import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const server = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const widget = readFileSync(new URL("./public/widget.js", import.meta.url), "utf8");
const audioId = "12345678-1234-1234-1234-123456789012";
const original = {id: audioId, filename: audioId + ".mp3", title: "Original title", author: "Example", bytes: 999, duration: 123, mime: "audio/mpeg"};

function excerpt(start, end) {
  const i = server.indexOf(start), j = server.indexOf(end, i);
  assert.ok(i >= 0 && j > i, "server source section not found: " + start);
  return server.slice(i, j);
}

function makeAudioHandler() {
  const responses = [], writes = [];
  const context = {
    console, Math,
    send(res, status) { responses.push({status}); },
    json(res, status, body) { responses.push({status, body}); },
    verifyAdminRequest(req, res) { if (req.authorized) return true; responses.push({status: 401}); return false; },
    readBody: async req => req.body,
    audioRecord: item => ({ provider: "upload", id: item.id, url: "/api/audio/" + item.id, title: item.title, author: item.author }),
    atomicJson: async (path, value) => { writes.push(value); },
    libraryFile: "library.json",
  };
  const code = `
    let audioLibrary = { [${JSON.stringify(audioId)}]: ${JSON.stringify(original)} };
    let libraryWriteQueue = Promise.resolve();
    let audioMetadataRevision = 0;
    let currentUploads = 0;
    let autoRadio = null;
    ${excerpt("async function handleAudioLibrary(req, res, url) {", "async function handleAudioStream(req, res, url) {")}
    globalThis.handler = handleAudioLibrary;
    globalThis.state = () => ({ song: audioLibrary[${JSON.stringify(audioId)}], revision: audioMetadataRevision });
  `;
  runInNewContext(code, context);
  return {
    async patch(id, title, authorized = true) {
      responses.length = 0;
      await context.handler(
        { method: "PATCH", authorized, body: JSON.stringify({ title }) }, {},
        { pathname: "/api/audio-library/" + id });
      return responses.at(-1);
    },
    state: () => context.state(),
    writes
  };
}

test("rename persists only the title, never changes stored audio identity or file", async () => {
  const handler = makeAudioHandler();
  const response = await handler.patch(audioId, "Mixtape Friday");
  assert.equal(response.status, 200);
  assert.equal(response.body.song.title, "Mixtape Friday");
  const result = handler.state();
  assert.equal(result.song.filename, original.filename);
  assert.equal(result.song.id, original.id);
  assert.equal(result.song.duration, original.duration);
  assert.equal(result.song.author, original.author);
  assert.equal(result.revision, 1);
  assert.equal(handler.writes.length, 1);
});

test("song rename requires admin authorization and rejects invalid titles", async () => {
  const handler = makeAudioHandler();
  assert.equal((await handler.patch(audioId, "Bad rename", false)).status, 401);
  assert.equal((await handler.patch(audioId, "  ")).status, 400);
  assert.equal((await handler.patch(audioId, "a".repeat(141))).status, 400);
  assert.equal((await handler.patch(audioId, "Bad\nTitle")).status, 400);
  assert.equal((await handler.patch("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "No song")).status, 404);
  assert.equal(handler.state().song.title, original.title);
  assert.equal(handler.writes.length, 0);
});

test("saved playlist and manual radio titles resolve to the renamed library record", () => {
  const code = `
    let audioLibrary = { [${JSON.stringify(audioId)}]: { ...${JSON.stringify(original)}, title: "Renamed in library" } };
    let audioMetadataRevision = 2;
    ${excerpt("function audioRecord(item) {", "function currentAutoRadio(room) {")}
    globalThis.canonicalUploadedTracks = canonicalUploadedTracks;
    globalThis.canonicalRoomSnapshot = canonicalRoomSnapshot;
  `;
  const context = {};
  runInNewContext(code, context);
  const old = { provider: "upload", id: audioId, title: original.title, author: original.author };
  const external = { provider: "youtube", id: "abc", title: "Other" };
  const refreshed = context.canonicalUploadedTracks([old, external]);
  assert.equal(refreshed[0].title, "Renamed in library");
  assert.equal(refreshed[1].title, "Other");
  const snapshot = context.canonicalRoomSnapshot({ playlist: [old], activeTrack: old, version: "radio-123" });
  assert.equal(snapshot.playlist[0].title, "Renamed in library");
  assert.equal(snapshot.activeTrack.title, "Renamed in library");
  assert.notEqual(snapshot.version, "radio-123");
});

test("uploaded music list has a rename editor with Save, Cancel and error feedback", () => {
  assert.match(html, /rename\.textContent = "Rename"/);
  assert.match(html, /method: "PATCH"/);
  assert.match(html, /className = "audio-library-rename"/);
  assert.match(html, /save\.textContent = "Save"/);
  assert.match(html, /cancel\.textContent = "Cancel"/);
  assert.match(html, /adminPublishingKey/);
  assert.match(html, /loadAudioLibrary\(\)/);
});

test("active widget updates the song title without reloading the audio element", () => {
  assert.match(widget, /function renderLabels\(root\) \{/);
  assert.match(widget, /querySelector\("\[data-title\]"\)\.textContent = track\.title/);
  assert.match(widget, /const signature = track =>/);
  assert.match(widget, /if \(sameTrack\) renderLabels\(root\);/);
  assert.match(server, /audioMetadataRevision\+\+/);
  assert.match(server, /currentAutoRadio\(room\)/);
});
