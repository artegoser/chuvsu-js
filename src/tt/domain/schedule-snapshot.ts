import type { AcademicPeriod, LocalDate } from "../../common/types.js";
import { formatLocalDate, parseLocalDate, RUSSIAN_HOLIDAYS, type Holiday } from "../utils/index.js";
import { Schedule, type ScheduleQueryOptions, type ScheduleOptions } from "./schedule.js";
import type {
  LessonOccurrence,
  LessonSeries,
  LessonSourceRef,
  ScheduleOwner,
} from "./types.js";

type SerializedSource = Omit<LessonSourceRef, "observedAt"> & { observedAt: string };
type SerializedSeries = Omit<LessonSeries, "sources"> & { sources: SerializedSource[] };
type SerializedOccurrence = Omit<LessonOccurrence, "sources"> & { sources: SerializedSource[] };

export interface SerializedScheduleSnapshot {
  schemaVersion: 3;
  repositoryRevision: number;
  owner: ScheduleOwner;
  academicYearStartYear: number;
  period: AcademicPeriod;
  start: LocalDate;
  end: LocalDate;
  series: SerializedSeries[];
  direct: SerializedOccurrence[];
  holidays?: Holiday[];
  holidayTransfers?: { dayOff: string; workDay: string | null }[];
}

function serializeSources(sources: LessonSourceRef[], include: boolean): SerializedSource[] {
  return include
    ? sources.map((source) => ({ ...structuredClone(source), observedAt: source.observedAt.toISOString() }))
    : [];
}

function deserializeSources(sources: SerializedSource[]): LessonSourceRef[] {
  return sources.map((source) => ({ ...structuredClone(source), observedAt: new Date(source.observedAt) }));
}

function usesDefaultHolidays(holidays: Holiday[]): boolean {
  return holidays.length === RUSSIAN_HOLIDAYS.length && holidays.every((holiday, index) => {
    const standard = RUSSIAN_HOLIDAYS[index];
    return holiday.month === standard.month && holiday.day === standard.day && holiday.name === standard.name;
  });
}

/** Browser-ready schedule backed by recurring rules and dated exceptions. */
export class ScheduleSnapshot extends Schedule {
  private readonly snapshot: SerializedScheduleSnapshot;
  private readonly snapshotSeries: LessonSeries[];
  private readonly snapshotDirect: LessonOccurrence[];
  private readonly dateSetCache = new Map<number | undefined, ReadonlySet<LocalDate>>();

  constructor(snapshot: SerializedScheduleSnapshot) {
    if (snapshot.schemaVersion !== 3) {
      throw new Error(`Unsupported schedule snapshot schema: ${snapshot.schemaVersion}`);
    }
    const series = snapshot.series.map((value) => ({
      ...structuredClone(value), sources: deserializeSources(value.sources),
    }));
    const direct = snapshot.direct.map((value) => ({
      ...structuredClone(value), sources: deserializeSources(value.sources),
    }));
    const options: ScheduleOptions = {
      period: snapshot.period,
      holidays: snapshot.holidays,
      holidayTransfers: snapshot.holidayTransfers?.map((value) => ({
        dayOff: new Date(value.dayOff),
        workDay: value.workDay ? new Date(value.workDay) : null,
      })),
    };
    super(undefined, snapshot.owner, snapshot.academicYearStartYear, options);
    this.snapshotSeries = series;
    this.snapshotDirect = direct;
    this.snapshot = structuredClone(snapshot);
  }

  override get revision(): number { return this.snapshot.repositoryRevision; }

  protected override queryData(): { series: LessonSeries[]; direct: LessonOccurrence[] } {
    return { series: this.snapshotSeries, direct: this.snapshotDirect };
  }

  export(): SerializedScheduleSnapshot { return structuredClone(this.snapshot); }

  override on(date: Date, options?: ScheduleQueryOptions): LessonOccurrence[] {
    const key = formatLocalDate(date);
    return key < this.snapshot.start || key > this.snapshot.end ? [] : super.on(date, options);
  }

  dateKeys(options?: ScheduleQueryOptions): ReadonlySet<LocalDate> {
    const subgroup = options?.subgroup;
    const cached = this.dateSetCache.get(subgroup);
    if (cached) return new Set(cached);
    const dates = new Set<LocalDate>();
    const end = parseLocalDate(this.snapshot.end);
    for (const date = parseLocalDate(this.snapshot.start); date <= end; date.setDate(date.getDate() + 1)) {
      if (this.on(date, options).length) dates.add(formatLocalDate(date));
    }
    this.dateSetCache.set(subgroup, dates);
    return new Set(dates);
  }
}

export function createScheduleSnapshot(
  schedule: Schedule,
  options?: { start?: Date; end?: Date; includeSources?: boolean },
): SerializedScheduleSnapshot {
  const start = options?.start == null ? new Date(schedule.academicYearStartYear, 8, 1) : new Date(options.start);
  const end = options?.end == null ? new Date(schedule.academicYearStartYear + 1, 7, 31) : new Date(options.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new RangeError("Schedule snapshot range contains an invalid date");
  }
  if (start > end) throw new RangeError("Schedule snapshot start must not exceed end");
  const includeSources = options?.includeSources !== false;
  const series = schedule.series().map((value) => ({
    ...value, sources: serializeSources(value.sources, includeSources),
  }));
  const direct = schedule.directOccurrences().map((value) => ({
    ...value, sources: serializeSources(value.sources, includeSources),
  }));
  return {
    schemaVersion: 3,
    repositoryRevision: schedule.revision,
    owner: structuredClone(schedule.owner),
    academicYearStartYear: schedule.academicYearStartYear,
    period: schedule.period,
    start: formatLocalDate(start),
    end: formatLocalDate(end),
    series,
    direct,
    ...(!usesDefaultHolidays(schedule.holidays) ? { holidays: structuredClone(schedule.holidays) } : {}),
    ...(schedule.holidayTransfers.length ? {
      holidayTransfers: schedule.holidayTransfers.map((value) => ({
        dayOff: value.dayOff.toISOString(),
        workDay: value.workDay?.toISOString() ?? null,
      })),
    } : {}),
  };
}
