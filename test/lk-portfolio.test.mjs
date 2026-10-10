import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StudentPortalClient, parsePortfolio, parsePortfolioUrl } from '../dist/index.js';
import { expandPortfolioRows, parsePortfolioTable } from '../dist/lk/parse/portfolio-content.js';
import { parseHtml } from '../dist/common/parse.js';
const html = await readFile(new URL('./fixtures/lk/portfolio.html', import.meta.url), 'utf8');
const home = `<button onclick="window.open('../portfolio');">Зачетная книжка</button>`;

function flatten(content) {
 return content.flatMap(item => [item, ...flatten(item.content ?? item.link?.content ?? [])]);
}
function section(portfolio,title) { return portfolio.sections.find(s=>s.title===title); }

test('portfolio discovery accepts only read-only portfolio routes on LK', () => {
 assert.equal(parsePortfolioUrl(home), 'https://lk.chuvsu.ru/portfolio');
 assert.equal(parsePortfolioUrl('<a href="../portfolio/index.php?id=123">Портфолио</a>'),'https://lk.chuvsu.ru/portfolio/index.php?id=123');
 for(const url of ['https://evil.example/portfolio/index.php?id=123','../portfolio/savelist.php?sem=1','../portfolio/index.php?id=-1','../portfolio/index.php?id=123&save=1','javascript:alert(1)']) {
  assert.throws(()=>parsePortfolioUrl(`<a href="${url}">Portfolio</a>`), /no portfolio link/);
 }
});

test('portfolio exposes identity, every tab, grades and referral metadata without executing controls', () => {
 const p = parsePortfolio(html);
 assert.equal(p.id,123);
 assert.equal(p.url,'https://lk.chuvsu.ru/portfolio/index.php?id=123');
 assert.equal(p.student.fullName,'Тестовый Студент Иванович');
 assert.equal(p.student.photoUrl,'https://lk.chuvsu.ru/portfolio/face.php?id=123');
 assert.deepEqual(p.student.fields, {'Факультет':'Тестовый факультет','Группа':'КТ-00-00'});
 assert.equal(p.sections.length,10);
 assert.equal(p.grades.length,3);
 assert.deepEqual(p.grades[0],{semester:1,code:'Б1.О.01',subject:'Математика (прикладная)',assessment:'Экзамен',grade:'4 (Хорошо)',notes:['Дата оценки: 2026-01-20'],referral:undefined});
 assert.equal(p.grades[1].grade,'');
 assert.deepEqual(p.grades[1].referral,{semester:1,disciplineId:77,lessonTypeId:4,type:2,key:1,code:'Б1.О.02'});
 assert.equal(p.grades[2].semester,2);
 assert.deepEqual(p.controlWeeks,[{semester:1,subject:'Базы данных',grades:['0','']}]);
 const serialized=JSON.stringify(p.sections);
 assert.ok(!serialized.includes('never evaluate'));
 assert.ok(!serialized.includes('savelist'));
 assert.ok(!serialized.includes('iexlist'));
 assert.ok(!serialized.includes('private action comment'));
 assert.equal(globalThis.secret,undefined);
});

test('all portfolio content retains documents, achievements, tooltip details and empty tables', () => {
 const p = parsePortfolio(html);
 const achievements=flatten(section(p,'Достижения').content);
 assert.ok(achievements.some(i=>i.kind==='group' && i.label==='Учеба'));
 assert.ok(achievements.some(i=>i.kind==='text' && i.text==='Тестовый курс'));
 assert.ok(achievements.some(i=>i.kind==='link' && i.link.url==='https://lk.chuvsu.ru/portfolio/get_file.php?id=123&file=test.pdf'));
 assert.ok(achievements.some(i=>i.kind==='image' && i.title==='Скачать документ'));
 const plans=flatten(section(p,'Учебные планы').content);
 assert.ok(plans.some(i=>i.kind==='link' && i.link.url.endsWith('/education/#docs')));
 const practice=flatten(section(p,'Практики').content).find(i=>i.kind==='table').table;
 assert.equal(practice.rows[0][0].colspan,2);
 assert.equal(practice.rows[0][2].rowspan,2);
 assert.deepEqual(practice.rows[2][3].notes,['Тестовая кафедра']);
 assert.equal(practice.rows[2][4].links[0].url,'https://lk.chuvsu.ru/portfolio/get_file.php?id=123&file=report.pdf');
 const interests=flatten(section(p,'Интересы').content).find(i=>i.kind==='table').table;
 assert.equal(interests.rows[1][2].text,'SQL & модели');
 const thesis=flatten(section(p,'ВКР').content).find(i=>i.kind==='table').table;
 assert.equal(thesis.rows.length,1);
});

test('journal aligns merged month/day headers and preserves missing marks and activity fields', () => {
 const [p]=parsePortfolio(html).performance;
 assert.equal(p.subject,'Базы данных');
 assert.deepEqual(p.attendance,[
  {month:'Сентябрь',day:9,slotNumber:1,type:'лб',subgroup:1,mark:'+',notes:['Присутствовал']},
  {month:'Сентябрь',day:9,slotNumber:2,type:'лк',subgroup:undefined,mark:'Н',notes:[]},
  {month:'Октябрь',day:10,slotNumber:3,type:'лб',subgroup:2,mark:'',notes:[]},
 ]);
 assert.equal(p.activities[0].teacher,'Иванов И. И.');
 assert.equal(p.activities[0].items[0].title,'Лаб\n№ 1');
 assert.deepEqual(p.activities[0].items[0].notes,['Оценка','Дата']);
 const fields=flatten(p.activities[0].items[0].content).filter(i=>i.kind==='text').map(i=>i.text);
 assert.deepEqual(fields,['5','10.10']);
 assert.ok(p.activities[0].items[1].links[0].url.endsWith('file=lab.pdf'));
});

test('table expansion accounts for rowspans and colspans', () => {
 const table=parseHtml('<table><tr><th rowspan="2">A</th><th colspan="2">B</th></tr><tr><th>C</th><th>D</th></tr></table>').querySelector('table');
 const expanded=expandPortfolioRows(parsePortfolioTable(table,'https://lk.chuvsu.ru/portfolio/').rows);
 assert.deepEqual(expanded.map(row=>row.map(cell=>cell.text)),[['A','B','B'],['A','C','D']]);
});

test('portfolio parser rejects wrong pages, missing IDs, mismatched identity and missing sections', () => {
 assert.throws(()=>parsePortfolio('<h2>Error</h2>'), /student identity/);
 assert.throws(()=>parsePortfolio(html.replace('face.php?id=123','face.php')), /student ID/);
 assert.throws(()=>parsePortfolio(html,{url:'https://lk.chuvsu.ru/portfolio/index.php?id=456'}), /differs/);
 assert.throws(()=>parsePortfolio('<div class="port_name">Name</div><img class="port_pic" src="face.php?id=123">'), /no sections/);
});

test('portfolio client discovers current user and caches without mutation requests', async () => {
 const client=new StudentPortalClient({cache:60_000});
 const requests=[];
 client.http={get:async(url)=>{requests.push(url);return {status:200,body:url.endsWith('/student/index.php')?home:html};},post:async()=>assert.fail('Portfolio must not POST')};
 const portfolio=await client.getPortfolio();
 assert.equal(portfolio.id,123);
 assert.equal(await client.getPortfolioUrl(),portfolio.url);
 assert.deepEqual(requests,['https://lk.chuvsu.ru/student/index.php','https://lk.chuvsu.ru/portfolio']);
});

test('failed portfolio parse is never cached', async () => {
 const client=new StudentPortalClient({cache:60_000});
 let reads=0;
 client.http={get:async(url)=>{reads++;return {status:200,body:url.endsWith('/student/index.php')?home:'<h2>Unavailable</h2>'};}};
 await assert.rejects(client.getPortfolio());
 await assert.rejects(client.getPortfolio());
 assert.equal(reads,4);
});
