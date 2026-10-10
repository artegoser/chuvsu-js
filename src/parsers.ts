export {
  parseAcademicYearFromPage,
  parseAvailablePeriodsFromPage,
  parseRoomButtons,
  parseRoomSchedule,
  parseRoomInfo,
  parseRoomName,
  parseFacultyButtons,
  parseGroupSchedule,
  parseGroupName,
  parseGroupButtons,
  parseGroupsString,
  parsePeriodFromPage,
  parseTeacherButtons,
  parseTeacherSchedule,
  parseTeacherInfo,
} from "./tt/parse/index.js";
export { createScheduleSourceSnapshot } from "./tt/observations.js";
export type {
  ParsedScheduleDay,
  ParsedLesson,
  ParsedScheduleBlock,
} from "./tt/types.js";
export { parseWebinars, parseWebinarPage } from "./lk/parse/webinars.js";
