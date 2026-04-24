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
} from "../dist/tt/parse/index.js";

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
