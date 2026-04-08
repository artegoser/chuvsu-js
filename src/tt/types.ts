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

export interface Audience {
  id: number;
  name: string;
}

export interface AudienceInfo {
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
  date: Date;
  /** New room, if changed. */
  room?: string;
  /** New teacher, if changed. */
  teacher?: Teacher;
}

/** Info about a lesson this teacher is substituting for another teacher. */
export interface SubstituteForInfo {
  /** The date this substitute lesson takes place. */
  date: Date;
  /** The original teacher being replaced. */
  originalTeacher: Teacher;
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
  /** For teacher schedules: group names (e.g. "КТ-42-25 (1 подгруппа)"). */
  groups?: string;
  subgroup?: number;
  weekParity?: "even" | "odd";
  /** Date-specific substitutions (замена на). */
  substitutions?: Substitution[];
  /** If this entry is a transferred lesson (перенос). */
  transfer?: TransferInfo;
  /** If this entry is a substitute lesson (замена вместо). */
  substituteFor?: SubstituteForInfo;
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
  /** For teacher schedules: group names. */
  groups?: string;
  weeks: WeekRange;
  subgroup?: number;
  weekParity?: "even" | "odd";
  /** If a substitution was applied, the original room. */
  originalRoom?: string;
  /** If a substitution was applied, the original teacher. */
  originalTeacher?: Teacher;
  /** Transfer info if this lesson was moved from another date/slot. */
  transfer?: TransferInfo;
  /** If this lesson is a substitute (замена вместо), the original teacher. */
  substituteFor?: SubstituteForInfo;
  /** Whether this lesson is marked as potentially changing. */
  possibleChanges?: boolean;
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

export interface CacheConfig {
  schedule?: number;
  faculties?: number;
  groups?: number;
  teachers?: number;
  teacherInfo?: number;
  teacherPhotos?: number;
  audienceInfo?: number;
  audienceImages?: number;
}

export interface TtClientOptions {
  educationType?: EducationType;
  cache?: number | CacheConfig;
}
