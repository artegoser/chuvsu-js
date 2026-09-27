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
};

/** Convert portal short code into compact domain identifier. */
export function parseLessonType(code: string): LessonType {
  return TYPE_BY_CODE[code.trim().toLocaleLowerCase("ru-RU").replace(/\.$/u, "")] ?? LessonType.Unknown;
}
