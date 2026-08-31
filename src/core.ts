// Runtime-safe core for Node.js, browsers, Deno, and workers.

export * from "./tt/domain/index.js";
export { attachWebinars, findWebinar } from "./tt/webinars.js";
export type { LessonWithWebinar } from "./tt/webinars.js";

export {
  getAdjacentSemester,
  getCompensatingWorkDays,
  getCurrentPeriod,
  getEffectiveHolidays,
  getHolidayTransfers,
  getSemesterStart,
  getSemesterWeeks,
  getStandardScheduleBlocks,
  getWeekNumber,
  getWeekdayName,
  isHoliday,
  isSessionPeriod,
  RUSSIAN_HOLIDAYS,
} from "./tt/utils/index.js";
export type { Holiday, HolidayTransfer } from "./tt/utils/index.js";

export {
  AuthError,
  EducationLevel,
  ParseError,
  AcademicPeriod,
} from "./common/types.js";
export type { Teacher, Time, TimeRange, WeekRange } from "./common/types.js";

export type { CacheAdapter, CacheEntry } from "./common/cache.js";

export type {
  CacheConfig,
  DirectoryPreloadOptions,
  EntityResolutionStrategy,
  Faculty,
  GetScheduleOptions,
  Group,
  StandardScheduleBlock,
  Room,
  RoomInfo,
  SemesterWeek,
  TeacherInfo,
  TimetableClientOptions,
  Webinar,
} from "./tt/types.js";

export type {
  StudentPortalCacheConfig,
  StudentPortalClientOptions,
  StudentProfile,
} from "./lk/types.js";
