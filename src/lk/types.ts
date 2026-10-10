import type { LocalDate, Teacher, TimeRange } from "../common/types.js";
import type { BlobAdapter, CacheAdapter } from "../common/cache.js";

export interface StudentProfile {
  lastName: string;
  firstName: string;
  patronymic: string;
  sex: string;
  birthday: string;
  recordBookNumber: string;
  faculty: string;
  specialty: string;
  profile: string;
  group: string;
  course: string;
  email: string;
  phone: string;
}

export interface StudentPortalCacheConfig {
  profile?: number;
  profilePhoto?: number;
  timetableGroupId?: number;
  webinars?: number;
  portfolio?: number;
}

export interface StudentPortalClientOptions {
  cache?: number | StudentPortalCacheConfig;
  cacheAdapter?: CacheAdapter;
  blobAdapter?: BlobAdapter;
}

/** A row from LK's personal webinar page, including unavailable meetings. */
export interface Webinar {
  /** Null when LK does not expose a join button. Never a timetable ID. */
  id: string | null;
  scheduled: boolean;
  scheduledDate?: LocalDate;
  slotNumber?: number;
  time: TimeRange;
  subject: string;
  type: string;
  teacher: Teacher;
  groups: string[];
  subgroup?: number;
  title: string;
  raw: string;
  server: string;
  completedAt: string | null;
  joinAvailable: boolean;
}

export interface WebinarPage {
  /** Selected date reported by LK; never inferred from the machine timezone. */
  date?: LocalDate;
  availableDates: LocalDate[];
  webinars: Webinar[];
}
