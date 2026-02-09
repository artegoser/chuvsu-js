import type {
  FullScheduleDay,
  FullScheduleSlot,
  SemesterWeek,
  Lesson,
} from "./types.js";
import { Period } from "../common/types.js";
import {
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
