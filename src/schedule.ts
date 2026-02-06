import type {
  FullScheduleSlot,
  ScheduleEntry,
  ScheduleFilter,
  SemesterWeek,
} from "./types.js";
import { Period } from "./types.js";

const WEEKDAY_NAMES = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

export function getWeekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "";
}

export function filterSlots(
  slots: FullScheduleSlot[],
  filter?: ScheduleFilter,
): FullScheduleSlot[] {
  if (!filter?.subgroup && !filter?.week) return slots;

  return slots
    .map((slot) => ({
      ...slot,
      entries: filterEntries(slot.entries, filter),
    }))
    .filter((slot) => slot.entries.length > 0);
}

function filterEntries(
  entries: ScheduleEntry[],
  filter?: ScheduleFilter,
): ScheduleEntry[] {
  return entries.filter((e) => {
    if (filter?.subgroup && e.subgroup && e.subgroup !== filter.subgroup) {
      return false;
    }
    if (filter?.week) {
      if (
        e.weeks.min > 0 &&
        (filter.week < e.weeks.min || filter.week > e.weeks.max)
      ) {
        return false;
      }
      if (e.weekParity) {
        const isEven = filter.week % 2 === 0;
        if (e.weekParity === "even" && !isEven) return false;
        if (e.weekParity === "odd" && isEven) return false;
      }
    }
    return true;
  });
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the start date of a semester.
 * Fall: September 1 of the given year.
 * Spring: last Monday of January of the given year.
 */
export function getSemesterStart(opts: {
  period: Period;
  year?: number;
}): Date {
  const year = opts.year ?? new Date().getFullYear();

  if (opts.period === Period.FallSemester) {
    return new Date(year, 8, 1); // September 1
  }

  // Spring: last Monday of January
  // Start from Jan 31 and walk back to Monday
  const jan31 = new Date(year, 0, 31);
  const day = jan31.getDay();
  const daysBack = day === 0 ? 6 : day - 1;
  const lastMonday = new Date(year, 0, 31 - daysBack);
  lastMonday.setHours(0, 0, 0, 0);
  return lastMonday;
}

/**
 * Get all weeks in a semester with their start/end dates.
 * Week 0 starts from the semester start date.
 */
export function getSemesterWeeks(opts: {
  period: Period;
  year?: number;
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

/**
 * Get the current week number within a semester.
 */
export function getWeekNumber(opts: {
  period: Period;
  date?: Date;
  year?: number;
}): number {
  const date = opts.date ?? new Date();
  const semesterStart = getSemesterStart(opts);
  const startMonday = getMonday(semesterStart);
  const targetMonday = getMonday(date);
  const diff = targetMonday.getTime() - startMonday.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}
