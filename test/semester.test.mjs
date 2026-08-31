import test from "node:test";
import assert from "node:assert/strict";

import { AcademicPeriod } from "../dist/common/types.js";
import {
  getSemesterWeeks,
  getWeekNumber,
  isLocalDate,
  parseLocalDate,
} from "../dist/tt/utils/index.js";
import { scheduleFromParsedDays } from "./helpers/schedule.mjs";

const FALL_SEMESTER = AcademicPeriod.FallSemester;

function firstWeekSchedule() {
  return scheduleFromParsedDays(
    [
      {
        weekday: "Вторник",
        blocks: [
          {
            slotNumber: 1,
            time: {
              start: { hours: 8, minutes: 20 },
              end: { hours: 9, minutes: 40 },
            },
            lessons: [
              {
                subject: "First-week lesson",
                type: "лк",
                weeks: { from: 1, to: 1 },
                isDistance: false,
                possibleChanges: false,
              },
            ],
          },
        ],
      },
    ],
    {
      owner: { type: "group", group: { id: 1, name: "TEST-1" } },
      period: FALL_SEMESTER,
      academicYearStartYear: 2026,
    },
  );
}

test("fall week 1 contains September 1 when it starts midweek", () => {
  const weeks = getSemesterWeeks({
    period: FALL_SEMESTER,
    year: 2026,
    weekCount: 2,
  });

  assert.deepEqual(weeks.map((week) => week.week), [1, 2]);
  assert.equal(weeks[0].start.getFullYear(), 2026);
  assert.equal(weeks[0].start.getMonth(), 7);
  assert.equal(weeks[0].start.getDate(), 31);
  assert.equal(getWeekNumber({
    period: FALL_SEMESTER,
    year: 2026,
    date: new Date(2026, 8, 1),
  }), 1);
});

test("LocalDate validation rejects rollover and malformed dates", () => {
  assert.equal(isLocalDate("2026-09-03"), true);
  assert.equal(isLocalDate("2026-02-30"), false);
  assert.equal(isLocalDate("2026-9-3"), false);
  assert.throws(() => parseLocalDate("2026-02-30"), /Invalid local date/u);
});

test("Schedule returns week-1 lessons during first September week", () => {
  const schedule = firstWeekSchedule();

  const septemberFirst = schedule.on(new Date(2026, 8, 1));
  assert.equal(septemberFirst.length, 1);
  assert.equal(septemberFirst[0].subject, "First-week lesson");

  const week = schedule.week(1);
  assert.equal(week.length, 1);
  assert.equal(week[0].scheduledDate, "2026-09-01");
});

test("explicit session lessons remain visible on public holidays", () => {
  const schedule = scheduleFromParsedDays([
    {
      weekday: "Пятница",
      date: "2027-01-01",
      blocks: [{
        time: {
          start: { hours: 10, minutes: 0 },
          end: { hours: 11, minutes: 30 },
        },
        lessons: [{
          subject: "Экзамен",
          type: "экз",
        }],
      }],
    },
  ], {
    owner: { type: "group", group: { id: 1, name: "TEST-1" } },
    period: AcademicPeriod.WinterSession,
    academicYearStartYear: 2026,
  });

  assert.equal(schedule.on(new Date(2027, 0, 1)).length, 1);
});

test("Schedule rejects invalid week and weekday arguments", () => {
  const schedule = firstWeekSchedule();
  assert.throws(() => schedule.week(0), /positive integer/u);
  assert.throws(() => schedule.weekday(7), /0 to 6/u);
});
