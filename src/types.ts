export const enum Period {
  FallSemester = 1,
  WinterSession = 2,
  SpringSemester = 3,
  SummerSession = 4,
}

export const enum EducationType {
  HigherEducation = 1,
  VocationalEducation = 2,
}

export interface PersonalData {
  lastName: string;
  firstName: string;
  patronymic: string;
  sex: string;
  birthday: string;
  recordBookNumber: string;
  faculty: string;
  specialty: string;
  profile: string;
  group: string;
  course: string;
  email: string;
  phone: string;
}

export interface Time {
  hours: number;
  minutes: number;
}

export interface WeekRange {
  min: number;
  max: number;
}

export interface Teacher {
  position?: string;
  degree?: string;
  name: string;
}

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

export interface CurrentLesson {
  slot: FullScheduleSlot;
  entry: ScheduleEntry;
  weekday: string;
  period: Period;
}
