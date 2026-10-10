import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StudentPortalClient, TimetableClient, parseWebinarPage, parseWebinars, findWebinar, findWebinars, LessonType } from '../dist/index.js';
const html = await readFile(new URL('./fixtures/lk/webinars.html', import.meta.url), 'utf8');

test('LK webinars retain unavailable rows, selected day, topics and join IDs', () => {
 const page = parseWebinarPage(html);
 assert.equal(page.date, '2026-10-10');
 assert.deepEqual(page.availableDates, ['2026-10-10','2026-10-12']);
 assert.equal(page.webinars.length, 4);
 const [completed, active, pending, external] = page.webinars;
 assert.equal(completed.id, null);
 assert.equal(completed.completedAt, '09:39');
 assert.equal(completed.joinAvailable, false);
 assert.equal(active.id, '12345');
 assert.equal(active.joinAvailable, true);
 assert.equal(active.subject, 'Базы данных');
 assert.equal(active.type,LessonType.Lecture);
 assert.equal(pending.type,LessonType.Laboratory);
 assert.equal(external.type,LessonType.Unknown);
 assert.equal(active.title, 'Тема & вопросы');
 assert.equal(active.server, 'webinar');
 assert.deepEqual(active.groups, ['КТ-41-24','КТ-41-24ин']);
 assert.equal(active.teacher.name, 'Иванов И. И.');
 assert.equal(pending.subgroup, 1);
 assert.equal(pending.id, null);
 assert.equal(external.scheduled, false);
 assert.deepEqual(parseWebinars(html), page.webinars);
 assert.throws(() => parseWebinars('<h2>Server error</h2>'), /no webinar page/);
 assert.equal(TimetableClient.prototype.getWebinars, undefined);
 assert.equal(TimetableClient.prototype.getWebinarJoinUrl, undefined);
});

test('matching respects subgroups, teachers, cancellation and ambiguous rows', () => {
 const webinar = parseWebinars(html)[2];
 const lesson = {scheduledDate: '2026-10-10', subject: 'Базы данных', type: 3, slotNumber:4, time:webinar.time,
  status:'scheduled', groups:{values:[{group:{name:'КТ-41-24'},subgroup:1}]}, teachers:{values:[{name:'Иванов И. И.'}]}};
 assert.equal(findWebinar(lesson,[webinar]),webinar);
 assert.equal(findWebinar({...lesson, groups:{values:[{group:{name:'КТ-41-24'},subgroup:2}]}},[webinar]),undefined);
 assert.equal(findWebinar({...lesson, groups:{values:[{group:{name:'КТ-42-24'}}]}},[webinar]),undefined);
 assert.equal(findWebinar({...lesson, teachers:{values:[{name:'Петров П. П.'}]}},[webinar]),undefined);
 assert.equal(findWebinar({...lesson,status:'cancelled'},[webinar]),undefined);
 assert.equal(findWebinar(lesson,[{...webinar,scheduledDate:undefined}]),undefined);
 assert.equal(findWebinar(lesson,[webinar,{...webinar,id:'other'}]),undefined);
 assert.equal(findWebinars(lesson,[webinar,{...webinar,id:'other'}]).length,2);
});

test('LK client uses listing and URL resolver contracts without TT credentials', async () => {
 const client = new StudentPortalClient({cache:60_000});
 const requests=[];
 client.http = {
  async get(url) { requests.push(['GET',url]); return {status:200,body:html}; },
  async post(url,data) { requests.push(['POST',url,data]); return {status:200,body:JSON.stringify({mes:'SUCCESS',url:'https://webinar.example/room'})}; },
 };
 assert.equal((await client.getWebinars()).length,4);
 await client.getWebinars();
 assert.equal(requests.length,1);
 assert.equal(requests[0][1],'https://lk.chuvsu.ru/student/mywebinars.php');
 assert.equal(await client.getWebinarJoinUrl({webinarId:'12345'}),'https://webinar.example/room');
 assert.deepEqual(requests[1],['POST','https://lk.chuvsu.ru/student/joinweb.php',{idw:'12345'}]);
 await assert.rejects(client.getWebinarJoinUrl({webinarId:''}),RangeError);
 await assert.rejects(client.getWebinars({date:'2026-02-30'}),RangeError);
 client.http.post = async (url,data) => { assert.deepEqual(data,{day:'2026-10-10'}); return {status:200,body:html}; };
 assert.equal((await client.getWebinars({date:'2026-10-10'})).length,4);
 client.http.post = async () => ({status:200,body:html});
 await assert.rejects(client.getWebinars({date:'2026-10-12'}), /requested webinar date/);
});

test('URL resolver rejects malformed, failed and unsafe responses', async () => {
 const client = new StudentPortalClient();
 for(const body of ['invalid','null','{}','{"mes":"FAIL","url":"https://example.com"}','{"mes":"SUCCESS","url":"javascript:alert(1)"}','{"mes":"SUCCESS","url":"httpwrong"}']) {
  client.http = {post:async()=>({status:200,body})};
  await assert.rejects(client.getWebinarJoinUrl({webinarId:1}));
 }
});


test('webinar matching uses shared enum and accepts unknown types', () => {
 const webinar=parseWebinars(html)[2];
 const lesson={scheduledDate:webinar.scheduledDate,subject:webinar.subject,type:LessonType.Laboratory,slotNumber:webinar.slotNumber,time:webinar.time,status:'scheduled',groups:{values:[]},teachers:{values:[]}};
 assert.equal(findWebinar(lesson,[webinar]),webinar);
 assert.equal(findWebinar(lesson,[{...webinar,type:LessonType.Practical}]),undefined);
 assert.ok(findWebinar(lesson,[{...webinar,type:LessonType.Unknown}]));
 assert.ok(findWebinar({...lesson,type:LessonType.Unknown},[webinar]));
});

test('webinar cache skips stale string schemas', async () => {
 const client=new StudentPortalClient({cache:60_000});
 await client.cache.set('webinars','2026-10-10',{date:'2026-10-10',webinars:[{type:'лк'}]});
 client.http={post:async()=>({status:200,body:html})};
 assert.equal((await client.getWebinars({date:'2026-10-10'}))[1].type,LessonType.Lecture);
});
