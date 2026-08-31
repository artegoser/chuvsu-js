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
  group: { parser: parseGroupSchedule, fixtureDir: "group-schedules", requiredCount: 34 },
  teacher: { parser: parseTeacherSchedule, fixtureDir: "teacher-schedules", requiredCount: 4 },
  room: { parser: parseRoomSchedule, fixtureDir: "room-schedules", requiredCount: 4 },
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
      teacher: { id, name: info.name, degree: info.degree },
    };
  }
  const name = parseRoomName(html);
  assert.ok(name, `room ${id}: missing owner`);
  return { type: "room", room: { id, name } };
}

async function loadCorpus(kind, config) {
  const dir = new URL(`./fixtures/tt/${config.fixtureDir}/`, import.meta.url);
  const files = (await readdir(dir)).filter((value) => value.endsWith(".html")).sort();
  assert.equal(files.length, config.requiredCount);
  return Promise.all(files.map(async (file) => {
    const html = await readFile(new URL(file, dir), "utf8");
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
      source: {
        sourceKey: `fixture:${kind}:${id}:${period}:${academicYearStartYear}`,
        owner: ownerFromPage(kind, id, html),
        academicYearStartYear,
        period,
      },
    };
  }));
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
}

function valueAt(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
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
    const lesson = days[testCase.day].blocks[testCase.block].lessons[testCase.lesson];
    for (const [path, expected] of Object.entries(testCase.fields)) {
      assert.deepEqual(valueAt(lesson, path), expected, `${testCase.fixture}: ${path}`);
    }
    for (const path of testCase.absent ?? []) {
      assert.equal(valueAt(lesson, path), undefined, `${testCase.fixture}: absent ${path}`);
    }
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
});
