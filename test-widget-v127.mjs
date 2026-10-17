import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const widget = readFileSync(new URL("./public/widget.js", import.meta.url), "utf8");
const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const server = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");

test("uploaded audio in the Retro Room widget resolves to Mixtap, not the game host", () => {
  const helper = widget.match(/  function uploadedAudioUrl\(track\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper, "expected audio URL resolver");
  const getUrl = new Function("state", "window", "URL", helper + "\nreturn uploadedAudioUrl;");
  const fn = getUrl({ hubUrl: "https://mixtap.ljas.ca" }, { location: { origin: "https://retro.ljas.ca" } }, URL);
  const id = "12345678-1234-1234-1234-123456789012";
  assert.equal(fn({ url: "/api/audio/" + id }), "https://mixtap.ljas.ca/api/audio/" + id);
  assert.match(widget, /audio\.src = uploadedAudioUrl\(track\)/);
  assert.match(server, /"Cross-Origin-Resource-Policy": "cross-origin"/);
});

test("minimize and close both dock, restoring can retry audio playback", () => {
  assert.match(widget, /\[data-minimize\]"\)\.addEventListener\("click", \(\) => toggleDock\(root, true\)\)/);
  assert.match(widget, /\[data-close\]"\)\.addEventListener\("click", \(\) => toggleDock\(root, true\)\)/);
  assert.match(widget, /state\.audioPlayer\.play\(\)\.catch/);
});

test("widget returns to natural height after closing Track List", () => {
  assert.match(widget, /min-height: 0;/);
  assert.match(widget, /\.r96-track-drawer\[hidden\] \{ display: none !important; \}/);
  assert.doesNotMatch(widget, /--r96-user-height|setHeight\(|savedHeight/);
  assert.match(widget, /data-track-toggle/);
});

test("playlist editor supports selecting multiple uploaded songs and saving in one action", () => {
  for (const id of ["playlistSongPicker", "selectedSongCount", "selectAllPlaylistSongs", "clearPlaylistSongs", "saveNamedPlaylist", "savedPlaylistSelect"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /function renderSongPicker\(\)/);
  assert.match(html, /querySelectorAll\("input\[data-song-id\]:checked"\)/);
  assert.match(html, /const selectedUploads = audioLibrary\.filter/);
  assert.match(html, /playlist = \[\.\.\.selectedUploads, \.\.\.onlineLinks\]/);
  assert.match(server, /const playlistsFile = join\(dataDir, "saved-playlists.json"\)/);
});

test("radio setup identifies source, playlist and start action", () => {
  assert.match(html, /Start broadcasting in three steps/);
  assert.match(html, /id="radioSource"/);
  assert.match(html, /id="radioMixSelect"/);
  assert.match(html, /id="startAutoRadio"/);
  assert.match(server, /const radioFile = join\(dataDir, "auto-radio.json"\)/);
});
