export { Schedule } from "./tt/schedule.js";
export {
  getCurrentPeriod,
  isSessionPeriod,
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  getWeekdayName,
} from "./tt/utils.js";
export { Period, EducationType } from "./common/types.js";
export type {
  Time,
  WeekRange,
  Teacher,
} from "./common/types.js";
export type {
  Faculty,
  Group,
  ScheduleEntry,
  FullScheduleSlot,
  FullScheduleDay,
  LessonTimeSlot,
  Lesson,
  LessonTime,
  SemesterWeek,
} from "./tt/types.js";
