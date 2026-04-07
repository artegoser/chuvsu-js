import { HttpClient, type HttpResponse } from "../common/http.js";
import { Cache } from "../common/cache.js";
import type { CacheEntry } from "../common/cache.js";
import { EducationType, AuthError, Period } from "../common/types.js";
import {
  parseAudienceButtons,
  parseAudienceFullSchedule,
  parseAudienceInfo,
  parseAudienceName,
  parseGroupButtons,
  parseFacultyButtons,
  parseTeacherButtons,
  parseFullSchedule,
  parseTeacherFullSchedule,
  parseTeacherInfo,
} from "./parse.js";
import { Schedule } from "./schedule.js";
import type {
  Audience,
  AudienceInfo,
  Faculty,
  Group,
  FullScheduleDay,
  TeacherInfo,
  TtClientOptions,
  CacheConfig,
} from "./types.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;

const ALL_PERIODS = [
  Period.FallSemester,
  Period.WinterSession,
  Period.SpringSemester,
  Period.SummerSession,
] as const;

export class TtClient {
  private http = new HttpClient();
  private educationType: EducationType;
  private cache: Cache | null;
  private loginMode:
    | { type: "credentials"; email: string; password: string }
    | { type: "guest" }
    | null = null;

  constructor(opts?: TtClientOptions) {
    this.educationType = opts?.educationType ?? EducationType.HigherEducation;

    if (opts?.cache == null) {
      this.cache = null;
    } else if (typeof opts.cache === "number") {
      this.cache = new Cache({
        schedule: opts.cache,
        faculties: opts.cache,
        groups: opts.cache,
      });
    } else {
      this.cache = new Cache(opts.cache as Record<string, number | undefined>);
    }
  }

  private get pertt(): string {
    return String(this.educationType);
  }

  // --- Cache ---

  clearCache(category?: keyof CacheConfig): void {
    this.cache?.clear(category);
  }

  exportCache(): Record<string, CacheEntry> {
    return this.cache?.export() ?? {};
  }

  importCache(data: Record<string, CacheEntry>): void {
    this.cache?.import(data);
  }

  // --- Auth ---

  async login(opts: { email: string; password: string }): Promise<void> {
    const res = await this.http.post(
      AUTH_URL,
      {
        wname: opts.email,
        wpass: opts.password,
        wauto: "1",
        auth: "Войти",
        hfac: "0",
        pertt: this.pertt,
      },
      false,
    );
    if (res.status !== 302) {
      throw new AuthError("TT login failed");
    }
    this.loginMode = { type: "credentials", ...opts };
  }

  async loginAsGuest(): Promise<void> {
    const res = await this.http.post(
      AUTH_URL,
      { guest: "Войти гостем", hfac: "0", pertt: this.pertt },
      false,
    );
    if (res.status !== 302) {
      throw new AuthError("TT guest login failed");
    }
    this.loginMode = { type: "guest" };
  }

  private isSessionExpired(body: string): boolean {
    return body.includes('name="wname"');
  }

  private async relogin(): Promise<void> {
    if (!this.loginMode) return;
    if (this.loginMode.type === "credentials") {
      await this.login(this.loginMode);
    } else {
      await this.loginAsGuest();
    }
  }

  private async authGet(url: string): Promise<HttpResponse> {
    const res = await this.http.get(url);
    if (this.loginMode && this.isSessionExpired(res.body)) {
      await this.relogin();
      return this.http.get(url);
    }
    return res;
  }

  private async authGetBuffer(url: string): Promise<Buffer> {
    return this.http.getBuffer(url);
  }

  private async authPost(
    url: string,
    data: Record<string, string>,
  ): Promise<HttpResponse> {
    const res = await this.http.post(url, data);
    if (this.loginMode && this.isSessionExpired(res.body)) {
      await this.relogin();
      return this.http.post(url, data);
    }
    return res;
  }

  // --- Schedule ---

  private async fetchSchedule(
    groupId: number,
    period: Period,
  ): Promise<FullScheduleDay[]> {
    const cacheKey = `${groupId}:${period}`;
    const cached = this.cache?.get("schedule", cacheKey);
    if (cached) return cached as FullScheduleDay[];

    const url = `${BASE}/index/grouptt/gr/${groupId}`;
    const { body } = await this.authPost(url, { htype: String(period) });
    const days = parseFullSchedule(body, this.educationType);
    this.cache?.set("schedule", cacheKey, days);
    return days;
  }

  /**
   * Get schedule for all periods. The returned Schedule automatically
   * routes queries to the correct period based on the date.
   */
  async getSchedule(groupId: number): Promise<Schedule> {
    const schedules = new Map<number, FullScheduleDay[]>();

    const results = await Promise.all(
      ALL_PERIODS.map(async (period) => {
        const days = await this.fetchSchedule(groupId, period);
        return { period, days };
      }),
    );

    for (const { period, days } of results) {
      schedules.set(period, days);
    }

    return new Schedule(groupId, schedules, undefined, this.educationType);
  }

  /**
   * Get schedule for a specific period only.
   */
  async getScheduleForPeriod(opts: {
    groupId: number;
    period: Period;
  }): Promise<Schedule> {
    const days = await this.fetchSchedule(opts.groupId, opts.period);
    const schedules = new Map<number, FullScheduleDay[]>();
    schedules.set(opts.period, days);
    return new Schedule(opts.groupId, schedules, opts.period, this.educationType);
  }

  // --- Search / Discovery ---

  async getFaculties(): Promise<Faculty[]> {
    const cached = this.cache?.get("faculties", "all");
    if (cached) return cached as Faculty[];

    const { body } = await this.authGet(`${BASE}/`);
    const data = parseFacultyButtons(body);
    this.cache?.set("faculties", "all", data);
    return data;
  }

  async getGroupsForFaculty(opts: { facultyId: number }): Promise<Group[]> {
    const cacheKey = String(opts.facultyId);
    const cached = this.cache?.get("groups", cacheKey);
    if (cached) return cached as Group[];

    const { body } = await this.authPost(`${BASE}/`, {
      hfac: String(opts.facultyId),
      pertt: this.pertt,
    });
    const data = parseGroupButtons(body);
    this.cache?.set("groups", cacheKey, data);
    return data;
  }

  async searchGroup(opts: { name: string }): Promise<Group[]> {
    const { body } = await this.authPost(`${BASE}/`, {
      grname: opts.name,
      findgr: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseGroupButtons(body);
  }

  /**
   * Search audiences by name (substring match). The server requires at
   * least 3 characters in the query.
   */
  async searchAudience(opts: { name: string }): Promise<Audience[]> {
    const { body } = await this.authPost(`${BASE}/`, {
      audname: opts.name,
      findaud: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseAudienceButtons(body);
  }

  /**
   * Get every audience known to the system in a single request.
   *
   * The site exposes only a search form ("at least 3 characters") and no
   * listing endpoint. However the query is passed to a SQL LIKE, so the
   * 3-character wildcard `%%%` matches every audience at once and returns
   * the full list of (id, name) pairs.
   */
  async getAudiences(): Promise<Audience[]> {
    const { body } = await this.authPost(`${BASE}/`, {
      audname: "%%%",
      findaud: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseAudienceButtons(body);
  }

  /**
   * Resolve an audience id from its exact name by searching and
   * selecting the button whose `value` equals the given name.
   */
  async findAudienceByName(opts: { name: string }): Promise<Audience | null> {
    const q = opts.name.length >= 3 ? opts.name : "%%%";
    const list = await this.searchAudience({ name: q });
    return list.find((a) => a.name === opts.name) ?? null;
  }

  /** Fetch the audience's display name from its schedule page. */
  async getAudienceName(audienceId: number): Promise<string | null> {
    const { body } = await this.authGet(
      `${BASE}/index/audtt/aud/${audienceId}`,
    );
    return parseAudienceName(body);
  }

  /**
   * Fetch detailed info about an audience (building, floor, usage,
   * image URLs for the audience photo, building photo and floor plan).
   */
  async getAudienceInfo(audienceId: number): Promise<AudienceInfo | null> {
    const cached = this.cache?.get("audienceInfo", String(audienceId));
    if (cached) return cached as AudienceInfo;

    const { body } = await this.authGet(
      `${BASE}/index/audtt/aud/${audienceId}`,
    );
    const info = parseAudienceInfo(body);
    if (info) this.cache?.set("audienceInfo", String(audienceId), info);
    return info;
  }

  private async fetchAudienceSchedule(
    audienceId: number,
    period: Period,
  ): Promise<FullScheduleDay[]> {
    const cacheKey = `audience:${audienceId}:${period}`;
    const cached = this.cache?.get("schedule", cacheKey);
    if (cached) return cached as FullScheduleDay[];

    const url = `${BASE}/index/audtt/aud/${audienceId}`;
    const { body } = await this.authPost(url, { htype: String(period) });
    const days = parseAudienceFullSchedule(body);
    this.cache?.set("schedule", cacheKey, days);

    // Cache audience info from the same page to avoid an extra request.
    if (!this.cache?.get("audienceInfo", String(audienceId))) {
      const info = parseAudienceInfo(body);
      if (info) this.cache?.set("audienceInfo", String(audienceId), info);
    }

    return days;
  }

  async getAudienceSchedule(audienceId: number): Promise<Schedule> {
    const schedules = new Map<number, FullScheduleDay[]>();

    const results = await Promise.all(
      ALL_PERIODS.map(async (period) => {
        const days = await this.fetchAudienceSchedule(audienceId, period);
        return { period, days };
      }),
    );

    for (const { period, days } of results) {
      schedules.set(period, days);
    }

    return new Schedule(audienceId, schedules, undefined, this.educationType);
  }

  async getAudienceScheduleForPeriod(opts: {
    audienceId: number;
    period: Period;
  }): Promise<Schedule> {
    const days = await this.fetchAudienceSchedule(opts.audienceId, opts.period);
    const schedules = new Map<number, FullScheduleDay[]>();
    schedules.set(opts.period, days);
    return new Schedule(opts.audienceId, schedules, opts.period, this.educationType);
  }

  /** Get the audience photo (audimage). Returns null if missing. */
  async getAudienceImage(audienceId: number): Promise<Buffer | null> {
    const info = await this.getAudienceInfo(audienceId);
    if (!info?.audImageUrl) return null;
    const buf = await this.authGetBuffer(`${BASE}${info.audImageUrl}`);
    return buf.length > 0 ? buf : null;
  }

  /** Get the building exterior image (blockimage). Returns null if missing. */
  async getAudienceBlockImage(audienceId: number): Promise<Buffer | null> {
    const info = await this.getAudienceInfo(audienceId);
    if (!info?.blockImageUrl) return null;
    const buf = await this.authGetBuffer(`${BASE}${info.blockImageUrl}`);
    return buf.length > 0 ? buf : null;
  }

  /** Get the floor plan image for the audience. Returns null if missing. */
  async getAudienceFloorplan(audienceId: number): Promise<Buffer | null> {
    const info = await this.getAudienceInfo(audienceId);
    if (!info?.floorplanUrl) return null;
    const buf = await this.authGetBuffer(`${BASE}${info.floorplanUrl}`);
    return buf.length > 0 ? buf : null;
  }

  async searchTeacher(opts: {
    name: string;
  }): Promise<{ id: number; name: string }[]> {
    const { body } = await this.authPost(`${BASE}/`, {
      techname: opts.name,
      findtech: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseTeacherButtons(body);
  }

  // --- Teacher schedule ---

  async getTeachers(): Promise<{ id: number; name: string }[]> {
    const cached = this.cache?.get("teachers", "all");
    if (cached) return cached as { id: number; name: string }[];

    const { body } = await this.authGet(`${BASE}/index/tech`);
    const data = parseTeacherButtons(body);
    this.cache?.set("teachers", "all", data);
    return data;
  }

  private async fetchTeacherSchedule(
    teacherId: number,
    period: Period,
  ): Promise<FullScheduleDay[]> {
    const cacheKey = `teacher:${teacherId}:${period}`;
    const cached = this.cache?.get("schedule", cacheKey);
    if (cached) return cached as FullScheduleDay[];

    const url = `${BASE}/index/techtt/tech/${teacherId}`;
    const { body } = await this.authPost(url, { htype: String(period) });
    const days = parseTeacherFullSchedule(body, this.educationType);
    this.cache?.set("schedule", cacheKey, days);

    // Cache teacher info from the same page to avoid extra requests
    if (!this.cache?.get("teacherInfo", String(teacherId))) {
      const info = parseTeacherInfo(body);
      if (info) this.cache?.set("teacherInfo", String(teacherId), info);
    }

    return days;
  }

  async getTeacherSchedule(teacherId: number): Promise<Schedule> {
    const schedules = new Map<number, FullScheduleDay[]>();

    const results = await Promise.all(
      ALL_PERIODS.map(async (period) => {
        const days = await this.fetchTeacherSchedule(teacherId, period);
        return { period, days };
      }),
    );

    for (const { period, days } of results) {
      schedules.set(period, days);
    }

    return new Schedule(teacherId, schedules, undefined, this.educationType, undefined, undefined, true);
  }

  async getTeacherScheduleForPeriod(opts: {
    teacherId: number;
    period: Period;
  }): Promise<Schedule> {
    const days = await this.fetchTeacherSchedule(opts.teacherId, opts.period);
    const schedules = new Map<number, FullScheduleDay[]>();
    schedules.set(opts.period, days);
    return new Schedule(opts.teacherId, schedules, opts.period, this.educationType, undefined, undefined, true);
  }

  async getTeacherInfo(teacherId: number): Promise<TeacherInfo | null> {
    const cached = this.cache?.get("teacherInfo", String(teacherId));
    if (cached) return cached as TeacherInfo;

    const url = `${BASE}/index/techtt/tech/${teacherId}`;
    const { body } = await this.authGet(url);
    const info = parseTeacherInfo(body);
    if (info) this.cache?.set("teacherInfo", String(teacherId), info);
    return info;
  }

  /**
   * Get the teacher's photo as a Buffer.
   * Returns null if the teacher has no photo.
   * Uses cached teacher info when available to avoid extra requests.
   */
  async getTeacherPhoto(teacherId: number): Promise<Buffer | null> {
    const photoCacheKey = String(teacherId);
    const cachedPhoto = this.cache?.get("teacherPhotos", photoCacheKey);
    if (cachedPhoto !== null && cachedPhoto !== undefined) {
      const entry = cachedPhoto as { data: string | null };
      return entry.data ? Buffer.from(entry.data, "base64") : null;
    }

    // Get teacher info (may already be cached from schedule fetch)
    const info = await this.getTeacherInfo(teacherId);
    if (!info?.photoUrl) {
      this.cache?.set("teacherPhotos", photoCacheKey, { data: null });
      return null;
    }

    const photoBuffer = await this.authGetBuffer(`${BASE}${info.photoUrl}`);
    this.cache?.set("teacherPhotos", photoCacheKey, {
      data: photoBuffer.toString("base64"),
    });
    return photoBuffer;
  }

  /**
   * Get the teacher's photo without parsing the schedule page.
   * Uses the known URL pattern directly — no extra page fetch needed.
   * Returns null if the teacher has no photo.
   */
  async getTeacherPhotoLazy(teacherId: number): Promise<Buffer | null> {
    const photoCacheKey = String(teacherId);
    const cachedPhoto = this.cache?.get("teacherPhotos", photoCacheKey);
    if (cachedPhoto !== null && cachedPhoto !== undefined) {
      const entry = cachedPhoto as { data: string | null };
      return entry.data ? Buffer.from(entry.data, "base64") : null;
    }

    const url = `${BASE}/index/photo/tech/${teacherId}/id/${teacherId}`;
    const photoBuffer = await this.authGetBuffer(url);

    if (photoBuffer.length === 0) {
      this.cache?.set("teacherPhotos", photoCacheKey, { data: null });
      return null;
    }

    this.cache?.set("teacherPhotos", photoCacheKey, {
      data: photoBuffer.toString("base64"),
    });
    return photoBuffer;
  }
}
