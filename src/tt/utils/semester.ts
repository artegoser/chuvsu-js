import { AcademicPeriod } from "../../common/types.js";
import type { SemesterWeek } from "../types.js";
import { getMonday } from "./date.js";

function assertSemesterPeriod(period: AcademicPeriod): void {
  if (
    period !== AcademicPeriod.FallSemester &&
    period !== AcademicPeriod.SpringSemester
  ) {
    throw new RangeError("Academic period must be a semester");
  }
}

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) /
    (24 * 60 * 60 * 1000);
}

function getAcademicYearStartYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();

  // Academic year starts in September.
  return month >= 8 ? year : year - 1;
}

function resolveSemesterYear(opts: {
  period: AcademicPeriod;
  year?: number;
  date?: Date;
}): number {
  assertSemesterPeriod(opts.period);
  if (opts.year != null) {
    if (!Number.isInteger(opts.year)) throw new RangeError("Invalid semester year");
    return opts.year;
  }

  const baseDate = opts.date ?? new Date();
  if (!Number.isFinite(baseDate.getTime())) throw new RangeError("Invalid date");
  const academicYearStart = getAcademicYearStartYear(baseDate);

  return opts.period === AcademicPeriod.FallSemester
    ? academicYearStart
    : academicYearStart + 1;
}

/**
 * Start date of a semester.
 * Fall: September 1 of the semester year.
 * Spring: first Monday of February of the semester year.
 * If year is omitted, the semester year is derived from the current
 * academic year instead of the calendar year.
 */
export function getSemesterStart(opts: {
  period: AcademicPeriod;
  year?: number;
  date?: Date;
}): Date {
  const year = resolveSemesterYear(opts);

  if (opts.period === AcademicPeriod.FallSemester) {
    return new Date(year, 8, 1); // September 1
  }

  // Spring: first Monday of February
  const feb1 = new Date(year, 1, 1);
  const day = feb1.getDay();
  const daysToAdd = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  const firstMonday = new Date(year, 1, 1 + daysToAdd);
  firstMonday.setHours(0, 0, 0, 0);
  return firstMonday;
}

/**
 * All weeks in a semester with their start/end dates.
 * Week 1 is the calendar week containing the semester start date.
 */
export function getSemesterWeeks(opts: {
  period: AcademicPeriod;
  year?: number;
  date?: Date;
  weekCount?: number;
}): SemesterWeek[] {
  const weekCount = opts.weekCount ?? 17;
  if (!Number.isInteger(weekCount) || weekCount < 1) {
    throw new RangeError("Week count must be a positive integer");
  }
  const semesterStart = getSemesterStart(opts);
  const startMonday = getMonday(semesterStart);

  const weeks: SemesterWeek[] = [];
  for (let i = 1; i <= weekCount; i++) {
    const start = new Date(startMonday);
    start.setDate(startMonday.getDate() + (i - 1) * 7);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    weeks.push({ week: i, start, end });
  }

  return weeks;
}

/** Current week number within a semester. */
export function getWeekNumber(opts: {
  period: AcademicPeriod;
  year?: number;
  date?: Date;
}): number {
  const date = opts.date ?? new Date();
  const semesterStart = getSemesterStart({ ...opts, date });
  const startMonday = getMonday(semesterStart);
  const targetMonday = getMonday(date);
  const diff = calendarDayNumber(targetMonday) - calendarDayNumber(startMonday);
  return Math.floor(diff / 7) + 1;
}
