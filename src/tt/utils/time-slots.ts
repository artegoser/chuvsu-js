import { EducationType } from "../../common/types.js";
import type { Time } from "../../common/types.js";
import type { LessonTimeSlot } from "../types.js";

const VO_TIME_SLOTS: LessonTimeSlot[] = [
  { number: 1, start: { hours: 8, minutes: 20 }, end: { hours: 9, minutes: 40 } },
  { number: 2, start: { hours: 9, minutes: 50 }, end: { hours: 11, minutes: 10 } },
  { number: 3, start: { hours: 11, minutes: 40 }, end: { hours: 13, minutes: 0 } },
  { number: 4, start: { hours: 13, minutes: 30 }, end: { hours: 14, minutes: 50 } },
  { number: 5, start: { hours: 15, minutes: 0 }, end: { hours: 16, minutes: 20 } },
  { number: 6, start: { hours: 16, minutes: 40 }, end: { hours: 18, minutes: 0 } },
  { number: 7, start: { hours: 18, minutes: 10 }, end: { hours: 19, minutes: 30 } },
  { number: 8, start: { hours: 19, minutes: 40 }, end: { hours: 21, minutes: 0 } },
];

const SPO_TIME_SLOTS: LessonTimeSlot[] = [
  { number: 1, start: { hours: 8, minutes: 10 }, end: { hours: 9, minutes: 40 } },
  { number: 2, start: { hours: 9, minutes: 55 }, end: { hours: 11, minutes: 25 } },
  { number: 3, start: { hours: 11, minutes: 55 }, end: { hours: 13, minutes: 25 } },
  { number: 4, start: { hours: 13, minutes: 40 }, end: { hours: 15, minutes: 10 } },
  { number: 5, start: { hours: 15, minutes: 25 }, end: { hours: 16, minutes: 55 } },
  { number: 6, start: { hours: 17, minutes: 10 }, end: { hours: 18, minutes: 40 } },
  { number: 7, start: { hours: 18, minutes: 55 }, end: { hours: 20, minutes: 25 } },
];

export function getTimeSlots(educationType: EducationType): LessonTimeSlot[] {
  return educationType === EducationType.VocationalEducation
    ? SPO_TIME_SLOTS
    : VO_TIME_SLOTS;
}

function timeToMinutes(t: Time): number {
  return t.hours * 60 + t.minutes;
}

export function getLessonNumber(
  time: Time,
  educationType: EducationType,
): number {
  const slots = getTimeSlots(educationType);
  const target = timeToMinutes(time);

  let closest = slots[0];
  let minDiff = Math.abs(timeToMinutes(closest.start) - target);

  for (let i = 1; i < slots.length; i++) {
    const diff = Math.abs(timeToMinutes(slots[i].start) - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = slots[i];
    }
  }

  return closest.number;
}
