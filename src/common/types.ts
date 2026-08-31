export enum AcademicPeriod {
  FallSemester = 1,
  WinterSession = 2,
  SpringSemester = 3,
  SummerSession = 4,
}

export enum EducationLevel {
  HigherEducation = 1,
  VocationalEducation = 2,
}

export interface Time {
  hours: number;
  minutes: number;
}

export interface TimeRange {
  start: Time;
  end: Time;
}

export interface WeekRange {
  from: number;
  to: number;
}

export interface Teacher {
  position?: string;
  degree?: string;
  name: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
