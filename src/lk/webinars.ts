import type { LessonOccurrence } from "../tt/domain/types.js";
import type { Webinar } from "./types.js";
import { LessonType } from "../common/lesson-type.js";

export type LessonWithWebinar = LessonOccurrence & { webinar?: Webinar };

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

export function findWebinar(
  lesson: LessonOccurrence,
  webinars: Webinar[],
): Webinar | undefined {
  const matches = findWebinars(lesson, webinars);
  return matches.length === 1 ? matches[0] : undefined;
}

/** All compatible rows; callers can resolve ambiguity explicitly. */
export function findWebinars(
  lesson: LessonOccurrence,
  webinars: Webinar[],
): Webinar[] {
  if (lesson.status === "cancelled") return [];
  return webinars.filter((webinar) => {
    if (!webinar.scheduled) return false;
    if (
      webinar.scheduledDate !== lesson.scheduledDate
    ) return false;
    if (
      webinar.slotNumber != null &&
      webinar.slotNumber !== lesson.slotNumber
    ) {
      return false;
    }
    if (
      !lesson.time ||
      webinar.time.start.hours !== lesson.time.start.hours ||
      webinar.time.start.minutes !== lesson.time.start.minutes ||
      webinar.time.end.hours !== lesson.time.end.hours ||
      webinar.time.end.minutes !== lesson.time.end.minutes
    ) {
      return false;
    }
    if (normalize(webinar.subject) !== normalize(lesson.subject)) return false;
    if (webinar.type !== LessonType.Unknown && lesson.type !== LessonType.Unknown && webinar.type !== lesson.type) return false;
    const groups = lesson.groups.values;
    if (groups.length && webinar.groups.length && !groups.some((attendance) =>
      webinar.groups.some((group) => normalize(group) === normalize(attendance.group.name)) &&
      (webinar.subgroup == null || attendance.subgroup == null || webinar.subgroup === attendance.subgroup)
    )) return false;
    const teachers = lesson.teachers.values.filter((teacher) => teacher.name.trim());
    if (teachers.length && webinar.teacher.name.trim() && !teachers.some((teacher) =>
      normalize(teacher.name) === normalize(webinar.teacher.name)
    )) return false;
    return true;
  });
}

export function attachWebinars(
  lessons: LessonOccurrence[],
  webinars: Webinar[],
): LessonWithWebinar[] {
  return lessons.map((lesson) => {
    const webinar = findWebinar(lesson, webinars);
    return webinar ? { ...lesson, webinar } : lesson;
  });
}
