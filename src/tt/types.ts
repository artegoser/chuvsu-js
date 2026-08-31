import type { BlobAdapter, CacheAdapter } from "../common/cache.js";
import type {
  TimetableRepositoryAdapter,
  TimetableRepositorySnapshot,
} from "./domain/types.js";
import type { TimetableRepository } from "./domain/repository.js";
import type {
  TimeRange,
  WeekRange,
  Teacher,
  EducationLevel,
  AcademicPeriod,
  LocalDate,
} from "../common/types.js";

export interface Faculty {
  id: number;
  name: string;
}

export interface Group {
  id: number;
  name: string;
  specialty?: string;
  profile?: string;
}

export interface Room {
  id: number;
  name: string;
}

export interface RoomInfo {
  name: string;
  /** Building letter/name, e.g. "Б". */
  building?: string;
  /** Floor number, e.g. 3. */
  floor?: number;
  /** Free-form usage description, e.g. "Учебная лаборатория". */
  usage?: string;
  /** Relative URL of the audience photo (/index/audimage/...). */
  audImageUrl?: string;
  /** Relative URL of the building image (/index/blockimage/...). */
  blockImageUrl?: string;
  /** Relative URL of the floor plan image (/index/floorplan/...). */
  floorplanUrl?: string;
  /** Rectangle (in floorplan image pixels) highlighting this audience. */
  floorplanRect?: { x1: number; y1: number; x2: number; y2: number };
}

/** A date-specific substitution (room and/or teacher change). */
export interface Substitution {
  /** The date this substitution applies to. */
  date: LocalDate;
  /** New room, if changed. */
  room?: string;
  /** Whether the substitution moves the lesson online. */
  isDistance?: boolean;
  /** New teacher, if changed. */
  teacher?: Teacher;
}

/** Info about a lesson this teacher is substituting for another teacher. */
export interface SubstituteForInfo {
  /** The date this substitute lesson takes place. */
  date: LocalDate;
  /** The original teacher being replaced. */
  originalTeacher: Teacher;
}

/** Info about a lesson transferred from another date/slot. */
export interface TransferInfo {
  /** Date when this lesson takes place (target). */
  targetDate: LocalDate;
  /** Original date the lesson was moved from. */
  fromDate: LocalDate;
  /** Original slot number (пара). */
  fromSlot: number;
  /** Subject name (used to match the source entry). */
  subject: string;
}

export interface ParsedLesson {
  /** Missing means this source projection does not expose room information. */
  room?: string | null;
  subject: string;
  type: string;
  weeks: WeekRange;
  /** Missing means this source projection does not expose teacher information. */
  teacher?: Teacher | null;
  /**
   * Group names for this lesson (e.g. `["КТ-42-25 (АихС)", "КТ-41-25"]`).
   * Parenthesized annotations that are part of the group name are preserved;
   * service markers like "(N подгруппа)" are stripped and moved to {@link ParsedLesson.subgroup}.
   * Empty array if no groups are listed.
   */
  groups?: string[] | null;
  subgroup?: number;
  weekParity?: "even" | "odd";
  /** True when the lesson is explicitly marked as дистанционно / ДОТ. */
  isDistance?: boolean;
  /** Date-specific substitutions (замена на). */
  substitutions?: Substitution[];
  /** If this entry is a transferred lesson (перенос). */
  transfer?: TransferInfo;
  /** If this entry is a substitute lesson (замена вместо). */
  substituteFor?: SubstituteForInfo;
  /** Whether this entry is marked as potentially changing (class="want"). */
  possibleChanges?: boolean;
}

export interface ParsedScheduleBlock {
  /** Portal ordinal claim. It is independent from the time claim. */
  slotNumber?: number;
  /** Missing when the source does not expose a trustworthy time range. */
  time?: TimeRange;
  lessons: ParsedLesson[];
}

export interface ParsedScheduleDay {
  weekday: string;
  date?: LocalDate;
  /** True when portal marks this weekday as a self-study day. */
  isSelfStudyDay?: boolean;
  blocks: ParsedScheduleBlock[];
}

export interface StandardScheduleBlock {
  slotNumber: number;
  time: TimeRange;
}

/** Teacher info from the schedule page header. */
export interface TeacherInfo {
  name: string;
  degree?: string;
  department?: string;
  /** Relative photo URL (e.g. "/index/photo/tech/653/id/653"), or undefined if no photo. */
  photoUrl?: string;
}

export interface SemesterWeek {
  week: number;
  start: Date;
  end: Date;
}

export interface Webinar {
  /** Internal tt.chuvsu.ru webinar id used by `/webinar/getjoin`. */
  id: string;
  /** Webinar table type argument (`idwt`) used by `/webinar/getjoin`. */
  idType: number;
  /** True for "Вебинары по расписанию"; false for external webinars. */
  scheduled: boolean;
  scheduledDate?: LocalDate;
  slotNumber?: number;
  time: TimeRange;
  subject: string;
  type: string;
  teacher: Teacher;
  groups: string[];
  subgroup?: number;
  /** Free-form title/topic from the second table column. */
  title: string;
  /** Raw first-column text as rendered by tt.chuvsu.ru. */
  raw: string;
}

export interface CacheConfig {
  schedule?: number;
  faculties?: number;
  groups?: number;
  rooms?: number;
  roomNames?: number;
  teachers?: number;
  teacherInfo?: number;
  teacherPhotos?: number;
  roomInfo?: number;
  roomImages?: number;
  webinars?: number;
}

export interface TimetableClientOptions {
  educationLevel?: EducationLevel;
  cache?: number | CacheConfig;
  cacheAdapter?: CacheAdapter;
  blobAdapter?: BlobAdapter;
  /** Existing canonical repository, useful for dependency injection/browser handoff. */
  repository?: TimetableRepository;
  /** Persistent canonical identity storage. Independent from the TTL cache. */
  repositoryAdapter?: TimetableRepositoryAdapter;
}


export interface GetScheduleOptions {
  periods?: readonly AcademicPeriod[];
}

export type EntityResolutionStrategy = "cache-only" | "search";

export interface DirectoryPreloadOptions {
  teachers?: boolean;
  rooms?: boolean;
  facultyIds?: number[];
}

export type { TimetableRepositorySnapshot };
