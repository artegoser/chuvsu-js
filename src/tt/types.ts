import type { Time, WeekRange, Teacher, EducationType } from "../common/types.js";

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

export interface ScheduleEntry {
  room: string;
  subject: string;
  type: string;
  weeks: WeekRange;
  teacher: Teacher;
  subgroup?: number;
  weekParity?: "even" | "odd";
}

export interface FullScheduleSlot {
  number: number;
  timeStart: Time;
  timeEnd: Time;
  entries: ScheduleEntry[];
}

export interface FullScheduleDay {
  weekday: string;
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
