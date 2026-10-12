import type { LessonOccurrence } from "../tt/domain/types.js";
import type { Webinar } from "./types.js";

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

/** Match scheduled date, slot (time when unavailable), and known group/subgroup. */
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
    if (webinar.slotNumber != null && lesson.slotNumber != null) {
      if (webinar.slotNumber !== lesson.slotNumber) return false;
    } else if (
      !lesson.time ||
      webinar.time.start.hours !== lesson.time.start.hours ||
      webinar.time.start.minutes !== lesson.time.start.minutes ||
      webinar.time.end.hours !== lesson.time.end.hours ||
      webinar.time.end.minutes !== lesson.time.end.minutes
    ) {
      return false;
    }
    const groups = lesson.groups.values;
    const attendance = webinar.groups.length
      ? groups.filter((entry) => webinar.groups.some((group) =>
        normalize(group) === normalize(entry.group.name)
      ))
      : groups;
    if (groups.length && !attendance.length) return false;
    if (webinar.subgroup != null && attendance.length && !attendance.some((entry) =>
      entry.subgroup == null || entry.subgroup === webinar.subgroup
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
