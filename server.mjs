import { createServer } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink, stat, open } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(__dirname, "public");
const dataDir = process.env.MIXTAP_DATA_DIR || process.env.DATA_DIR || join(__dirname, "data");
const adminToken = process.env.MIXTAP_ADMIN_TOKEN || "";
const APP_VERSION = "1.2.8";
const MAX_PLAYLIST_TRACKS = 500;
const publicOrigin = process.env.MIXTAP_PUBLIC_ORIGIN || "https://mixtap.ljas.ca";
const dataFile = join(dataDir, "rooms.json");
const playlistsFile = join(dataDir, "saved-playlists.json");
const libraryFile = join(dataDir, "audio-library.json");
const radioFile = join(dataDir, "auto-radio.json");
const audioDir = join(dataDir, "audio");
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 1024 * 1024 * 1024;
const audioExtensions = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" };
const ffprobe = promisify(execFile);
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

let rooms = {};
let savedPlaylists = {};
let playlistWriteQueue = Promise.resolve();
let writeQueue = Promise.resolve();
let audioLibrary = {};
let audioMetadataRevision = 0;
let autoRadio = null;
let libraryWriteQueue = Promise.resolve();
let autoRadioWriteQueue = Promise.resolve();
let currentUploads = 0;

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
    "Cache-Control": type.startsWith("text/javascript") ? "no-cache, must-revalidate" : "no-store",
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

async function loadPlaylists() {
  try {
    const raw = JSON.parse(await readFile(playlistsFile, "utf8"));
    savedPlaylists = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Could not read saved-playlists.json:", error.message);
    savedPlaylists = {};
  }
}

function safeTracks(value) {
  return Array.isArray(value) ? value.slice(0, MAX_PLAYLIST_TRACKS).map((track) => ({
    title: String(track?.title || "").slice(0, 200),
    provider: String(track?.provider || "").slice(0, 30),
    id: String(track?.id || "").slice(0, 150),
    url: String(track?.url || "").slice(0, 1500),
    author: String(track?.author || "").slice(0, 200),
    thumbnail: String(track?.thumbnail || "").slice(0, 1500),
    kind: track?.kind === "youtube-playlist" ? "youtube-playlist" : "track",
    listId: String(track?.listId || "").slice(0, 100),
    duration: Number.isFinite(Number(track?.duration)) ? Math.max(0, Math.min(86400, Number(track.duration))) : 0
  })) : [];
}

function persistPlaylists(update) {
  const operation = playlistWriteQueue.then(async () => {
    const next = typeof update === "function" ? update(savedPlaylists) : update;
    await mkdir(dataDir, { recursive: true });
    const tmp = `${playlistsFile}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2));
    await rename(tmp, playlistsFile);
    savedPlaylists = next;
  });
  playlistWriteQueue = operation.catch(e => console.error("Could not save playlists:", e));
  return operation;
}

async function handlePlaylists(req, res, url) {
  if (req.method === "OPTIONS") { send(res, 204, "", "text/plain; charset=utf-8"); return; }
  const match = /^\/api\/playlists(?:\/([a-z0-9-]{1,80}))?$/i.exec(url.pathname);
  if (!match) { json(res, 404, { error: "Unknown playlist" }); return; }
  const id = match[1];
  if (req.method === "GET") {
    if (!id) {
      json(res, 200, { playlists: Object.values(savedPlaylists).map(({ id, name, updatedAt, tracks }) => ({ id, name, updatedAt, count: tracks.length,
        type: tracks.length === 0 ? "Empty" : tracks.every(t=>t.provider==="upload") ? "Music library" : tracks.every(t=>["youtube","spotify"].includes(t.provider)) ? "Stream" : "Mixed" })) });
    } else if (savedPlaylists[id]) json(res, 200, { ...savedPlaylists[id], tracks: canonicalUploadedTracks(savedPlaylists[id].tracks) });
    else json(res, 404, { error: "Playlist not found" });
    return;
  }
  if (!verifyAdminRequest(req, res)) return;
  if (req.method === "PUT" && id) {
    let input;
    try { input = JSON.parse(await readBody(req) || "{}"); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
    const name = String(input.name || "").trim().slice(0, 70);
    if (!name || !Array.isArray(input.tracks) || input.tracks.length > MAX_PLAYLIST_TRACKS) { json(res, 400, { error: "Provide a playlist name and up to 500 tracks" }); return; }
    const item = { id, name, tracks: canonicalUploadedTracks(safeTracks(input.tracks)), updatedAt: Date.now() };
    try { await persistPlaylists(previous => ({ ...previous, [id]: item })); }
    catch { json(res, 503, { error: "Playlist storage failed; previous saved playlists remain intact" }); return; }
    json(res, 200, item);
    return;
  }
  if (req.method === "POST" && !id) {
    let input;
    try { input = JSON.parse(await readBody(req) || "{}"); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
    const name = String(input.name || "").trim().slice(0, 70);
    if (!name || !Array.isArray(input.tracks) || input.tracks.length > MAX_PLAYLIST_TRACKS) { json(res, 400, { error: "Provide a playlist name and up to 500 tracks" }); return; }
    const newId = randomUUID();
    const item = { id: newId, name, tracks: canonicalUploadedTracks(safeTracks(input.tracks)), updatedAt: Date.now() };
    try { await persistPlaylists(previous => ({ ...previous, [newId]: item })); }
    catch { json(res, 503, { error: "Playlist storage failed; no changes were saved" }); return; }
    json(res, 201, item);
    return;
  }
  if (req.method === "DELETE" && id) {
    if (!savedPlaylists[id]) { json(res, 404, { error: "Playlist not found" }); return; }
    try { await persistPlaylists(previous => { const next = { ...previous }; delete next[id]; return next; }); }
    catch { json(res, 503, { error: "Playlist storage failed" }); return; }
    json(res, 200, { ok: true }); return;
  }
  json(res, 405, { error: "Method not allowed" });
}

// Uploads are administrator-only; streaming is intentionally public so radio works on Retro Room.
// Store audio and station metadata in the existing /var/data persistent Docker volume.
async function readJsonOr(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") console.error(`Cannot read ${path}:`, error); return fallback; }
}
async function atomicJson(path, value) {
  await mkdir(dataDir, { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try { await rename(temp, path); } catch (e) { await unlink(temp).catch(() => {}); throw e; }
}
async function loadAudioData() {
  await mkdir(audioDir, { recursive: true, mode: 0o700 });
  const library = await readJsonOr(libraryFile, {});
  audioLibrary = library && typeof library === "object" && !Array.isArray(library) ? library : {};
  const saved = await readJsonOr(radioFile, null);
  autoRadio = saved && saved.active && Array.isArray(saved.trackIds) ? saved : null;
}
function audioRecord(item) {
  return { provider: "upload", id: item.id, url: `/api/audio/${item.id}`, title: item.title, author: item.author, thumbnail: "", duration: item.duration, kind: "track", listId: "" };
}
function fromAudioTrack(track) {
  const id = String(track?.id || "");
  return String(track?.provider || "") === "upload" ? audioLibrary[id] : null;
}
// The uploaded-song record is the source of truth for names, even when a
// playlist or radio queue was saved before a song was renamed.
function canonicalUploadedTrack(track) {
  const item = fromAudioTrack(track);
  return item ? { ...track, title: item.title, author: item.author } : track;
}
function canonicalUploadedTracks(tracks) {
  return Array.isArray(tracks) ? tracks.map(canonicalUploadedTrack) : [];
}
function canonicalRoomSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  let changed = false;
  const update = (track) => {
    if (!track) return track;
    const next = canonicalUploadedTrack(track);
    if (next.title !== track.title || next.author !== track.author) changed = true;
    return next;
  };
  const playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist.map(update) : [];
  const activeTrack = update(snapshot.activeTrack);
  if (!changed) return snapshot;
  return {
    ...snapshot, playlist, activeTrack,
    version: `${snapshot.version || "unknown"}:audio-titles:${audioMetadataRevision}`
  };
}
function currentAutoRadio(room) {
  const station = autoRadio;
  if (!station?.active || station.room !== room) return null;
  const tracks = station.trackIds.map(id => audioLibrary[id]).filter(Boolean);
  if (tracks.length !== station.trackIds.length || !tracks.length) return null;
  const total = tracks.reduce((sum, x) => sum + x.duration, 0);
  if (!(total > 0)) return null;
  const elapsed = Math.max(0, (Date.now() - station.startedAt) / 1000);
  let remaining = elapsed % total;
  let index = 0;
  for (; index < tracks.length - 1; index++) {
    if (remaining < tracks[index].duration) break;
    remaining -= tracks[index].duration;
  }
  const cycle = Math.floor(elapsed / total);
  return { playlist: tracks.map(audioRecord), activeTrack: audioRecord(tracks[index]),
    index, playing: true, position: remaining, startedAt: Date.now(),
    updatedAt: Date.now(), version: `auto:${station.startedAt}:${cycle}:${index}:meta${audioMetadataRevision}`, autoDJ: true };
}
function validatedRoom(input) {
  const room = String(input || "retro96").replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
  return room || "retro96";
}
async function handleAudioLibrary(req, res, url) {
  if (req.method === "OPTIONS") { send(res, 204, "", "text/plain; charset=utf-8"); return; }
  if (url.pathname === "/api/audio-library" && req.method === "GET") {
    json(res, 200, { songs: Object.values(audioLibrary).map(audioRecord), totalBytes: Object.values(audioLibrary).reduce((sum, x) => sum + (x.bytes || 0), 0), maxBytes: MAX_LIBRARY_BYTES });
    return;
  }
  if (!verifyAdminRequest(req, res)) return;
  if (url.pathname === "/api/audio-library" && req.method === "POST") {
    if (currentUploads) { json(res, 429, { error: "Another audio upload is already running. Try again shortly." }); return; }
    const name = String(url.searchParams.get("name") || "").slice(0, 150).trim();
    const author = String(url.searchParams.get("artist") || "").slice(0, 150).trim();
    const ext = String(name.split(".").pop() || "").toLowerCase();
    if (!name || !audioExtensions[ext]) { json(res, 415, { error: "Supported uploads: MP3, M4A, OGG and WAV." }); return; }
    const total = Object.values(audioLibrary).reduce((sum, x) => sum + (x.bytes || 0), 0);
    const rawLength = req.headers["content-length"];
    const declared = rawLength === undefined ? null : Number(rawLength);
    if ((declared !== null && (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_UPLOAD_BYTES)) || total >= MAX_LIBRARY_BYTES || (declared !== null && total + declared > MAX_LIBRARY_BYTES)) {
      json(res, 413, { error: "Upload exceeds the 45 MB per-song or 1 GB library limit." }); return;
    }
    currentUploads++;
    const id = randomUUID();
    const path = join(audioDir, `${id}.${ext}`);
    let bytes = 0;
    try {
      await mkdir(audioDir, { recursive: true });
      const limit = new Transform({ transform(chunk, _enc, done) {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES || total + bytes > MAX_LIBRARY_BYTES || (declared !== null && bytes > declared)) done(new Error("Audio upload exceeded permitted size"));
        else done(null, chunk);
      }});
      await pipeline(req, limit, createWriteStream(path, { flags: "wx", mode: 0o600 }));
      if (!bytes || (declared !== null && bytes !== declared)) throw new Error("Incomplete upload");
      const { stdout } = await ffprobe("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path], { timeout: 18000, maxBuffer: 65536 });
      const info = JSON.parse(stdout);
      const audio = (info.streams || []).filter(s => s.codec_type === "audio");
      const video = (info.streams || []).filter(s => s.codec_type === "video");
      const duration = Number(audio[0]?.duration || info.format?.duration);
      const allowedCodecs = ["mp3", "aac", "vorbis", "opus", "pcm_s16le", "pcm_s24le", "pcm_u8", "flac"];
      if (audio.length !== 1 || video.length || !allowedCodecs.includes(audio[0].codec_name) || !Number.isFinite(duration) || duration < 1 || duration > 7200) {
        throw new Error("Not a supported audio-only file (maximum duration 2 hours)");
      }
      const tags = {...(info.format?.tags || {}), ...(audio[0]?.tags || {})};
      const tag = (key) => String(Object.entries(tags).find(([k]) => k.toLowerCase() === key)?.[1] || "").trim().slice(0, 140);
      const item = { id, filename: `${id}.${ext}`, title: tag("title") || name.replace(/\.[^.]+$/, "").slice(0, 140), author: author || tag("artist"), duration, bytes, uploadedAt: Date.now(), mime: audioExtensions[ext] };
      await (libraryWriteQueue = libraryWriteQueue.catch(() => {}).then(async () => {
        const next = { ...audioLibrary, [id]: item }; await atomicJson(libraryFile, next); audioLibrary = next;
      }));
      json(res, 201, { song: audioRecord(item), bytes });
    } catch (error) {
      await unlink(path).catch(() => {});
      json(res, 422, { error: error.message || "Upload failed" });
    } finally { currentUploads--; }
    return;
  }
  const match = /^\/api\/audio-library\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (match && req.method === "PATCH") {
    const id = match[1];
    if (!audioLibrary[id]) { json(res, 404, { error: "Song not found" }); return; }
    let input;
    try { input = JSON.parse(await readBody(req) || "{}"); }
    catch { json(res, 400, { error: "Invalid JSON" }); return; }
    if (typeof input.title !== "string" || !input.title.trim() ||
        input.title.trim().length > 140 || /[\u0000-\u001f\u007f]/.test(input.title)) {
      json(res, 400, { error: "Enter a title between 1 and 140 characters." }); return;
    }
    const title = input.title.trim();
    try {
      const updated = await (libraryWriteQueue = libraryWriteQueue.catch(() => {}).then(async () => {
        if (!audioLibrary[id]) return null;
        const item = { ...audioLibrary[id], title };
        const next = { ...audioLibrary, [id]: item };
        await atomicJson(libraryFile, next);
        audioLibrary = next;
        audioMetadataRevision++;
        return item;
      }));
      if (!updated) { json(res, 404, { error: "Song not found" }); return; }
      json(res, 200, { song: audioRecord(updated) });
    } catch (error) {
      console.error("Audio title update failed:", error);
      json(res, 503, { error: "Could not save the new title. Existing title is unchanged." });
    }
    return;
  }
  if (match && req.method === "DELETE") {
    const id = match[1]; const item = audioLibrary[id];
    if (!item) { json(res, 404, { error: "Song not found" }); return; }
    if (autoRadio?.active && autoRadio.trackIds.includes(id)) { json(res, 409, { error: "Stop Auto Radio before deleting a song it is playing." }); return; }
    await (libraryWriteQueue = libraryWriteQueue.catch(() => {}).then(async () => {
      const next = { ...audioLibrary }; delete next[id]; await atomicJson(libraryFile, next); audioLibrary = next;
    }));
    // Remove the file only after metadata no longer lists it.
    await unlink(join(audioDir, item.filename)).catch(e => console.error("Audio delete file error", e));
    json(res, 200, { ok: true }); return;
  }
  json(res, 405, { error: "Method not allowed" });
}
async function handleAudioStream(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) { json(res, 405, { error: "Method not allowed" }); return; }
  const match = /^\/api\/audio\/([a-f0-9-]{36})$/.exec(url.pathname);
  const item = match && audioLibrary[match[1]];
  if (!item) { json(res, 404, { error: "Song not found" }); return; }
  const path = join(audioDir, item.filename);
  let size;
  try { size = (await stat(path)).size; } catch { json(res, 404, { error: "Audio file missing" }); return; }
  const range = String(req.headers.range || "");
  let start = 0, end = size - 1;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (m[1] === "" && m[2] === "")) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    else { const suffix = Number(m[2]); start = Math.max(0, size - suffix); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return; }
  }
  const h = { ...headers(item.mime), "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
    "Content-Disposition": "inline", "Cache-Control": "public, max-age=3600" };
  if (range) h["Content-Range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, h);
  if (req.method === "HEAD") { res.end(); return; }
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
async function handleAutoRadio(req, res, url) {
  if (req.method === "OPTIONS") { send(res, 204, "", "text/plain; charset=utf-8"); return; }
  if (req.method === "GET") {
    const room = validatedRoom(url.searchParams.get("room") || "retro96");
    json(res, 200, { active: Boolean(autoRadio?.active && autoRadio.room === room), room,
      now: currentAutoRadio(room), trackCount: autoRadio?.room === room ? autoRadio.trackIds.length : 0 }); return;
  }
  if (!verifyAdminRequest(req, res)) return;
  if (req.method !== "POST") { json(res, 405, { error: "Method not allowed" }); return; }
  let input;
  try { input = JSON.parse(await readBody(req) || "{}"); }
  catch { json(res, 400, { error: "Invalid JSON" }); return; }
  const room = validatedRoom(input.room);
  if (url.pathname === "/api/radio/stop") {
    await (autoRadioWriteQueue = autoRadioWriteQueue.catch(() => {}).then(async () => { await atomicJson(radioFile, { active: false }); autoRadio = null; }));
    json(res, 200, { active: false }); return;
  }
  if (url.pathname === "/api/radio/start") {
    const ids = Array.isArray(input.trackIds) ? input.trackIds.slice(0, 100).map(String) : [];
    if (!ids.length || ids.length > 100 || ids.some(id => !audioLibrary[id] || audioLibrary[id].duration < 1)) {
      json(res, 400, { error: "Choose at least one uploaded song. YouTube and Spotify links cannot be used for 24/7 Auto Radio." }); return;
    }
    for (const id of ids) {
      try { await stat(join(audioDir, audioLibrary[id].filename)); }
      catch { json(res, 409, { error: `Song file missing: ${audioLibrary[id].title}` }); return; }
    }
    const station = { active: true, room, trackIds: ids, startedAt: Date.now() };
    await (autoRadioWriteQueue = autoRadioWriteQueue.catch(() => {}).then(async () => { await atomicJson(radioFile, station); autoRadio = station; }));
    json(res, 200, { active: true, room, now: currentAutoRadio(room) }); return;
  }
  json(res, 404, { error: "Unknown radio command" });
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
    if (embedMatch && embedMatch[1] !== "videoseries") return embedMatch[1];
    const listMatch = rawUrl.match(/[?&]list=([a-zA-Z0-9_-]{8,100})/i);
    if (listMatch) return `playlist:${listMatch[1]}`;
  }
  if (provider === "spotify") {
    const match = rawUrl.match(/spotify\.com\/(track|episode|playlist|album)\/([^?&#/]+)/i);
    return match ? `${match[1]}:${match[2]}` : "";
  }
  return "";
}

function buildUrl(provider, id, fallback) {
  if (fallback) return fallback;
  if (provider === "youtube") return String(id).startsWith("playlist:") ? `https://www.youtube.com/playlist?list=${id.slice(9)}` : `https://www.youtube.com/watch?v=${id}`;
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
    sourceTitle: oembed.provider_name || provider,
    kind: provider === "youtube" && id.startsWith("playlist:") ? "youtube-playlist" : "track",
    listId: provider === "youtube" && id.startsWith("playlist:") ? id.slice(9) : ""
  };
}


function youtubePlaylistId(raw) {
  try {
    const u=new URL(String(raw||""));
    if(u.protocol!=="https:" || !["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com"].includes(u.hostname.toLowerCase()) || u.username || u.password) return "";
    const id=u.searchParams.get("list")||"";
    return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:"";
  }catch{return "";}
}
// The official YouTube Data API paginates to 50 playlist items per request.
// The key is held on the server only and never sent to the browser.
async function handleYoutubePlaylistImport(req,res) {
  if(req.method==="OPTIONS"){send(res,204,"","text/plain; charset=utf-8");return;}
  if(req.method!=="POST"){json(res,405,{error:"Method not allowed"});return;}
  if(!verifyAdminRequest(req,res))return;
  const key=String(process.env.YOUTUBE_API_KEY||"").trim();
  if(!key){json(res,503,{error:"YouTube playlist importing needs YOUTUBE_API_KEY in your Mixtap LaunchDock environment. This is required to list individual playlist videos reliably."});return;}
  let input;
  try{input=JSON.parse(await readBody(req)||"{}");}catch{json(res,400,{error:"Invalid request JSON"});return;}
  const id=youtubePlaylistId(input.url);
  if(!id){json(res,400,{error:"Paste a valid HTTPS YouTube playlist link with a list ID."});return;}
  const tracks=[];
  let token="",more=false,pages=0;
  do {
    const api=new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    api.searchParams.set("part","snippet,contentDetails");
    api.searchParams.set("playlistId",id);
    api.searchParams.set("maxResults","50");
    api.searchParams.set("key",key);
    if(token)api.searchParams.set("pageToken",token);
    let response,data;
    try{
      response=await fetch(api,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(12000)});
      data=await response.json();
    }catch{json(res,502,{error:"YouTube could not be reached. No tracks were imported."});return;}
    if(!response.ok){
      const reason=response.status===403 ? "Your YouTube API key is invalid, disabled or out of quota." :
        response.status===404 ? "YouTube playlist not found or not public." : "YouTube playlist lookup failed.";
      json(res,502,{error:reason+" No tracks were imported."});return;
    }
    for(const item of data.items||[]){
      const snippet=item.snippet||{},videoId=item.contentDetails?.videoId||snippet.resourceId?.videoId||"";
      const title=String(snippet.title||"").trim();
      if(!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title || /^(private video|deleted video)$/i.test(title))continue;
      tracks.push({title:title.slice(0,200),provider:"youtube",id:videoId,
        url:"https://www.youtube.com/watch?v="+videoId,author:String(snippet.videoOwnerChannelTitle||snippet.channelTitle||"").slice(0,200),
        thumbnail:String(snippet.thumbnails?.medium?.url||snippet.thumbnails?.default?.url||"").slice(0,1500),
        kind:"track",listId:id,duration:0});
      if(tracks.length>=MAX_PLAYLIST_TRACKS)break;
    }
    token=String(data.nextPageToken||"");
    pages++;
  }while(token && tracks.length<MAX_PLAYLIST_TRACKS && pages<30);
  more=Boolean(token);
  if(!tracks.length){json(res,422,{error:"No public, playable videos were found in this playlist."});return;}
  json(res,200,{playlistId:id,tracks,count:tracks.length,truncated:more,source:"YouTube Data API"});
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
    json(res, 200, canonicalRoomSnapshot(currentAutoRadio(room) || rooms[room] || emptyRoom()));
    return true;
  }
  if (req.method === "PUT") {
    if (!verifyAdminRequest(req, res)) return;
    let incoming;
    try { incoming = JSON.parse(await readBody(req) || "{}"); }
    catch { return json(res, 400, { error: "Invalid JSON" }); }
    const payload = {
      playlist: canonicalUploadedTracks(safeTracks(incoming.playlist)),
      activeTrack: incoming.activeTrack ? canonicalUploadedTrack(safeTracks([incoming.activeTrack])[0]) : null,
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
await loadPlaylists();
await loadAudioData();

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
    if (url.pathname === "/api/youtube-playlist/import") {
      await handleYoutubePlaylistImport(req,res);
      return;
    }
    if (url.pathname === "/api/playlists" || url.pathname.startsWith("/api/playlists/")) {
      await handlePlaylists(req, res, url);
      return;
    }
    if (url.pathname === "/api/audio-library" || url.pathname.startsWith("/api/audio-library/")) {
      await handleAudioLibrary(req, res, url); return;
    }
    if (url.pathname.startsWith("/api/audio/")) { await handleAudioStream(req, res, url); return; }
    if (url.pathname === "/api/radio" || url.pathname === "/api/radio/start" || url.pathname === "/api/radio/stop") {
      await handleAutoRadio(req, res, url); return;
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
