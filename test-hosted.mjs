import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});server.on('error',reject);});}
const dir=await mkdtemp(join(tmpdir(),'mixtap-test-'));
const port=await freePort();
const base=`http://127.0.0.1:${port}`;
const key='TEST_ONLY_NOT_A_REAL_PASSWORD';
const env={...process.env,PORT:String(port),HOST:'127.0.0.1',MIXTAP_DATA_DIR:dir,MIXTAP_PUBLIC_ORIGIN:'https://mixtap.ljas.ca',MIXTAP_ADMIN_TOKEN:key};
let child;
let count=0;
const start=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env,stdio:['ignore','pipe','pipe']});await new Promise(async(resolve,reject)=>{for(let i=0;i<50;i++){if(child.exitCode!==null)return reject(new Error('server exited early'));try{const r=await fetch(`${base}/healthz`);if(r.ok){resolve();return}}catch{} await new Promise(r=>setTimeout(r,80))}reject(new Error('server not reachable'));});};
const stop=()=>new Promise(resolve=>{if(!child||child.exitCode!==null)return resolve();child.once('exit',()=>resolve());child.kill('SIGTERM');setTimeout(resolve,1000).unref();});
const check=(value,message)=>{assert.ok(value,message);count++};
try{
 await start();
 let r=await fetch(`${base}/widget.js`);check(r.status===200,'widget public');check(r.headers.get('cross-origin-resource-policy')==='cross-origin','COEP compatible');check(r.headers.get('access-control-allow-origin')==='*','CORS for Retro Room');
 r=await fetch(`${base}/healthz`);check((await r.json()).version==='1.1.0','health');
 r=await fetch(`${base}/api/rooms/retro96`);check((await r.json()).playlist.length===0,'empty room');
 const body=JSON.stringify({playlist:[{title:'Test track',provider:'youtube',id:'dQw4w9WgXcQ',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}],playing:true,index:0});
 const put=async(headers)=>fetch(`${base}/api/rooms/retro96`,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body});
 check((await put({})).status===401,'anonymous updates rejected');
 check((await put({Authorization:'Bearer wrong'})).status===401,'wrong key rejected');
 check((await put({Authorization:`Bearer ${key}`,Origin:'https://attacker.invalid'})).status===403,'foreign origin rejected');
 check((await put({Authorization:`Bearer ${key}`,Origin:'https://mixtap.ljas.ca'})).status===200,'correct update accepted');
 check((await (await fetch(`${base}/api/rooms/retro96`)).json()).playlist[0].title==='Test track','new playlist publicly readable');
 const saved=JSON.parse(await readFile(join(dir,'rooms.json'),'utf8'));
 check(saved.retro96.playlist.length===1,'persistent file saved');
 await stop();await start();
 check((await (await fetch(`${base}/api/rooms/retro96`)).json()).playlist.length===1,'persistent file survived restart');
 console.log(`PASS: ${count} checks (public widget, CORS/CORP, auth, origin, persistence, restart)`);
} finally {await stop();await rm(dir,{recursive:true,force:true});}
