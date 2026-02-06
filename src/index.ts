export { LkClient } from "./lk.js";
export { TtClient } from "./tt.js";
export {
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  getWeekdayName,
  filterSlots,
} from "./schedule.js";
export { Period, EducationType, AuthError, ParseError } from "./types.js";
export type {
  PersonalData,
  Time,
  WeekRange,
  Teacher,
  Faculty,
  Group,
  ScheduleEntry,
  FullScheduleSlot,
  FullScheduleDay,
  LessonTimeSlot,
  CurrentLesson,
  ScheduleFilter,
  SemesterWeek,
  TtClientOptions,
  CacheConfig,
} from "./types.js";
