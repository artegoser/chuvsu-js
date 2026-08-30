// Runtime-safe core for Node.js, browsers, Deno, and workers.

export * from "./tt/domain/index.js";

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
  EducationLevel,
  ParseError,
  AcademicPeriod,
} from "./common/types.js";
export type { Teacher, Time, WeekRange } from "./common/types.js";

export type { CacheAdapter, CacheEntry } from "./common/cache.js";

export type {
  CacheConfig,
  DirectoryPreloadOptions,
  EntityResolutionStrategy,
  Faculty,
  GetScheduleOptions,
  Group,
  LessonTimeSlot,
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
