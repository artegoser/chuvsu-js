import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";
import {
  parseAcademicYearFromPage,
  parseGroupName,
  parseGroupSchedule,
  parsePeriodFromPage,
  parseRoomName,
  parseRoomSchedule,
  parseTeacherInfo,
  parseTeacherSchedule,
} from "../dist/tt/parse/index.js";
import { isLocalDate } from "../dist/tt/utils/index.js";

const CONFIG = {
  group: {
    parser: parseGroupSchedule,
    fixtureDir: "group-schedules",
    expectedDir: "expected",
    requiredCount: 34,
    expectedFeatures: {
      lessons: 900,
      occurrences: 3,
      substitutions: 1,
      distance: 58,
      moved: 3,
    },
  },
  teacher: {
    parser: parseTeacherSchedule,
    fixtureDir: "teacher-schedules",
    expectedDir: "teacher-expected",
    requiredCount: 4,
    expectedFeatures: {
      lessons: 64,
      occurrences: 0,
      substitutions: 0,
      distance: 18,
      moved: 0,
    },
  },
  room: {
    parser: parseRoomSchedule,
    fixtureDir: "room-schedules",
    expectedDir: "room-expected",
    requiredCount: 4,
    expectedFeatures: {
      lessons: 220,
      occurrences: 2,
      substitutions: 0,
      distance: 0,
      moved: 2,
    },
  },
};
const CORPORA = [];

function ownerFromPage(kind, id, html) {
  if (kind === "group") {
    const name = parseGroupName(html);
    assert.ok(name, `group ${id}: missing owner`);
    return { type: "group", group: { id, name } };
  }
  if (kind === "teacher") {
    const info = parseTeacherInfo(html);
    assert.ok(info?.name, `teacher ${id}: missing owner`);
    return {
      type: "teacher",
      teacher: {
        id,
        name: info.name,
        ...(info.degree ? { degree: info.degree } : {}),
      },
    };
  }
  const name = parseRoomName(html);
  assert.ok(name, `room ${id}: missing owner`);
  return { type: "room", room: { id, name } };
}

async function loadCorpus(kind, config) {
  const dir = new URL(`./fixtures/tt/${config.fixtureDir}/`, import.meta.url);
  const expectedDir = new URL(`./fixtures/tt/${config.expectedDir}/`, import.meta.url);
  const files = (await readdir(dir)).filter((value) => value.endsWith(".html")).sort();
  const expectedFiles = (await readdir(expectedDir))
    .filter((value) => value.endsWith(".json"))
    .sort();
  assert.equal(files.length, config.requiredCount);
  assert.deepEqual(
    expectedFiles,
    files.map((value) => value.replace(/\.html$/u, ".json")),
  );
  return Promise.all(files.map(async (file) => {
    const html = await readFile(new URL(file, dir), "utf8");
    const expected = JSON.parse(await readFile(
      new URL(file.replace(/\.html$/u, ".json"), expectedDir),
      "utf8",
    ));
    const match = file.match(/-(\d+)-period-(\d+)\.html$/u);
    assert.ok(match, `${file}: invalid filename`);
    const id = Number(match[1]);
    const period = Number(match[2]);
    const academicYearStartYear = parseAcademicYearFromPage(html);
    assert.ok(academicYearStartYear, `${file}: missing academic year`);
    assert.equal(parsePeriodFromPage(html), period, `${file}: period`);
    return {
      kind,
      file,
      html,
      days: config.parser(html),
      expected,
      source: {
        sourceKey: `fixture:${kind}:${id}:${period}:${academicYearStartYear}`,
        owner: ownerFromPage(kind, id, html),
        academicYearStartYear,
        period,
      },
    };
  }));
}

function canonicalValue(value, kind) {
  return {
    kind,
    ...value,
    sources: value.sources.map(({ observedAt: _observedAt, ...source }) => source),
  };
}

function recreateCanonical(fixture) {
  const ownerEntity = fixture.source.owner.type === "group"
    ? fixture.source.owner.group
    : fixture.source.owner.type === "teacher"
      ? fixture.source.owner.teacher
      : fixture.source.owner.room;
  let series = 0;
  let occurrences = 0;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: () =>
        `ser_fixture_${fixture.source.owner.type}_${ownerEntity.id}_${++series}`,
      lessonId: () =>
        `les_fixture_${fixture.source.owner.type}_${ownerEntity.id}_${++occurrences}`,
    },
  });
  repository.ingest(createScheduleSourceSnapshot({
    ...fixture.source,
    observedAt: new Date("2026-08-31T00:00:00.000Z"),
    days: fixture.days,
  }));
  return [
    ...repository.getSeries({ owner: fixture.source.owner })
      .map((value) => canonicalValue(value, "series")),
    ...repository.getDirectOccurrences({ owner: fixture.source.owner })
      .map((value) => canonicalValue(value, "occurrence")),
  ];
}

for (const [kind, config] of Object.entries(CONFIG)) {
  const fixtures = await loadCorpus(kind, config);
  CORPORA.push(...fixtures);
  test(`${kind} full-page corpus satisfies canonical input invariants`, () => {
    const observations = fixtures.flatMap((fixture) =>
      createScheduleSourceSnapshot({
        ...fixture.source,
        observedAt: new Date("2026-08-31T00:00:00Z"),
        days: fixture.days,
      }).observations
    );
    assert.ok(observations.length > 0);
    for (const observation of observations) {
      assert.ok(observation.subject.trim());
      assert.ok(observation.type.trim());
      assert.ok(observation.slotNumber == null || observation.slotNumber >= 1);
      assert.ok(observation.groups.values.every((value) => value.group.name.trim()));
      assert.ok(observation.teachers.values.every((value) => value.name.trim()));
      assert.ok(observation.rooms.values.every((value) => value.name.trim()));
      if (observation.kind === "series") {
        assert.ok(observation.recurrence.weeks == null || observation.recurrence.weeks.from >= 1);
      } else {
        assert.ok(isLocalDate(observation.date));
      }
    }
  });

  test(`${kind} reviewed corpus retains its feature coverage`, () => {
    const lessons = fixtures.flatMap((fixture) => fixture.expected.lessons);
    assert.deepEqual(
      {
        lessons: lessons.length,
        occurrences: lessons.filter((lesson) => lesson.kind === "occurrence").length,
        substitutions: lessons.reduce(
          (count, lesson) => count + (lesson.substitutions?.length ?? 0),
          0,
        ),
        distance: lessons.filter((lesson) => lesson.isDistance).length,
        moved: lessons.filter((lesson) => lesson.status === "moved").length,
      },
      config.expectedFeatures,
    );
  });

  for (const fixture of fixtures) {
    test(`${kind} fixture ${fixture.file} matches its manually reviewed expectation`, () => {
      assert.equal(fixture.expected.schemaVersion, 5);
      assert.deepEqual(fixture.source, fixture.expected.source);
      assert.deepEqual(
        JSON.parse(JSON.stringify(recreateCanonical(fixture))),
        fixture.expected.lessons,
      );
    });
  }
}

const manualCases = JSON.parse(await readFile(
  new URL("./fixtures/tt/manual-schedule-cases.json", import.meta.url),
  "utf8",
));

test("hand-authored schedule cases match parser output", async () => {
  for (const testCase of manualCases) {
    const html = await readFile(
      new URL(`./fixtures/tt/parser/${testCase.fixture}`, import.meta.url),
      "utf8",
    );
    const parser = CONFIG[testCase.kind].parser;
    const page = testCase.wrapper === "session"
      ? `<!doctype html><table><tr><td id="trd20260425" class="trfd">25.04.2026<br>Суббота</td><td class="trdata"><table>${html}</table></td></tr></table>`
      : testCase.wrapper === "raw"
        ? html
        : `<!doctype html><table id="groupstt"><tr style="background: lightgray" class="trfd"><td>Суббота</td></tr><tr><td class="trf trdata"><div class="trfd">4 пара<br>(13:30 - 14:50)</div></td><td class="trdata"><div class="tdd"><table><tr><td>${html}</td></tr></table></div></td></tr></table>`;
    const days = parser(page);
    assert.deepEqual(
      JSON.parse(JSON.stringify(days)),
      testCase.expected,
      testCase.fixture,
    );
  }
});

function corpusRepository(fixtures) {
  const repository = new TimetableRepository();
  for (const fixture of fixtures) {
    repository.ingest(createScheduleSourceSnapshot({
      ...fixture.source,
      observedAt: new Date("2026-08-31T00:00:00Z"),
      days: fixture.days,
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

test("full-page corpus contains genuine cross-owner canonical lessons", () => {
  const repository = corpusRepository(CORPORA);
  const shared = repository.getSeries().filter((lesson) =>
    new Set(lesson.sources.map((source) => source.owner.type)).size > 1
  );
  assert.ok(shared.length > 0);
  assert.ok(shared.every((lesson) =>
    lesson.groups.values.length > 0 &&
    lesson.teachers.values.length > 0 &&
    lesson.rooms.values.length > 0
  ));
  assert.ok(shared.some((lesson) => {
    const kinds = new Set(lesson.sources.map((source) => source.owner.type));
    return kinds.has("teacher") && kinds.has("room");
  }));
  assert.ok(shared.some((lesson) => {
    const kinds = new Set(lesson.sources.map((source) => source.owner.type));
    return kinds.has("group") && kinds.has("room");
  }));

  const reversed = corpusRepository([...CORPORA].reverse());
  assert.deepEqual(sourcePartition(reversed), sourcePartition(repository));
});
