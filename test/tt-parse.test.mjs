import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAudienceFullSchedule,
  parseAudienceInfo,
  parseAudienceName,
  parseFullSchedule,
  parseGroupsString,
  parseTeacherButtons,
  parseTeacherFullSchedule,
  parseTeacherInfo,
  parseWebinars,
} from "../dist/tt/parse/index.js";
import { Schedule } from "../dist/tt/schedule.js";
import {
  attachWebinarsToLessons,
  isHoliday,
} from "../dist/tt/utils/index.js";

function semesterPage(entryHtml) {
  return `<!doctype html><html><body>
    <table id="groupstt"><tbody>
      <tr style=" background: lightgray; " class="trfd">
        <td width="120">Суббота</td><td align="center"></td><td width="120">Суббота</td>
      </tr>
      <tr>
        <td class="trf trdata"><div class="trfd">4 пара<br>(13:30 - 14:50)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%"><tr><td>${entryHtml}</td></tr></table></div></td>
        <td class="trf trdata"><div class="trfd">4 пара<br>(13:40 - 15:10)</div></td>
      </tr>
    </tbody></table>
  </body></html>`;
}

function sessionPage(entryRowsHtml) {
  return `<!doctype html><html><body>
    <table><tbody>
      <tr>
        <td id="trd20260425" class="trfd">25.04.2026<br>Суббота</td>
        <td class="trdata"><table>${entryRowsHtml}</table></td>
      </tr>
    </tbody></table>
  </body></html>`;
}

function teacherSemesterEntry(html) {
  return semesterPage(
    `Г-402 <span style="color: blue;">Базы данных</span> (лб) (1 - 16 нед.) <br>${html}`,
  );
}

function teacherSessionRow(html) {
  return `<tr><td>${html}</td></tr>`;
}

function pickOnlyEntry(days) {
  assert.equal(days.length, 1);
  assert.equal(days[0].slots.length, 1);
  assert.equal(days[0].slots[0].entries.length, 1);
  return days[0].slots[0].entries[0];
}

function assertDateParts(date, year, monthIndex, day) {
  assert.equal(date.getFullYear(), year);
  assert.equal(date.getMonth(), monthIndex);
  assert.equal(date.getDate(), day);
}

test("parseGroupsString covers plain groups, qualifiers and subgroup stripping", () => {
  assert.deepEqual(parseGroupsString("КТ-42-25"), ["КТ-42-25"]);
  assert.deepEqual(parseGroupsString("КТ-42-25 (АихС) КТ-41-25"), [
    "КТ-42-25 (АихС)",
    "КТ-41-25",
  ]);
  assert.deepEqual(parseGroupsString("КТ-42-25 (1 подгруппа)"), [
    "КТ-42-25",
  ]);
  assert.deepEqual(parseGroupsString("КТ-42-25 (АихС) (1 подгруппа)"), [
    "КТ-42-25 (АихС)",
  ]);
  assert.deepEqual(parseGroupsString("КТ-41-24 КТ-41-24ин"), [
    "КТ-41-24",
    "КТ-41-24ин",
  ]);
  assert.deepEqual(parseGroupsString(""), []);
});

test("parseTeacherFullSchedule parses a regular semester entry", () => {
  const html = teacherSemesterEntry("КТ-41-24 КТ-41-24ин (2 подгруппа)");
  const entry = pickOnlyEntry(parseTeacherFullSchedule(html));

  assert.equal(entry.room, "Г-402");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.weeks, { from: 1, to: 16 });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 2);
});

test("parseTeacherFullSchedule keeps transfer overlays parsed correctly", () => {
  const html = semesterPage(
    `<div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
      <span style="color: red;"><b>25.04.2026 перенос c 23.05.2026 (2 пара): </b></span><br>
      И-208 <span style="color: blue;">Базы данных</span> (лб)<br>
      КТ-41-24 КТ-41-24ин (1 подгруппа)
    </div>`,
  );
  const entry = pickOnlyEntry(parseTeacherFullSchedule(html));

  assert.equal(entry.room, "И-208");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 1);
  assert.ok(entry.transfer);
  assertDateParts(entry.transfer.targetDate, 2026, 3, 25);
  assertDateParts(entry.transfer.fromDate, 2026, 4, 23);
  assert.equal(entry.transfer.fromSlot, 2);
});

test("parseTeacherFullSchedule parses semester substitutions", () => {
  const html = teacherSemesterEntry(`КТ-31-24 (2 подгруппа)
    <div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
      <span style="color: red;"><b>28.04.2026 замена на: </b></span><br>
      Аудитория: <span class="blue">Б-116</span><br>
      Преподаватель: <span class="blue">доц. Иванов И.И.</span>
    </div>`);
  const entry = pickOnlyEntry(parseTeacherFullSchedule(html));

  assert.equal(entry.substitutions?.length, 1);
  assert.equal(entry.substitutions[0].room, "Б-116");
  assert.deepEqual(entry.substitutions[0].teacher, {
    position: "доц.",
    name: "Иванов И.И.",
  });
});

test("parseTeacherFullSchedule parses substitute-for overlays", () => {
  const html = semesterPage(
    `<div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
      <span style="color: red;"><b>25.04.2026 замена вместо: </b></span>
      <span style="color: blue;">доц. Петров П.П.</span><br>
      И-208 <span style="color: blue;">Базы данных</span> (лб)<br>
      КТ-41-24 КТ-41-24ин (1 подгруппа)
    </div>`,
  );
  const entry = pickOnlyEntry(parseTeacherFullSchedule(html));

  assert.equal(entry.room, "И-208");
  assert.equal(entry.subject, "Базы данных");
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 1);
  assert.ok(entry.substituteFor);
  assert.deepEqual(entry.substituteFor.originalTeacher, {
    position: "доц.",
    name: "Петров П.П.",
  });
  assertDateParts(entry.substituteFor.date, 2026, 3, 25);
});

test("parseTeacherFullSchedule parses session entries with flexible lesson types", () => {
  const html = sessionPage([
    teacherSessionRow(
      `И-208 <span style="color: blue;">Базы данных</span> (Экз) КТ-41-24 КТ-41-24ин<br>11:40 - 13:00`,
    ),
    teacherSessionRow(
      `Б-201 <span style="color: blue;">Консультация</span> (конс.) КТ-41-24<br>13:30 - 14:50`,
    ),
  ].join(""));
  const day = parseTeacherFullSchedule(html)[0];

  assert.equal(day.weekday, "Суббота");
  assert.equal(day.slots.length, 2);
  assert.equal(day.slots[0].entries[0].type, "экз");
  assert.deepEqual(day.slots[0].entries[0].groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(day.slots[1].entries[0].type, "конс");
  assert.deepEqual(day.slots[1].entries[0].groups, ["КТ-41-24"]);
});

test("parseFullSchedule parses a regular semester group entry", () => {
  const html = semesterPage(
    `Г-402 <span style="color: blue;">Базы данных</span> (лб) (1 - 16 нед.) <br>доц. Иванов И.И.`,
  );
  const entry = pickOnlyEntry(parseFullSchedule(html));

  assert.equal(entry.room, "Г-402");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.weeks, { from: 1, to: 16 });
  assert.deepEqual(entry.teacher, {
    position: "доц.",
    name: "Иванов И.И.",
  });
});

test("parseFullSchedule parses subgroup, degree and week parity from group entries", () => {
  const html = semesterPage(
    `<sup>**</sup>Г-402 <span style="color: blue;">Базы данных</span> (лб) (6 - 8 нед.) <br>
    доц. к.т.н. Димитриев А. П.<br>
    <i>2 подгруппа</i>`,
  );
  const entry = pickOnlyEntry(parseFullSchedule(html));

  assert.equal(entry.room, "Г-402");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.weeks, { from: 6, to: 8 });
  assert.deepEqual(entry.teacher, {
    position: "доц.",
    degree: "к.т.н.",
    name: "Димитриев А. П.",
  });
  assert.equal(entry.subgroup, 2);
  assert.equal(entry.weekParity, "even");
});

test("parseFullSchedule parses session entries with flexible lesson types", () => {
  const html = sessionPage(
    `<tr><td>Б-201 <span style="color: blue;">Консультация</span> (конс.)<br>10:00 - 11:30</td></tr>`,
  );
  const day = parseFullSchedule(html)[0];

  assert.equal(day.weekday, "Суббота");
  assert.equal(day.slots[0].entries[0].room, "Б-201");
  assert.equal(day.slots[0].entries[0].type, "конс");
});

test("parseFullSchedule parses summer session types, teachers and subgroups", () => {
  const html = sessionPage([
    `<tr><td class="want">Е-115 <span style="color: blue;">Элективные дисциплины (модули) по физической культуре и спорту</span> (зач)<br>Дигуева О. Г.<br><i>1 подгруппа</i><br>09:50 - 11:10</td></tr>`,
    `<tr><td class="want">И-212 <span style="color: blue;">Объектно-ориентированное программирование</span> (КП)<br>Мытникова Е. А.<br>09:50 - 11:10</td></tr>`,
    `<tr><td class="want">Г-216 <span style="color: blue;">Основы проектной деятельности</span> (ЗачО)<br>Игреев Р. А.<br>16:40 - 18:00</td></tr>`,
  ].join(""));
  const entries = parseFullSchedule(html).flatMap((day) =>
    day.slots.flatMap((slot) => slot.entries),
  );

  assert.equal(entries[0].type, "зач");
  assert.equal(entries[0].subgroup, 1);
  assert.deepEqual(entries[0].teacher, { name: "Дигуева О. Г." });
  assert.equal(entries[0].possibleChanges, true);

  assert.equal(entries[1].type, "кп");
  assert.deepEqual(entries[1].teacher, { name: "Мытникова Е. А." });

  assert.equal(entries[2].type, "зачо");
  assert.deepEqual(entries[2].teacher, { name: "Игреев Р. А." });
});

test("Schedule filters session entries by subgroup", () => {
  const html = sessionPage([
    `<tr><td>Е-115 <span style="color: blue;">Физкультура</span> (зач)<br>Дигуева О. Г.<br><i>1 подгруппа</i><br>09:50 - 11:10</td></tr>`,
    `<tr><td>Е-115 <span style="color: blue;">Физкультура</span> (зач)<br>Миронская И. В.<br><i>2 подгруппа</i><br>09:50 - 11:10</td></tr>`,
  ].join(""));
  const days = parseFullSchedule(html);
  const schedule = new Schedule(8919, new Map([[2, days]]), 2);

  const lessons = schedule.forDate(new Date(2026, 3, 25), { subgroup: 1 });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].subgroup, 1);
  assert.deepEqual(lessons[0].teacher, { name: "Дигуева О. Г." });
});

test("Schedule does not reuse semester lessons outside current academic year", () => {
  const html = `<!doctype html><html><body>
    <table id="groupstt"><tbody>
      <tr style=" background: lightgray; " class="trfd"><td>Среда</td><td></td></tr>
      <tr>
        <td class="trf trdata"><div class="trfd">1 пара<br>(08:20 - 09:40)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%">
          <tr><td>Г-301 <span style="color: blue;">Правоведение</span> (лк) (1 - 16 нед.) <br>Верещак С. Б.</td></tr>
        </table></div></td>
      </tr>
    </tbody></table>
  </body></html>`;
  const schedule = new Schedule(
    8919,
    new Map([[3, parseFullSchedule(html)]]),
    3,
  );

  assert.equal(schedule.forDate(new Date(2025, 4, 7)).length, 0);
  assert.equal(schedule.forDate(new Date(2026, 4, 6)).length, 1);
});

test("isHoliday uses six-day week by default for Saturday holiday transfers", () => {
  assert.equal(isHoliday(new Date(2026, 4, 11)), false);
  assert.equal(isHoliday(new Date(2026, 4, 11), undefined, [], false), true);
});

test("parseFullSchedule marks distance substitutions", () => {
  const html = `<!doctype html><html><body>
    <table id="groupstt"><tbody>
      <tr style=" background: lightgray; " class="trfd"><td width="120">Четверг</td><td></td></tr>
      <tr>
        <td class="trf trdata"><div class="trfd">1 пара<br>(08:20 - 09:40)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%"><tr><td>
    И-212 <span style="color: blue;">Объектно-ориентированное программирование</span> (лб) (1 - 16 нед.) <br>
    Мытникова Е. А.<br><i>1 подгруппа</i>
    <div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
      <span style="color: red;"><b>07.05.2026  замена на: </b></span><br>
      Аудитория: <span class="blue">Дистанционно (ДОТ)</span>
    </div>
        </td></tr></table></div></td>
      </tr>
    </tbody></table>
  </body></html>`;
  const days = parseFullSchedule(html);
  const schedule = new Schedule(8919, new Map([[3, days]]), 3);

  const lessons = schedule.forDate(new Date(2026, 4, 7), { subgroup: 1 });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].room, "Дистанционно (ДОТ)");
  assert.equal(lessons[0].isDistance, true);
});

test("parseWebinars parses scheduled rows and attaches them to lessons", () => {
  const html = `<!doctype html><html><body>
    <select name="seldate"><option value="2026-05-07" selected="selected">7 Май</option></select>
    <table id="webstt"><tbody>
      <tr>
        <td class="trf trdata"><div id="trd2026-05-07t1" class="trfd">1 пара<br>08:20 - 09:40</div></td>
        <td class="trdata"><div class="tdd"><table>
          <tr>
            <td>Правоведение(лк) зав.каф.  к.ю.н. Верещак С. Б. ФМ-10-24 ФМ-11-24</td>
            <td>Лекция</td>
            <td><button id="meet122123" onclick="jointo('122123', 1);" type="button"></button></td>
          </tr>
        </table></div></td>
      </tr>
    </tbody></table>
    <table id="websttext"><tbody></tbody></table>
  </body></html>`;
  const webinars = parseWebinars(html);

  assert.equal(webinars.length, 1);
  assert.equal(webinars[0].id, "122123");
  assert.equal(webinars[0].slotNumber, 1);
  assert.equal(webinars[0].subject, "Правоведение");
  assert.equal(webinars[0].type, "лк");
  assert.deepEqual(webinars[0].teacher, {
    position: "зав.каф.",
    degree: "к.ю.н.",
    name: "Верещак С. Б.",
  });
  assert.deepEqual(webinars[0].groups, ["ФМ-10-24", "ФМ-11-24"]);

  const lessons = attachWebinarsToLessons(
    [
      {
        number: 1,
        start: { date: new Date(2026, 4, 7, 8, 20), hours: 8, minutes: 20 },
        end: { date: new Date(2026, 4, 7, 9, 40), hours: 9, minutes: 40 },
        subject: "Правоведение",
        type: "лк",
        room: "Дистанционно (ДОТ)",
        teacher: { name: "Верещак С. Б." },
        groups: [],
        weeks: { from: 0, to: 0 },
        isDistance: true,
      },
    ],
    webinars,
  );
  assert.equal(lessons[0].webinar?.id, "122123");
});

test("Schedule applies spring substitutions and suppresses transferred source lessons", () => {
  const html = `<!doctype html><html><body>
    <table id="groupstt"><tbody>
      <tr style=" background: lightgray; " class="trfd"><td>Вторник</td><td></td></tr>
      <tr>
        <td class="trf trdata"><div class="trfd">1 пара<br>(08:20 - 09:40)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%">
          <tr><td class="want"><div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
            <span style="color: red;"><b>26.05.2026 перенос c 02.04.2026 (3 пара): </b></span><br>
            И-212 <span style="color: blue;">Объектно-ориентированное программирование</span> (лб)<br>
            Мытникова Е. А.<br><i>2 подгруппа</i>
          </div></td></tr>
        </table></div></td>
      </tr>
      <tr style=" background: lightgray; " class="trfd"><td>Четверг</td><td></td></tr>
      <tr>
        <td class="trf trdata"><div class="trfd">1 пара<br>(08:20 - 09:40)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%">
          <tr><td class="want">И-212 <span style="color: blue;">Объектно-ориентированное программирование</span> (лб) (1 - 17 нед.) <br>
            Мытникова Е. А.<br><i>1 подгруппа</i>
            <div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
              <span style="color: red;"><b>28.05.2026  замена на: </b></span><br>
              Преподаватель: <span class="blue">Мытников А. Н.</span>
            </div>
          </td></tr>
        </table></div></td>
      </tr>
      <tr>
        <td class="trf trdata"><div class="trfd">3 пара<br>(11:40 - 13:00)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%">
          <tr><td class="want">И-212 <span style="color: blue;">Объектно-ориентированное программирование</span> (лб) (1 - 17 нед.) <br>
            Мытникова Е. А.<br><i>2 подгруппа</i>
          </td></tr>
        </table></div></td>
      </tr>
    </tbody></table>
  </body></html>`;
  const springDays = parseFullSchedule(html);
  const schedule = new Schedule(
    8919,
    new Map([[3, springDays]]),
    3,
  );

  const substituted = schedule.forDate(new Date(2026, 4, 28), {
    subgroup: 1,
  });
  assert.equal(substituted.length, 1);
  assert.deepEqual(substituted[0].teacher, { name: "Мытников А. Н." });
  assert.deepEqual(substituted[0].originalTeacher, { name: "Мытникова Е. А." });

  const sourceDate = schedule.forDate(new Date(2026, 3, 2), { subgroup: 2 });
  assert.equal(sourceDate.length, 0);

  const targetDate = schedule.forDate(new Date(2026, 4, 26), { subgroup: 2 });
  assert.equal(targetDate.length, 1);
  assert.deepEqual(targetDate[0].teacher, { name: "Мытникова Е. А." });
  assert.equal(targetDate[0].transfer?.fromSlot, 3);
});

test("parseAudienceFullSchedule parses audience semester entries", () => {
  const html = semesterPage(
    `<span style="color: blue;">Базы данных</span> (лб) (1 - 16 нед.) <br>
    доц. Иванов И.И.<br>
    КТ-41-24 КТ-41-24ин (2 подгруппа)`,
  );
  const entry = pickOnlyEntry(parseAudienceFullSchedule(html));

  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.teacher, {
    position: "доц.",
    name: "Иванов И.И.",
  });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 2);
});

test("parseAudienceFullSchedule parses possible changes and odd week parity", () => {
  const html = semesterPage(
    `<sup>*</sup><span style="color: blue;">Элективные дисциплины (модули) по физической культуре и спорту</span> (пр) (17 нед.) <br>
    Миронская И. В.<br>
    М-42-25ин М-42-25 (2 подгруппа)`,
  ).replace("<td>", '<td class="want">');
  const entry = pickOnlyEntry(parseAudienceFullSchedule(html));

  assert.equal(entry.type, "пр");
  assert.deepEqual(entry.weeks, { from: 17, to: 17 });
  assert.deepEqual(entry.groups, ["М-42-25ин", "М-42-25"]);
  assert.equal(entry.subgroup, 2);
  assert.equal(entry.weekParity, "odd");
  assert.equal(entry.possibleChanges, true);
});

test("parseAudienceInfo parses metadata and image links from audience pages", () => {
  const html = `<!doctype html><html><body>
    <div id="path" class="sbtext">
      <a href="/">Расписание занятий</a> &nbsp;&nbsp;/&nbsp;&nbsp;
      <a href="/index/findaud">Аудитории</a> &nbsp;&nbsp;/&nbsp;&nbsp; Е-115
    </div>
    <span class="htext"><nobr>Аудитория <span style="color: blue;">Е-115</span></nobr></span>
    <span class="htextb"> (Корпус Е; 1 этаж - Спортивный зал)</span>
    <img id="audsrc" src="/index/audimage/aud/852/aid/852">
    <img id="blocksrc" src="/index/blockimage/aud/852/bid/6">
    <img id="floorsrc" src="/index/floorplan/aud/852/fid/37">
    <map name="flooraud">
      <area shape="rect" alt="Е-115" coords="430,92,496,295">
    </map>
  </body></html>`;
  const info = parseAudienceInfo(html);

  assert.deepEqual(info, {
    name: "Е-115",
    building: "Е",
    floor: 1,
    usage: "Спортивный зал",
    audImageUrl: "/index/audimage/aud/852/aid/852",
    blockImageUrl: "/index/blockimage/aud/852/bid/6",
    floorplanUrl: "/index/floorplan/aud/852/fid/37",
    floorplanRect: {
      x1: 430,
      y1: 92,
      x2: 496,
      y2: 295,
    },
  });
});

test("parseAudienceName reads the current audience from breadcrumbs", () => {
  const html = `<!doctype html><html><body>
    <div id="path" class="sbtext">
      <a href="/">Расписание занятий</a> &nbsp;&nbsp;/&nbsp;&nbsp;
      <a href="/index/findaud">Аудитории</a> &nbsp;&nbsp;/&nbsp;&nbsp; Е-115
    </div>
  </body></html>`;

  assert.equal(parseAudienceName(html), "Е-115");
});

test("parseTeacherButtons parses teacher list buttons", () => {
  const html = `<!doctype html><html><body>
    <button
      name="tech113"
      id="tech113"
      type="button"
      value="Александров Андрей Харитонович"
      class="techbut nicebut let0"
      onClick='$("#idstaff").val(113);$("#tt").submit();'
    >Александров Андрей Харитонович</button>
    <button
      name="tech793"
      id="tech793"
      type="button"
      value="Алексеева Наталья Робертовна"
      class="techbut nicebut let0"
      onClick='$("#idstaff").val(793);$("#tt").submit();'
    >Алексеева Наталья Робертовна</button>
  </body></html>`;

  assert.deepEqual(parseTeacherButtons(html), [
    { id: 113, name: "Александров Андрей Харитонович" },
    { id: 793, name: "Алексеева Наталья Робертовна" },
  ]);
});

test("parseTeacherInfo parses teacher pages without degree", () => {
  const html = `<!doctype html><html><body>
    <span class="htextb">Давыдова Наталия Анатольевна</span>
    <span class="htext">Кафедра Техносферной безопасности, метрологии и технологии материалов<br></span>
    <img id="photosrc" src="/index/photo/tech/2125/id/2125" alt="Фото">
  </body></html>`;
  const info = parseTeacherInfo(html);

  assert.deepEqual(info, {
    name: "Давыдова Наталия Анатольевна",
    degree: undefined,
    department: "Кафедра Техносферной безопасности, метрологии и технологии материалов",
    photoUrl: "/index/photo/tech/2125/id/2125",
  });
});
