import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
const start = server.indexOf('function youtubePlaylistId(raw) {');
const end = server.indexOf('async function handleMetadata(req, res, url) {',start);
assert.ok(start>=0 && end>start,'Importer functions must exist');
const source = server.slice(start,end);
const factory = new Function('process','fetch','verifyAdminRequest','readBody','json','send','MAX_PLAYLIST_TRACKS','AbortSignal','URL',
  source+'return {youtubePlaylistId,handleYoutubePlaylistImport};');
const listId='PL1234567890123456';
const url='https://www.youtube.com/playlist?list='+listId;
const tracks=(offset,n)=>Array.from({length:n},(_,i)=>({snippet:{
  title:'Song '+(offset+i), videoOwnerChannelTitle:'Test artist',
  resourceId:{videoId:String(offset+i).padStart(11,'0')}
}}));
const abort={timeout:()=>({})};

test('playlist ID allowlist rejects lookalike domains and accepts watch-list links',()=>{
 const app=factory({env:{}},async()=>{},()=>true,async()=>'',()=>{},()=>{},500,abort,URL);
 assert.equal(app.youtubePlaylistId('https://www.youtube.com/watch?v=ABCDEFGHIJK&list='+listId),listId);
 assert.equal(app.youtubePlaylistId('https://youtube.com.evil.invalid/playlist?list='+listId),'');
 assert.equal(app.youtubePlaylistId('http://youtube.com/playlist?list='+listId),'');
});
test('paginated YouTube API results become individual ordered songs',async()=>{
 let calls=0;const responses=[];
 const fakeFetch=async api=>{
   calls++;
   assert.equal(new URL(api).hostname,'www.googleapis.com');
   const page=new URL(api).searchParams.get('pageToken');
   return {ok:true,status:200,json:async()=>page?{items:tracks(50,4)}:{items:tracks(0,50),nextPageToken:'second'}};
 };
 const app=factory({env:{YOUTUBE_API_KEY:'TEST'}},fakeFetch,()=>true,async()=>JSON.stringify({url}),(_r,status,data)=>responses.push({status,data}),()=>{},500,abort,URL);
 await app.handleYoutubePlaylistImport({method:'POST'},{});
 assert.equal(calls,2);
 assert.equal(responses[0].status,200);
 assert.equal(responses[0].data.tracks.length,54);
 assert.equal(responses[0].data.tracks[0].title,'Song 0');
 assert.equal(responses[0].data.tracks.at(-1).title,'Song 53');
 assert.equal(responses[0].data.truncated,false);
});
test('no YouTube key returns configuration error without external requests',async()=>{
 const responses=[];
 const app=factory({env:{}},async()=>{throw Error('Do not call API without a key')},()=>true,async()=>JSON.stringify({url}),(_r,status,data)=>responses.push({status,data}),()=>{},500,abort,URL);
 await app.handleYoutubePlaylistImport({method:'POST'},{});
 assert.equal(responses[0].status,503);
 assert.match(responses[0].data.error,/YOUTUBE_API_KEY/);
});
test('unauthorized import never calls the YouTube API',async()=>{
 const responses=[];
 const app=factory({env:{YOUTUBE_API_KEY:'TEST'}},async()=>{throw Error('Unauthorized API call')},()=>false,async()=>JSON.stringify({url}),(_r,status,data)=>responses.push({status,data}),()=>{},500,abort,URL);
 await app.handleYoutubePlaylistImport({method:'POST'},{});
 assert.equal(responses.length,0);
});
