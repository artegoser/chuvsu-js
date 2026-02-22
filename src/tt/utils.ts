import type {
  FullScheduleSlot,
  ScheduleEntry,
  SemesterWeek,
  Lesson,
  LessonTime,
  LessonTimeSlot,
} from "./types.js";
import { Period, EducationType } from "../common/types.js";
import type { Time } from "../common/types.js";

export function getCurrentPeriod(opts?: { date?: Date }): Period {
  const date = opts?.date ?? new Date();
  const month = date.getMonth();
  const day = date.getDate();

  // Dec 25+ and Jan → Winter session (зимняя сессия)
  if (month === 0 || (month === 11 && day >= 25)) return Period.WinterSession;
  // Feb–May → Spring semester (весенний семестр)
  if (month >= 1 && month <= 4) return Period.SpringSemester;
  // Jun–Aug → Summer session (летняя сессия)
  if (month >= 5 && month <= 7) return Period.SummerSession;
  // Sep – Dec 24 → Fall semester (осенний семестр)
  return Period.FallSemester;
}

export function isSessionPeriod(period: Period): boolean {
  return period === Period.WinterSession || period === Period.SummerSession;
}

export function sortLessons(a: Lesson, b: Lesson) {
  return a.start.date.getTime() - b.start.date.getTime();
}

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
export function getWeekNumber(opts: { period: Period; date?: Date }): number {
  const date = opts.date ?? new Date();
  const semesterStart = getSemesterStart(opts);
  const startMonday = getMonday(semesterStart);
  const targetMonday = getMonday(date);
  const diff = targetMonday.getTime() - startMonday.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}

function filterEntries(
  entries: ScheduleEntry[],
  opts?: { subgroup?: number; week?: number },
): ScheduleEntry[] {
  return entries.filter((e) => {
    if (opts?.subgroup && e.subgroup && e.subgroup !== opts.subgroup) {
      return false;
    }
    if (opts?.week != null) {
      if (
        e.weeks.from > 0 &&
        (opts.week < e.weeks.from || opts.week > e.weeks.to)
      ) {
        return false;
      }
      if (e.weekParity) {
        const isEven = opts.week % 2 === 0;
        if (e.weekParity === "even" && !isEven) return false;
        if (e.weekParity === "odd" && isEven) return false;
      }
    }
    return true;
  });
}

export function filterSlots(
  slots: FullScheduleSlot[],
  opts?: { subgroup?: number; week?: number },
): FullScheduleSlot[] {
  if (opts?.subgroup == null && opts?.week == null) return slots;

  return slots
    .map((slot) => ({
      ...slot,
      entries: filterEntries(slot.entries, opts),
    }))
    .filter((slot) => slot.entries.length > 0);
}

function makeLessonTime(
  date: Date,
  time: { hours: number; minutes: number },
): LessonTime {
  const d = new Date(date);
  d.setHours(time.hours, time.minutes, 0, 0);
  return { date: d, hours: time.hours, minutes: time.minutes };
}

export function slotsToLessons(
  slots: FullScheduleSlot[],
  date: Date,
): Lesson[] {
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

// --- Lesson time slots ---

const VO_TIME_SLOTS: LessonTimeSlot[] = [
  {
    number: 1,
    start: { hours: 8, minutes: 20 },
    end: { hours: 9, minutes: 40 },
  },
  {
    number: 2,
    start: { hours: 9, minutes: 50 },
    end: { hours: 11, minutes: 10 },
  },
  {
    number: 3,
    start: { hours: 11, minutes: 40 },
    end: { hours: 13, minutes: 0 },
  },
  {
    number: 4,
    start: { hours: 13, minutes: 30 },
    end: { hours: 14, minutes: 50 },
  },
  {
    number: 5,
    start: { hours: 15, minutes: 0 },
    end: { hours: 16, minutes: 20 },
  },
  {
    number: 6,
    start: { hours: 16, minutes: 40 },
    end: { hours: 18, minutes: 0 },
  },
  {
    number: 7,
    start: { hours: 18, minutes: 10 },
    end: { hours: 19, minutes: 30 },
  },
  {
    number: 8,
    start: { hours: 19, minutes: 40 },
    end: { hours: 21, minutes: 0 },
  },
];

const SPO_TIME_SLOTS: LessonTimeSlot[] = [
  {
    number: 1,
    start: { hours: 8, minutes: 10 },
    end: { hours: 9, minutes: 40 },
  },
  {
    number: 2,
    start: { hours: 9, minutes: 55 },
    end: { hours: 11, minutes: 25 },
  },
  {
    number: 3,
    start: { hours: 11, minutes: 55 },
    end: { hours: 13, minutes: 25 },
  },
  {
    number: 4,
    start: { hours: 13, minutes: 40 },
    end: { hours: 15, minutes: 10 },
  },
  {
    number: 5,
    start: { hours: 15, minutes: 25 },
    end: { hours: 16, minutes: 55 },
  },
  {
    number: 6,
    start: { hours: 17, minutes: 10 },
    end: { hours: 18, minutes: 40 },
  },
  {
    number: 7,
    start: { hours: 18, minutes: 55 },
    end: { hours: 20, minutes: 25 },
  },
];

export function getTimeSlots(educationType: EducationType): LessonTimeSlot[] {
  return educationType === EducationType.VocationalEducation
    ? SPO_TIME_SLOTS
    : VO_TIME_SLOTS;
}

function timeToMinutes(t: Time): number {
  return t.hours * 60 + t.minutes;
}

export function getLessonNumber(
  time: Time,
  educationType: EducationType,
): number {
  const slots = getTimeSlots(educationType);
  const target = timeToMinutes(time);

  let closest = slots[0];
  let minDiff = Math.abs(timeToMinutes(closest.start) - target);

  for (let i = 1; i < slots.length; i++) {
    const diff = Math.abs(timeToMinutes(slots[i].start) - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = slots[i];
    }
  }

  return closest.number;
}

export function getAdjacentSemester(session: Period): Period {
  return session === Period.WinterSession
    ? Period.FallSemester
    : Period.SpringSemester;
}

// --- Holidays ---

export interface Holiday {
  /** Month number, 1–12. */
  month: number;
  /** Day of month. */
  day: number;
  /** Human-readable name. */
  name: string;
}

/** Russian non-working public holidays (Статья 112 ТК РФ). */
export const RUSSIAN_HOLIDAYS: Holiday[] = [
  { month: 1, day: 1, name: "Новый год" },
  { month: 1, day: 2, name: "Новогодние каникулы" },
  { month: 1, day: 3, name: "Новогодние каникулы" },
  { month: 1, day: 4, name: "Новогодние каникулы" },
  { month: 1, day: 5, name: "Новогодние каникулы" },
  { month: 1, day: 6, name: "Новогодние каникулы" },
  { month: 1, day: 7, name: "Рождество Христово" },
  { month: 1, day: 8, name: "Новогодние каникулы" },
  { month: 2, day: 23, name: "День защитника Отечества" },
  { month: 3, day: 8, name: "Международный женский день" },
  { month: 5, day: 1, name: "Праздник Весны и Труда" },
  { month: 5, day: 9, name: "День Победы" },
  { month: 6, day: 12, name: "День России" },
  { month: 11, day: 4, name: "День народного единства" },
];

/**
 * Returns true if the given date falls on a holiday.
 * Pass an empty array to disable holiday checking.
 */
export function isHoliday(
  date: Date,
  holidays: Holiday[] = RUSSIAN_HOLIDAYS,
): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return holidays.some((h) => h.month === month && h.day === day);
}
