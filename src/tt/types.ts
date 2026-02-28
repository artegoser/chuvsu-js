import type {
  Time,
  WeekRange,
  Teacher,
  EducationType,
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

/** A date-specific substitution (room and/or teacher change). */
export interface Substitution {
  /** The date this substitution applies to. */
  date: Date;
  /** New room, if changed. */
  room?: string;
  /** New teacher, if changed. */
  teacher?: Teacher;
}

/** Info about a lesson transferred from another date/slot. */
export interface TransferInfo {
  /** Date when this lesson takes place (target). */
  targetDate: Date;
  /** Original date the lesson was moved from. */
  fromDate: Date;
  /** Original slot number (пара). */
  fromSlot: number;
  /** Subject name (used to match the source entry). */
  subject: string;
}

export interface ScheduleEntry {
  room: string;
  subject: string;
  type: string;
  weeks: WeekRange;
  teacher: Teacher;
  subgroup?: number;
  weekParity?: "even" | "odd";
  /** Date-specific substitutions (замена на). */
  substitutions?: Substitution[];
  /** If this entry is a transferred lesson (перенос). */
  transfer?: TransferInfo;
  /** Whether this entry is marked as potentially changing (class="want"). */
  possibleChanges?: boolean;
}

export interface FullScheduleSlot {
  number: number;
  timeStart: Time;
  timeEnd: Time;
  entries: ScheduleEntry[];
}

export interface FullScheduleDay {
  weekday: string;
  date?: Date;
  slots: FullScheduleSlot[];
}

export interface LessonTimeSlot {
  number: number;
  start: Time;
  end: Time;
}

export interface LessonTime {
  date: Date;
  hours: number;
  minutes: number;
}

export interface Lesson {
  number: number;
  start: LessonTime;
  end: LessonTime;
  subject: string;
  type: string;
  room: string;
  teacher: Teacher;
  weeks: WeekRange;
  subgroup?: number;
  weekParity?: "even" | "odd";
  /** If a substitution was applied, the original room. */
  originalRoom?: string;
  /** If a substitution was applied, the original teacher. */
  originalTeacher?: Teacher;
  /** Transfer info if this lesson was moved from another date/slot. */
  transfer?: TransferInfo;
  /** Whether this lesson is marked as potentially changing. */
  possibleChanges?: boolean;
}

export interface SemesterWeek {
  week: number;
  start: Date;
  end: Date;
}

export interface CacheConfig {
  schedule?: number;
  faculties?: number;
  groups?: number;
}

export interface TtClientOptions {
  educationType?: EducationType;
  cache?: number | CacheConfig;
}
