import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('./public/widget.js', import.meta.url), 'utf8');
const block = script.match(/  function volumeGain\(percentage\) \{[\s\S]*?\n  \}\n\n  function youtubeVolume\(percentage\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(block, 'The production widget must define the tested volume mapping');
const { volumeGain, youtubeVolume } = runInNewContext(block + '\n({volumeGain, youtubeVolume})');

test('5% is barely audible but not muted', () => {
  assert.ok(volumeGain(5) > 0 && volumeGain(5) < 0.01);
  assert.equal(youtubeVolume(5), 1);
});

test('the endpoints and nearby steps map smoothly', () => {
  assert.equal(volumeGain(0), 0);
  assert.equal(youtubeVolume(0), 0);
  assert.equal(volumeGain(100), 1);
  assert.equal(youtubeVolume(100), 100);
  assert.ok(volumeGain(10) < 0.02);
  assert.ok(volumeGain(25) < 0.1);
  assert.ok(volumeGain(50) > volumeGain(25));
  assert.ok(volumeGain(75) > volumeGain(50));
  for (let v = 5; v <= 100; v += 5) {
    assert.ok(volumeGain(v) > volumeGain(v - 5));
    assert.ok(youtubeVolume(v) >= youtubeVolume(v - 5));
  }
});

test('invalid and out-of-range percentages are clamped', () => {
  assert.equal(volumeGain(-10), 0);
  assert.equal(volumeGain(200), 1);
  assert.equal(volumeGain('oops'), 0);
});

test('both HTML audio and YouTube commands use the same curve', () => {
  assert.match(script, /audio\.volume = volumeGain\(state\.volume\)/);
  assert.match(script, /state\.audioPlayer\.volume = volumeGain\(state\.volume\)/);
  assert.match(script, /func: "setVolume", args: \[youtubeVolume\(state\.volume\)\]/);
});

test('YouTube volume is retried after the player is ready or playing', () => {
  assert.match(script, /payload\.event === "onReady"/);
  assert.match(script, /payload\.event === "onStateChange" && Number\(payload\.info\) === 1/);
});
