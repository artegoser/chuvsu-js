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
}

export interface StudentPortalClientOptions {
  cache?: number | StudentPortalCacheConfig;
  cacheAdapter?: CacheAdapter;
  blobAdapter?: BlobAdapter;
}
