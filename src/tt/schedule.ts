import type {
  FullScheduleDay,
  FullScheduleSlot,
  SemesterWeek,
  Lesson,
} from "./types.js";
import { Period, EducationType } from "../common/types.js";
import {
  getCurrentPeriod,
  isSessionPeriod,
  getWeekdayName,
  getMonday,
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  getAdjacentSemester,
  filterSlots,
  slotsToLessons,
  sortLessons,
  isHoliday,
  collectTransfers,
  suppressTransferredLessons,
  RUSSIAN_HOLIDAYS,
  type Holiday,
} from "./utils.js";

export class Schedule {
  readonly groupId: number;
  readonly scheduleMap: Map<number, FullScheduleDay[]>;
  readonly educationType: EducationType;
  /** List of holidays to exclude from schedule queries. Pass `[]` to disable. */
  readonly holidays: Holiday[];
  private _period?: Period;

  constructor(
    groupId: number,
    scheduleMap: Map<number, FullScheduleDay[]>,
    period?: Period,
    educationType?: EducationType,
    holidays?: Holiday[] | null,
  ) {
    this.groupId = groupId;
    this.scheduleMap = scheduleMap;
    this.educationType = educationType ?? EducationType.HigherEducation;
    this._period = period;
    this.holidays = holidays ?? RUSSIAN_HOLIDAYS;
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
    opts?: { subgroup?: number; week?: number; date?: Date },
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
      return lessons.sort(sortLessons);
    }

    const slots = this.getSlotsForWeekday(weekday, days, opts);
    const date = this.getDateForWeekday(weekday, period, opts?.week);
    return slotsToLessons(slots, date);
  }

  forDate(date: Date, opts?: { subgroup?: number }): Lesson[] {
    if (isHoliday(date, this.holidays)) return [];

    const period = getCurrentPeriod({ date });
    const lessons: Lesson[] = [];

    // 1. Check all periods for date-based (session) entries matching this date
    for (const [, d] of this.scheduleMap) {
      for (const day of d) {
        if (day.date && Schedule.isSameDay(day.date, date)) {
          lessons.push(...slotsToLessons(day.slots, date));
        }
      }
    }

    // 2. Check applicable semester for weekday-based entries
    const semesterPeriod = isSessionPeriod(period)
      ? getAdjacentSemester(period)
      : period;

    const semesterDays = this.getDays(semesterPeriod);
    if (semesterDays.length > 0) {
      const week = getWeekNumber({ period: semesterPeriod, date });
      if (week >= 0 && week <= 17) {
        const weekday = date.getDay();
        const slots = this.getSlotsForWeekday(weekday, semesterDays, {
          subgroup: opts?.subgroup,
          week,
          date,
        });
        lessons.push(...slotsToLessons(slots, date));
      }

      // 3. Suppress lessons that were transferred away from this date
      const transfers = collectTransfers(semesterDays);
      if (transfers.length > 0) {
        return suppressTransferredLessons(lessons, transfers, date).sort(
          sortLessons,
        );
      }
    }

    return lessons.sort(sortLessons);
  }

  forWeek(week?: number, opts?: { subgroup?: number }): Lesson[] {
    const period = this.period;

    // Determine the Monday of the target week
    let mondayDate: Date;
    if (week != null && !isSessionPeriod(period)) {
      const semesterWeeks = getSemesterWeeks({
        period,
        weekCount: week,
      });
      const weekData = semesterWeeks.find((w) => w.week === week);
      mondayDate = weekData ? weekData.start : getMonday(new Date());
    } else {
      mondayDate = getMonday(new Date());
    }

    const lessons: Lesson[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(mondayDate);
      date.setDate(mondayDate.getDate() + i);
      date.setHours(0, 0, 0, 0);
      lessons.push(...this.forDate(date, opts));
    }
    return lessons.sort(sortLessons);
  }

  today(opts?: { subgroup?: number }): Lesson[] {
    return this.forDate(new Date(), opts).sort(sortLessons);
  }

  tomorrow(opts?: { subgroup?: number }): Lesson[] {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return this.forDate(date, opts).sort(sortLessons);
  }

  thisWeek(opts?: { subgroup?: number }): Lesson[] {
    return this.forWeek(undefined, opts).sort(sortLessons);
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
