export { LkClient } from "./lk/client.js";
export { TtClient } from "./tt/client.js";
export type { CacheEntry } from "./common/cache.js";
export {
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  getWeekdayName,
  filterSlots,
  slotsToLessons,
} from "./tt/schedule.js";
export { Period, EducationType, AuthError, ParseError } from "./common/types.js";
export type {
  Time,
  WeekRange,
  Teacher,
} from "./common/types.js";
export type {
  PersonalData,
} from "./lk/types.js";
export type {
  Faculty,
  Group,
  ScheduleEntry,
  FullScheduleSlot,
  FullScheduleDay,
  LessonTimeSlot,
  Lesson,
  LessonTime,
  ScheduleWeekDay,
  ScheduleFilter,
  SemesterWeek,
  TtClientOptions,
  CacheConfig,
} from "./tt/types.js";
