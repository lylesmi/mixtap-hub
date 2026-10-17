import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const index = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
assert.match(index, /if \(!data\.playing\) \{[\s\S]*?radioPlayerBox\.replaceChildren\(\)/,
  'Mixtap page clears the currently playing element after Stop');
const widget = readFileSync(new URL('./public/widget.js', import.meta.url), 'utf8');
assert.match(widget, /if \(force \|\| oldId !== newId \|\| djChangedPlay/,
  'Widget updates its media element on server play or stop events');

async function freePort() {
  return new Promise((resolve,reject) => {
    const s=net.createServer();s.on('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
}

test('stopping 24/7 Radio stops shared playback, persists stop across restart', async () => {
  const dir=await mkdtemp(join(tmpdir(),'mixtap-radio-stop-'));
  const id='11111111-2222-4333-8444-555555555555';
  const song={id,provider:'upload',title:'Test only',author:'QA',duration:120,
    filename:'qa.mp3',mime:'audio/mpeg',bytes:200};
  await mkdir(join(dir,'audio'));
  await writeFile(join(dir,'audio-library.json'),JSON.stringify({[id]:song}));
  await writeFile(join(dir,'auto-radio.json'),JSON.stringify({active:true,room:'retro96',trackIds:[id],startedAt:Date.now()-2000}));
  await writeFile(join(dir,'rooms.json'),JSON.stringify({retro96:{playlist:[song],index:0,playing:true,
    position:0,startedAt:Date.now(),updatedAt:Date.now(),version:'old-playing-dj'}}));
  const port=await freePort();let child=null;
  const base='http://127.0.0.1:'+port;
  async function start() {
    child=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{
      env:{...process.env,MIXTAP_DATA_DIR:dir,MIXTAP_ADMIN_TOKEN:'test-secret',PORT:String(port),HOST:'127.0.0.1'},stdio:'ignore'});
    for(let i=0;i<100;i++) {
      try {if((await fetch(base+'/healthz')).ok)return;}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    throw Error('Server did not start');
  }
  async function stop() {
    if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
  }
  async function get(path){const response=await fetch(base+path);assert.equal(response.status,200);return response.json();}
  try {
    await start();
    assert.equal((await get('/api/rooms/retro96')).playing,true);
    const denied=await fetch(base+'/api/radio/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"room":"retro96"}'});
    assert.equal(denied.status,401,'Guests cannot stop host radio');
    const stopped=await fetch(base+'/api/radio/stop',{method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer test-secret'},body:'{"room":"retro96"}'});
    assert.equal(stopped.status,200,'Host can stop radio');
    const snapshot=await get('/api/rooms/retro96');
    assert.equal(snapshot.playing,false);
    assert.equal(snapshot.startedAt,0);
    assert.equal(snapshot.autoDJ,false);
    assert.equal(snapshot.playlist.length,1,'Stopping does not destroy the music queue');
    assert.match(snapshot.version,/^stopped:/);
    assert.equal((await get('/api/radio?room=retro96')).active,false);
    await stop();await start();
    assert.equal((await get('/api/rooms/retro96')).playing,false,'Stop survives server restart');
  } finally {await stop();await rm(dir,{recursive:true,force:true});}
});