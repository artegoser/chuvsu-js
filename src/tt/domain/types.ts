import type { AcademicPeriod, Time, WeekRange } from "../../common/types.js";

export type LessonSeriesId = string;
export type LessonId = string;

export interface NamedEntityRef {
  id?: number;
  name: string;
}

export interface GroupRef extends NamedEntityRef {
  specialty?: string;
  profile?: string;
}

export interface TeacherRef extends NamedEntityRef {
  position?: string;
  degree?: string;
}

export interface RoomRef extends NamedEntityRef {
  building?: string;
}

export interface GroupAttendance {
  group: GroupRef;
  subgroup?: number;
}

export type ScheduleOwner =
  | { type: "group"; group: GroupRef }
  | { type: "teacher"; teacher: TeacherRef }
  | { type: "room"; room: RoomRef };

export interface LessonSlot {
  number: number;
  start: Time;
  end: Time;
}

export interface LessonRecurrence {
  weekday: number;
  weeks: WeekRange;
  parity?: "even" | "odd";
}

export interface LessonSubstitution {
  date: Date;
  rooms?: RoomRef[];
  teachers?: TeacherRef[];
  isDistance?: boolean;
}

export interface LessonTransfer {
  fromDate: Date;
  fromSlot: number;
  targetDate: Date;
}

export interface LessonSourceRef {
  sourceKey: string;
  observationKey: string;
  observedAt: Date;
  owner: ScheduleOwner;
}

export interface LessonSeries {
  id: LessonSeriesId;
  academicYearStartYear: number;
  period: AcademicPeriod;
  subject: string;
  type: string;
  slot: LessonSlot;
  recurrence: LessonRecurrence;
  groups: GroupAttendance[];
  teachers: TeacherRef[];
  rooms: RoomRef[];
  isDistance: boolean;
  possibleChanges: boolean;
  substitutions: LessonSubstitution[];
  sources: LessonSourceRef[];
}

export type LessonStatus = "scheduled" | "moved" | "cancelled";

export interface LessonOccurrence {
  id: LessonId;
  seriesId?: LessonSeriesId;
  academicYearStartYear: number;
  period: AcademicPeriod;
  academicWeek?: number;
  nominalDate: Date;
  date: Date;
  subject: string;
  type: string;
  slot: LessonSlot;
  groups: GroupAttendance[];
  teachers: TeacherRef[];
  rooms: RoomRef[];
  isDistance: boolean;
  possibleChanges: boolean;
  status: LessonStatus;
  movedFrom?: { date: Date; slot: number };
  originalRooms?: RoomRef[];
  originalTeachers?: TeacherRef[];
  sources: LessonSourceRef[];
}

interface ObservationBase {
  /** Stable only inside one source page projection. */
  key: string;
  subject: string;
  type: string;
  slot: LessonSlot;
  /** Undefined means the source did not expose this relation. */
  groups?: GroupAttendance[];
  /** Undefined means the source did not expose this relation. */
  teachers?: TeacherRef[];
  /** Undefined means the source did not expose this relation. */
  rooms?: RoomRef[];
  isDistance?: boolean;
  possibleChanges?: boolean;
  substitutions?: LessonSubstitution[];
}

export interface SeriesObservation extends ObservationBase {
  kind: "series";
  recurrence: LessonRecurrence;
}

export interface OccurrenceObservation extends ObservationBase {
  kind: "occurrence";
  date: Date;
  transfer?: LessonTransfer;
}

export type ScheduleObservation =
  | SeriesObservation
  | OccurrenceObservation;

export interface ScheduleSourceSnapshot {
  sourceKey: string;
  owner: ScheduleOwner;
  academicYearStartYear: number;
  period: AcademicPeriod;
  observedAt: Date;
  observations: ScheduleObservation[];
}

export interface IngestResult {
  revision: number;
  seriesIds: LessonSeriesId[];
  lessonIds: LessonId[];
  created: number;
  updated: number;
  removedObservations: number;
}

export interface SerializedScheduleSourceSnapshot
  extends Omit<ScheduleSourceSnapshot, "observedAt" | "observations"> {
  observedAt: string;
  observations: SerializedScheduleObservation[];
}

export type SerializedScheduleObservation =
  | (Omit<
      SeriesObservation,
      "substitutions"
    > & { substitutions?: SerializedLessonSubstitution[] })
  | (Omit<
      OccurrenceObservation,
      "date" | "transfer" | "substitutions"
    > & {
      date: string;
      transfer?: {
        fromDate: string;
        fromSlot: number;
        targetDate: string;
      };
      substitutions?: SerializedLessonSubstitution[];
    });

export interface SerializedLessonSubstitution
  extends Omit<LessonSubstitution, "date"> {
  date: string;
}

export interface TimetableRepositorySnapshot {
  schemaVersion: 1;
  revision: number;
  directory: TimetableDirectorySnapshot;
  sources: SerializedScheduleSourceSnapshot[];
  links: Array<{
    sourceKey: string;
    observationKey: string;
    kind: "series" | "occurrence";
    id: string;
  }>;
}

export interface TimetableDirectorySnapshot {
  groups: GroupRef[];
  teachers: TeacherRef[];
  rooms: RoomRef[];
}

export interface TimetableRepositoryAdapter {
  load(): Promise<TimetableRepositorySnapshot | null>;
  compareAndSet(
    expectedRevision: number,
    snapshot: TimetableRepositorySnapshot,
  ): Promise<boolean>;
  clear?(): Promise<void>;
}

export interface LessonIdGenerator {
  seriesId(): LessonSeriesId;
  lessonId(): LessonId;
}
