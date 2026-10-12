import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeToWebinarChat } from '../dist/webinar/chat-subscription.js';
import { WebinarProtocolError } from '../dist/index.js';

test('signature negotiation retries only a type mismatch and retains the result',async()=>{
 const calls=[];
 const transport={subscribe:async(name,params)=>{calls.push([name,params]);if(Array.isArray(params[0]))throw new WebinarProtocolError('Mismatch',400);}};
 const format=await subscribeToWebinarChat(transport,['public'],null);
 assert.equal(format,'count');
 await subscribeToWebinarChat(transport,['public','private'],format);
 assert.deepEqual(calls.map(([,params])=>params),[[['public']],[1],[2]]);
});
test('auth and transport errors never trigger signature fallback',async()=>{
 for(const error of [new WebinarProtocolError('Unauthorized',403),new Error('Disconnected')]){
  let calls=0;
  await assert.rejects(subscribeToWebinarChat({subscribe:async()=>{calls++;throw error;}},['public'],null),caught=>caught===error);
  assert.equal(calls,1);
 }
});
test('compatible IDs format needs no version metadata or fallback',async()=>{
 const calls=[];
 const transport={subscribe:async(name,params)=>{calls.push(params);}};
 const format=await subscribeToWebinarChat(transport,['public'],null);
 assert.equal(format,'ids');
 await subscribeToWebinarChat(transport,['public','private'],format);
 assert.deepEqual(calls,[[['public']],[['public','private']]]);
});
