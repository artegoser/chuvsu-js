import type {
  FullScheduleSlot,
  ScheduleEntry,
  ScheduleFilter,
  SemesterWeek,
  Lesson,
  LessonTime,
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
        e.weeks.from > 0 &&
        (filter.week < e.weeks.from || filter.week > e.weeks.to)
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

export function getMonday(date: Date): Date {
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
 * Spring: first Monday of February of the given year.
 */
export function getSemesterStart(opts: {
  period: Period;
  year?: number;
}): Date {
  const year = opts.year ?? new Date().getFullYear();

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

function makeLessonTime(date: Date, time: { hours: number; minutes: number }): LessonTime {
  const d = new Date(date);
  d.setHours(time.hours, time.minutes, 0, 0);
  return { date: d, hours: time.hours, minutes: time.minutes };
}

export function slotsToLessons(slots: FullScheduleSlot[], date: Date): Lesson[] {
  const lessons: Lesson[] = [];
  for (const slot of slots) {
    for (const entry of slot.entries) {
      lessons.push({
        number: slot.number,
        start: makeLessonTime(date, slot.timeStart),
        end: makeLessonTime(date, slot.timeEnd),
        subject: entry.subject,
        type: entry.type,
        room: entry.room,
        teacher: entry.teacher,
        weeks: entry.weeks,
        subgroup: entry.subgroup,
        weekParity: entry.weekParity,
      });
    }
  }
  return lessons;
}
