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

export interface Exam {
  time: string;
  subject: string;
  type: string;
  teacher: string;
  room: string;
  subgroup?: string;
}

export interface ExamDay {
  date: string;
  exams: Exam[];
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
