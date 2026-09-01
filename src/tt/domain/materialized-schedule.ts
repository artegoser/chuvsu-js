import type { AcademicPeriod, LocalDate } from "../../common/types.js";
import { formatLocalDate } from "../utils/index.js";
import { entityKey } from "./normalize.js";
import type { Schedule } from "./schedule.js";
import type {
  GroupAttendance,
  LessonOccurrence,
  LessonSourceRef,
  ScheduleOwner,
} from "./types.js";

export interface SerializedLessonSourceRef
  extends Omit<LessonSourceRef, "observedAt"> {
  observedAt: string;
}

export interface SerializedLessonOccurrence
  extends Omit<LessonOccurrence, "sources"> {
  sources: SerializedLessonSourceRef[];
}

export interface MaterializedScheduleSnapshot {
  schemaVersion: 1;
  repositoryRevision: number;
  owner: ScheduleOwner;
  academicYearStartYear: number;
  period: AcademicPeriod;
  lessonsByDate: Record<LocalDate, SerializedLessonOccurrence[]>;
}

export interface MaterializeScheduleOptions {
  start?: Date;
  end?: Date;
  includeSources?: boolean;
}

function attendanceMatchesSubgroup(
  groups: GroupAttendance[],
  owner: ScheduleOwner,
  subgroup: number | undefined,
): boolean {
  if (subgroup == null) return true;
  if (owner.type === "group") {
    const ownerKey = entityKey(owner.group);
    return groups
      .filter((value) => entityKey(value.group) === ownerKey)
      .some((value) => value.subgroup == null || value.subgroup === subgroup);
  }
  return groups.some(
    (value) => value.subgroup == null || value.subgroup === subgroup,
  );
}

function serializeOccurrence(
  value: LessonOccurrence,
  includeSources: boolean,
): SerializedLessonOccurrence {
  return {
    ...structuredClone(value),
    sources: includeSources
      ? value.sources.map((source) => ({
          ...structuredClone(source),
          observedAt: source.observedAt.toISOString(),
        }))
      : [],
  };
}

function deserializeOccurrence(
  value: SerializedLessonOccurrence,
): LessonOccurrence {
  return {
    ...structuredClone(value),
    sources: value.sources.map((source) => ({
      ...structuredClone(source),
      observedAt: new Date(source.observedAt),
    })),
  };
}

function sortOccurrences(
  left: LessonOccurrence,
  right: LessonOccurrence,
): number {
  return (
    left.scheduledDate.localeCompare(right.scheduledDate) ||
    ((left.time?.start.hours ?? 24) * 60 +
      (left.time?.start.minutes ?? 0)) -
      ((right.time?.start.hours ?? 24) * 60 +
        (right.time?.start.minutes ?? 0)) ||
    (left.slotNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.slotNumber ?? Number.MAX_SAFE_INTEGER) ||
    left.subject.localeCompare(right.subject) ||
    left.id.localeCompare(right.id)
  );
}

export class MaterializedSchedule {
  readonly owner: ScheduleOwner;
  readonly academicYearStartYear: number;
  readonly period: AcademicPeriod;
  readonly repositoryRevision: number;
  private readonly lessonsByDate = new Map<LocalDate, LessonOccurrence[]>();
  private readonly dateSetCache = new Map<
    number | undefined,
    ReadonlySet<LocalDate>
  >();

  constructor(snapshot: MaterializedScheduleSnapshot) {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(
        `Unsupported materialized schedule schema: ${snapshot.schemaVersion}`,
      );
    }
    this.owner = structuredClone(snapshot.owner);
    this.academicYearStartYear = snapshot.academicYearStartYear;
    this.period = snapshot.period;
    this.repositoryRevision = snapshot.repositoryRevision;
    for (const [date, lessons] of Object.entries(snapshot.lessonsByDate)) {
      this.lessonsByDate.set(
        date as LocalDate,
        lessons.map(deserializeOccurrence).sort(sortOccurrences),
      );
    }
  }

  export(): MaterializedScheduleSnapshot {
    return {
      schemaVersion: 1,
      repositoryRevision: this.repositoryRevision,
      owner: structuredClone(this.owner),
      academicYearStartYear: this.academicYearStartYear,
      period: this.period,
      lessonsByDate: Object.fromEntries(
        [...this.lessonsByDate].map(([date, lessons]) => [
          date,
          lessons.map((lesson) => serializeOccurrence(lesson, true)),
        ]),
      ),
    };
  }

  on(date: Date, options?: { subgroup?: number }): LessonOccurrence[] {
    const lessons = this.lessonsByDate.get(formatLocalDate(date)) ?? [];
    return structuredClone(
      options?.subgroup == null
        ? lessons
        : lessons.filter((lesson) =>
            attendanceMatchesSubgroup(
              lesson.groups.values,
              this.owner,
              options.subgroup,
            ),
          ),
    );
  }

  dateKeys(options?: { subgroup?: number }): ReadonlySet<LocalDate> {
    const subgroup = options?.subgroup;
    const cached = this.dateSetCache.get(subgroup);
    if (cached) return new Set(cached);
    const dates = new Set<LocalDate>();
    for (const [date, lessons] of this.lessonsByDate) {
      if (
        subgroup == null ||
        lessons.some((lesson) =>
          attendanceMatchesSubgroup(
            lesson.groups.values,
            this.owner,
            subgroup,
          ),
        )
      ) {
        dates.add(date);
      }
    }
    this.dateSetCache.set(subgroup, dates);
    return new Set(dates);
  }

}

export function materializeSchedule(
  schedule: Schedule,
  options?: MaterializeScheduleOptions,
): MaterializedSchedule {
  return new MaterializedSchedule(
    materializeScheduleSnapshot(schedule, options),
  );
}

export function materializeScheduleSnapshot(
  schedule: Schedule,
  options?: MaterializeScheduleOptions,
): MaterializedScheduleSnapshot {
  const start = options?.start == null
    ? new Date(schedule.academicYearStartYear, 8, 1)
    : new Date(options.start);
  const end = options?.end == null
    ? new Date(schedule.academicYearStartYear + 1, 7, 31)
    : new Date(options.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new RangeError("Materialized schedule range contains an invalid date");
  }
  if (start > end) {
    throw new RangeError("Materialized schedule start must not exceed end");
  }
  const lessonsByDate: Record<LocalDate, SerializedLessonOccurrence[]> = {};
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  for (; date <= end; date.setDate(date.getDate() + 1)) {
    const lessons = schedule.on(date);
    if (lessons.length === 0) continue;
    lessonsByDate[formatLocalDate(date)] = lessons.map((lesson) =>
      serializeOccurrence(lesson, options?.includeSources !== false),
    );
  }
  return {
    schemaVersion: 1,
    repositoryRevision: schedule.revision,
    owner: schedule.owner,
    academicYearStartYear: schedule.academicYearStartYear,
    period: schedule.period,
    lessonsByDate,
  };
}
