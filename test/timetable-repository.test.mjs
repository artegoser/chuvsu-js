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
    slotNumber: 2,
    time: {
      start: { hours: 10, minutes: 0 },
      end: { hours: 11, minutes: 20 },
    },
    groups: { values: [], completeness: "unknown" },
    teachers: { values: [], completeness: "unknown" },
    rooms: { values: [], completeness: "unknown" },
    recurrence: {
      weekday: 2,
      weeks: { from: 1, to: 17 },
      parity: "odd",
    },
    ...overrides,
  };
}

function occurrenceObservation(overrides = {}) {
  const base = seriesObservation();
  const { recurrence: _recurrence, ...observation } = base;
  return {
    ...observation,
    kind: "occurrence",
    date: "2025-09-03",
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
        teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
        rooms: { values: [{ name: "Г-402" }], completeness: "partial" },
      }),
    ]),
  );
  const second = repo.ingest(
    snapshot("group:102", { type: "group", group: groupB }, [
      seriesObservation({
        teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
        rooms: { values: [{ name: "Г-402" }], completeness: "partial" },
      }),
    ]),
  );

  assert.equal(second.seriesIds[0], first.seriesIds[0]);
  assert.equal(repo.getSeries().length, 1);
  assert.deepEqual(repo.getSeries()[0].groups.values, [
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
        teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
        rooms: { values: [{ name: "Г-402" }], completeness: "partial" },
      }),
    ]),
  );
  const teacherResult = repo.ingest(
    snapshot("teacher:201", { type: "teacher", teacher }, [
      seriesObservation({
        groups: { values: [
          { group: { name: groupA.name } },
          { group: { name: groupB.name } },
        ], completeness: "partial" },
        rooms: { values: [{ name: room.name }], completeness: "partial" },
      }),
    ]),
  );
  const roomResult = repo.ingest(
    snapshot("room:301", { type: "room", room }, [
      seriesObservation({
        groups: { values: [
          { group: { name: groupA.name } },
          { group: { name: groupB.name } },
        ], completeness: "partial" },
        teachers: {
          values: [{ name: teacher.name, degree: teacher.degree }],
          completeness: "partial",
        },
      }),
    ]),
  );

  assert.equal(teacherResult.seriesIds[0], groupResult.seriesIds[0]);
  assert.equal(roomResult.seriesIds[0], groupResult.seriesIds[0]);
  const lesson = repo.getSeries()[0];
  assert.deepEqual(lesson.groups.values, [
    { group: groupA, subgroup: undefined },
    { group: groupB, subgroup: undefined },
  ]);
  assert.deepEqual(lesson.teachers.values, [teacher]);
  assert.deepEqual(lesson.rooms.values, [room]);
  assert.equal(lesson.sources.length, 3);
});

test("repository directory resolves initials during identity matching", () => {
  const repo = repository();
  const groupResult = repo.ingest(
    snapshot("group:101", { type: "group", group: groupA }, [
      seriesObservation({
        teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
        rooms: { values: [{ name: room.name }], completeness: "partial" },
      }),
    ]),
  );
  const teacherResult = repo.ingest(
    snapshot("teacher:201", { type: "teacher", teacher }, [
      seriesObservation({
        groups: { values: [{ group: groupA }], completeness: "partial" },
        teachers: { values: [teacher], completeness: "partial" },
        rooms: { values: [room], completeness: "partial" },
      }),
    ]),
  );

  assert.equal(teacherResult.seriesIds[0], groupResult.seriesIds[0]);
  assert.deepEqual(repo.getSeries()[0].teachers.values, [teacher]);
  assert.deepEqual(repo.directory.export().teachers, [teacher]);
});

test("scalar evidence is aggregated independently across projections", () => {
  const repo = repository();
  seedDirectory(repo);
  const expectedTime = {
    start: { hours: 10, minutes: 0 },
    end: { hours: 11, minutes: 20 },
  };
  repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [
    seriesObservation({
      slotNumber: undefined,
      time: expectedTime,
      groups: { values: [{ group: groupA }], completeness: "partial" },
      teachers: { values: [teacher], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }),
    occurrenceObservation({
      key: "session:1",
      slotNumber: undefined,
      time: expectedTime,
      groups: { values: [{ group: groupA }], completeness: "partial" },
      teachers: { values: [teacher], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }),
  ]));
  repo.ingest(snapshot("teacher:201", { type: "teacher", teacher }, [
    seriesObservation({
      slotNumber: 2,
      time: undefined,
      groups: { values: [{ group: groupA }], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }),
    occurrenceObservation({
      key: "session:1",
      slotNumber: 2,
      time: undefined,
      groups: { values: [{ group: groupA }], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }),
  ]));

  assert.equal(repo.getSeries()[0].slotNumber, 2);
  assert.deepEqual(repo.getSeries()[0].time, expectedTime);
  assert.equal(repo.getDirectOccurrences()[0].slotNumber, 2);
  assert.deepEqual(repo.getDirectOccurrences()[0].time, expectedTime);
});

test("matching time survives a conflicting portal slot number", () => {
  const repo = repository();
  seedDirectory(repo);
  const first = repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [
    seriesObservation({
      teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
      rooms: { values: [{ name: room.name }], completeness: "partial" },
    }),
  ]));
  const second = repo.ingest(snapshot("group:102", { type: "group", group: groupB }, [
    seriesObservation({
      slotNumber: 7,
      teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
      rooms: { values: [{ name: room.name }], completeness: "partial" },
    }),
  ]));

  assert.equal(second.seriesIds[0], first.seriesIds[0]);
  assert.equal(repo.getSeries().length, 1);
});

test("different recurrence days never merge despite matching metadata", () => {
  const repo = repository();
  seedDirectory(repo);
  repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [
    seriesObservation({
      teachers: { values: [teacher], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }),
  ]));
  repo.ingest(snapshot("teacher:201", { type: "teacher", teacher }, [
    seriesObservation({
      recurrence: { weekday: 3, weeks: { from: 1, to: 17 }, parity: "odd" },
      groups: { values: [{ group: groupA }], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }),
  ]));

  assert.equal(repo.getSeries().length, 2);
});

test("partially overlapping recurrence ranges remain separate series", () => {
  const repo = repository();
  seedDirectory(repo);
  const common = {
    teachers: { values: [teacher], completeness: "partial" },
    rooms: { values: [room], completeness: "partial" },
  };
  repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [
    seriesObservation({
      ...common,
      recurrence: { weekday: 2, weeks: { from: 1, to: 9 } },
    }),
  ]));
  repo.ingest(snapshot("group:102", { type: "group", group: groupB }, [
    seriesObservation({
      ...common,
      recurrence: { weekday: 2, weeks: { from: 5, to: 17 } },
    }),
  ]));

  assert.equal(repo.getSeries().length, 2);
});

test("partial relation evidence cannot become globally complete", () => {
  const repo = repository();
  seedDirectory(repo);
  const first = seriesObservation({
    rooms: { values: [], completeness: "complete" },
    teachers: { values: [teacher], completeness: "partial" },
  });
  const second = seriesObservation({
    groups: { values: [{ group: groupA }], completeness: "partial" },
    teachers: { values: [teacher], completeness: "partial" },
    rooms: { values: [room], completeness: "partial" },
  });
  repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [first]));
  repo.ingest(snapshot("teacher:201", { type: "teacher", teacher }, [second]));

  assert.deepEqual(repo.getSeries()[0].rooms, {
    values: [room],
    completeness: "partial",
  });
});

test("source owner is always explicit partial relation evidence", () => {
  const repo = repository();
  repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [
    seriesObservation(),
  ]));

  assert.deepEqual(repo.getSeries()[0].groups, {
    values: [{ group: groupA, subgroup: undefined }],
    completeness: "partial",
  });
});

test("substitutions from projections are deduplicated and enriched", () => {
  const repo = repository();
  seedDirectory(repo);
  const date = "2025-09-09";
  repo.ingest(snapshot("group:101", { type: "group", group: groupA }, [
    seriesObservation({
      teachers: { values: [teacher], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
      substitutions: [{ date, teachers: [{ name: "Иванов И. И." }] }],
    }),
  ]));
  repo.ingest(snapshot("room:301", { type: "room", room }, [
    seriesObservation({
      groups: { values: [{ group: groupA }], completeness: "partial" },
      teachers: { values: [teacher], completeness: "partial" },
      substitutions: [{ date, rooms: [{ name: room.name }], isDistance: false }],
    }),
  ]));

  assert.deepEqual(repo.getSeries()[0].substitutions, [{
    date,
    rooms: [room],
    teachers: [teacher],
    isDistance: false,
  }]);
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
        slotNumber: 3,
        time: {
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
        slotNumber: 3,
        time: {
          start: { hours: 11, minutes: 50 },
          end: { hours: 13, minutes: 10 },
        },
      }),
    ]),
  );
  assert.equal(afterRestore.seriesIds[0], initial.seriesIds[0]);
});

test("deleted rows remove stale links and report exact removals", () => {
  const repo = repository();
  const owner = { type: "group", group: groupA };
  repo.ingest(snapshot("group:101", owner, [
    seriesObservation({ key: "row:1" }),
    seriesObservation({ key: "row:2", subject: "Сети" }),
  ]));
  const result = repo.ingest(snapshot("group:101", owner, [
    seriesObservation({ key: "row:1" }),
    seriesObservation({ key: "row:3", subject: "ОС" }),
  ]));

  assert.equal(result.removedObservations, 1);
  assert.equal(
    repo.export().links.some((value) => value.observationKey === "row:2"),
    false,
  );
});

test("same source position does not preserve ID for an unrelated lesson", () => {
  const repo = repository();
  const owner = { type: "group", group: groupA };
  const first = repo.ingest(snapshot("group:101", owner, [seriesObservation()]));
  const replacement = repo.ingest(snapshot("group:101", owner, [
    seriesObservation({ subject: "Совсем другой предмет" }),
  ]));

  assert.notEqual(replacement.seriesIds[0], first.seriesIds[0]);
  assert.equal(repo.getSeries().length, 1);
});

test("repository rejects duplicate observation keys and dangling snapshots", () => {
  const repo = repository();
  const owner = { type: "group", group: groupA };
  assert.throws(() => repo.ingest(snapshot("group:101", owner, [
    seriesObservation(),
    seriesObservation(),
  ])), /duplicate observation key/u);

  const valid = repository();
  valid.ingest(snapshot("group:101", owner, [seriesObservation()]));
  const exported = valid.export();
  exported.links = [];
  assert.throws(() => repository(exported), /Missing timetable link/u);

  assert.throws(() => repo.ingest(snapshot("group:102", owner, [
    seriesObservation({
      time: {
        start: { hours: 12, minutes: 0 },
        end: { hours: 11, minutes: 0 },
      },
    }),
  ])), /Invalid lesson time/u);

  assert.throws(() => repo.ingest(snapshot("group:103", owner, [
    seriesObservation({
      rooms: { values: [{ name: "" }], completeness: "partial" },
    }),
  ])), /Empty room/u);
  assert.throws(() => repo.ingest(snapshot("group:104", owner, [
    seriesObservation({
      teachers: { values: [teacher], completeness: "unknown" },
    }),
  ])), /Unknown teacher relation has values/u);
  assert.throws(
    () => repo.rememberRooms([{ id: 1, name: "" }]),
    /Room name is empty/u,
  );
});

test("replacing a persisted snapshot keeps existing Schedule views live", () => {
  const owner = { type: "group", group: groupA };
  const repo = repository();
  repo.ingest(snapshot("group:101", owner, [seriesObservation()]));
  const schedule = new Schedule(repo, owner, YEAR, { period: PERIOD, holidays: [] });

  const external = repository();
  external.ingest(snapshot("group:101", owner, [
    seriesObservation({ subject: "Обновленный предмет" }),
  ]));
  repo.replaceSnapshot(external.export());

  assert.equal(schedule.series()[0].subject, "Обновленный предмет");
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
        rooms: { values: [{ name: "Г-404" }], completeness: "partial" },
        slotNumber: 2,
        time: {
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

test("another owner's transfer cannot suppress this schedule", () => {
  const repo = repository();
  const ownerA = { type: "group", group: groupA };
  const ownerB = { type: "group", group: groupB };
  repo.ingest(snapshot("group:101", ownerA, [
    seriesObservation({ groups: { values: [{ group: groupA }], completeness: "partial" } }),
  ]));
  repo.ingest(snapshot("group:102", ownerB, [
    occurrenceObservation({
      groups: { values: [{ group: groupB }], completeness: "partial" },
      transfer: {
        fromDate: "2025-09-02",
        fromSlot: 2,
        targetDate: "2025-09-03",
      },
    }),
  ]));
  const schedule = new Schedule(repo, ownerA, YEAR, { period: PERIOD, holidays: [] });

  assert.equal(schedule.on(new Date(2025, 8, 2)).length, 1);
});

test("ambiguous parallel lessons remain separate instead of guessing identity", () => {
  const repo = repository();
  const owner = { type: "group", group: groupA };
  const observation = seriesObservation({
    teachers: { values: [{ name: "Иванов И. И." }], completeness: "partial" },
    rooms: { values: [{ name: "Г-402" }], completeness: "partial" },
  });
  repo.ingest(
    snapshot("group:101", owner, [
      {
        ...observation,
        key: "subgroup:1",
        groups: { values: [{ group: groupA, subgroup: 1 }], completeness: "partial" },
      },
      {
        ...observation,
        key: "subgroup:2",
        groups: { values: [{ group: groupA, subgroup: 2 }], completeness: "partial" },
      },
    ]),
  );
  const result = repo.ingest(
    snapshot("teacher:201", { type: "teacher", teacher }, [observation]),
  );

  assert.equal(repo.getSeries().length, 3);
  assert.equal(result.created, 1);
});

test("canonical matching and owner projections never enumerate unrelated records", () => {
  const repo = repository();
  const owner = { type: "group", group: groupA };
  repo.ingest(snapshot("group:101", owner, [seriesObservation()]));
  repo.ingest(snapshot("group:102", { type: "group", group: groupB }, [
    seriesObservation({ subject: "Физика", recurrence: { weekday: 4 } }),
  ]));

  repo.seriesRecords.values = () => {
    throw new Error("unbounded canonical record scan");
  };

  const enriched = repo.ingest(
    snapshot("teacher:201", { type: "teacher", teacher }, [
      seriesObservation({
        groups: { values: [{ group: groupA }], completeness: "partial" },
      }),
    ]),
  );

  assert.equal(enriched.created, 0);
  assert.equal(repo.getSeries({ owner }).length, 1);
});

test("owner index drops relations removed by a refreshed source", () => {
  const repo = repository();
  const sourceOwner = { type: "teacher", teacher };
  repo.ingest(snapshot("teacher:201", sourceOwner, [
    seriesObservation({
      groups: { values: [{ group: groupA }], completeness: "partial" },
    }),
  ]));
  repo.ingest(snapshot("teacher:201", sourceOwner, [
    seriesObservation({
      groups: { values: [{ group: groupB }], completeness: "partial" },
    }),
  ]));

  assert.equal(
    repo.getSeries({ owner: { type: "group", group: groupA } }).length,
    0,
  );
  assert.equal(
    repo.getSeries({ owner: { type: "group", group: groupB } }).length,
    1,
  );
});
