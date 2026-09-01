import test from "node:test";
import assert from "node:assert/strict";

import { AcademicPeriod } from "../dist/common/types.js";
import { Schedule } from "../dist/tt/domain/schedule.js";
import { MaterializedSchedule } from "../dist/tt/domain/materialized-schedule.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";
import { formatLocalDate } from "../dist/tt/utils/index.js";
import { scheduleFromParsedDays } from "./helpers/schedule.mjs";

const group = { id: 1, name: "TEST-1" };
const teacher = { id: 2, name: "Иванов Иван Иванович" };
const room = { id: 3, name: "А-101" };

function recurringSchedule(options = {}) {
  return scheduleFromParsedDays([{
    weekday: "Вторник",
    blocks: [{
      slotNumber: 2,
      time: {
        start: { hours: 9, minutes: 50 },
        end: { hours: 11, minutes: 10 },
      },
      lessons: [{
        subject: "Архитектура",
        type: "лк",
        weeks: { from: 1, to: 4 },
        weekParity: "even",
        room: room.name,
        teacher,
        groups: [group.name],
        subgroup: 1,
        substitutions: [{
          date: "2026-09-08",
          room: "Дистанционно (ДОТ)",
          teacher: { name: "Петров Петр Петрович" },
          isDistance: true,
        }],
      }],
    }],
  }], {
    owner: { type: "group", group },
    academicYearStartYear: 2026,
    period: AcademicPeriod.FallSemester,
    ...options,
  });
}

test("recurrence, subgroup and substitutions are applied independently", () => {
  const schedule = recurringSchedule();
  assert.equal(schedule.on(new Date(2026, 8, 1)).length, 0, "odd week excluded");
  assert.equal(schedule.on(new Date(2026, 8, 15)).length, 0, "odd week excluded");
  assert.equal(schedule.on(new Date(2026, 8, 29)).length, 0, "outside range");
  assert.equal(schedule.on(new Date(2026, 8, 9)).length, 0, "wrong weekday");

  const substituted = schedule.on(new Date(2026, 8, 8), { subgroup: 1 });
  assert.equal(substituted.length, 1);
  assert.deepEqual(substituted[0].rooms.values, [{ name: "Дистанционно (ДОТ)" }]);
  assert.deepEqual(substituted[0].originalRooms.values, [{ name: room.name }]);
  assert.deepEqual(substituted[0].teachers.values, [{ name: "Петров Петр Петрович" }]);
  assert.deepEqual(substituted[0].originalTeachers.values, [teacher]);
  assert.equal(substituted[0].isDistance, true);
  assert.equal(schedule.on(new Date(2026, 8, 8), { subgroup: 2 }).length, 0);

  const regular = schedule.on(new Date(2026, 8, 22))[0];
  assert.deepEqual(regular.rooms.values, [{ name: room.name }]);
  assert.equal(regular.originalRooms, undefined);
  assert.equal(regular.isDistance, false);
});

test("holidays suppress recurring lessons but options are defensively copied", () => {
  const holidays = [{ month: 9, day: 8, name: "Тест" }];
  const schedule = recurringSchedule({ holidays });
  holidays.length = 0;
  assert.equal(schedule.on(new Date(2026, 8, 8)).length, 0);
});

test("direct occurrences project to group, teacher and room owners", () => {
  const repository = new TimetableRepository({
    idGenerator: { seriesId: () => "ser", lessonId: () => "les_direct" },
  });
  repository.ingest({
    sourceKey: "direct",
    owner: { type: "group", group },
    academicYearStartYear: 2026,
    period: AcademicPeriod.WinterSession,
    observedAt: new Date("2026-09-01T00:00:00Z"),
    observations: [{
      kind: "occurrence",
      key: "exam",
      date: "2027-01-10",
      subject: "Экзамен",
      type: "экз",
      groups: { values: [{ group }], completeness: "partial" },
      teachers: { values: [teacher], completeness: "partial" },
      rooms: { values: [room], completeness: "partial" },
    }],
  });
  for (const owner of [
    { type: "group", group },
    { type: "teacher", teacher },
    { type: "room", room },
  ]) {
    const schedule = new Schedule(repository, owner, 2026, {
      period: AcademicPeriod.WinterSession,
      holidays: [],
    });
    assert.equal(schedule.on(new Date(2027, 0, 10))[0].id, "les_direct");
  }
});

test("convenience queries and semester metadata use the same calendar", () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const academicYearStartYear = now.getMonth() >= 8
    ? now.getFullYear()
    : now.getFullYear() - 1;
  const schedule = scheduleFromParsedDays([{
      weekday: "Сегодня",
      date: formatLocalDate(now),
      blocks: [{
        time: { start: { hours: 0, minutes: 0 }, end: { hours: 23, minutes: 59 } },
        lessons: [{ subject: "Сегодня", type: "экз" }],
      }],
    }], {
    owner: { type: "group", group },
    academicYearStartYear,
    period: AcademicPeriod.SummerSession,
  });
  const tomorrowAcademicYear = tomorrow.getMonth() >= 8
    ? tomorrow.getFullYear()
    : tomorrow.getFullYear() - 1;
  const tomorrowSchedule = scheduleFromParsedDays([{
      weekday: "Завтра",
      date: formatLocalDate(tomorrow),
      blocks: [{ lessons: [{ subject: "Завтра", type: "конс" }] }],
    }], {
    owner: { type: "group", group },
    academicYearStartYear: tomorrowAcademicYear,
    period: AcademicPeriod.SummerSession,
  });

  assert.equal(schedule.today()[0]?.subject, "Сегодня");
  assert.equal(tomorrowSchedule.tomorrow()[0]?.subject, "Завтра");
  assert.equal(schedule.current()?.subject, "Сегодня");
  assert.ok(schedule.thisWeek().length >= 1);
  assert.equal(schedule.weekday(now.getDay())[0]?.subject, "Сегодня");
  assert.ok(Number.isInteger(schedule.getWeekNumber(now)));
  assert.equal(schedule.getSemesterWeeks(2).length, 2);
  assert.ok(schedule.getSemesterStart() instanceof Date);
});

test("schedule queries reuse aggregation until the repository revision changes", () => {
  const schedule = recurringSchedule();
  const repository = schedule.repository;
  const getSeries = repository.getSeries.bind(repository);
  const getDirectOccurrences = repository.getDirectOccurrences.bind(repository);
  let seriesCalls = 0;
  let occurrenceCalls = 0;
  repository.getSeries = (...args) => {
    seriesCalls++;
    return getSeries(...args);
  };
  repository.getDirectOccurrences = (...args) => {
    occurrenceCalls++;
    return getDirectOccurrences(...args);
  };

  schedule.on(new Date(2026, 8, 8));
  schedule.on(new Date(2026, 8, 22));
  schedule.series();
  assert.equal(seriesCalls, 1);
  assert.equal(occurrenceCalls, 1);

  repository.rememberRooms([{ id: 99, name: "Б-202" }]);
  schedule.on(new Date(2026, 8, 8));
  assert.equal(seriesCalls, 2);
  assert.equal(occurrenceCalls, 2);
});

test("materialized schedules survive JSON transport and provide indexed dates", () => {
  const schedule = recurringSchedule();
  const materialized = schedule.materialize({
    start: new Date(2026, 8, 1),
    end: new Date(2026, 8, 30),
  });
  const snapshot = JSON.parse(JSON.stringify(materialized.export()));
  const restored = new MaterializedSchedule(snapshot);

  assert.deepEqual([...restored.dateKeys({ subgroup: 1 })], [
    "2026-09-08",
    "2026-09-22",
  ]);
  assert.deepEqual([...restored.dateKeys({ subgroup: 2 })], []);
  assert.equal(restored.on(new Date(2026, 8, 8))[0].isDistance, true);
  assert.ok(restored.on(new Date(2026, 8, 8))[0].sources[0].observedAt instanceof Date);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.export())), snapshot);
  assert.deepEqual([...restored.dateKeys({ subgroup: 1 })], [
    "2026-09-08",
    "2026-09-22",
  ]);
  assert.equal("repository" in snapshot, false);
});

test("materialized schedule validates ranges and can omit source metadata", () => {
  const schedule = recurringSchedule();
  const withoutSources = schedule.materializeSnapshot({
    start: new Date(2026, 8, 8),
    end: new Date(2026, 8, 8),
    includeSources: false,
  });
  assert.deepEqual(withoutSources.lessonsByDate["2026-09-08"][0].sources, []);
  assert.throws(
    () => new MaterializedSchedule({ ...withoutSources, schemaVersion: 2 }),
    /Unsupported materialized schedule schema/,
  );
  assert.throws(
    () => schedule.materialize({ start: new Date("invalid") }),
    /invalid date/,
  );
  assert.throws(
    () => schedule.materialize({
      start: new Date(2026, 8, 9),
      end: new Date(2026, 8, 8),
    }),
    /must not exceed/,
  );
});
