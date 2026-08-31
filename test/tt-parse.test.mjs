import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  parseRoomSchedule,
  parseRoomInfo,
  parseRoomName,
  parseGroupSchedule,
  parseGroupsString,
  parseTeacherButtons,
  parseTeacherSchedule,
  parseTeacherInfo,
  parseWebinars,
} from "../dist/tt/parse/index.js";
import { attachWebinars } from "../dist/tt/webinars.js";
import { isHoliday } from "../dist/tt/utils/index.js";
import { scheduleFromParsedDays } from "./helpers/schedule.mjs";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";

const FIXTURE_DIR = new URL("./fixtures/tt/parser/", import.meta.url);

async function loadFixture(name) {
  return readFile(new URL(name, FIXTURE_DIR), "utf8");
}

function semesterPage(entryHtml, entryClass = "") {
  return `<!doctype html><html><body>
    <table id="groupstt"><tbody>
      <tr style=" background: lightgray; " class="trfd">
        <td width="120">Суббота</td><td align="center"></td><td width="120">Суббота</td>
      </tr>
      <tr>
        <td class="trf trdata"><div class="trfd">4 пара<br>(13:30 - 14:50)</div></td>
        <td class="trdata"><div class="tdd"><table width="100%"><tr><td${entryClass ? ` class="${entryClass}"` : ""}>${entryHtml}</td></tr></table></div></td>
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
        <td id="trd20260425" class="trfd">25.04.2026<br>Суббота</td>
      </tr>
    </tbody></table>
  </body></html>`;
}

async function loadSemesterFixture(name, entryClass = "") {
  return semesterPage(await loadFixture(name), entryClass);
}

async function loadSessionFixture(name) {
  return sessionPage(await loadFixture(name));
}

function pickOnlyEntry(days) {
  assert.equal(days.length, 1);
  assert.equal(days[0].blocks.length, 1);
  assert.equal(days[0].blocks[0].lessons.length, 1);
  return days[0].blocks[0].lessons[0];
}

function assertLocalDate(date, expected) {
  assert.equal(date, expected);
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

test("missing and explicitly absent relations remain distinguishable", () => {
  const base = {
    sourceKey: "test:relations",
    owner: { type: "group", group: { id: 1, name: "TEST-1" } },
    academicYearStartYear: 2026,
    period: 1,
    observedAt: new Date("2026-08-31T00:00:00.000Z"),
  };
  const makeDays = (lesson) => [{
    weekday: "Понедельник",
    blocks: [{ lessons: [{
      subject: "Архитектура",
      type: "лк",
      ...lesson,
    }] }],
  }];
  const unknown = createScheduleSourceSnapshot({ ...base, days: makeDays({}) })
    .observations[0];
  const absent = createScheduleSourceSnapshot({
    ...base,
    days: makeDays({ room: null, teacher: null, groups: null }),
  }).observations[0];

  assert.deepEqual(unknown.rooms, { values: [], completeness: "unknown" });
  assert.deepEqual(absent.rooms, { values: [], completeness: "complete" });
  assert.deepEqual(unknown.teachers, { values: [], completeness: "unknown" });
  assert.deepEqual(absent.teachers, { values: [], completeness: "complete" });
  assert.equal(unknown.groups.completeness, "partial");
  assert.equal(absent.groups.completeness, "complete");
});

test("parseTeacherSchedule parses a regular semester entry", async () => {
  const html = await loadSemesterFixture("teacher-semester-basic.html");
  const entry = pickOnlyEntry(parseTeacherSchedule(html));

  assert.equal(entry.room, "Г-402");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.weeks, { from: 1, to: 16 });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 2);
});

test("parseTeacherSchedule keeps transfer overlays parsed correctly", async () => {
  const html = await loadSemesterFixture("teacher-transfer.html");
  const entry = pickOnlyEntry(parseTeacherSchedule(html));

  assert.equal(entry.room, "И-208");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 1);
  assert.ok(entry.transfer);
  assertLocalDate(entry.transfer.targetDate, "2026-04-25");
  assertLocalDate(entry.transfer.fromDate, "2026-05-23");
  assert.equal(entry.transfer.fromSlot, 2);
});

test("parseGroupSchedule does not treat transfer room line as group", async () => {
  const html = await loadSemesterFixture("group-transfer.html");
  const entry = pickOnlyEntry(parseGroupSchedule(html));

  assert.equal(entry.room, "Г-316");
  assert.equal(entry.subject, "Основы проектной деятельности");
  assert.equal(entry.type, "пр");
  assert.deepEqual(entry.teacher, { name: "Игреев Р. А." });
  assert.equal(entry.groups, undefined);
  assert.ok(entry.transfer);
});

test("parseTeacherSchedule parses semester substitutions", async () => {
  const html = await loadSemesterFixture("teacher-substitution.html");
  const entry = pickOnlyEntry(parseTeacherSchedule(html));

  assert.equal(entry.substitutions?.length, 1);
  assert.equal(entry.substitutions[0].room, "Б-116");
  assert.deepEqual(entry.substitutions[0].teacher, {
    position: "доц.",
    name: "Иванов И.И.",
  });
});

test("parseTeacherSchedule parses substitute-for overlays", async () => {
  const html = await loadSemesterFixture("teacher-substitute-for.html");
  const entry = pickOnlyEntry(parseTeacherSchedule(html));

  assert.equal(entry.room, "И-208");
  assert.equal(entry.subject, "Базы данных");
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 1);
  assert.ok(entry.substituteFor);
  assert.deepEqual(entry.substituteFor.originalTeacher, {
    position: "доц.",
    name: "Петров П.П.",
  });
  assertLocalDate(entry.substituteFor.date, "2026-04-25");
});

test("parseTeacherSchedule parses session entries with flexible lesson types", async () => {
  const html = await loadSessionFixture("teacher-session.html");
  const days = parseTeacherSchedule(html);
  const day = days[0];

  assert.equal(days.length, 1);
  assert.equal(day.weekday, "Суббота");
  assert.equal(day.date, "2026-04-25");
  assert.equal(day.blocks.length, 2);
  assert.equal(day.blocks[0].lessons[0].type, "экз");
  assert.equal(day.blocks[0].lessons[0].weeks, undefined);
  assert.deepEqual(day.blocks[0].lessons[0].groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(day.blocks[1].lessons[0].type, "конс");
  assert.deepEqual(day.blocks[1].lessons[0].groups, ["КТ-41-24"]);
});

test("parseGroupSchedule parses a regular semester group entry", async () => {
  const html = await loadSemesterFixture("group-semester-basic.html");
  const entry = pickOnlyEntry(parseGroupSchedule(html));

  assert.equal(entry.room, "Г-402");
  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.weeks, { from: 1, to: 16 });
  assert.deepEqual(entry.teacher, {
    position: "доц.",
    name: "Иванов И.И.",
  });
});

test("parseGroupSchedule parses subgroup, degree and week parity from group entries", async () => {
  const html = await loadSemesterFixture("group-semester-subgroup.html");
  const entry = pickOnlyEntry(parseGroupSchedule(html));

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

test("parseGroupSchedule recognizes a candidate of arts degree", () => {
  const entry = pickOnlyEntry(parseGroupSchedule(semesterPage(`
    III-110в <span style="color: blue;">Эстетика и теория искусства</span> (лк) (2 - 11 нед.)<br>
    зав.каф. к.иск. Данилова И. В.
  `)));

  assert.deepEqual(entry.teacher, {
    position: "зав.каф.",
    degree: "к.иск.",
    name: "Данилова И. В.",
  });
});

test("parseGroupSchedule parses live remote room and teacher markup", async () => {
  const html = await loadSemesterFixture("group-remote.html");
  const entry = pickOnlyEntry(parseGroupSchedule(html));

  assert.equal(entry.room, "Дистанционно (ДОТ)");
  assert.deepEqual(entry.teacher, {
    position: "доц.",
    degree: "к.х.н.",
    name: "Решетников А. В.",
  });
  assert.equal(entry.isDistance, true);
  assert.equal(entry.weekParity, "even");
});

test("parseGroupSchedule maps a trailing remote marker to a virtual room", async () => {
  const html = await loadSemesterFixture("group-remote-trailing.html");
  const entry = pickOnlyEntry(parseGroupSchedule(html));

  assert.equal(entry.room, "Дистанционно (ДОТ)");
  assert.equal(entry.teacher.name, "Ласточкин В. Б.");
  assert.equal(entry.isDistance, true);
});

test("parseGroupSchedule supports individual and group lesson types", async () => {
  const individual = pickOnlyEntry(
    parseGroupSchedule(await loadSemesterFixture("group-type-iz.html")),
  );
  const group = pickOnlyEntry(
    parseGroupSchedule(await loadSemesterFixture("group-type-gz.html")),
  );

  assert.equal(individual.type, "из");
  assert.equal(group.type, "гз");

  const uppercase = pickOnlyEntry(
    parseGroupSchedule(await loadSemesterFixture("group-type-krp.html")),
  );
  assert.equal(uppercase.type, "КРП");
});

test("parseTeacherSchedule parses live remote room and group markup", async () => {
  const html = await loadSemesterFixture("teacher-remote.html");
  const entry = pickOnlyEntry(parseTeacherSchedule(html));

  assert.equal(entry.room, "Дистанционно (ДОТ)");
  assert.deepEqual(entry.groups, ["КТ-41-24"]);
  assert.equal(entry.subgroup, 2);
  assert.equal(entry.isDistance, true);
});

test("parseRoomSchedule strips remote marker from teacher and groups", async () => {
  const html = await loadSemesterFixture("audience-remote.html");
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.deepEqual(entry.teacher, {
    position: "доц.",
    degree: "к.х.н.",
    name: "Решетников А. В.",
  });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 1);
  assert.equal(entry.isDistance, true);
});

test("parseRoomSchedule does not treat Федотова as a ДОТ marker", () => {
  const entry = pickOnlyEntry(parseRoomSchedule(semesterPage(`
    <tr><td class="want"><span style="color: blue;">История России</span> (пр) (1 - 16 нед.)<br>
      Федотова Т. Ю.<br>Б-91-25</td></tr>
  `)));

  assert.equal(entry.teacher.name, "Федотова Т. Ю.");
  assert.equal(entry.isDistance, false);
});

test("parseGroupSchedule parses session entries with flexible lesson types", async () => {
  const html = await loadSessionFixture("group-session-consultation.html");
  const days = parseGroupSchedule(html);
  const day = days[0];

  assert.equal(days.length, 1);
  assert.equal(day.weekday, "Суббота");
  assert.equal(day.date, "2026-04-25");
  assert.equal(day.blocks[0].lessons[0].room, "Б-201");
  assert.equal(day.blocks[0].lessons[0].type, "конс");
  assert.equal(day.blocks[0].lessons[0].weeks, undefined);
});

test("parseRoomSchedule parses session teachers and groups", () => {
  const html = sessionPage(`
    <tr><td class="want"><span style="color: blue;">Базы данных</span> (Экз)<br>
      доц. Иванов И. И.<br>КТ-41-24 КТ-41-24ин (2 подгруппа)<br>
      11:40 - 13:00</td></tr>
  `);
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "экз");
  assert.equal(entry.weeks, undefined);
  assert.deepEqual(entry.teacher, { position: "доц.", name: "Иванов И. И." });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 2);
  assert.equal(entry.possibleChanges, true);
});

test("parseRoomSchedule does not fabricate an empty teacher", () => {
  const html = semesterPage(`
    <span style="color: blue;">Консультация</span> (конс.) (1 нед.)<br>
    КТ-41-24
  `);
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.equal(entry.teacher, undefined);
  assert.deepEqual(entry.groups, ["КТ-41-24"]);
});

test("parseRoomSchedule preserves room-page substitutions", () => {
  const html = semesterPage(`
    <span style="color: blue;">Базы данных</span> (лб) (1 - 16 нед.)<br>
    доц. Иванов И. И.<br>КТ-41-24
    <div style="border: 2px solid red; padding: 5px; margin-top: 1px;">
      <span style="color: red;"><b>08.09.2026 замена на: </b></span><br>
      Аудитория: <span class="blue">Б-116</span><br>
      Преподаватель: <span class="blue">доц. Петров П. П.</span>
    </div>
  `);
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.deepEqual(entry.substitutions, [{
    date: "2026-09-08",
    room: "Б-116",
    teacher: { position: "доц.", name: "Петров П. П." },
    isDistance: false,
  }]);
});

test("parseGroupSchedule parses summer session types, teachers and subgroups", async () => {
  const html = await loadSessionFixture("group-session-summer.html");
  const entries = parseGroupSchedule(html).flatMap((day) =>
    day.blocks.flatMap((slot) => slot.lessons),
  );

  assert.equal(entries.length, 3);
  assert.ok(parseGroupSchedule(html).every((day) => day.date != null));
  assert.ok(entries.every((entry) => entry.weeks === undefined));
  assert.equal(entries[0].type, "зач");
  assert.equal(entries[0].subgroup, 1);
  assert.deepEqual(entries[0].teacher, { name: "Дигуева О. Г." });
  assert.equal(entries[0].possibleChanges, true);

  assert.equal(entries[1].type, "кп");
  assert.deepEqual(entries[1].teacher, { name: "Мытникова Е. А." });

  assert.equal(entries[2].type, "зачо");
  assert.deepEqual(entries[2].teacher, { name: "Игреев Р. А." });
});

test("Schedule filters session entries by subgroup", async () => {
  const html = await loadSessionFixture("session-subgroups.html");
  const days = parseGroupSchedule(html);
  const schedule = scheduleFromParsedDays(days, { period: 2 });

  const lessons = schedule.on(new Date(2026, 3, 25), { subgroup: 1 });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].scheduledDate, "2026-04-25");
  assert.equal(lessons[0].seriesId, undefined);
  assert.equal(lessons[0].groups.values[0].subgroup, 1);
  assert.deepEqual(lessons[0].teachers.values, [{ name: "Дигуева О. Г." }]);
});

test("Schedule does not reuse semester lessons outside its academic year", async () => {
  const html = await loadFixture("schedule-outside-year.html");
  const schedule = scheduleFromParsedDays(parseGroupSchedule(html), {
    period: 3,
  });

  assert.equal(schedule.on(new Date(2025, 4, 7)).length, 0);
  assert.equal(schedule.on(new Date(2026, 4, 6)).length, 1);
});

test("isHoliday uses six-day week by default for Saturday holiday transfers", () => {
  assert.equal(isHoliday(new Date(2026, 4, 11)), false);
  assert.equal(isHoliday(new Date(2026, 4, 11), undefined, [], false), true);
});

test("parseGroupSchedule marks distance substitutions", async () => {
  const html = await loadFixture("group-distance-substitution.html");
  const days = parseGroupSchedule(html);
  const schedule = scheduleFromParsedDays(days, { period: 3 });

  const lessons = schedule.on(new Date(2026, 4, 7), { subgroup: 1 });
  assert.equal(lessons.length, 1);
  assert.deepEqual(lessons[0].rooms, {
    values: [{ name: "Дистанционно (ДОТ)" }],
    completeness: "complete",
  });
  assert.equal(lessons[0].isDistance, true);
});

test("parseWebinars parses scheduled rows and attaches them to lessons", async () => {
  const html = await loadFixture("webinars.html");
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

  const lessons = attachWebinars(
    [
      {
        id: "les_test",
        academicYearStartYear: 2025,
        period: 3,
        nominalDate: "2026-05-07",
        scheduledDate: "2026-05-07",
        slotNumber: 1,
        time: {
          start: { hours: 8, minutes: 20 },
          end: { hours: 9, minutes: 40 },
        },
        subject: "Правоведение",
        type: "лк",
        groups: { values: [], completeness: "unknown" },
        teachers: { values: [{ name: "Верещак С. Б." }], completeness: "partial" },
        rooms: { values: [{ name: "Дистанционно (ДОТ)" }], completeness: "complete" },
        isDistance: true,
        possibleChanges: false,
        status: "scheduled",
        sources: [],
      },
    ],
    webinars,
  );
  assert.equal(lessons[0].webinar?.id, "122123");
});

test("Schedule applies spring substitutions and suppresses transferred source lessons", async () => {
  const html = await loadFixture("spring-substitutions.html");
  const springDays = parseGroupSchedule(html);
  const schedule = scheduleFromParsedDays(springDays, { period: 3 });

  const substituted = schedule.on(new Date(2026, 4, 28), {
    subgroup: 1,
  });
  assert.equal(substituted.length, 1);
  assert.deepEqual(substituted[0].teachers.values, [{ name: "Мытников А. Н." }]);
  assert.deepEqual(substituted[0].originalTeachers.values, [{ name: "Мытникова Е. А." }]);

  const sourceDate = schedule.on(new Date(2026, 3, 2), { subgroup: 2 });
  assert.equal(sourceDate.length, 0);

  const targetDate = schedule.on(new Date(2026, 4, 26), { subgroup: 2 });
  assert.equal(targetDate.length, 1);
  assert.deepEqual(targetDate[0].teachers.values, [{ name: "Мытникова Е. А." }]);
  assert.equal(targetDate[0].movedFrom?.slotNumber, 3);
});

test("parseRoomSchedule parses audience semester entries", async () => {
  const html = await loadSemesterFixture("audience-semester.html");
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.equal(entry.subject, "Базы данных");
  assert.equal(entry.type, "лб");
  assert.deepEqual(entry.teacher, {
    position: "доц.",
    name: "Иванов И.И.",
  });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.equal(entry.subgroup, 2);
});

test("parseRoomSchedule parses possible changes and odd week parity", async () => {
  const html = await loadSemesterFixture("audience-possible.html", "want");
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.equal(entry.type, "пр");
  assert.deepEqual(entry.weeks, { from: 17, to: 17 });
  assert.deepEqual(entry.groups, ["М-42-25ин", "М-42-25"]);
  assert.equal(entry.subgroup, 2);
  assert.equal(entry.weekParity, "odd");
  assert.equal(entry.possibleChanges, true);
});

test("parseRoomSchedule parses transfer with original room marker", async () => {
  const html = await loadSemesterFixture("audience-transfer.html");
  const entry = pickOnlyEntry(parseRoomSchedule(html));

  assert.equal(entry.room, "Г-316");
  assert.equal(entry.subject, "Основы проектной деятельности");
  assert.equal(entry.type, "пр");
  assert.deepEqual(entry.teacher, { name: "Игреев Р. А." });
  assert.deepEqual(entry.groups, ["КТ-41-24", "КТ-41-24ин"]);
  assert.ok(entry.transfer);
  assert.equal(entry.transfer.fromSlot, 7);
});

test("parseRoomInfo parses metadata and image links from audience pages", async () => {
  const html = await loadFixture("audience-info.html");
  const info = parseRoomInfo(html);

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

test("parseRoomName reads the current audience from breadcrumbs", async () => {
  const html = await loadFixture("audience-name.html");

  assert.equal(parseRoomName(html), "Е-115");
});

test("parseTeacherButtons parses teacher list buttons", async () => {
  const html = await loadFixture("teacher-buttons.html");

  assert.deepEqual(parseTeacherButtons(html), [
    { id: 113, name: "Александров Андрей Харитонович" },
    { id: 793, name: "Алексеева Наталья Робертовна" },
  ]);
});

test("parseTeacherInfo parses teacher pages without degree", async () => {
  const html = await loadFixture("teacher-info.html");
  const info = parseTeacherInfo(html);

  assert.deepEqual(info, {
    name: "Давыдова Наталия Анатольевна",
    degree: undefined,
    department: "Кафедра Техносферной безопасности, метрологии и технологии материалов",
    photoUrl: "/index/photo/tech/2125/id/2125",
  });
});
