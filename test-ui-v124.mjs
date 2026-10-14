import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./public/index.html', import.meta.url),'utf8');
const server = readFileSync(new URL('./server.mjs', import.meta.url),'utf8');
const dom = html.slice(0,html.indexOf('    const STORAGE_KEY'));

test('playlist editor has a single top selection and bottom Save',()=>{
  assert.match(dom,/id="savedPlaylistSelect"/);
  assert.match(dom,/id="newPlaylist"/);
  assert.match(dom,/id="playlistAudioSelect"/);
  assert.match(dom,/id="saveNamedPlaylist"/);
  assert.doesNotMatch(dom,/<h2>Saved mixes<\/h2>/);
  assert.doesNotMatch(dom,/id="loadSavedPlaylist"/);
  assert.doesNotMatch(dom,/id="saveNewPlaylist"/);
});
test('two add-music choices and two radio sources are present',()=>{
  for(const id of ['sourceUploaded','sourceLinks','playlistUploadedPanel','playlistLinksPanel','radioSource'])assert.match(dom,new RegExp('id="'+id+'"'));
  const radio = dom.match(/<select id="radioSource">([\s\S]*?)<\/select>/)?.[1] || '';
  assert.match(radio,/value="upload"/);
  assert.match(radio,/value="stream"/);
  assert.doesNotMatch(radio,/value="youtube"|value="spotify"|value="links"/);
});
test('track labels and new playlist clear logic remain wired',()=>{
  assert.match(html,/classifyPlaylist\(playlist\)/);
  assert.match(html,/provider === "upload" \? "Music library"/);
  assert.match(html,/window\.Retro96Player\.updatePlaylist\(playlist, \{ preferOwnPlaylist: true \}\)/);
  assert.match(html,/els\.newPlaylist\.addEventListener/);
  assert.match(html,/els\.saveNamedPlaylist\.addEventListener/);
});
test('authenticated YouTube playlist import has paginated API logic and bounded tracks',()=>{
  assert.match(server,/YOUTUBE_API_KEY/);
  assert.match(server,/verifyAdminRequest\(req,res\)/);
  assert.match(server,/youtube\/v3\/playlistItems/);
  assert.match(server,/nextPageToken/);
  assert.match(server,/MAX_PLAYLIST_TRACKS = 500/);
  assert.match(html,/\/api\/youtube-playlist\/import/);
});
test('core Mixtap hosting, storage, and widget remain untouched',()=>{
  assert.match(server,/const playlistsFile = join\(dataDir, "saved-playlists.json"\)/);
  assert.match(server,/const audioDir = join\(dataDir, "audio"\)/);
  assert.match(server,/const radioFile = join\(dataDir, "auto-radio.json"\)/);
  assert.match(html,/id="audioUploadFiles"/);
  assert.match(html,/src="widget.js"/);
});
