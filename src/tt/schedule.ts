import type {
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
  SemesterWeek,
  Lesson,
  LessonTime,
} from "./types.js";
import { Period } from "../common/types.js";

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

// --- Internal helpers ---

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

function filterSlots(
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

function slotsToLessons(slots: FullScheduleSlot[], date: Date): Lesson[] {
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

// --- Schedule class ---

export class Schedule {
  readonly groupId: number;
  readonly period: Period;
  readonly days: FullScheduleDay[];

  constructor(groupId: number, period: Period, days: FullScheduleDay[]) {
    this.groupId = groupId;
    this.period = period;
    this.days = days;
  }

  private getSlotsForWeekday(
    weekday: number,
    opts?: { subgroup?: number; week?: number },
  ): FullScheduleSlot[] {
    const dayName = getWeekdayName(weekday);
    const day = this.days.find(
      (d) => d.weekday.toLowerCase() === dayName.toLowerCase(),
    );
    if (!day) return [];
    return filterSlots(day.slots, opts);
  }

  private getDateForWeekday(weekday: number, week?: number): Date {
    if (week != null) {
      const startMonday = getMonday(getSemesterStart({ period: this.period }));
      const date = new Date(startMonday);
      date.setDate(
        startMonday.getDate() +
          (week - 1) * 7 +
          (weekday === 0 ? 6 : weekday - 1),
      );
      return date;
    }
    const now = new Date();
    const currentDay = now.getDay();
    const diff = weekday - currentDay;
    const date = new Date(now);
    date.setDate(now.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  forDay(
    weekday: number,
    opts?: { subgroup?: number; week?: number },
  ): Lesson[] {
    const slots = this.getSlotsForWeekday(weekday, opts);
    const date = this.getDateForWeekday(weekday, opts?.week);
    return slotsToLessons(slots, date);
  }

  forDate(date: Date, opts?: { subgroup?: number }): Lesson[] {
    const weekday = date.getDay();
    const week = getWeekNumber({ period: this.period, date });
    const slots = this.getSlotsForWeekday(weekday, {
      subgroup: opts?.subgroup,
      week,
    });
    return slotsToLessons(slots, date);
  }

  forWeek(week?: number, opts?: { subgroup?: number }): Lesson[] {
    const effectiveWeek = week ?? getWeekNumber({ period: this.period });
    const semesterWeeks = getSemesterWeeks({
      period: this.period,
      weekCount: effectiveWeek,
    });
    const weekData = semesterWeeks.find((w) => w.week === effectiveWeek);
    const mondayDate = weekData ? weekData.start : new Date();

    const lessons: Lesson[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(mondayDate);
      date.setDate(mondayDate.getDate() + i);
      date.setHours(0, 0, 0, 0);

      const weekday = i === 6 ? 0 : i + 1;
      const slots = this.getSlotsForWeekday(weekday, {
        subgroup: opts?.subgroup,
        week: effectiveWeek,
      });
      lessons.push(...slotsToLessons(slots, date));
    }
    return lessons;
  }

  today(opts?: { subgroup?: number }): Lesson[] {
    return this.forDate(new Date(), opts);
  }

  tomorrow(opts?: { subgroup?: number }): Lesson[] {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return this.forDate(date, opts);
  }

  thisWeek(opts?: { subgroup?: number }): Lesson[] {
    return this.forWeek(undefined, opts);
  }

  currentLesson(opts?: { subgroup?: number }): Lesson | null {
    const now = new Date();
    const lessons = this.forDate(now, opts);
    const timeMinutes = now.getHours() * 60 + now.getMinutes();

    for (const lesson of lessons) {
      const start = lesson.start.hours * 60 + lesson.start.minutes;
      const end = lesson.end.hours * 60 + lesson.end.minutes;
      if (timeMinutes >= start && timeMinutes <= end) {
        return lesson;
      }
    }

    return null;
  }

  getWeekNumber(date?: Date): number {
    return getWeekNumber({ period: this.period, date });
  }

  getSemesterWeeks(weekCount?: number): SemesterWeek[] {
    return getSemesterWeeks({ period: this.period, weekCount });
  }

  getSemesterStart(): Date {
    return getSemesterStart({ period: this.period });
  }
}
