// Shared exports that work in any environment (Node, browser, Deno).
// Both ./index.ts and ./browser.ts re-export everything from here and only
// add their platform-specific extras on top.

export { Schedule } from "./tt/schedule.js";

export { parseGroupsString } from "./tt/parse/index.js";

export {
  getAdjacentSemester,
  getCompensatingWorkDays,
  getCurrentPeriod,
  getEffectiveHolidays,
  getHolidayTransfers,
  getLessonNumber,
  getSemesterStart,
  getSemesterWeeks,
  getTimeSlots,
  getWeekNumber,
  getWeekdayName,
  isHoliday,
  isSessionPeriod,
  RUSSIAN_HOLIDAYS,
} from "./tt/utils/index.js";
export type { Holiday, HolidayTransfer } from "./tt/utils/index.js";

export {
  AuthError,
  EducationType,
  ParseError,
  Period,
} from "./common/types.js";
export type { Teacher, Time, WeekRange } from "./common/types.js";

export type { CacheEntry } from "./common/cache.js";

export type {
  Audience,
  AudienceInfo,
  CacheConfig,
  Faculty,
  FullScheduleDay,
  FullScheduleSlot,
  Group,
  Lesson,
  LessonTime,
  LessonTimeSlot,
  ScheduleEntry,
  SemesterWeek,
  SubstituteForInfo,
  Substitution,
  TeacherInfo,
  TransferInfo,
  TtClientOptions,
} from "./tt/types.js";

export type { LkCacheConfig, LkClientOptions, PersonalData } from "./lk/types.js";
