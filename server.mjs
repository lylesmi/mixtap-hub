import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(__dirname, "public");
const dataDir = process.env.MIXTAP_DATA_DIR || process.env.DATA_DIR || join(__dirname, "data");
const adminToken = process.env.MIXTAP_ADMIN_TOKEN || "";
const APP_VERSION = "1.1.2";
const publicOrigin = process.env.MIXTAP_PUBLIC_ORIGIN || "https://mixtap.ljas.ca";
const dataFile = join(dataDir, "rooms.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

let rooms = {};
let writeQueue = Promise.resolve();

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8"
};

function headers(type = "application/json; charset=utf-8") {
  return {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": type.startsWith("text/javascript") ? "public, max-age=300" : "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}

function send(res, status, body, type) {
  res.writeHead(status, headers(type));
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function emptyRoom() {
  return {
    playlist: [],
    index: 0,
    playing: false,
    position: 0,
    startedAt: 0,
    updatedAt: 0,
    version: "empty"
  };
}

async function loadRooms() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    rooms = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Could not read data/rooms.json:", error.message);
    rooms = {};
  }
}

function saveRoom(room, payload) {
  // Queue writes and publish a room to readers only after the disk write succeeds.
  // The caller must see a failed write, not a misleading HTTP 200.
  const operation = writeQueue.then(async () => {
    const nextRooms = { ...rooms, [room]: payload };
    await mkdir(dataDir, { recursive: true });
    const tempFile = `${dataFile}.tmp`;
    await writeFile(tempFile, JSON.stringify(nextRooms, null, 2));
    await rename(tempFile, dataFile);
    rooms = nextRooms;
  });
  // A failure must not permanently prevent subsequent writes from retrying.
  writeQueue = operation.catch((error) => {
    console.error("Could not save data/rooms.json:", error);
  });
  return operation;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeRoom(pathname) {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (!match) return "";
  return decodeURIComponent(match[1]).replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
}

function detectProvider(rawUrl) {
  if (/youtu\.be|youtube\.com/i.test(rawUrl)) return "youtube";
  if (/spotify\.com/i.test(rawUrl)) return "spotify";
  return "";
}

function extractId(rawUrl, provider) {
  if (provider === "youtube") {
    const shortMatch = rawUrl.match(/youtu\.be\/([^?&#/]+)/i);
    if (shortMatch) return shortMatch[1];
    const watchMatch = rawUrl.match(/[?&]v=([^?&#]+)/i);
    if (watchMatch) return watchMatch[1];
    const embedMatch = rawUrl.match(/youtube\.com\/embed\/([^?&#/]+)/i);
    if (embedMatch) return embedMatch[1];
  }
  if (provider === "spotify") {
    const match = rawUrl.match(/spotify\.com\/(track|episode|playlist|album)\/([^?&#/]+)/i);
    return match ? `${match[1]}:${match[2]}` : "";
  }
  return "";
}

function buildUrl(provider, id, fallback) {
  if (fallback) return fallback;
  if (provider === "youtube") return `https://www.youtube.com/watch?v=${id}`;
  if (provider === "spotify") {
    const parts = String(id || "").split(":");
    if (parts.length === 2) return `https://open.spotify.com/${parts[0]}/${parts[1]}`;
  }
  return "";
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanTitle(title, provider) {
  let value = decodeHtml(title).trim();
  value = value.replace(/\s+\|\s+Spotify$/i, "");
  value = value.replace(/\s+-\s+YouTube$/i, "");
  if (provider === "spotify") {
    value = value.replace(/\s+-\s+song and lyrics by .+$/i, "");
    value = value.replace(/\s+-\s+song by .+$/i, "");
  }
  return value.trim();
}

function inferAuthorFromTitle(title) {
  const value = decodeHtml(title).trim();
  const spotifyMatch = value.match(/\s+-\s+song(?: and lyrics)? by\s+(.+?)(?:\s+\|\s+Spotify)?$/i);
  if (spotifyMatch) return spotifyMatch[1].trim();
  return "";
}

function readMeta(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const hasName = new RegExp(`(?:property|name)=["']${property}["']`, "i").test(tag);
    if (!hasName) continue;
    const match = tag.match(/content=["']([^"']+)["']/i);
    if (match) return decodeHtml(match[1]);
  }
  return "";
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return {};
  return response.json();
}

async function fetchPageMeta(rawUrl) {
  const response = await fetch(rawUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 Retro96MetadataBot"
    }
  });
  if (!response.ok) return {};
  const html = await response.text();
  return {
    title: readMeta(html, "og:title") || readMeta(html, "twitter:title") || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || "",
    author: readMeta(html, "music:musician") || readMeta(html, "og:site_name") || "",
    thumbnail: readMeta(html, "og:image") || readMeta(html, "twitter:image") || ""
  };
}

async function lookupMetadata(rawUrl) {
  // Keep metadata fetching restricted to supported public music providers.
  // A text regex alone also matches attacker-controlled hosts containing "youtube.com".
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return { error: "Invalid URL" }; }
  const hostname = parsed.hostname.toLowerCase();
  const validHost = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "open.spotify.com"].includes(hostname);
  if (parsed.protocol !== "https:" || !validHost || parsed.username || parsed.password || rawUrl.length > 2048)
    return { error: "Unsupported URL. Use an HTTPS YouTube or Spotify link." };
  const provider = detectProvider(rawUrl);
  const id = extractId(rawUrl, provider);
  if (!rawUrl || !provider || !id) {
    return { error: "Unsupported URL. Use a YouTube or Spotify link." };
  }

  const endpoint = provider === "spotify"
    ? `https://open.spotify.com/oembed?url=${encodeURIComponent(rawUrl)}`
    : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(rawUrl)}`;

  const oembed = await fetchJson(endpoint).catch(() => ({}));
  const pageMeta = oembed.title ? {} : await fetchPageMeta(rawUrl).catch(() => ({}));
  const rawTitle = oembed.title || pageMeta.title || "";
  const title = cleanTitle(rawTitle, provider) || rawTitle || rawUrl;
  const author = oembed.author_name || inferAuthorFromTitle(rawTitle) || pageMeta.author || "";

  return {
    title,
    provider,
    id,
    url: buildUrl(provider, id, rawUrl),
    author: cleanTitle(author, provider),
    thumbnail: oembed.thumbnail_url || pageMeta.thumbnail || "",
    sourceTitle: oembed.provider_name || provider
  };
}

async function handleMetadata(req, res, url) {
  if (req.method === "OPTIONS") {
    send(res, 204, "", "text/plain; charset=utf-8");
    return true;
  }
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return true;
  }

  const result = await lookupMetadata(url.searchParams.get("url") || "");
  json(res, result.error ? 400 : 200, result);
  return true;
}

function verifyAdminRequest(req, res) {
  if (!adminToken) {
    json(res, 503, { ok: false, error: "Publishing is not configured. Add MIXTAP_ADMIN_TOKEN to Mixtap in LaunchDock." });
    return false;
  }
  const origin = req.headers.origin || "";
  if (origin && origin !== publicOrigin) {
    json(res, 403, { ok: false, error: "This publishing request came from an unapproved website." });
    return false;
  }
  const bearer = String(req.headers.authorization || "");
  const presented = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  const expected = Buffer.from(adminToken);
  const actual = Buffer.from(presented);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    json(res, 401, { ok: false, error: "Incorrect publishing key. Check the saved MIXTAP_ADMIN_TOKEN." });
    return false;
  }
  return true;
}

function handleVerifyPublishing(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  if (!verifyAdminRequest(req, res)) return;
  json(res, 200, { ok: true, verified: true });
}

async function handleRoom(req, res, url) {
  const room = safeRoom(url.pathname);
  if (!room) {
    json(res, 404, { error: "Room not found" });
    return true;
  }
  if (req.method === "OPTIONS") {
    send(res, 204, "", "text/plain; charset=utf-8");
    return true;
  }
  if (req.method === "GET") {
    json(res, 200, rooms[room] || emptyRoom());
    return true;
  }
  if (req.method === "PUT") {
    if (!verifyAdminRequest(req, res)) return;
    let incoming;
    try { incoming = JSON.parse(await readBody(req) || "{}"); }
    catch { return json(res, 400, { error: "Invalid JSON" }); }
    const payload = {
      playlist: Array.isArray(incoming.playlist) ? incoming.playlist.slice(0, 100).map((track) => ({
        title: String(track?.title || "").slice(0, 200),
        provider: String(track?.provider || "").slice(0, 30),
        id: String(track?.id || "").slice(0, 150),
        url: String(track?.url || "").slice(0, 1500),
        author: String(track?.author || "").slice(0, 200),
        thumbnail: String(track?.thumbnail || "").slice(0, 1500)
      })) : [],
      index: Number(incoming.index || 0),
      playing: Boolean(incoming.playing),
      position: Number(incoming.position || 0),
      startedAt: Number(incoming.startedAt || 0),
      updatedAt: Date.now(),
      version: incoming.version || String(Date.now())
    };
    try {
      await saveRoom(room, payload);
    } catch (_) {
      json(res, 503, { ok: false, error: "Could not save the shared room. No playlist changes were published. Check Mixtap storage." });
      return true;
    }
    json(res, 200, payload);
    return true;
  }
  json(res, 405, { error: "Method not allowed" });
  return true;
}

async function handleStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicRoot, pathname));
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + sep)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await readFile(filePath);
    send(res, 200, req.method === "HEAD" ? "" : file, types[extname(filePath)] || "application/octet-stream");
  } catch (_) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

await loadRooms();

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "retro96-mixtap", version: APP_VERSION, storageConfigured: Boolean(process.env.MIXTAP_DATA_DIR || process.env.DATA_DIR) });
      return;
    }
    if (url.pathname === "/api/publishing/verify") {
      handleVerifyPublishing(req, res);
      return;
    }
    if (url.pathname === "/api/metadata") {
      await handleMetadata(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/rooms/")) {
      await handleRoom(req, res, url);
      return;
    }
    await handleStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: error.message || "Server error" });
  }
}).listen(port, host, () => {
  console.log(`Retro 96 Mixtape Hub running at http://${host}:${port}`);
});
