export { LkClient } from "./lk/client.js";
export { TtClient } from "./tt/client.js";
export { Schedule } from "./tt/schedule.js";
export type { CacheEntry } from "./common/cache.js";
export {
  getCurrentPeriod,
  isSessionPeriod,
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  getWeekdayName,
  getTimeSlots,
  getLessonNumber,
  getAdjacentSemester,
  isHoliday,
  getEffectiveHolidays,
  getHolidayTransfers,
  getCompensatingWorkDays,
  RUSSIAN_HOLIDAYS,
} from "./tt/utils.js";
export type { Holiday, HolidayTransfer } from "./tt/utils.js";
export {
  Period,
  EducationType,
  AuthError,
  ParseError,
} from "./common/types.js";
export type { Time, WeekRange, Teacher } from "./common/types.js";
export type { PersonalData } from "./lk/types.js";
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
  Substitution,
  SubstituteForInfo,
  TransferInfo,
  TeacherInfo,
  TtClientOptions,
  CacheConfig,
} from "./tt/types.js";
