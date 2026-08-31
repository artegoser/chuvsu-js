import { EducationLevel } from "../../common/types.js";
import type { StandardScheduleBlock } from "../types.js";

const VO_TIME_SLOTS: StandardScheduleBlock[] = [
  { slotNumber: 1, time: { start: { hours: 8, minutes: 20 }, end: { hours: 9, minutes: 40 } } },
  { slotNumber: 2, time: { start: { hours: 9, minutes: 50 }, end: { hours: 11, minutes: 10 } } },
  { slotNumber: 3, time: { start: { hours: 11, minutes: 40 }, end: { hours: 13, minutes: 0 } } },
  { slotNumber: 4, time: { start: { hours: 13, minutes: 30 }, end: { hours: 14, minutes: 50 } } },
  { slotNumber: 5, time: { start: { hours: 15, minutes: 0 }, end: { hours: 16, minutes: 20 } } },
  { slotNumber: 6, time: { start: { hours: 16, minutes: 40 }, end: { hours: 18, minutes: 0 } } },
  { slotNumber: 7, time: { start: { hours: 18, minutes: 10 }, end: { hours: 19, minutes: 30 } } },
  { slotNumber: 8, time: { start: { hours: 19, minutes: 40 }, end: { hours: 21, minutes: 0 } } },
];

const SPO_TIME_SLOTS: StandardScheduleBlock[] = [
  { slotNumber: 1, time: { start: { hours: 8, minutes: 10 }, end: { hours: 9, minutes: 40 } } },
  { slotNumber: 2, time: { start: { hours: 9, minutes: 55 }, end: { hours: 11, minutes: 25 } } },
  { slotNumber: 3, time: { start: { hours: 11, minutes: 55 }, end: { hours: 13, minutes: 25 } } },
  { slotNumber: 4, time: { start: { hours: 13, minutes: 40 }, end: { hours: 15, minutes: 10 } } },
  { slotNumber: 5, time: { start: { hours: 15, minutes: 25 }, end: { hours: 16, minutes: 55 } } },
  { slotNumber: 6, time: { start: { hours: 17, minutes: 10 }, end: { hours: 18, minutes: 40 } } },
  { slotNumber: 7, time: { start: { hours: 18, minutes: 55 }, end: { hours: 20, minutes: 25 } } },
];

export function getStandardScheduleBlocks(
  educationLevel: EducationLevel,
): StandardScheduleBlock[] {
  return educationLevel === EducationLevel.VocationalEducation
    ? SPO_TIME_SLOTS
    : VO_TIME_SLOTS;
}
