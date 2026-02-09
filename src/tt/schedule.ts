import type {
  FullScheduleDay,
  FullScheduleSlot,
  SemesterWeek,
  Lesson,
} from "./types.js";
import { Period } from "../common/types.js";
import {
  getCurrentPeriod,
  isSessionPeriod,
  getWeekdayName,
  getMonday,
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  filterSlots,
  slotsToLessons,
} from "./utils.js";

export class Schedule {
  readonly groupId: number;
  readonly scheduleMap: Map<number, FullScheduleDay[]>;
  private _period?: Period;

  constructor(
    groupId: number,
    scheduleMap: Map<number, FullScheduleDay[]>,
    period?: Period,
  ) {
    this.groupId = groupId;
    this.scheduleMap = scheduleMap;
    this._period = period;
  }

  /** Current (or fixed) period for this schedule. */
  get period(): Period {
    return this._period ?? getCurrentPeriod();
  }

  /** Days for the current period. */
  get days(): FullScheduleDay[] {
    return this.scheduleMap.get(this.period) ?? [];
  }

  /** All periods that have data in this schedule. */
  get periods(): Period[] {
    return [...this.scheduleMap.keys()] as Period[];
  }

  /** Get days for a specific period. */
  getDays(period: Period): FullScheduleDay[] {
    return this.scheduleMap.get(period) ?? [];
  }

  // --- Semester helpers (weekday-based) ---

  private getSlotsForWeekday(
    weekday: number,
    days: FullScheduleDay[],
    opts?: { subgroup?: number; week?: number },
  ): FullScheduleSlot[] {
    const dayName = getWeekdayName(weekday);
    const day = days.find(
      (d) => d.weekday.toLowerCase() === dayName.toLowerCase(),
    );
    if (!day) return [];
    return filterSlots(day.slots, opts);
  }

  private getDateForWeekday(
    weekday: number,
    period: Period,
    week?: number,
  ): Date {
    if (week != null) {
      const startMonday = getMonday(getSemesterStart({ period }));
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

  // --- Session helpers (date-based) ---

  private static isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private getSessionLessonsForDate(
    days: FullScheduleDay[],
    date: Date,
  ): Lesson[] {
    const day = days.find((d) => d.date && Schedule.isSameDay(d.date, date));
    if (!day) return [];
    return slotsToLessons(day.slots, date);
  }

  // --- Public query methods ---

  forDay(
    weekday: number,
    opts?: { subgroup?: number; week?: number },
  ): Lesson[] {
    const period = this.period;
    const days = this.getDays(period);

    if (isSessionPeriod(period)) {
      // For sessions, return all entries on days matching this weekday
      const lessons: Lesson[] = [];
      const dayName = getWeekdayName(weekday);
      for (const d of days) {
        if (d.weekday.toLowerCase() === dayName.toLowerCase() && d.date) {
          lessons.push(...slotsToLessons(d.slots, d.date));
        }
      }
      return lessons;
    }

    const slots = this.getSlotsForWeekday(weekday, days, opts);
    const date = this.getDateForWeekday(weekday, period, opts?.week);
    return slotsToLessons(slots, date);
  }

  forDate(date: Date, opts?: { subgroup?: number }): Lesson[] {
    const period = getCurrentPeriod({ date });
    const days = this.getDays(period);

    if (isSessionPeriod(period)) {
      const lessons = this.getSessionLessonsForDate(days, date);
      if (lessons.length > 0) return lessons;
    }

    // Try session periods for exact date match (sessions can have entries
    // on dates that fall outside their "official" period boundaries)
    for (const [p, d] of this.scheduleMap) {
      if (p === period) continue;
      const match = d.find(
        (day) => day.date && Schedule.isSameDay(day.date, date),
      );
      if (match) return slotsToLessons(match.slots, date);
    }

    if (isSessionPeriod(period)) return [];

    const weekday = date.getDay();
    const week = getWeekNumber({ period, date });
    const slots = this.getSlotsForWeekday(weekday, days, {
      subgroup: opts?.subgroup,
      week,
    });
    return slotsToLessons(slots, date);
  }

  forWeek(week?: number, opts?: { subgroup?: number }): Lesson[] {
    const period = this.period;
    const days = this.getDays(period);

    if (isSessionPeriod(period)) {
      // For sessions, return all entries within this calendar week
      const now = new Date();
      const monday = getMonday(now);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      const lessons: Lesson[] = [];
      for (const d of days) {
        if (d.date && d.date >= monday && d.date <= sunday) {
          lessons.push(...slotsToLessons(d.slots, d.date));
        }
      }
      return lessons;
    }

    const effectiveWeek = week ?? getWeekNumber({ period });
    const semesterWeeks = getSemesterWeeks({
      period,
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
      const slots = this.getSlotsForWeekday(weekday, days, {
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
