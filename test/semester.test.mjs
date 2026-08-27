import test from "node:test";
import assert from "node:assert/strict";

import { Schedule } from "../dist/tt/schedule.js";
import {
  getSemesterWeeks,
  getWeekNumber,
} from "../dist/tt/utils/index.js";

const FALL_SEMESTER = 1;

function firstWeekSchedule() {
  return new Schedule(
    1,
    new Map([
      [
        FALL_SEMESTER,
        [
          {
            weekday: "Вторник",
            slots: [
              {
                number: 1,
                timeStart: { hours: 8, minutes: 20 },
                timeEnd: { hours: 9, minutes: 40 },
                entries: [
                  {
                    subject: "First-week lesson",
                    type: "лк",
                    weeks: { from: 1, to: 1 },
                  },
                ],
              },
            ],
          },
        ],
      ],
    ]),
    FALL_SEMESTER,
    undefined,
    [],
    [],
    false,
    2026,
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

test("Schedule returns week-1 lessons during first September week", () => {
  const schedule = firstWeekSchedule();

  const septemberFirst = schedule.forDate(new Date(2026, 8, 1));
  assert.equal(septemberFirst.length, 1);
  assert.equal(septemberFirst[0].subject, "First-week lesson");

  const week = schedule.forWeek(1);
  assert.equal(week.length, 1);
  assert.equal(week[0].start.date.getMonth(), 8);
  assert.equal(week[0].start.date.getDate(), 1);
});
