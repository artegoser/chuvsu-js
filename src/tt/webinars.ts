import type { LessonOccurrence } from "./domain/types.js";
import type { Webinar } from "./types.js";

export type LessonWithWebinar = LessonOccurrence & { webinar?: Webinar };

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function findWebinar(
  lesson: LessonOccurrence,
  webinars: Webinar[],
): Webinar | undefined {
  return webinars.find((webinar) => {
    if (!webinar.scheduled) return false;
    if (
      webinar.scheduledDate &&
      !sameDay(webinar.scheduledDate, lesson.scheduledDate)
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
    if (webinar.type && lesson.type && webinar.type !== lesson.type) return false;
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
