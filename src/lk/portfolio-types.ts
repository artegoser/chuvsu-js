import type { LessonType } from "../common/lesson-type.js";

export type PortfolioGradeValue = number | boolean | null;

/** Displayed content only; scripts and profile-changing controls are excluded. */
export interface PortfolioLink {
  text: string;
  url: string;
  title?: string;
  content?: PortfolioContent[];
}

export interface PortfolioCell {
  text: string;
  header: boolean;
  colspan: number;
  rowspan: number;
  links: PortfolioLink[];
  /** Tooltips often contain department names or grade details. */
  notes: string[];
  content: PortfolioContent[];
}

export interface PortfolioTable {
  rows: PortfolioCell[][];
}

export type PortfolioContent =
  | { kind: "text"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "link"; link: PortfolioLink }
  | { kind: "image"; url: string; alt: string; title?: string }
  | { kind: "table"; table: PortfolioTable }
  | { kind: "group"; label?: string; content: PortfolioContent[] };

export interface PortfolioSection {
  title: string;
  content: PortfolioContent[];
}

/** Referral metadata is parsed only. No order is submitted. */
export interface PortfolioReferral {
  semester: number;
  disciplineId: number;
  lessonTypeId: number;
  type: number;
  key: number;
  code: string;
}

export interface PortfolioGrade {
  semester: number;
  code: string;
  subject: string;
  assessment: LessonType;
  /** Numeric grade, credit result, or null when no recognized grade is reported. */
  grade: PortfolioGradeValue;
  notes: string[];
  referral?: PortfolioReferral;
}

export interface PortfolioControlWeek {
  semester: number;
  subject: string;
  grades: (number | null)[];
}

export interface PortfolioAttendance {
  month: string;
  day: number;
  slotNumber: number;
  type: LessonType;
  subgroup?: number;
  /** Preserve +, Н, numeric grades and empty cells without reinterpretation. */
  mark: string;
  notes: string[];
}

export interface PortfolioActivity {
  title: string;
  value: string;
  notes: string[];
  links: PortfolioLink[];
  content: PortfolioContent[];
}

export interface PortfolioPerformance {
  subject: string;
  attendance: PortfolioAttendance[];
  activities: { teacher: string; items: PortfolioActivity[] }[];
}

export interface StudentPortfolio {
  id: number;
  url: string;
  student: {
    fullName: string;
    photoUrl?: string;
    /** All displayed identity fields keyed by their original LK labels. */
    fields: Record<string, string>;
  };
  grades: PortfolioGrade[];
  controlWeeks: PortfolioControlWeek[];
  performance: PortfolioPerformance[];
  /** All tabs, including achievements, interests, practices, coursework and thesis. */
  sections: PortfolioSection[];
}
