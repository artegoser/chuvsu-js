// Runtime-safe core for Node.js, browsers, Deno, and workers.

export * from "./tt/domain/index.js";
export { attachWebinars, findWebinar, findWebinars } from "./lk/webinars.js";
export type { LessonWithWebinar } from "./lk/webinars.js";
export type * from "./lk/portfolio-types.js";

export {
  getAdjacentSemester,
  getCompensatingWorkDays,
  getCurrentPeriod,
  getEffectiveHolidays,
  formatLocalDate,
  getHolidayTransfers,
  getSemesterStart,
  getSemesterWeeks,
  getStandardScheduleBlocks,
  getWeekNumber,
  getWeekdayName,
  isHoliday,
  isLocalDate,
  isSessionPeriod,
  LessonType,
  parseLessonType,
  parseLocalDate,
  RUSSIAN_HOLIDAYS,
} from "./tt/utils/index.js";
export type { Holiday, HolidayTransfer } from "./tt/utils/index.js";

export {
  AuthError,
  EducationLevel,
  ParseError,
  AcademicPeriod,
} from "./common/types.js";
export type {
  LocalDate,
  Teacher,
  Time,
  TimeRange,
  WeekRange,
} from "./common/types.js";

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
} from "./tt/types.js";

export type {
  StudentPortalCacheConfig,
  StudentPortalClientOptions,
  StudentProfile,
  Webinar,
  WebinarPage,
} from "./lk/types.js";
