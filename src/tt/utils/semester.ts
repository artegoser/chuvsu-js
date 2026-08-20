import { Period } from "../../common/types.js";
import type { SemesterWeek } from "../types.js";
import { getMonday } from "./date.js";

function getAcademicYearStartYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();

  // Academic year starts in September.
  return month >= 8 ? year : year - 1;
}

function resolveSemesterYear(opts: {
  period: Period;
  year?: number;
  date?: Date;
}): number {
  if (opts.year != null) return opts.year;

  const baseDate = opts.date ?? new Date();
  const academicYearStart = getAcademicYearStartYear(baseDate);

  return opts.period === Period.FallSemester
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
  period: Period;
  year?: number;
  date?: Date;
}): Date {
  const year = resolveSemesterYear(opts);

  if (opts.period === Period.FallSemester) {
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
 * Week 0 starts from the semester start date.
 */
export function getSemesterWeeks(opts: {
  period: Period;
  year?: number;
  date?: Date;
  weekCount?: number;
}): SemesterWeek[] {
  const weekCount = opts.weekCount ?? 17;
  const semesterStart = getSemesterStart(opts);
  const startMonday = getMonday(semesterStart);

  const weeks: SemesterWeek[] = [];
  for (let i = 0; i <= weekCount; i++) {
    const start = new Date(startMonday);
    start.setDate(startMonday.getDate() + i * 7);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    weeks.push({ week: i, start, end });
  }

  return weeks;
}

/** Current week number within a semester. */
export function getWeekNumber(opts: {
  period: Period;
  year?: number;
  date?: Date;
}): number {
  const date = opts.date ?? new Date();
  const semesterStart = getSemesterStart({ ...opts, date });
  const startMonday = getMonday(semesterStart);
  const targetMonday = getMonday(date);
  const diff = targetMonday.getTime() - startMonday.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}
