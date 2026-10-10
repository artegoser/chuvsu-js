import test from 'node:test';
import assert from 'node:assert/strict';
import { WebinarMediaClient, WebinarPermissionError } from '../dist/index.js';
import { session } from './helpers/webinar.mjs';

class Stream {
 tracks=[];
 addTrack(track){this.tracks.push(track);}
 getTracks(){return this.tracks;}
}
class Peer {
 listeners=new Map();transceivers=[];connectionState='new';candidates=[];remoteDescription=null;
 addEventListener(type,fn){this.listeners.set(type,fn);}
 addTransceiver(kind,opts){this.transceivers.push({kind,...opts});}
 async createOffer(){return {type:'offer',sdp:'synthetic-offer'};}
 async setLocalDescription(){this.listeners.get('icecandidate')?.({candidate:{toJSON:()=>({candidate:'local'})}});}
 async setRemoteDescription(description){
  this.remoteDescription=description;
  this.track={id:'remote-track',kind:this.transceivers[0].kind,stopped:false,stop(){this.stopped=true;}};
  this.listeners.get('track')?.({track:this.track});
  queueMicrotask(()=>{this.connectionState='connected';this.listeners.get('connectionstatechange')?.();});
 }
 async addIceCandidate(candidate){assert.ok(this.remoteDescription);this.candidates.push(candidate);}
 async getStats(){return new Map();}
 close(){this.connectionState='closed';}
}
class Socket {
 readyState=0;listeners=new Map();sent=[];response='accepted';
 constructor(){queueMicrotask(()=>{this.readyState=1;this.event('open');});}
 addEventListener(type,fn){const list=this.listeners.get(type)??[];list.push(fn);this.listeners.set(type,list);}
 event(type,event){for(const fn of this.listeners.get(type)??[])fn(event);}
 receive(data){this.event('message',{data:JSON.stringify(data)});}
 send(raw){const d=JSON.parse(raw);this.sent.push(d);if(d.id==='start')queueMicrotask(()=>{
  if(this.response==='silent')return;
  this.receive({id:'iceCandidate',candidate:{candidate:'remote-before-answer'}});
  this.receive({id:'startResponse',response:this.response,sdpAnswer:'synthetic-answer'});
 });}
 close(){if(this.readyState===3)return;this.readyState=3;this.event('close');}
}
function setup(opts={}){
 const sockets=[];const peers=[];
 const room={getSnapshot:()=>({ended:opts.ended??false}),getMediaStreams:()=>opts.streams??[{id:'camera',kind:'camera'},{id:'screen',kind:'screen',hasAudio:true}]};
 const media=new WebinarMediaClient(session(),room,{timeout:opts.timeout??100,
  socketFactory:()=>{const socket=new Socket();socket.response=opts.response??'accepted';sockets.push(socket);return socket;},
  peerFactory:()=>{const peer=new Peer();peers.push(peer);return peer;},
 });
 return {media,sockets,peers};
}
async function withStream(fn){const old=globalThis.MediaStream;globalThis.MediaStream=Stream;try{await fn();}finally{if(old===undefined)delete globalThis.MediaStream;else globalThis.MediaStream=old;}}

test('listen-only queues ICE, receives tracks, never acquires devices, and closes idempotently',()=>withStream(async()=>{
 const {media,sockets,peers}=setup();
 const playback=await media.listen();
 assert.deepEqual(peers[0].transceivers,[{kind:'audio',direction:'recvonly'}]);
 assert.deepEqual(peers[0].candidates,[{candidate:'remote-before-answer'}]);
 assert.equal(playback.stream.getTracks().length,1);
 const start=sockets[0].sent.find(m=>m.id==='start');
 assert.equal(start.role,'recv');assert.equal(start.caleeName,'GLOBAL_AUDIO_12345');
 assert.equal(sockets[0].sent.find(m=>m.id==='iceCandidate').candidate.candidate,'local');
 assert.ok(await playback.getStats() instanceof Map);
 let closed=0;playback.onClose(()=>closed++);playback.close();playback.close();
 assert.equal(closed,1);assert.equal(sockets[0].readyState,3);assert.equal(peers[0].track.stopped,true);
 assert.equal(sockets[0].sent.some(m=>m.id==='stop'),false);media.close();
}));

test('camera and screenshare use distinct verified SFU schemas and permitted streams',()=>withStream(async()=>{
 const {media,sockets,peers}=setup();
 await assert.rejects(media.receiveCamera({streamId:'unpublished'}),WebinarPermissionError);assert.equal(sockets.length,0);
 const camera=await media.receiveCamera({streamId:'camera'});
 const start=sockets[0].sent.find(m=>m.id==='start');
 assert.equal(start.type,'video');assert.equal(start.role,'viewer');assert.equal(start.cameraId,'camera');
 assert.equal(sockets[0].sent.some(m=>m.id==='onIceCandidate'),true);
 camera.close();assert.equal(sockets[0].sent.at(-1).id,'stop');
 const screen=await media.receiveScreen();assert.equal(screen.kind,'screen');
 assert.deepEqual(peers[1].transceivers.map(t=>t.kind),['audio','video']);
 const screenStart=sockets[1].sent.find(m=>m.id==='start');
 assert.equal(screenStart.type,'screenshare');assert.equal(screenStart.callerName,'self');assert.equal(screenStart.hasAudio,true);
 media.close();assert.ok(sockets.every(s=>s.readyState===3));
}));

test('media errors, timeouts, aborts and server termination release all resources',()=>withStream(async()=>{
 for(const opts of [{response:'rejected'},{response:'silent',timeout:10}]){
  const {media,sockets,peers}=setup(opts);await assert.rejects(media.listen(),/negotiation failed|timed out/);
  assert.equal(sockets[0].readyState,3);assert.equal(peers[0].connectionState,'closed');media.close();
 }
 const {media,sockets,peers}=setup();const controller=new AbortController();controller.abort();
 await assert.rejects(media.listen({signal:controller.signal}),/aborted/);assert.equal(peers[0].connectionState,'closed');
 const playback=await media.receiveScreen();let closed=0;playback.onClose(()=>closed++);
 sockets[1].receive({id:'stopSharing'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(closed,1);assert.equal(peers[1].connectionState,'closed');media.close();
}));

test('ended meetings, absent streams and closed clients fail before creating a socket',()=>withStream(async()=>{
 const ended=setup({ended:true});await assert.rejects(ended.media.listen(),/ended/);assert.equal(ended.sockets.length,0);
 const missing=setup({streams:[]});await assert.rejects(missing.media.receiveScreen(),/No screen/);assert.equal(missing.sockets.length,0);
 missing.media.close();await assert.rejects(missing.media.listen(),/closed/);
}));
