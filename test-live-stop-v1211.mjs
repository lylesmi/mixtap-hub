import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';

const widget=readFileSync(new URL('./public/widget.js',import.meta.url),'utf8');
const index=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
assert.match(widget,/new window\.EventSource/);
assert.match(widget,/function applyMasterStop/);
assert.match(widget,/state\.audioPlayer\.pause\(\)/);
assert.match(widget,/state\.player\.src = 'about:blank'/);
assert.match(widget,/state\.spotifyFrame\.src = 'about:blank'/);
assert.match(widget,/state\.audioPlayer !== audio \|\| !audio\.isConnected \|\| !canRenderMedia\(\)/);
assert.match(index,/command === 'stop'[\s\S]*?radioPlayerBox\.replaceChildren\(\)/);
async function portNumber(){
  return new Promise((resolve,reject)=>{
    const s=net.createServer();s.on('error',reject);
    s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
  });
}
function nextEvents(response){
 const reader=response.body.getReader();const decoder=new TextDecoder();let buf='';
 return async function next(){
   while(true){
     const sep=buf.indexOf('\n\n');
     if(sep>=0){
       const row=buf.slice(0,sep);buf=buf.slice(sep+2);
       if(row.includes('event: room'))return JSON.parse(row.split('\n').find(x=>x.startsWith('data: ')).slice(6));
       continue;
     }
     const {done,value}=await reader.read();
     if(done)throw Error('SSE disconnected');
     buf+=decoder.decode(value,{stream:true}).replaceAll('\r','');
   }
 };
}
test('authenticated Stop immediately notifies all subscribers and persists after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mixtap-live-stop-'));
 const id='11111111-2222-4333-8444-555555555555';
 const song={id,provider:'upload',title:'Synthetic',duration:120,filename:'synthetic.mp3',bytes:25,mime:'audio/mpeg'};
 await mkdir(join(dir,'audio'));
 await writeFile(join(dir,'audio-library.json'),JSON.stringify({[id]:song}));
 await writeFile(join(dir,'auto-radio.json'),JSON.stringify({active:true,room:'retro96',trackIds:[id],startedAt:Date.now()-1000}));
 const port=await portNumber(),base='http://127.0.0.1:'+port;let child;
 async function start(){
   child=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{
     env:{...process.env,MIXTAP_DATA_DIR:dir,MIXTAP_ADMIN_TOKEN:'test-token',PORT:String(port),HOST:'127.0.0.1'},stdio:'ignore'
   });
   for(let i=0;i<100;i++){
     try{if((await fetch(base+'/healthz')).ok)return;}catch{}
     await new Promise(r=>setTimeout(r,50));
   }
   throw Error('Mixtap did not start');
 }
 async function shutdown(){
   if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
 }
 const aborts=[new AbortController(),new AbortController()];
 try{
   await start();
   const responses=await Promise.all(aborts.map(a=>fetch(base+'/api/rooms/retro96/events',{signal:a.signal,headers:{Origin:'https://retro.ljas.ca'}})));
   for(const r of responses){
     assert.equal(r.status,200);
     assert.match(r.headers.get('content-type'),/text\/event-stream/);
     assert.equal(r.headers.get('access-control-allow-origin'),'*');
     assert.equal(r.headers.get('cross-origin-resource-policy'),'cross-origin');
   }
   const readers=responses.map(nextEvents);
   const initial=await Promise.all(readers.map(f=>f()));
   assert.equal(initial[0].roomState.playing,true);
   assert.equal(initial[1].roomState.playing,true);
   const denied=await fetch(base+'/api/radio/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'retro96'})});
   assert.equal(denied.status,401);
   const time=Date.now();
   const stopped=await fetch(base+'/api/radio/stop',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-token'},body:JSON.stringify({room:'retro96'})});
   assert.equal(stopped.status,200);
   const received=await Promise.all(readers.map(f=>f()));
   assert.ok(Date.now()-time<1500,'Live Stop must not wait for the polling interval');
   for(const event of received){
     assert.equal(event.kind,'stop');
     assert.equal(event.roomState.playing,false);
     assert.match(event.roomState.version,/^stopped:/);
     assert.equal(event.roomState.playlist.length,1,'Stop must keep songs');
   }
   aborts.forEach(a=>a.abort());await shutdown();await start();
   const saved=await (await fetch(base+'/api/rooms/retro96')).json();
   assert.equal(saved.playing,false,'Stop remains after restart');
 } finally{aborts.forEach(a=>a.abort());await shutdown();await rm(dir,{recursive:true,force:true});}
});