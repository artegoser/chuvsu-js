/** Stable compact identifiers for portal lesson types. */
export enum LessonType {
  Unknown = 0,
  Lecture = 1,
  Practical = 2,
  Laboratory = 3,
  Consultation = 4,
  Credit = 5,
  GradedCredit = 6,
  Exam = 7,
  Individual = 8,
  Group = 9,
  CourseProject = 10,
  Krp = 11,
  StateExam = 12,
  ThesisDefense = 13,
}

const TYPE_BY_CODE: Readonly<Record<string, LessonType>> = {
  лк: LessonType.Lecture,
  пр: LessonType.Practical,
  лб: LessonType.Laboratory,
  конс: LessonType.Consultation,
  зач: LessonType.Credit,
  зачо: LessonType.GradedCredit,
  экз: LessonType.Exam,
  из: LessonType.Individual,
  гз: LessonType.Group,
  кп: LessonType.CourseProject,
  крп: LessonType.Krp,
  лекция: LessonType.Lecture,
  "практическое занятие": LessonType.Practical,
  "лабораторная работа": LessonType.Laboratory,
  консультация: LessonType.Consultation,
  зачет: LessonType.Credit,
  "зачет с оценкой": LessonType.GradedCredit,
  "дифференцированный зачет": LessonType.GradedCredit,
  экзамен: LessonType.Exam,
  госэкзамен: LessonType.StateExam,
  "государственный экзамен": LessonType.StateExam,
  "защита выпускной квалификационной работы": LessonType.ThesisDefense,
  "защита вкр": LessonType.ThesisDefense,
  "курсовой проект": LessonType.CourseProject,
};

/** Convert portal short code or full assessment label into a domain identifier. */
export function parseLessonType(code: string): LessonType {
  return TYPE_BY_CODE[code.trim().toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ").replace(/\.$/u, "")] ?? LessonType.Unknown;
}
