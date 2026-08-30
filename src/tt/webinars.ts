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
    if (webinar.date && !sameDay(webinar.date, lesson.date)) return false;
    if (
      webinar.slotNumber != null &&
      webinar.slotNumber !== lesson.slot.number
    ) {
      return false;
    }
    if (
      webinar.timeStart.hours !== lesson.slot.start.hours ||
      webinar.timeStart.minutes !== lesson.slot.start.minutes ||
      webinar.timeEnd.hours !== lesson.slot.end.hours ||
      webinar.timeEnd.minutes !== lesson.slot.end.minutes
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
