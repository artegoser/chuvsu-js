import type {
  AcademicPeriod,
  LocalDate,
  TimeRange,
  WeekRange,
} from "../../common/types.js";

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

export type RelationCompleteness = "unknown" | "partial" | "complete";

export interface RelationSet<T> {
  values: T[];
  completeness: RelationCompleteness;
}

export interface LessonRecurrence {
  weekday: number;
  weeks?: WeekRange;
  parity?: "even" | "odd";
}

export interface LessonSubstitution {
  date: LocalDate;
  rooms?: RoomRef[];
  teachers?: TeacherRef[];
  isDistance?: boolean;
}

export interface LessonTransfer {
  fromDate: LocalDate;
  fromSlot: number;
  targetDate: LocalDate;
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
  slotNumber?: number;
  time?: TimeRange;
  recurrence: LessonRecurrence;
  groups: RelationSet<GroupAttendance>;
  teachers: RelationSet<TeacherRef>;
  rooms: RelationSet<RoomRef>;
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
  nominalDate: LocalDate;
  scheduledDate: LocalDate;
  subject: string;
  type: string;
  slotNumber?: number;
  time?: TimeRange;
  groups: RelationSet<GroupAttendance>;
  teachers: RelationSet<TeacherRef>;
  rooms: RelationSet<RoomRef>;
  isDistance: boolean;
  possibleChanges: boolean;
  status: LessonStatus;
  movedFrom?: { date: LocalDate; slotNumber?: number };
  originalRooms?: RelationSet<RoomRef>;
  originalTeachers?: RelationSet<TeacherRef>;
  sources: LessonSourceRef[];
}

interface ObservationBase {
  /** Stable only inside one source page projection. */
  key: string;
  subject: string;
  type: string;
  slotNumber?: number;
  time?: TimeRange;
  groups: RelationSet<GroupAttendance>;
  teachers: RelationSet<TeacherRef>;
  rooms: RelationSet<RoomRef>;
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
  date: LocalDate;
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

export type SerializedScheduleObservation = ScheduleObservation;

export interface TimetableRepositorySnapshot {
  schemaVersion: 5;
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
