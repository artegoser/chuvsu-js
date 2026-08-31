import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml } from "../dist/common/parse.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";
import {
  parseRoomSchedule,
  parseTeacherSchedule,
} from "../dist/tt/parse/index.js";

const KINDS = {
  teacher: { parser: parseTeacherSchedule, requiredCount: 4 },
  room: { parser: parseRoomSchedule, requiredCount: 4 },
};

function dateKey(date) {
  if (!date) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function actualEntry(entry) {
  return {
    subject: entry.subject,
    type: entry.type,
    weeks: entry.weeks,
    room: entry.room,
    teacher: entry.teacher,
    groups: entry.groups,
    subgroup: entry.subgroup ?? null,
    weekParity: entry.weekParity ?? null,
    isDistance: Boolean(entry.isDistance),
    possibleChanges: Boolean(entry.possibleChanges),
    substitutions: (entry.substitutions ?? []).map((value) => ({
      date: dateKey(value.date),
      room: value.room ?? null,
      isDistance: Boolean(value.isDistance),
      teacher: value.teacher ?? null,
    })),
    transfer: entry.transfer
      ? {
          targetDate: dateKey(entry.transfer.targetDate),
          fromDate: dateKey(entry.transfer.fromDate),
          fromSlot: entry.transfer.fromSlot,
          subject: entry.transfer.subject,
        }
      : null,
    substituteFor: entry.substituteFor
      ? {
          date: dateKey(entry.substituteFor.date),
          originalTeacher: entry.substituteFor.originalTeacher,
        }
      : null,
  };
}

async function loadFixtures(kind) {
  const fixtureDir = new URL(`./fixtures/tt/${kind}-schedules/`, import.meta.url);
  const expectedDir = new URL(`./fixtures/tt/${kind}-expected/`, import.meta.url);
  const htmlFiles = (await readdir(fixtureDir)).filter((value) => value.endsWith(".html")).sort();
  const jsonFiles = (await readdir(expectedDir)).filter((value) => value.endsWith(".json")).sort();
  assert.deepEqual(jsonFiles, htmlFiles.map((value) => value.replace(/\.html$/u, ".json")));
  return Promise.all(htmlFiles.map(async (file) => ({
    file,
    html: await readFile(new URL(file, fixtureDir), "utf8"),
    expected: JSON.parse(await readFile(
      new URL(file.replace(/\.html$/u, ".json"), expectedDir),
      "utf8",
    )),
  })));
}

function compareFrozen(fixture, parser) {
  const days = parser(fixture.html);
  assert.equal(days.length, fixture.expected.days.length);
  for (const [dayIndex, expectedDay] of fixture.expected.days.entries()) {
    const day = days[dayIndex];
    assert.equal(day.weekday, expectedDay.weekday);
    assert.equal(dateKey(day.date), expectedDay.date);
    assert.equal(Boolean(day.isSelfStudyDay), expectedDay.isSelfStudyDay);
    assert.equal(day.slots.length, expectedDay.slots.length);
    for (const [slotIndex, expectedSlot] of expectedDay.slots.entries()) {
      const slot = day.slots[slotIndex];
      assert.equal(slot.number, expectedSlot.number);
      assert.deepEqual(slot.timeStart, expectedSlot.timeStart);
      assert.deepEqual(slot.timeEnd, expectedSlot.timeEnd);
      assert.deepEqual(
        slot.entries.map(actualEntry),
        expectedSlot.entries.map(({ index: _index, ...entry }) => entry),
        `${fixture.file}: entry mismatch at ${dayIndex}/${slotIndex}`,
      );
    }
  }
  return days;
}

function normalize(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function auditSource(fixture) {
  const document = parseHtml(fixture.html);
  const entries = fixture.expected.days.flatMap((day) =>
    day.slots.flatMap((slot) => slot.entries),
  );
  const subjectCells = [...document.querySelectorAll('span[style*="color: blue"]')]
    .map((span) => ({ subject: normalize(span.textContent ?? ""), cell: span.closest("td") }))
    .filter((value) => value.cell);

  assert.ok(normalize(document.body.textContent ?? "").includes(fixture.expected.owner.name));
  for (const subject of new Set(entries.map((entry) => entry.subject))) {
    const expectedCount = entries.filter((entry) => entry.subject === subject).length;
    const sourceCount = subjectCells.filter((value) => value.subject === subject).length;
    assert.ok(sourceCount >= expectedCount, `${fixture.file}: raw subject count for ${subject}`);
  }

  for (const entry of entries) {
    const candidates = subjectCells.filter((value) => value.subject === entry.subject);
    const cell = candidates.find(({ cell: value }) => {
      const source = normalize(value.textContent ?? "");
      const hasType = new RegExp(`\\(${escapeRegex(entry.type)}\\.?\\)`, "iu").test(source);
      const hasSubgroup = entry.subgroup == null ||
        new RegExp(`${entry.subgroup}\\s*подгруппа`, "iu").test(source);
      return hasType && hasSubgroup &&
        (!entry.room || entry.isDistance || source.includes(entry.room)) &&
        (!entry.teacher.name || source.includes(entry.teacher.name)) &&
        entry.groups.every((group) => source.includes(group));
    })?.cell;
    assert.ok(cell, `${fixture.file}: no raw source cell for ${entry.subject}`);
    const source = normalize(cell.textContent ?? "");
    assert.match(source, new RegExp(`\\(${escapeRegex(entry.type)}\\.?\\)`, "iu"));
    if (entry.subgroup != null) {
      assert.match(source, new RegExp(`${entry.subgroup}\\s*подгруппа`, "iu"));
    }
    if (entry.isDistance) assert.match(source, /дистанционно|ДОТ/iu);
    assert.equal(cell.classList.contains("want"), entry.possibleChanges);
  }
}

function assertCanonical(fixture, days) {
  let series = 0;
  let lessons = 0;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: () => `ser_owner_${++series}`,
      lessonId: () => `les_owner_${++lessons}`,
    },
  });
  const owner = fixture.expected.owner.type === "teacher"
    ? {
        type: "teacher",
        teacher: { id: fixture.expected.owner.id, name: fixture.expected.owner.name },
      }
    : {
        type: "room",
        room: { id: fixture.expected.owner.id, name: fixture.expected.owner.name },
      };
  const source = createScheduleSourceSnapshot({
    sourceKey: `fixture:${fixture.file}`,
    owner,
    academicYearStartYear: fixture.expected.academicYearStartYear,
    period: fixture.expected.period,
    observedAt: new Date("2026-08-31T00:00:00.000Z"),
    days,
  });
  repository.ingest(source);
  const links = repository.export().links;
  assert.equal(links.length, source.observations.length);
  assert.equal(new Set(links.map((value) => value.id)).size, links.length);
  const canonical = [
    ...repository.getSeries({ owner }),
    ...repository.getDirectOccurrences({ owner }),
  ];
  assert.equal(canonical.length, source.observations.length);
  for (const lesson of canonical) {
    if (owner.type === "teacher") {
      assert.ok(lesson.teachers.some((value) => value.id === owner.teacher.id));
    } else {
      assert.ok(lesson.rooms.some((value) => value.id === owner.room.id));
    }
  }
}

for (const [kind, config] of Object.entries(KINDS)) {
  const fixtures = await loadFixtures(kind);
  test(`${kind} full-page fixture corpus coverage`, () => {
    assert.equal(fixtures.length, config.requiredCount);
    const entries = fixtures.flatMap((fixture) =>
      fixture.expected.days.flatMap((day) => day.slots.flatMap((slot) => slot.entries)),
    );
    assert.ok(entries.length >= 20);
    assert.ok(entries.every((entry) => entry.groups.length > 0));
    assert.ok(entries.some((entry) => entry.subgroup != null));
    assert.ok(entries.some((entry) => entry.weekParity != null));
    if (kind === "teacher") assert.ok(entries.some((entry) => entry.isDistance));
    if (kind === "room") assert.ok(entries.every((entry) => entry.teacher.name));
  });

  for (const fixture of fixtures) {
    test(`${kind} fixture ${fixture.file} matches frozen JSON and source`, () => {
      assert.equal(fixture.expected.schemaVersion, 1);
      assert.equal(fixture.expected.file, fixture.file);
      assert.equal(fixture.expected.owner.type, kind);
      const days = compareFrozen(fixture, config.parser);
      auditSource(fixture);
      assertCanonical(fixture, days);
    });
  }
}
