import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml } from "../dist/common/parse.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";
import {
  parseGroupSchedule,
  parseRoomSchedule,
  parseTeacherSchedule,
} from "../dist/tt/parse/index.js";

const CONFIG = {
  group: {
    parser: parseGroupSchedule,
    fixtureDir: "group-schedules",
    expectedDir: "expected",
    requiredCount: 34,
  },
  teacher: {
    parser: parseTeacherSchedule,
    fixtureDir: "teacher-schedules",
    expectedDir: "teacher-expected",
    requiredCount: 4,
  },
  room: {
    parser: parseRoomSchedule,
    fixtureDir: "room-schedules",
    expectedDir: "room-expected",
    requiredCount: 4,
  },
};
const CORPORA = [];

const WEEKDAYS = new Map([
  ["воскресенье", 0],
  ["понедельник", 1],
  ["вторник", 2],
  ["среда", 3],
  ["четверг", 4],
  ["пятница", 5],
  ["суббота", 6],
]);

function normalize(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function directLessonCell(row) {
  const cell = row.querySelector("td") ?? row;
  const subjects = [...cell.querySelectorAll('span[style*="color: blue"]')]
    .filter((value) => {
      const content = normalize(value.textContent ?? "");
      return value.closest("td") === cell && content && !/^\(ДОТ\)$/iu.test(content);
    })
    .map((value) => normalize(value.textContent ?? ""));
  return subjects.length > 0 ? { cell, subjects } : null;
}

function sourceDays(html) {
  const document = parseHtml(html);
  const days = [];
  let current;
  for (const row of document.querySelectorAll("tr")) {
    const className = row.getAttribute("class") ?? "";
    const style = row.getAttribute("style") ?? "";
    if (className.includes("trfd") && style.includes("lightgray")) {
      current = {
        weekday: normalize(row.querySelector("td")?.textContent ?? ""),
        isSelfStudyDay: false,
        blocks: [],
      };
      days.push(current);
      continue;
    }
    if (!current) continue;
    if (/День самостоятельной работы/iu.test(row.textContent ?? "")) {
      current.isSelfStudyDay = true;
    }
    const timeCell = row.querySelector("td.trf");
    const dataCell = row.querySelector("td.trdata:not(.trf)");
    const timeText = normalize(timeCell?.textContent ?? "");
    const slotNumber = timeText.match(/(\d+)\s*пара/iu);
    const time = timeText.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/u);
    if (!dataCell || !slotNumber) continue;
    current.blocks.push({
      slotNumber: Number(slotNumber[1]),
      time: time
        ? {
            start: { hours: Number(time[1]), minutes: Number(time[2]) },
            end: { hours: Number(time[3]), minutes: Number(time[4]) },
          }
        : undefined,
      lessons: [...dataCell.querySelectorAll("table tr")]
        .map(directLessonCell)
        .filter(Boolean),
    });
  }
  return { document, days };
}

function relationOwnerValue(owner, relation) {
  if (relation === "groups" && owner.type === "group") return owner.group;
  if (relation === "teachers" && owner.type === "teacher") return owner.teacher;
  if (relation === "rooms" && owner.type === "room") return owner.room;
  return null;
}

function relationEntity(value, relation) {
  return relation === "groups" ? value.group : value;
}

function expectedCompleteness(relation, owner, values) {
  const hasOwner = relationOwnerValue(owner, relation) != null;
  return hasOwner || values.length > 0 ? "partial" : "unknown";
}

function assertRelationSource(relation, expected, owner, source, label) {
  assert.equal(
    expected.completeness,
    expectedCompleteness(relation, owner, expected.values),
    `${label}: ${relation} completeness`,
  );
  const implicit = relationOwnerValue(owner, relation);
  for (const value of expected.values) {
    const entity = relationEntity(value, relation);
    if (implicit?.id === entity.id) continue;
    assert.ok(source.includes(entity.name), `${label}: ${relation} ${entity.name}`);
    if (relation === "groups" && value.subgroup != null) {
      assert.match(source, new RegExp(`${value.subgroup}\\s*подгруппа`, "iu"));
    }
  }
}

function dateText(value) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

function assertWeeks(source, weeks, label) {
  if (weeks.from === 0 && weeks.to === 0) return;
  const marker = weeks.from === weeks.to
    ? `${weeks.from}\\s*нед\\.?`
    : `${weeks.from}\\s*-\\s*${weeks.to}\\s*нед\\.?`;
  assert.match(source, new RegExp(`\\(${marker}\\)`, "iu"), `${label}: weeks`);
}

function assertOverlays(cell, lesson, label) {
  const overlays = [...cell.querySelectorAll('div[style*="border: 2px solid red"]')];
  const substitutions = overlays.filter((value) => /замена\s*на:/iu.test(value.textContent ?? ""));
  const expectedSubstitutions = lesson.substitutions ?? [];
  assert.equal(substitutions.length, expectedSubstitutions.length, `${label}: substitutions`);
  for (const expected of expectedSubstitutions) {
    const source = normalize(substitutions.find((value) =>
      normalize(value.textContent ?? "").includes(dateText(expected.date)),
    )?.textContent ?? "");
    assert.ok(source, `${label}: substitution date`);
    for (const room of expected.rooms ?? []) assert.ok(source.includes(room.name));
    for (const teacher of expected.teachers ?? []) assert.ok(source.includes(teacher.name));
    if (expected.isDistance) assert.match(source, /дистанционно|ДОТ/iu);
  }

  const transfers = overlays.filter((value) => /перенос\s*[cс]/iu.test(value.textContent ?? ""));
  assert.equal(transfers.length > 0, lesson.kind === "occurrence" && lesson.status === "moved");
  if (lesson.kind === "occurrence" && lesson.status === "moved") {
    const source = normalize(transfers[0].textContent ?? "");
    assert.ok(source.includes(dateText(lesson.scheduledDate)));
    assert.ok(source.includes(dateText(lesson.movedFrom.date)));
    assert.match(source, new RegExp(`${lesson.movedFrom.slotNumber}\\s*пара`, "iu"));
  }
}

function sourcePosition(lesson) {
  assert.equal(lesson.sources.length, 1);
  const match = lesson.sources[0].observationKey.match(
    /^day:(\d+):block:(\d+):lesson:(\d+)$/u,
  );
  assert.ok(match, `${lesson.id}: opaque source position malformed`);
  return match.slice(1).map(Number);
}

function auditCanonicalAgainstHtml(fixture) {
  const { document, days } = sourceDays(fixture.html);
  const { source, lessons } = fixture.expected;
  const body = normalize(document.body.textContent ?? "");
  const ownerEntity = source.owner.type === "group"
    ? source.owner.group
    : source.owner.type === "teacher"
      ? source.owner.teacher
      : source.owner.room;
  assert.ok(body.includes(ownerEntity.name), `${fixture.file}: owner`);
  assert.ok(body.includes(
    `${source.academicYearStartYear}/${source.academicYearStartYear + 1} учебный год`,
  ));

  for (const lesson of lessons) {
    const [dayIndex, blockIndex, lessonIndex] = sourcePosition(lesson);
    const day = days[dayIndex];
    const block = day?.blocks[blockIndex];
    const raw = block?.lessons[lessonIndex];
    const label = `${fixture.file}:${lesson.id}`;
    assert.ok(raw, `${label}: raw source row missing`);
    const text = normalize(raw.cell.textContent ?? "");
    assert.ok(raw.subjects.includes(lesson.subject), `${label}: subject`);
    assert.match(text, new RegExp(`\\(${escapeRegex(lesson.type)}\\.?\\)`, "iu"));
    assert.equal(block.slotNumber, lesson.slotNumber, `${label}: independent slot claim`);
    assert.deepEqual(block.time, lesson.time, `${label}: independent time claim`);
    if (lesson.kind === "series") {
      assert.equal(WEEKDAYS.get(day.weekday.toLowerCase()), lesson.recurrence.weekday);
      assertWeeks(text, lesson.recurrence.weeks, label);
      const parity = normalize(raw.cell.querySelector("sup")?.textContent ?? "");
      assert.equal(
        parity || null,
        lesson.recurrence.parity === "even"
          ? "**"
          : lesson.recurrence.parity === "odd" ? "*" : null,
      );
    }
    assertRelationSource("groups", lesson.groups, source.owner, text, label);
    assertRelationSource("teachers", lesson.teachers, source.owner, text, label);
    assertRelationSource("rooms", lesson.rooms, source.owner, text, label);
    assert.equal(/дистанционно|ДОТ/iu.test(text), lesson.isDistance);
    assert.equal(raw.cell.classList.contains("want"), lesson.possibleChanges);
    assertOverlays(raw.cell, lesson, label);
    assert.ok(!lesson.id.includes(lesson.subject));
    assert.ok(!lesson.rooms.values.some((room) => lesson.id.includes(room.name)));
  }
}

function canonicalValue(value, kind) {
  return {
    kind,
    ...value,
    sources: value.sources.map(({ observedAt: _observedAt, ...source }) => source),
  };
}

function recreateCanonical(fixture, parser) {
  const { source } = fixture.expected;
  const ownerEntity = source.owner.type === "group"
    ? source.owner.group
    : source.owner.type === "teacher"
      ? source.owner.teacher
      : source.owner.room;
  let series = 0;
  let occurrences = 0;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: () => `ser_fixture_${source.owner.type}_${ownerEntity.id}_${++series}`,
      lessonId: () => `les_fixture_${source.owner.type}_${ownerEntity.id}_${++occurrences}`,
    },
  });
  repository.ingest(createScheduleSourceSnapshot({
    ...source,
    observedAt: new Date("2026-08-31T00:00:00.000Z"),
    days: parser(fixture.html),
  }));
  return [
    ...repository.getSeries({ owner: source.owner }).map((value) => canonicalValue(value, "series")),
    ...repository.getDirectOccurrences({ owner: source.owner }).map((value) => canonicalValue(value, "occurrence")),
  ];
}

async function loadFixtures(kind, config) {
  const fixtureDir = new URL(`./fixtures/tt/${config.fixtureDir}/`, import.meta.url);
  const expectedDir = new URL(`./fixtures/tt/${config.expectedDir}/`, import.meta.url);
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

for (const [kind, config] of Object.entries(CONFIG)) {
  const fixtures = await loadFixtures(kind, config);
  CORPORA.push(...fixtures.map((fixture) => ({ ...fixture, kind, parser: config.parser })));
  test(`${kind} schema-v5 corpus coverage`, () => {
    assert.equal(fixtures.length, config.requiredCount);
    const lessons = fixtures.flatMap((fixture) => fixture.expected.lessons);
    assert.ok(lessons.length > 0);
    assert.equal(new Set(lessons.map((lesson) => lesson.id)).size, lessons.length);
    assert.ok(lessons.every((lesson) => lesson.groups.completeness !== undefined));
    assert.ok(lessons.every((lesson) => lesson.teachers.completeness !== undefined));
    assert.ok(lessons.every((lesson) => lesson.rooms.completeness !== undefined));
  });

  for (const fixture of fixtures) {
    test(`${kind} fixture ${fixture.file} is canonical schema v5`, () => {
      assert.equal(fixture.expected.schemaVersion, 5);
      assert.deepEqual(
        JSON.parse(JSON.stringify(recreateCanonical(fixture, config.parser))),
        fixture.expected.lessons,
      );
      auditCanonicalAgainstHtml(fixture);
    });
  }
}

function corpusRepository(fixtures) {
  let series = 0;
  let occurrences = 0;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: () => `ser_corpus_${++series}`,
      lessonId: () => `les_corpus_${++occurrences}`,
    },
  });
  for (const fixture of fixtures) {
    repository.ingest(createScheduleSourceSnapshot({
      ...fixture.expected.source,
      observedAt: new Date("2026-08-31T00:00:00.000Z"),
      days: fixture.parser(fixture.html),
    }));
  }
  return repository;
}

function sourcePartition(repository) {
  return repository.getSeries()
    .map((lesson) => lesson.sources
      .map((source) => `${source.sourceKey}:${source.observationKey}`)
      .sort()
      .join("|"))
    .sort();
}

test("real corpus merges shared lessons without conflating unrelated owners", () => {
  const repository = corpusRepository(CORPORA);
  const shared = repository.getSeries().filter((lesson) =>
    lesson.sources.length > 1
  );
  assert.ok(shared.length > 0, "corpus must contain shared group lessons");
  assert.ok(shared.some((lesson) =>
    lesson.groups.values.length > 0 &&
    lesson.teachers.values.length > 0 &&
    lesson.rooms.values.length > 0
  ), "a shared lesson must accumulate all known relations");
  assert.ok(repository.getSeries().every((lesson) => {
    const ownerKinds = new Set(lesson.sources.map((source) => source.owner.type));
    return ownerKinds.size === 1;
  }), "unrelated teacher and room samples must not be false-positive matches");

  const reversed = corpusRepository([...CORPORA].reverse());
  assert.deepEqual(
    sourcePartition(reversed),
    sourcePartition(repository),
    "canonical grouping must not depend on request order",
  );
});
