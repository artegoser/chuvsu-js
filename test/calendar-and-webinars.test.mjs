import test from "node:test";
import assert from "node:assert/strict";

import { AcademicPeriod } from "../dist/common/types.js";
import { occurrenceIdForSeries, RandomLessonIdGenerator } from "../dist/tt/domain/ids.js";
import {
  getAdjacentSemester,
  getCompensatingWorkDays,
  getCurrentPeriod,
  getEffectiveHolidays,
  getHolidayTransfers,
  isHoliday,
  isSessionPeriod,
} from "../dist/tt/utils/index.js";
import { attachWebinars, findWebinar } from "../dist/tt/webinars.js";

function localDates(values) {
  return values.map((value) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  );
}

test("period helpers cover every annual boundary", () => {
  assert.equal(getCurrentPeriod({ date: new Date(2026, 0, 10) }), AcademicPeriod.WinterSession);
  assert.equal(getCurrentPeriod({ date: new Date(2026, 1, 1) }), AcademicPeriod.SpringSemester);
  assert.equal(getCurrentPeriod({ date: new Date(2026, 5, 1) }), AcademicPeriod.SummerSession);
  assert.equal(getCurrentPeriod({ date: new Date(2026, 8, 1) }), AcademicPeriod.FallSemester);
  assert.equal(getCurrentPeriod({ date: new Date(2026, 11, 25) }), AcademicPeriod.WinterSession);
  assert.equal(isSessionPeriod(AcademicPeriod.WinterSession), true);
  assert.equal(isSessionPeriod(AcademicPeriod.SummerSession), true);
  assert.equal(isSessionPeriod(AcademicPeriod.FallSemester), false);
  assert.equal(getAdjacentSemester(AcademicPeriod.WinterSession), AcademicPeriod.FallSemester);
  assert.equal(getAdjacentSemester(AcademicPeriod.SummerSession), AcademicPeriod.SpringSemester);
});

test("holiday weekends, bridges, collisions and explicit overrides are deterministic", () => {
  const tuesday = [{ month: 9, day: 1, name: "Tuesday" }];
  const thursday = [{ month: 9, day: 3, name: "Thursday" }];
  const weekendCollision = [
    { month: 9, day: 6, name: "Sunday" },
    { month: 9, day: 7, name: "Monday" },
  ];

  assert.deepEqual(
    localDates(getHolidayTransfers(2026, tuesday, [], true).map((value) => value.dayOff)),
    ["2026-08-31"],
  );
  assert.deepEqual(
    localDates(getCompensatingWorkDays(2026, tuesday, [], false)),
    ["2026-08-29"],
  );
  assert.deepEqual(
    localDates(getHolidayTransfers(2026, thursday, [], false).map((value) => value.dayOff)),
    ["2026-09-04"],
  );
  assert.equal(getHolidayTransfers(2026, thursday, [], true).length, 0);
  assert.ok(localDates(getEffectiveHolidays(2026, weekendCollision, [], true)).includes("2026-09-08"));

  const override = [{ dayOff: new Date(2026, 7, 31), workDay: null }];
  assert.deepEqual(getHolidayTransfers(2026, tuesday, override, false), override);
  assert.equal(isHoliday(new Date(2026, 7, 31), tuesday, override, false), true);
  assert.equal(isHoliday(new Date(2026, 7, 31), [], []), false);
});

test("lesson ID generators preserve namespace and deterministic occurrence IDs", () => {
  const generator = new RandomLessonIdGenerator();
  assert.match(generator.seriesId(), /^ser_/u);
  assert.match(generator.lessonId(), /^les_/u);
  assert.equal(occurrenceIdForSeries("ser_fixed", 3), "les_ser_fixed_3_0");
  assert.equal(occurrenceIdForSeries("ser_fixed", 3, 2), "les_ser_fixed_3_2");
});

function lesson() {
  return {
    id: "les",
    academicYearStartYear: 2026,
    period: AcademicPeriod.FallSemester,
    nominalDate: "2026-09-08",
    scheduledDate: "2026-09-08",
    subject: "Базы данных",
    type: "лк",
    slotNumber: 2,
    time: { start: { hours: 9, minutes: 50 }, end: { hours: 11, minutes: 10 } },
    groups: { values: [], completeness: "unknown" },
    teachers: { values: [], completeness: "unknown" },
    rooms: { values: [], completeness: "unknown" },
    isDistance: false,
    possibleChanges: false,
    status: "scheduled",
    sources: [],
  };
}

function webinar(overrides = {}) {
  return {
    id: "web",
    idType: 1,
    scheduled: true,
    scheduledDate: "2026-09-08",
    slotNumber: 2,
    time: { start: { hours: 9, minutes: 50 }, end: { hours: 11, minutes: 10 } },
    subject: "Базы данных",
    type: "лк",
    teacher: { name: "Иванов И. И." },
    groups: [],
    title: "",
    raw: "",
    ...overrides,
  };
}

test("webinar matching rejects each conflicting identity field", () => {
  const target = lesson();
  assert.equal(findWebinar(target, [webinar()])?.id, "web");
  for (const candidate of [
    webinar({ scheduled: false }),
    webinar({ scheduledDate: "2026-09-09" }),
    webinar({ slotNumber: 3 }),
    webinar({ time: { start: { hours: 10, minutes: 0 }, end: { hours: 11, minutes: 10 } } }),
    webinar({ subject: "Сети" }),
    webinar({ type: "пр" }),
  ]) {
    assert.equal(findWebinar(target, [candidate]), undefined);
  }
  assert.equal(attachWebinars([target], [webinar()])[0].webinar.id, "web");
  assert.equal(attachWebinars([target], [webinar({ scheduled: false })])[0].webinar, undefined);
});
