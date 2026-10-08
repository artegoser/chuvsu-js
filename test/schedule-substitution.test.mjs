import test from "node:test";
import assert from "node:assert/strict";
import { AcademicPeriod } from "../dist/common/types.js";
import { Schedule } from "../dist/tt/domain/schedule.js";
import {
  ScheduleSnapshot,
  createScheduleSnapshot,
} from "../dist/tt/domain/schedule-snapshot.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";

const group = { id: 1, name: "КТ-41-24" };
const originalTeacher = { id: 2, name: "Александров А. Х." };
const substituteTeacher = { id: 3, name: "Дмитриев А. П." };
const room = { name: "Г-316" };
const date = new Date(2026, 8, 8);
const time = {
  start: { hours: 8, minutes: 20 },
  end: { hours: 9, minutes: 40 },
};

function replacementSchedule({
  direct = {},
  recurring = {},
  extraSeries = [],
  owner = { type: "group", group },
} = {}) {
  const repository = new TimetableRepository();
  const base = {
    subject: "Информационные системы и технологии",
    type: "лк",
    room: room.name,
    groups: [group.name],
    subgroup: 1,
  };
  const options = {
    academicYearStartYear: 2026,
    period: AcademicPeriod.FallSemester,
    observedAt: new Date("2026-09-01T00:00:00Z"),
  };
  repository.ingest(
    createScheduleSourceSnapshot({
      ...options,
      sourceKey: "group:1",
      owner: { type: "group", group },
      days: [
        {
          weekday: "Вторник",
          blocks: [
            {
              slotNumber: 1,
              time,
              lessons: [
                {
                  ...base,
                  teacher: originalTeacher,
                  substitutions: [
                    { date: "2026-09-08", teacher: substituteTeacher },
                  ],
                  ...recurring,
                },
                ...extraSeries,
              ],
            },
          ],
        },
      ],
    }),
  );
  repository.ingest(
    createScheduleSourceSnapshot({
      ...options,
      sourceKey: "teacher:3",
      owner: { type: "teacher", teacher: substituteTeacher },
      days: [
        {
          weekday: "Вторник",
          blocks: [
            {
              slotNumber: 1,
              time,
              lessons: [
                {
                  ...base,
                  substituteFor: { date: "2026-09-08", originalTeacher },
                  ...direct,
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  return new Schedule(repository, owner, 2026, {
    period: AcademicPeriod.FallSemester,
    holidays: [],
  });
}

for (const owner of [
  { type: "group", group },
  { type: "room", room },
]) {
  test(`${owner.type} queries reconcile dated replacement with substituted series`, () => {
    const schedule = replacementSchedule({ owner });
    const [lesson, duplicate] = schedule.on(date);
    assert.equal(duplicate, undefined);
    assert.ok(lesson.seriesId);
    assert.deepEqual(lesson.originalTeachers.values, [originalTeacher]);
    assert.deepEqual(lesson.teachers.values, [substituteTeacher]);
    assert.equal(lesson.sources.length, 2);
    const restored = new ScheduleSnapshot(createScheduleSnapshot(schedule));
    assert.deepEqual(restored.on(date), schedule.on(date));
    assert.equal(restored.on(date, { subgroup: 2 }).length, 0);
    const regular = schedule.on(new Date(2026, 8, 15));
    assert.equal(regular.length, 1);
    assert.deepEqual(regular[0].teachers.values, [originalTeacher]);
    assert.equal(regular[0].originalTeachers, undefined);
    assert.equal(
      schedule.directOccurrences().length,
      1,
      "repository evidence retained",
    );
  });
}

test("query repeats retain stable IDs and do not accumulate sources", () => {
  const schedule = replacementSchedule();
  assert.deepEqual(schedule.on(date), schedule.on(date));
  assert.equal(schedule.on(date)[0].sources.length, 2);
});

for (const [name, direct] of [
  ["different subgroup", { subgroup: 2 }],
  ["different subject", { subject: "Базы данных" }],
  ["different type", { type: "пр" }],
  ["different room", { room: "А-101" }],
  ["additional teacher", { teacher: originalTeacher }],
  ["different distance mode", { isDistance: true }],
  [
    "moved lesson",
    {
      transfer: {
        fromDate: "2026-09-01",
        fromSlot: 1,
        targetDate: "2026-09-08",
      },
    },
  ],
]) {
  test(`preserves ${name}`, () => {
    assert.equal(replacementSchedule({ direct }).on(date).length, 2);
  });
}

test("does not collapse an ordinary series without substitution evidence", () => {
  const schedule = replacementSchedule({
    recurring: { teacher: substituteTeacher, substitutions: undefined },
  });
  assert.equal(schedule.on(date).length, 2);
});

test("preserves ambiguity between two substituted series", () => {
  const schedule = replacementSchedule({
    extraSeries: [
      {
        subject: "Информационные системы и технологии",
        type: "лк",
        room: room.name,
        groups: [group.name],
        subgroup: 1,
        teacher: originalTeacher,
        substitutions: [{ date: "2026-09-08", teacher: substituteTeacher }],
      },
    ],
  });
  assert.equal(schedule.on(date).length, 3);
});
