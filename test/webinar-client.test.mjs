import test from 'node:test';
import assert from 'node:assert/strict';
import { WebinarClient, WebinarGateway, WebinarPermissionError, WebinarProtocolError } from '../dist/index.js';
import { WebinarDdp } from '../dist/webinar/ddp.js';
import { parseWebinarConfig, parseWebinarSession, parseWebinarIceServers } from '../dist/webinar/parse.js';
import { config, entry, origin, session } from './helpers/webinar.mjs';
const docs={
 users:[{_id:'u1',userId:'self',name:'Student',role:'VIEWER',locked:true,emoji:'none',color:'#123456'},{_id:'u2',userId:'teacher',name:'Teacher',role:'MODERATOR',presenter:true},{_id:'u3',userId:'gone',name:'Former user',loggedOut:true}],
 'users-persistent-data':[{_id:'p1',userId:'gone',name:'Former user'}],
 meetings:[{_id:'m',meetingId:'meeting',lockSettingsProps:{disablePublicChat:false,disablePrivateChat:false},meetingEnded:false}],
 voiceUsers:[{_id:'v',intId:'teacher',joined:true,muted:false,talking:true}],
 'group-chat':[{_id:'chat',chatId:'public',name:'Public',access:'PUBLIC_ACCESS',users:[]}],
 presentations:[{_id:'p',id:'pres',name:'Lecture.pdf',current:true,downloadable:false}],
 slides:[{_id:'s',id:'pres/1',presentationId:'pres',num:1,current:true,svgUri:origin+'/bigbluebutton/presentation/meeting/meeting/pres/svg/1',txtUri:origin+'/bigbluebutton/presentation/meeting/meeting/pres/textfiles/1'}],
 'slide-positions':[{_id:'position',id:'pres/1',x:1,y:2,viewBoxWidth:800,viewBoxHeight:600}],
 screenshare:[{_id:'screen',screenshare:{streamId:'screen-stream',hasAudio:true}}],
 note:[{_id:'note',revs:3,padId:'pad',readOnlyId:'read'}],
};
class Socket {
 readyState=0;listeners=new Map();sent=[];invalidAuth=false;
 constructor(){queueMicrotask(()=>{this.readyState=1;this.event('open');});}
 addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}
 event(type,value){for(const listener of this.listeners.get(type)??[])listener(value);}
 receive(data){this.event('message',{data:JSON.stringify(data)});}
 send(raw){const d=JSON.parse(raw);this.sent.push(d);queueMicrotask(()=>{
  if(d.msg==='connect')this.receive({msg:'connected',session:'connection'});
  if(d.msg==='sub'){
   if(d.name==='auth-token-validation')this.receive({msg:'added',collection:d.name,id:'auth',fields:{userId:'self',validationStatus:this.invalidAuth?4:3}});
   for(const doc of docs[d.name]??[]) {const {_id,...fields}=doc;this.receive({msg:'added',collection:d.name,id:_id,fields});}
   this.receive({msg:'ready',subs:[d.id]});
  }
  if(d.msg==='method'){
   if(d.method==='createGroupChat')this.receive({msg:'added',collection:'group-chat',id:'private-doc',fields:{chatId:'private',name:'Teacher',access:'PRIVATE_ACCESS',users:['self','teacher']}});
   const result=d.method==='fetchMessagePerPage'?(d.params[1]===1?[{id:'old',chatId:d.params[0],sender:'gone',timestamp:100,message:'&lt;b&gt;Hello&lt;/b&gt;'}]:[]):true;
   this.receive({msg:'result',id:d.id,result});
  }
 });}
 close(){if(this.readyState===3)return;this.readyState=3;this.event('close');}
}
async function connected(){let socket;const client=new WebinarClient(session(),{socketFactory:()=>socket=new Socket(),timeout:100});await client.connect();return {client,socket};}

test('session parsing never evaluates scripts, detects version per server, validates endpoints',()=>{
 const html=`<script>__meteor_runtime_config__ = JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify({PUBLIC_SETTINGS:config}))}"));throw Error('do not execute');</script>`;
 assert.deepEqual(parseWebinarConfig(html),config);
 assert.equal(session().connections.state,'wss://webinar.example/html5client/websocket');
 assert.match(session().connections.media,/sessionToken=synthetic-session/);
 assert.throws(()=>parseWebinarSession({clientUrl:origin+'/?sessionToken=x',config:{...config,app:{bbbServerVersion:3}},entry,iceServers:[]}),WebinarProtocolError);
 assert.throws(()=>parseWebinarSession({clientUrl:origin+'/?sessionToken=x',config:{...config,kurento:{wsUrl:'wss://other.example/sfu'}},entry,iceServers:[]}),/media endpoint/);
 assert.throws(()=>parseWebinarConfig('<h1>Login</h1>'),WebinarProtocolError);
 assert.throws(()=>parseWebinarIceServers('{}'),/ICE/);
 assert.deepEqual(parseWebinarIceServers(JSON.stringify({stunServers:[{url:'stun:stun.example'},{url:'https://bad.example'}],turnServers:[{url:'turn:turn.example',username:'user',password:'secret'}]})),[{urls:'stun:stun.example'},{urls:'turn:turn.example',username:'user',credential:'secret'}]);
});

test('live state excludes departed users, resolves historical senders, normalizes slides and notes',async()=>{
 const {client,socket}=await connected();
 try {
  assert.deepEqual(client.getUsers().map(u=>u.id),['self','teacher']);
  assert.equal(client.getPresenter().name,'Teacher');
  assert.equal(client.getPresenter().audio.speaking,true);
  assert.equal(client.getMessages()[0].senderName,'Former user');
  assert.equal(client.getMessages()[0].text,'<b>Hello</b>');
  assert.equal(client.getCurrentPresentation().slides[0].viewport.width,800);
  assert.equal(client.getCurrentPresentation().downloadable,false);
  assert.equal(client.getMediaStreams()[0].hasAudio,true);
  assert.equal(client.getNotes().readUrl,origin+'/pad/p/read');
  const copy=client.getUsers();copy[0].name='Changed locally';assert.equal(client.getUsers()[0].name,'Student');
  assert.ok(socket.sent.filter(d=>d.msg==='method').every(d=>['validateAuthToken','fetchMessagePerPage'].includes(d.method)));
  const events=[];const unsubscribe=client.subscribe(e=>events.push(e));
  socket.receive({msg:'added',collection:'group-chat-msg',id:'live',fields:{id:'live',chatId:'public',sender:'teacher',timestamp:200,message:'Live'}});
  socket.receive({msg:'changed',collection:'users',id:'u2',fields:{emoji:'raiseHand'},cleared:['presenter']});
  assert.equal(client.getMessages().length,2);
  assert.equal(events.filter(e=>e.type==='message').length,1);
  assert.equal(client.getPresenter(),null);
  assert.equal(client.getUsers().find(u=>u.id==='teacher').raisedHand,true);
  socket.receive({msg:'removed',collection:'users',id:'u2'});assert.equal(client.getUsers().length,1);
  unsubscribe();
 }finally{client.close();}
 assert.throws(()=>client.getUsers(),/disconnected/);
 await assert.rejects(client.connect(),/new client/);
});

test('write actions are explicit and obey meeting locks; private messages use real chat IDs',async()=>{
 const {client,socket}=await connected();
 try {
  await client.setRaisedHand(true);
  await client.sendMessage({text:'Hello'});
  await client.sendPrivateMessage({userId:'teacher',text:'Private'});
  const sent=socket.sent.filter(d=>d.method==='sendGroupChatMsg');
  assert.equal(sent[0].params[0],'public');assert.equal(sent[1].params[0],'private');
  assert.deepEqual(socket.sent.find(d=>d.method==='setEmojiStatus').params,['self','raiseHand']);
  socket.receive({msg:'changed',collection:'meetings',id:'m',fields:{lockSettingsProps:{disablePublicChat:true}}});
  await assert.rejects(client.sendMessage({text:'Blocked'}),WebinarPermissionError);
  await assert.rejects(client.sendMessage({text:'Hello',chatId:'unknown'}),WebinarPermissionError);
  await assert.rejects(client.setMuted(false),/Microphone audio/);
  await assert.rejects(client.openPrivateChat({userId:'self'}),RangeError);
  await assert.rejects(client.loadMessages({page:0}),RangeError);
 }finally{client.close();}
});

test('rejected auth and dropped connections fail rather than exposing partial room state',async()=>{
 let socket;const client=new WebinarClient(session(),{socketFactory:()=>{socket=new Socket();socket.invalidAuth=true;return socket;},timeout:100});
 await assert.rejects(client.connect(),/authentication rejected/);assert.equal(socket.readyState,3);
 const {client:live,socket:connectedSocket}=await connected();
 connectedSocket.close();assert.throws(()=>live.getSnapshot(),/disconnected/);live.close();
});

test('DDP heartbeat, timeout, and server errors are handled without leaking response details',async()=>{
 let socket;const ddp=new WebinarDdp(()=>socket=new Socket(),20);
 await ddp.connect('wss://webinar.example/websocket');
 socket.receive({msg:'ping',id:'beat'});assert.deepEqual(socket.sent.at(-1),{msg:'pong',id:'beat'});
 socket.send=raw=>{socket.sent.push(JSON.parse(raw));};
 const request=ddp.call('synthetic');const id=socket.sent.at(-1).id;
 socket.receive({msg:'result',id,error:{reason:'sensitive token'}});await assert.rejects(request,/method rejected/);
 await assert.rejects(ddp.subscribe('never-ready'),/timed out/);
 ddp.close();
});

test('gateway blocks cross-server redirects and forbidden presentation downloads',async()=>{
 const gateway=new WebinarGateway();
 await assert.rejects(gateway.openSession({joinUrl:'http://webinar.example/bigbluebutton/api/join'}),RangeError);
 gateway.http={get:async()=>({status:302,location:'https://other.example/html5client/join?sessionToken=x'})};
 await assert.rejects(gateway.openSession({joinUrl:origin+'/bigbluebutton/api/join?checksum=synthetic'}),/outside its server/);
 await assert.rejects(gateway.downloadPresentation({presentationId:'pres'}),WebinarPermissionError);
 gateway.session=session();
 gateway.http={getBufferResponse:async()=>{throw Error('must not request');}};
 await assert.rejects(gateway.downloadSlide({slide:{svgUrl:'https://other.example/asset',number:1}}),RangeError);
 await assert.rejects(gateway.downloadSlide({slide:{svgUrl:origin+'/bigbluebutton/presentation/upload',number:1}}),RangeError);
});

test('gateway bootstraps once, downloads declared slide assets, and respects original-file permission',async()=>{
 const gateway=new WebinarGateway();const requests=[];
 gateway.http={get:async(url,follow)=>{
  requests.push([new URL(url).pathname,follow]);
  if(new URL(url).pathname.endsWith('/api/join'))return {status:302,location:'/html5client/join?sessionToken=synthetic-session'};
  if(new URL(url).pathname.endsWith('/api/enter'))return {status:200,body:JSON.stringify(entry)};
  if(new URL(url).pathname.endsWith('/api/stuns'))return {status:200,body:'{"stunServers":[],"turnServers":[]}'};
  return {status:200,body:`__meteor_runtime_config__=JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify({PUBLIC_SETTINGS:config}))}"))`};
 },getBufferResponse:async(url,follow)=>{
  assert.equal(follow,false);requests.push([new URL(url).pathname,follow]);
  return {status:200,body:Buffer.from('<svg/>'),contentType:'image/svg+xml'};
 }};
 await gateway.openSession({joinUrl:origin+'/bigbluebutton/api/join?checksum=synthetic'});
 assert.ok(requests.every(([,follow])=>follow===false));
 const copied=gateway.getSession();copied.authToken='different';assert.equal(gateway.getSession().authToken,'synthetic-auth');
 const file=await gateway.downloadSlide({slide:{number:1,svgUrl:docs.slides[0].svgUri}});
 assert.equal(file.filename,'slide-1.svg');assert.equal(file.body.toString(),'<svg/>');
 gateway.client={getPresentations:()=>[{id:'pres',name:'Lecture.pdf',downloadable:false}]};
 const count=requests.length;await assert.rejects(gateway.downloadPresentation({presentationId:'pres'}),WebinarPermissionError);assert.equal(requests.length,count);
 await assert.rejects(gateway.openSession({joinUrl:origin+'/bigbluebutton/api/join'}),/new gateway/);
});

test('async event streams stop on abort and reject overflow',async()=>{
 const {client,socket}=await connected();
 try {
  const controller=new AbortController();const stream=client.events({signal:controller.signal,bufferSize:1});
  const waiting=stream.next();socket.receive({msg:'changed',collection:'users',id:'u1',fields:{emoji:'raiseHand'}});
  assert.equal((await waiting).value.type,'change');
  controller.abort();assert.equal((await stream.next()).done,true);
  const overflow=client.events({bufferSize:1});const next=overflow.next();
  socket.receive({msg:'changed',collection:'users',id:'u1',fields:{emoji:'none'}});
  socket.receive({msg:'changed',collection:'users',id:'u1',fields:{emoji:'raiseHand'}});
  await assert.rejects(next,/overflow/);
 }finally{client.close();}
});
