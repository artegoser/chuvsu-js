import assert from "node:assert/strict";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseHtml } from "../dist/common/parse.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";
import {
  parseAcademicYearFromPage,
  parseGroupSchedule,
  parseRoomName,
  parseRoomSchedule,
  parseTeacherInfo,
  parseTeacherSchedule,
} from "../dist/tt/parse/index.js";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const CONFIG = {
  group: {
    parser: parseGroupSchedule,
    fixtureDir: "test/fixtures/tt/group-schedules",
    expectedDir: "test/fixtures/tt/expected",
    ownerName: (html) => parseHtml(html)
      .querySelector('span.htext span[style*="color: blue"]')
      ?.textContent?.trim(),
  },
  teacher: {
    parser: parseTeacherSchedule,
    fixtureDir: "test/fixtures/tt/teacher-schedules",
    expectedDir: "test/fixtures/tt/teacher-expected",
    ownerName: (html) => parseTeacherInfo(html)?.name,
  },
  room: {
    parser: parseRoomSchedule,
    fixtureDir: "test/fixtures/tt/room-schedules",
    expectedDir: "test/fixtures/tt/room-expected",
    ownerName: parseRoomName,
  },
};

function ownerFor(kind, id, name) {
  if (kind === "group") return { type: kind, group: { id, name } };
  if (kind === "teacher") return { type: kind, teacher: { id, name } };
  return { type: kind, room: { id, name } };
}

function canonicalValue(value, kind) {
  return {
    kind,
    ...value,
    sources: value.sources.map(({ observedAt: _observedAt, ...source }) => source),
  };
}

const kind = option("kind");
assert.ok(kind in CONFIG, "--kind must be group, teacher, or room");
const config = CONFIG[kind];
const fixtureDir = resolve(config.fixtureDir);
const expectedDir = resolve(config.expectedDir);
await mkdir(expectedDir, { recursive: true });
for (const file of await readdir(expectedDir)) {
  if (new RegExp(`^${kind}-\\d+-period-\\d+\\.json$`, "u").test(file)) {
    await unlink(join(expectedDir, file));
  }
}

const files = (await readdir(fixtureDir))
  .filter((file) => new RegExp(`^${kind}-\\d+-period-\\d+\\.html$`, "u").test(file))
  .sort();
for (const file of files) {
  const html = await readFile(join(fixtureDir, file), "utf8");
  const id = Number(file.match(new RegExp(`^${kind}-(\\d+)-`, "u"))?.[1]);
  const period = Number(file.match(/-period-(\d+)\.html$/u)?.[1]);
  const name = config.ownerName(html);
  const academicYearStartYear = parseAcademicYearFromPage(html);
  assert.ok(name, `${file}: owner name missing`);
  assert.ok(academicYearStartYear != null, `${file}: academic year missing`);
  const owner = ownerFor(kind, id, name);
  let seriesSequence = 0;
  let occurrenceSequence = 0;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: () => `ser_fixture_${kind}_${id}_${++seriesSequence}`,
      lessonId: () => `les_fixture_${kind}_${id}_${++occurrenceSequence}`,
    },
  });
  const sourceKey = `fixture:${kind}:${id}:${period}:${academicYearStartYear}`;
  repository.ingest(createScheduleSourceSnapshot({
    sourceKey,
    owner,
    academicYearStartYear,
    period,
    observedAt: new Date("2026-08-31T00:00:00.000Z"),
    days: config.parser(html),
  }));
  const expected = {
    schemaVersion: 5,
    source: { sourceKey, owner, academicYearStartYear, period },
    lessons: [
      ...repository.getSeries({ owner }).map((value) => canonicalValue(value, "series")),
      ...repository.getDirectOccurrences({ owner }).map((value) => canonicalValue(value, "occurrence")),
    ],
  };
  await writeFile(
    join(expectedDir, file.replace(/\.html$/u, ".json")),
    `${JSON.stringify(expected, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify({ kind, schemaVersion: 5, expectations: files.length }));
