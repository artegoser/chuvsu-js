import test from "node:test";
import assert from "node:assert/strict";

import { AcademicPeriod } from "../dist/common/types.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { Schedule } from "../dist/tt/domain/schedule.js";

const YEAR = 2025;
const PERIOD = AcademicPeriod.FallSemester;

function repository(snapshot) {
  let series = 0;
  let lessons = 0;
  return new TimetableRepository({
    snapshot,
    idGenerator: {
      seriesId: () => `ser_${++series}`,
      lessonId: () => `les_${++lessons}`,
    },
  });
}

function seriesObservation(overrides = {}) {
  return {
    kind: "series",
    key: "row:1",
    subject: "Базы данных",
    type: "лб",
    slot: {
      number: 2,
      start: { hours: 10, minutes: 0 },
      end: { hours: 11, minutes: 20 },
    },
    recurrence: {
      weekday: 2,
      weeks: { from: 1, to: 17 },
      parity: "odd",
    },
    ...overrides,
  };
}

function snapshot(sourceKey, owner, observations) {
  return {
    sourceKey,
    owner,
    academicYearStartYear: YEAR,
    period: PERIOD,
    observedAt: new Date("2026-08-30T00:00:00.000Z"),
    observations,
  };
}

const groupA = { id: 101, name: "КТ-41-24" };
const groupB = { id: 102, name: "КТ-42-24" };
const teacher = { id: 201, name: "Иванов Иван Иванович", degree: "к.т.н." };
const room = { id: 301, name: "Г-402" };

function seedDirectory(value) {
  value.rememberGroups([groupA, groupB]);
  value.rememberTeachers([teacher]);
  value.rememberRooms([room]);
}

test("one shared lesson keeps one ID across group schedule projections", () => {
  const repo = repository();
  seedDirectory(repo);

  const first = repo.ingest(
    snapshot("group:101", { type: "group", group: groupA }, [
      seriesObservation({
        teachers: [{ name: "Иванов И. И." }],
        rooms: [{ name: "Г-402" }],
      }),
    ]),
  );
  const second = repo.ingest(
    snapshot("group:102", { type: "group", group: groupB }, [
      seriesObservation({
        teachers: [{ name: "Иванов И. И." }],
        rooms: [{ name: "Г-402" }],
      }),
    ]),
  );

  assert.equal(second.seriesIds[0], first.seriesIds[0]);
  assert.equal(repo.getSeries().length, 1);
  assert.deepEqual(repo.getSeries()[0].groups, [
    { group: groupA, subgroup: undefined },
    { group: groupB, subgroup: undefined },
  ]);
});

test("teacher and room projections enrich the same canonical lesson", () => {
  const repo = repository();
  seedDirectory(repo);

  const groupResult = repo.ingest(
    snapshot("group:101", { type: "group", group: groupA }, [
      seriesObservation({
        teachers: [{ name: "Иванов И. И." }],
        rooms: [{ name: "Г-402" }],
      }),
    ]),
  );
  const teacherResult = repo.ingest(
    snapshot("teacher:201", { type: "teacher", teacher }, [
      seriesObservation({
        groups: [
          { group: { name: groupA.name } },
          { group: { name: groupB.name } },
        ],
        rooms: [{ name: room.name }],
      }),
    ]),
  );
  const roomResult = repo.ingest(
    snapshot("room:301", { type: "room", room }, [
      seriesObservation({
        groups: [
          { group: { name: groupA.name } },
          { group: { name: groupB.name } },
        ],
        teachers: [{ name: teacher.name, degree: teacher.degree }],
      }),
    ]),
  );

  assert.equal(teacherResult.seriesIds[0], groupResult.seriesIds[0]);
  assert.equal(roomResult.seriesIds[0], groupResult.seriesIds[0]);
  const lesson = repo.getSeries()[0];
  assert.deepEqual(lesson.groups, [
    { group: groupA, subgroup: undefined },
    { group: groupB, subgroup: undefined },
  ]);
  assert.deepEqual(lesson.teachers, [teacher]);
  assert.deepEqual(lesson.rooms, [room]);
  assert.equal(lesson.sources.length, 3);
});

test("source row movement preserves identity and repository snapshots preserve links", () => {
  const repo = repository();
  seedDirectory(repo);
  const owner = { type: "group", group: groupA };
  const initial = repo.ingest(
    snapshot("group:101", owner, [seriesObservation()]),
  );
  const moved = repo.ingest(
    snapshot("group:101", owner, [
      seriesObservation({
        key: "row:9",
        slot: {
          number: 3,
          start: { hours: 11, minutes: 50 },
          end: { hours: 13, minutes: 10 },
        },
      }),
    ]),
  );
  assert.equal(moved.seriesIds[0], initial.seriesIds[0]);

  const restored = repository(repo.export());
  const afterRestore = restored.ingest(
    snapshot("group:101", owner, [
      seriesObservation({
        key: "row:10",
        slot: {
          number: 3,
          start: { hours: 11, minutes: 50 },
          end: { hours: 13, minutes: 10 },
        },
      }),
    ]),
  );
  assert.equal(afterRestore.seriesIds[0], initial.seriesIds[0]);
});

test("recurring occurrence ID is stable and excludes mutable room and time", () => {
  const repo = repository();
  seedDirectory(repo);
  const owner = { type: "group", group: groupA };
  const source = snapshot("group:101", owner, [seriesObservation()]);
  repo.ingest(source);
  const schedule = new Schedule(repo, owner, YEAR, {
    period: PERIOD,
    holidays: [],
  });
  const date = new Date(2025, 8, 2);
  const before = schedule.on(date)[0];

  repo.ingest(
    snapshot("group:101", owner, [
      seriesObservation({
        rooms: [{ name: "Г-404" }],
        slot: {
          number: 2,
          start: { hours: 10, minutes: 10 },
          end: { hours: 11, minutes: 30 },
        },
      }),
    ]),
  );
  const after = schedule.on(date)[0];

  assert.equal(after.seriesId, before.seriesId);
  assert.equal(after.id, before.id);
  assert.equal(after.id.includes("2025-09-02"), false);
  assert.equal(after.id.includes("Г-402"), false);
});

test("ambiguous parallel lessons remain separate instead of guessing identity", () => {
  const repo = repository();
  const owner = { type: "group", group: groupA };
  const observation = seriesObservation({
    teachers: [{ name: "Иванов И. И." }],
    rooms: [{ name: "Г-402" }],
  });
  repo.ingest(
    snapshot("group:101", owner, [
      { ...observation, key: "subgroup:1", groups: [{ group: groupA, subgroup: 1 }] },
      { ...observation, key: "subgroup:2", groups: [{ group: groupA, subgroup: 2 }] },
    ]),
  );
  const result = repo.ingest(
    snapshot("teacher:201", { type: "teacher", teacher }, [observation]),
  );

  assert.equal(repo.getSeries().length, 3);
  assert.equal(result.created, 1);
});
