import { AcademicPeriod } from "../../common/types.js";
import {
  getAdjacentSemester,
  getCurrentPeriod,
  getMonday,
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  isHoliday,
  isSameDay,
  type Holiday,
  type HolidayTransfer,
  RUSSIAN_HOLIDAYS,
} from "../utils/index.js";
import { occurrenceIdForSeries } from "./ids.js";
import { entityKey } from "./normalize.js";
import { TimetableRepository } from "./repository.js";
import type {
  GroupAttendance,
  LessonOccurrence,
  LessonSeries,
  ScheduleOwner,
} from "./types.js";

export interface ScheduleQueryOptions {
  subgroup?: number;
}

export interface ScheduleWeekdayOptions extends ScheduleQueryOptions {
  week?: number;
}

export interface ScheduleOptions {
  period?: AcademicPeriod;
  holidays?: Holiday[] | null;
  holidayTransfers?: HolidayTransfer[];
}

function dateAt(
  date: Date,
  time: { hours: number; minutes: number },
): Date {
  const value = new Date(date);
  value.setHours(time.hours, time.minutes, 0, 0);
  return value;
}

function semesterCalendarYear(series: LessonSeries): number {
  return series.period === AcademicPeriod.FallSemester
    ? series.academicYearStartYear
    : series.academicYearStartYear + 1;
}

function recurrenceIncludes(series: LessonSeries, date: Date): number | null {
  if (date.getDay() !== series.recurrence.weekday) return null;
  const week = getWeekNumber({
    period: series.period,
    year: semesterCalendarYear(series),
    date,
  });
  const from = series.recurrence.weeks.from || 1;
  const to = series.recurrence.weeks.to || 17;
  if (week < from || week > to) return null;
  if (series.recurrence.parity === "even" && week % 2 !== 0) return null;
  if (series.recurrence.parity === "odd" && week % 2 === 0) return null;
  return week;
}

function attendanceMatchesSubgroup(
  groups: GroupAttendance[],
  owner: ScheduleOwner,
  subgroup: number | undefined,
): boolean {
  if (subgroup == null) return true;
  if (owner.type === "group") {
    const ownerKey = entityKey(owner.group);
    const attendance = groups.filter(
      (value) => entityKey(value.group) === ownerKey,
    );
    return attendance.some(
      (value) => value.subgroup == null || value.subgroup === subgroup,
    );
  }
  return groups.some(
    (value) => value.subgroup == null || value.subgroup === subgroup,
  );
}

function occurrenceMatchesOwner(
  occurrence: LessonOccurrence,
  owner: ScheduleOwner,
): boolean {
  if (owner.type === "group") {
    const key = entityKey(owner.group);
    return occurrence.groups.values.some((value) => entityKey(value.group) === key);
  }
  if (owner.type === "teacher") {
    const key = entityKey(owner.teacher);
    return occurrence.teachers.values.some((value) => entityKey(value) === key);
  }
  const key = entityKey(owner.room);
  return occurrence.rooms.values.some((value) => entityKey(value) === key);
}

function sortOccurrences(
  left: LessonOccurrence,
  right: LessonOccurrence,
): number {
  return (
    (left.startsAt?.getTime() ?? left.scheduledDate.getTime()) -
      (right.startsAt?.getTime() ?? right.scheduledDate.getTime()) ||
    (left.slotNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.slotNumber ?? Number.MAX_SAFE_INTEGER) ||
    left.subject.localeCompare(right.subject) ||
    left.id.localeCompare(right.id)
  );
}

export class Schedule {
  readonly repository: TimetableRepository;
  readonly owner: ScheduleOwner;
  readonly academicYearStartYear: number;
  readonly period: AcademicPeriod;
  readonly holidays: Holiday[];
  readonly holidayTransfers: HolidayTransfer[];

  constructor(
    repository: TimetableRepository,
    owner: ScheduleOwner,
    academicYearStartYear: number,
    options?: ScheduleOptions,
  ) {
    this.repository = repository;
    this.owner = owner;
    this.academicYearStartYear = academicYearStartYear;
    this.period = options?.period ?? getCurrentPeriod();
    this.holidays = options?.holidays ?? RUSSIAN_HOLIDAYS;
    this.holidayTransfers = options?.holidayTransfers ?? [];
  }

  get revision(): number {
    return this.repository.revision;
  }

  series(): LessonSeries[] {
    return this.repository.getSeries({
      owner: this.owner,
      academicYearStartYear: this.academicYearStartYear,
    });
  }

  on(date: Date, options?: ScheduleQueryOptions): LessonOccurrence[] {
    if (!this.isInAcademicYear(date)) return [];
    if (isHoliday(date, this.holidays, this.holidayTransfers)) return [];

    const direct = this.repository.getDirectOccurrences({
      academicYearStartYear: this.academicYearStartYear,
    });
    const movedSources = direct
      .filter((value) => value.movedFrom)
      .map((value) => ({
        date: value.movedFrom!.date,
        slotNumber: value.movedFrom!.slotNumber,
        subject: value.subject,
      }));
    const occurrences: LessonOccurrence[] = [];

    for (const series of this.series()) {
      const week = recurrenceIncludes(series, date);
      if (week == null) continue;
      if (
        movedSources.some(
          (source) =>
            isSameDay(source.date, date) &&
            source.slotNumber === series.slotNumber &&
            source.subject === series.subject,
        )
      ) {
        continue;
      }

      let rooms = series.rooms;
      let teachers = series.teachers;
      let isDistance = series.isDistance;
      let originalRooms: typeof rooms | undefined;
      let originalTeachers: typeof teachers | undefined;
      const substitution = series.substitutions.find((value) =>
        isSameDay(value.date, date),
      );
      if (substitution?.rooms) {
        originalRooms = rooms;
        rooms = { values: substitution.rooms, completeness: "complete" };
      }
      if (substitution?.teachers) {
        originalTeachers = teachers;
        teachers = { values: substitution.teachers, completeness: "complete" };
      }
      if (substitution?.isDistance != null) {
        isDistance = substitution.isDistance;
      }

      const occurrence: LessonOccurrence = {
        id: occurrenceIdForSeries(series.id, week),
        seriesId: series.id,
        academicYearStartYear: series.academicYearStartYear,
        period: series.period,
        academicWeek: week,
        nominalDate: new Date(date),
        scheduledDate: new Date(date),
        startsAt: series.time ? dateAt(date, series.time.start) : undefined,
        endsAt: series.time ? dateAt(date, series.time.end) : undefined,
        subject: series.subject,
        type: series.type,
        slotNumber: series.slotNumber,
        time: series.time,
        groups: series.groups,
        teachers,
        rooms,
        isDistance,
        possibleChanges: series.possibleChanges,
        status: "scheduled",
        originalRooms,
        originalTeachers,
        sources: series.sources,
      };
      if (
        occurrenceMatchesOwner(occurrence, this.owner) &&
        attendanceMatchesSubgroup(
          occurrence.groups.values,
          this.owner,
          options?.subgroup,
        )
      ) {
        occurrences.push(occurrence);
      }
    }

    for (const occurrence of direct) {
      if (!isSameDay(occurrence.scheduledDate, date)) continue;
      if (!occurrenceMatchesOwner(occurrence, this.owner)) continue;
      if (
        !attendanceMatchesSubgroup(
          occurrence.groups.values,
          this.owner,
          options?.subgroup,
        )
      ) {
        continue;
      }
      occurrences.push(occurrence);
    }

    return occurrences.sort(sortOccurrences);
  }

  week(week?: number, options?: ScheduleQueryOptions): LessonOccurrence[] {
    const period =
      this.period === AcademicPeriod.WinterSession ||
      this.period === AcademicPeriod.SummerSession
        ? getAdjacentSemester(this.period)
        : this.period;
    const year =
      period === AcademicPeriod.FallSemester
        ? this.academicYearStartYear
        : this.academicYearStartYear + 1;
    let monday: Date;
    if (week != null) {
      const data = getSemesterWeeks({ period, year, weekCount: week }).find(
        (value) => value.week === week,
      );
      monday = data?.start ?? getMonday(new Date());
    } else {
      monday = getMonday(new Date());
    }

    const result: LessonOccurrence[] = [];
    for (let day = 0; day < 7; day++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + day);
      result.push(...this.on(date, options));
    }
    return result.sort(sortOccurrences);
  }

  weekday(
    weekday: number,
    options?: ScheduleWeekdayOptions,
  ): LessonOccurrence[] {
    if (options?.week != null) {
      return this.week(options.week, options).filter(
        (value) => value.scheduledDate.getDay() === weekday,
      );
    }
    const now = new Date();
    const date = new Date(now);
    date.setDate(now.getDate() + weekday - now.getDay());
    date.setHours(0, 0, 0, 0);
    return this.on(date, options);
  }

  today(options?: ScheduleQueryOptions): LessonOccurrence[] {
    return this.on(new Date(), options);
  }

  tomorrow(options?: ScheduleQueryOptions): LessonOccurrence[] {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return this.on(date, options);
  }

  thisWeek(options?: ScheduleQueryOptions): LessonOccurrence[] {
    return this.week(undefined, options);
  }

  current(options?: ScheduleQueryOptions): LessonOccurrence | null {
    const now = new Date();
    return (
      this.on(now, options).find((value) => {
        return value.startsAt != null && value.endsAt != null &&
          now >= value.startsAt && now <= value.endsAt;
      }) ?? null
    );
  }

  getWeekNumber(date?: Date): number {
    const period =
      this.period === AcademicPeriod.WinterSession ||
      this.period === AcademicPeriod.SummerSession
        ? getAdjacentSemester(this.period)
        : this.period;
    return getWeekNumber({
      period,
      year:
        period === AcademicPeriod.FallSemester
          ? this.academicYearStartYear
          : this.academicYearStartYear + 1,
      date,
    });
  }

  getSemesterWeeks(weekCount?: number) {
    const period =
      this.period === AcademicPeriod.WinterSession ||
      this.period === AcademicPeriod.SummerSession
        ? getAdjacentSemester(this.period)
        : this.period;
    return getSemesterWeeks({
      period,
      year:
        period === AcademicPeriod.FallSemester
          ? this.academicYearStartYear
          : this.academicYearStartYear + 1,
      weekCount,
    });
  }

  getSemesterStart(): Date {
    const period =
      this.period === AcademicPeriod.WinterSession ||
      this.period === AcademicPeriod.SummerSession
        ? getAdjacentSemester(this.period)
        : this.period;
    return getSemesterStart({
      period,
      year:
        period === AcademicPeriod.FallSemester
          ? this.academicYearStartYear
          : this.academicYearStartYear + 1,
    });
  }

  private isInAcademicYear(date: Date): boolean {
    const start = new Date(this.academicYearStartYear, 8, 1);
    const end = new Date(
      this.academicYearStartYear + 1,
      7,
      31,
      23,
      59,
      59,
      999,
    );
    return date >= start && date <= end;
  }
}
