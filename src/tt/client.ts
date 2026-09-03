import {
  HttpClient,
  type HttpBufferResponse,
  type HttpResponse,
} from "../common/http.js";
import { HybridCache } from "../common/cache.js";
import type { CacheEntry } from "../common/cache.js";
import {
  AcademicPeriod,
  AuthError,
  EducationLevel,
  ParseError,
} from "../common/types.js";
import {
  parseAcademicYearFromPage,
  parseRoomButtons,
  parseRoomSchedule,
  parseRoomInfo,
  parseRoomName,
  parseGroupButtons,
  parseGroupName,
  parseFacultyButtons,
  parseTeacherButtons,
  parseGroupSchedule,
  parseTeacherSchedule,
  parseTeacherInfo,
  parsePeriodFromPage,
  parseWebinars,
} from "./parse/index.js";
import { Schedule } from "./domain/schedule.js";
import { TimetableRepository } from "./domain/repository.js";
import { createScheduleSourceSnapshot } from "./observations.js";
import type {
  GroupRef,
  RoomRef,
  ScheduleOwner,
  TeacherRef,
  TimetableRepositorySnapshot,
} from "./domain/types.js";
import type {
  Room,
  RoomInfo,
  Faculty,
  Group,
  ParsedScheduleDay,
  TeacherInfo,
  TimetableClientOptions,
  CacheConfig,
  DirectoryPreloadOptions,
  EntityResolutionStrategy,
  GetScheduleOptions,
  Webinar,
} from "./types.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;
const TIMETABLE_CONTEXT_TTL_MS = 15 * 60 * 1000;

const ALL_PERIODS = [
  AcademicPeriod.FallSemester,
  AcademicPeriod.WinterSession,
  AcademicPeriod.SpringSemester,
  AcademicPeriod.SummerSession,
] as const;

function requirePositiveId(value: number | undefined, label: string): number {
  if (!Number.isInteger(value) || value == null || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeSearchQuery(
  value: string,
  label: string,
  minimumLength = 1,
): string {
  const normalized = value.trim();
  if (normalized.length < minimumLength) {
    throw new RangeError(`${label} must contain at least ${minimumLength} characters`);
  }
  return normalized;
}

function normalizePeriods(
  periods: readonly AcademicPeriod[] | undefined,
): AcademicPeriod[] {
  const values = [...(periods ?? ALL_PERIODS)];
  if (values.length === 0) throw new RangeError("At least one period is required");
  const unique = new Set<AcademicPeriod>();
  for (const period of values) {
    if (!ALL_PERIODS.includes(period)) {
      throw new RangeError(`Invalid academic period: ${period}`);
    }
    if (unique.has(period)) {
      throw new RangeError(`Duplicate academic period: ${period}`);
    }
    unique.add(period);
  }
  return values;
}

function makeUniformCacheConfig(ttl: number): CacheConfig {
  return {
    schedule: ttl,
    faculties: ttl,
    groups: ttl,
    rooms: ttl,
    roomNames: ttl,
    teachers: ttl,
    teacherInfo: ttl,
    teacherPhotos: ttl,
    roomInfo: ttl,
    roomImages: ttl,
    webinars: ttl,
  };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface CachedSchedulePage {
  days: ParsedScheduleDay[];
  ownerName: string;
}

export class TimetableClient {
  private http = new HttpClient();
  private educationLevel: EducationLevel;
  private cache: HybridCache | null;
  private blobAdapter = undefined as TimetableClientOptions["blobAdapter"];
  private _repository: TimetableRepository;
  private repositoryAdapter: TimetableClientOptions["repositoryAdapter"];
  private repositoryReady: Promise<void> | null = null;
  private repositoryMutation: Promise<void> = Promise.resolve();
  private loginMode:
    | { type: "credentials"; email: string; password: string }
    | { type: "guest" }
    | null = null;
  private timetableContext:
    | { academicYearStartYear: number; period: AcademicPeriod; resolvedAt: number }
    | null = null;

  constructor(opts?: TimetableClientOptions) {
    this.educationLevel = opts?.educationLevel ?? EducationLevel.HigherEducation;
    if (
      this.educationLevel !== EducationLevel.HigherEducation &&
      this.educationLevel !== EducationLevel.VocationalEducation
    ) {
      throw new RangeError("Invalid education level");
    }
    this.blobAdapter = opts?.blobAdapter;
    this._repository = opts?.repository ?? new TimetableRepository();
    this.repositoryAdapter = opts?.repositoryAdapter;

    if (opts?.cache == null) {
      this.cache = null;
    } else if (typeof opts.cache === "number") {
      this.cache = new HybridCache(
        makeUniformCacheConfig(opts.cache) as Record<string, number | undefined>,
        opts.cacheAdapter,
      );
    } else {
      this.cache = new HybridCache(
        opts.cache as Record<string, number | undefined>,
        opts.cacheAdapter,
      );
    }
  }

  private get pertt(): string {
    return String(this.educationLevel);
  }

  get repository(): TimetableRepository {
    return this._repository;
  }

  private async ensureRepository(): Promise<void> {
    if (!this.repositoryAdapter) return;
    if (!this.repositoryReady) {
      this.repositoryReady = (async () => {
        const snapshot = await this.repositoryAdapter!.load();
        if (snapshot && this._repository.revision === 0) {
          this._repository.replaceSnapshot(snapshot);
        }
      })();
    }
    await this.repositoryReady;
  }

  private async mutateRepository<T>(
    mutate: (repository: TimetableRepository) => T,
  ): Promise<T> {
    const operation = this.repositoryMutation.then(() =>
      this.performRepositoryMutation(mutate),
    );
    this.repositoryMutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performRepositoryMutation<T>(
    mutate: (repository: TimetableRepository) => T,
  ): Promise<T> {
    await this.ensureRepository();
    for (let attempt = 0; attempt < 4; attempt++) {
      const expectedRevision = this._repository.revision;
      const mutation = this._repository.capturePatch(() => mutate(this._repository));
      const result = mutation.result;
      if (!mutation.patch) return result;
      if (!this.repositoryAdapter) return result;
      let saved: boolean;
      if (this.repositoryAdapter.compareAndSetPatch) {
        saved = await this.repositoryAdapter.compareAndSetPatch(expectedRevision, mutation.patch);
      } else if (this.repositoryAdapter.compareAndSet) {
        saved = await this.repositoryAdapter.compareAndSet(
          expectedRevision,
          this._repository.export(),
        );
      } else {
        throw new Error("Timetable repository adapter cannot persist changes");
      }
      if (saved) {
        return result;
      }
      const latest = await this.repositoryAdapter.load();
      this._repository.replaceSnapshot(latest ?? {
        schemaVersion: 5,
        revision: 0,
        directory: { groups: [], teachers: [], rooms: [] },
        sources: [],
        links: [],
      });
    }
    throw new Error("Timetable repository update conflict");
  }

  async exportRepository(): Promise<TimetableRepositorySnapshot> {
    await this.ensureRepository();
    return this._repository.export();
  }

  private async rememberGroups(values: GroupRef[]): Promise<void> {
    await this.mutateRepository((repository) => repository.rememberGroups(values));
  }

  private async rememberTeachers(values: TeacherRef[]): Promise<void> {
    await this.mutateRepository((repository) =>
      repository.rememberTeachers(values),
    );
  }

  private async rememberRooms(values: RoomRef[]): Promise<void> {
    await this.mutateRepository((repository) => repository.rememberRooms(values));
  }

  // --- Cache ---

  async clearCache(category?: keyof CacheConfig): Promise<void> {
    await this.cache?.clear(category);
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
    this.timetableContext = null;
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
    this.timetableContext = null;
  }

  private isSessionExpired(body: string): boolean {
    return body.includes('name="wname"');
  }

  private isBinarySessionExpired(response: HttpBufferResponse): boolean {
    const prefix = response.body.subarray(0, 8_192).toString("utf8");
    return this.isSessionExpired(prefix);
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
    let res = await this.http.get(url);
    if (this.loginMode && this.isSessionExpired(res.body)) {
      await this.relogin();
      res = await this.http.get(url);
    }
    if (this.isSessionExpired(res.body)) {
      throw new AuthError("TT request returned an authentication page");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`TT request failed with HTTP ${res.status}: ${url}`);
    }
    return res;
  }

  private async authGetBuffer(url: string): Promise<Buffer> {
    let res = await this.http.getBufferResponse(url);
    if (this.loginMode && this.isBinarySessionExpired(res)) {
      await this.relogin();
      res = await this.http.getBufferResponse(url);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`TT request failed with HTTP ${res.status}: ${url}`);
    }
    if (this.isBinarySessionExpired(res)) {
      throw new AuthError("TT binary request returned an authentication page");
    }
    return res.body;
  }

  private async authPost(
    url: string,
    data: Record<string, string>,
  ): Promise<HttpResponse> {
    let res = await this.http.post(url, data);
    if (this.loginMode && this.isSessionExpired(res.body)) {
      await this.relogin();
      res = await this.http.post(url, data);
    }
    if (this.isSessionExpired(res.body)) {
      throw new AuthError("TT request returned an authentication page");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`TT request failed with HTTP ${res.status}: ${url}`);
    }
    return res;
  }

  /** Resolve the academic year and active period from tt.chuvsu.ru itself. */
  private async getTimetableContext(
    pageUrl: string,
  ): Promise<{ academicYearStartYear: number; period: AcademicPeriod }> {
    if (
      this.timetableContext &&
      Date.now() - this.timetableContext.resolvedAt < TIMETABLE_CONTEXT_TTL_MS
    ) {
      return this.timetableContext;
    }

    const { body } = await this.authGet(pageUrl);
    const academicYearStartYear = parseAcademicYearFromPage(body);
    if (academicYearStartYear == null) {
      throw new ParseError("TT page does not expose the current academic year");
    }

    const period = parsePeriodFromPage(body);
    if (period == null) {
      throw new ParseError("TT page does not expose the active timetable period");
    }

    const context = {
      academicYearStartYear,
      period,
      resolvedAt: Date.now(),
    };
    this.timetableContext = context;
    return context;
  }

  // --- Schedule ---

  private async fetchGroupSchedule(
    groupId: number,
    period: AcademicPeriod,
    academicYearStartYear: number,
  ): Promise<ParsedScheduleDay[]> {
    const cacheKey = `group:${groupId}:${period}:${academicYearStartYear}-${academicYearStartYear + 1}`;
    const cached = await this.cache?.get("schedule", cacheKey);
    if (cached) {
      const page = cached as CachedSchedulePage;
      await this.rememberGroups([{ id: groupId, name: page.ownerName }]);
      return page.days;
    }

    const url = `${BASE}/index/grouptt/gr/${groupId}`;
    const { body } = await this.authPost(url, { htype: String(period) });
    const ownerName = this.validateSchedulePage(
      { type: "group", group: { id: groupId, name: "" } },
      body,
      academicYearStartYear,
    );
    const days = parseGroupSchedule(body);
    await this.rememberGroups([{ id: groupId, name: ownerName }]);
    await this.cache?.set("schedule", cacheKey, { days, ownerName });
    return days;
  }

  private validateSchedulePage(
    owner: ScheduleOwner,
    html: string,
    academicYearStartYear: number,
  ): string {
    const pageYear = parseAcademicYearFromPage(html);
    if (pageYear !== academicYearStartYear) {
      throw new ParseError("TT schedule response has an unexpected academic year");
    }
    const ownerName = owner.type === "group"
      ? parseGroupName(html)
      : owner.type === "teacher"
        ? parseTeacherInfo(html)?.name ?? null
        : parseRoomName(html);
    if (!ownerName) {
      throw new ParseError(`TT ${owner.type} schedule response has no owner name`);
    }
    return ownerName;
  }

  private ownerUrl(owner: ScheduleOwner): string {
    if (owner.type === "group") {
      return `${BASE}/index/grouptt/gr/${requirePositiveId(owner.group.id, "Group ID")}`;
    }
    if (owner.type === "teacher") {
      return `${BASE}/index/techtt/tech/${requirePositiveId(owner.teacher.id, "Teacher ID")}`;
    }
    return `${BASE}/index/audtt/aud/${requirePositiveId(owner.room.id, "Room ID")}`;
  }

  private sourceKey(
    owner: ScheduleOwner,
    period: AcademicPeriod,
    academicYearStartYear: number,
  ): string {
    const entity =
      owner.type === "group"
        ? owner.group
        : owner.type === "teacher"
          ? owner.teacher
          : owner.room;
    return `${owner.type}:${entity.id}:${period}:${academicYearStartYear}`;
  }

  private resolveOwner(owner: ScheduleOwner): ScheduleOwner {
    if (owner.type === "group") {
      return {
        type: "group",
        group: this._repository.directory.resolveGroup(owner.group),
      };
    }
    if (owner.type === "teacher") {
      return {
        type: "teacher",
        teacher: this._repository.directory.resolveTeacher(owner.teacher),
      };
    }
    return {
      type: "room",
      room: this._repository.directory.resolveRoom(owner.room),
    };
  }

  private async fetchOwnerSchedule(
    owner: ScheduleOwner,
    period: AcademicPeriod,
    academicYearStartYear: number,
  ): Promise<ParsedScheduleDay[]> {
    if (owner.type === "group") {
      return this.fetchGroupSchedule(
        owner.group.id!,
        period,
        academicYearStartYear,
      );
    }
    if (owner.type === "teacher") {
      return this.fetchTeacherSchedule(
        owner.teacher.id!,
        period,
        academicYearStartYear,
      );
    }
    return this.fetchRoomSchedule(
      owner.room.id!,
      period,
      academicYearStartYear,
    );
  }

  async getSchedule(
    owner: ScheduleOwner,
    options?: GetScheduleOptions,
  ): Promise<Schedule> {
    const ownerUrl = this.ownerUrl(owner);
    const periods = normalizePeriods(options?.periods);
    await this.ensureRepository();
    if (owner.type === "group" && owner.group.name.trim()) {
      await this.rememberGroups([owner.group]);
    }
    if (owner.type === "teacher" && owner.teacher.name.trim()) {
      await this.rememberTeachers([owner.teacher]);
    }
    if (owner.type === "room" && owner.room.name.trim()) {
      await this.rememberRooms([owner.room]);
    }
    const resolvedOwner = this.resolveOwner(owner);
    const context = await this.getTimetableContext(ownerUrl);
    const results = await Promise.all(
      periods.map(async (period) => ({
        period,
        days: await this.fetchOwnerSchedule(
          resolvedOwner,
          period,
          context.academicYearStartYear,
        ),
      })),
    );

    await this.mutateRepository((repository) => {
      for (const result of results) {
        const currentOwner = this.resolveOwner(resolvedOwner);
        repository.ingest(createScheduleSourceSnapshot({
          sourceKey: this.sourceKey(
            currentOwner,
            result.period,
            context.academicYearStartYear,
          ),
          owner: currentOwner,
          academicYearStartYear: context.academicYearStartYear,
          period: result.period,
          days: result.days,
        }));
      }
    });

    return new Schedule(
      this._repository,
      this.resolveOwner(resolvedOwner),
      context.academicYearStartYear,
      { period: periods.length === 1 ? periods[0] : context.period },
    );
  }

  async getGroupSchedule(
    groupId: number,
    options?: GetScheduleOptions,
  ): Promise<Schedule> {
    return this.getSchedule(
      {
        type: "group",
        group: this._repository.directory.resolveGroup({ id: groupId, name: "" }),
      },
      options,
    );
  }

  async getWebinars(opts?: {
    date?: Date;
    facultyId?: number;
  }): Promise<Webinar[]> {
    const date = opts?.date ?? new Date();
    const facultyId = opts?.facultyId ?? 0;
    const cacheKey = `${formatDate(date)}:${facultyId}:${this.pertt}`;
    const cached = await this.cache?.get("webinars", cacheKey);
    if (cached) return cached as Webinar[];

    const { body } = await this.authPost(`${BASE}/webinar`, {
      seldate: formatDate(date),
      selfac: String(facultyId),
      pertt: this.pertt,
    });
    const data = parseWebinars(body);
    await this.cache?.set("webinars", cacheKey, data);
    return data;
  }

  async getWebinarJoinUrl(opts: {
    webinarId: string | number;
    idType?: number;
    email: string;
    password: string;
  }): Promise<string> {
    const { body } = await this.authPost(`${BASE}/webinar/getjoin`, {
      idw: String(opts.webinarId),
      idwt: String(opts.idType ?? 1),
      name: opts.email,
      pass: opts.password,
      auto: "1",
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new AuthError("TT webinar join failed: invalid response");
    }

    const data = parsed as { mes?: string; url?: string };
    if (data.mes !== "SUCCESS" || !data.url?.startsWith("http")) {
      throw new AuthError(data.mes ?? "TT webinar join failed");
    }
    return data.url;
  }

  // --- Search / Discovery ---

  async getFaculties(): Promise<Faculty[]> {
    const cached = await this.cache?.get("faculties", "all");
    if (cached) return cached as Faculty[];

    const { body } = await this.authGet(`${BASE}/`);
    const data = parseFacultyButtons(body);
    await this.cache?.set("faculties", "all", data);
    return data;
  }

  async getFacultyGroups(facultyId: number): Promise<Group[]> {
    requirePositiveId(facultyId, "Faculty ID");
    const cacheKey = String(facultyId);
    const cached = await this.cache?.get("groups", cacheKey);
    if (cached) {
      const data = cached as Group[];
      await this.rememberGroups(data);
      return data;
    }

    const { body } = await this.authPost(`${BASE}/`, {
      hfac: String(facultyId),
      pertt: this.pertt,
    });
    const data = parseGroupButtons(body);
    await this.cache?.set("groups", cacheKey, data);
    await this.rememberGroups(data);
    return data;
  }

  async searchGroups(name: string): Promise<GroupRef[]> {
    name = normalizeSearchQuery(name, "Group search query");
    const cacheKey = `search:${name}:${this.pertt}`;
    const cached = await this.cache?.get("groups", cacheKey);
    if (cached) {
      const data = cached as Group[];
      await this.rememberGroups(data);
      return data;
    }

    const { body } = await this.authPost(`${BASE}/`, {
      grname: name,
      findgr: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    const data = parseGroupButtons(body);
    await this.cache?.set("groups", cacheKey, data);
    await this.rememberGroups(data);
    return data;
  }

  /**
   * Search audiences by name (substring match). The server requires at
   * least 3 characters in the query.
   */
  async searchRooms(name: string): Promise<Room[]> {
    name = normalizeSearchQuery(name, "Room search query", 3);
    const cacheKey = `search:${name}:${this.pertt}`;
    const cached = await this.cache?.get("rooms", cacheKey);
    if (cached) {
      const data = cached as Room[];
      await this.rememberRooms(data);
      return data;
    }

    const { body } = await this.authPost(`${BASE}/`, {
      audname: name,
      findaud: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    const data = parseRoomButtons(body);
    await this.cache?.set("rooms", cacheKey, data);
    await this.rememberRooms(data);
    return data;
  }

  /**
   * Get every audience known to the system in a single request.
   *
   * The site exposes only a search form ("at least 3 characters") and no
   * listing endpoint. However the query is passed to a SQL LIKE, so the
   * 3-character wildcard `%%%` matches every audience at once and returns
   * the full list of (id, name) pairs.
   */
  async getRooms(): Promise<Room[]> {
    const cacheKey = `all:${this.pertt}`;
    const cached = await this.cache?.get("rooms", cacheKey);
    if (cached) {
      const data = cached as Room[];
      await this.rememberRooms(data);
      return data;
    }

    const { body } = await this.authPost(`${BASE}/`, {
      audname: "%%%",
      findaud: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    const data = parseRoomButtons(body);
    await this.cache?.set("rooms", cacheKey, data);
    await this.rememberRooms(data);
    return data;
  }

  async resolveGroup(
    value: string | GroupRef,
    options?: { strategy?: EntityResolutionStrategy },
  ): Promise<GroupRef> {
    await this.ensureRepository();
    const ref = typeof value === "string" ? { name: value } : value;
    let resolved = this._repository.directory.resolveGroup(ref);
    if (resolved.id == null && options?.strategy === "search") {
      await this.searchGroups(ref.name);
      resolved = this._repository.directory.resolveGroup(ref);
    }
    return resolved;
  }

  async resolveTeacher(
    value: string | TeacherRef,
    options?: { strategy?: EntityResolutionStrategy },
  ): Promise<TeacherRef> {
    await this.ensureRepository();
    const ref = typeof value === "string" ? { name: value } : value;
    let resolved = this._repository.directory.resolveTeacher(ref);
    if (resolved.id == null && options?.strategy === "search") {
      await this.searchTeachers(ref.name);
      resolved = this._repository.directory.resolveTeacher(ref);
    }
    return resolved;
  }

  async resolveRoom(
    value: string | RoomRef,
    options?: { strategy?: EntityResolutionStrategy },
  ): Promise<RoomRef> {
    await this.ensureRepository();
    const ref = typeof value === "string" ? { name: value } : value;
    let resolved = this._repository.directory.resolveRoom(ref);
    if (resolved.id == null && options?.strategy === "search") {
      await this.searchRooms(ref.name.length >= 3 ? ref.name : "%%%");
      resolved = this._repository.directory.resolveRoom(ref);
    }
    return resolved;
  }

  async preloadDirectory(options: DirectoryPreloadOptions): Promise<void> {
    const requests: Promise<unknown>[] = [];
    if (options.teachers) requests.push(this.getTeachers());
    if (options.rooms) requests.push(this.getRooms());
    for (const facultyId of options.facultyIds ?? []) {
      requests.push(this.getFacultyGroups(facultyId));
    }
    await Promise.all(requests);
  }

  /**
   * Resolve an audience id from its exact name by searching and
   * selecting the button whose `value` equals the given name.
   */
  async findRoomByName(name: string): Promise<Room | null> {
    name = normalizeSearchQuery(name, "Room name");
    const query = name.length >= 3 ? name : "%%%";
    const list = await this.searchRooms(query);
    return list.find((room) => room.name === name) ?? null;
  }

  /** Fetch the audience's display name from its schedule page. */
  async getRoomName(roomId: number): Promise<string | null> {
    requirePositiveId(roomId, "Room ID");
    const cacheKey = String(roomId);
    const cached = await this.cache?.get("roomNames", cacheKey);
    if (cached !== null && cached !== undefined) {
      const name = cached as string | null;
      if (name) await this.rememberRooms([{ id: roomId, name }]);
      return name;
    }

    const cachedInfo = await this.cache?.get("roomInfo", cacheKey);
    if (cachedInfo) {
      const name = (cachedInfo as RoomInfo).name ?? null;
      if (name) await this.rememberRooms([{ id: roomId, name }]);
      return name;
    }

    const { body } = await this.authGet(
      `${BASE}/index/audtt/aud/${roomId}`,
    );
    const name = parseRoomName(body);
    const info = parseRoomInfo(body);
    await this.cache?.set("roomNames", cacheKey, name);
    if (info) await this.cache?.set("roomInfo", cacheKey, info);
    if (name) await this.rememberRooms([{ id: roomId, name }]);
    return name;
  }

  /**
   * Fetch detailed info about an audience (building, floor, usage,
   * image URLs for the audience photo, building photo and floor plan).
   */
  async getRoomInfo(roomId: number): Promise<RoomInfo | null> {
    requirePositiveId(roomId, "Room ID");
    const cached = await this.cache?.get("roomInfo", String(roomId));
    if (cached) {
      const info = cached as RoomInfo;
      await this.rememberRooms([{ id: roomId, name: info.name }]);
      return info;
    }

    const { body } = await this.authGet(
      `${BASE}/index/audtt/aud/${roomId}`,
    );
    const info = parseRoomInfo(body);
    if (info) await this.cache?.set("roomInfo", String(roomId), info);
    if (info) await this.rememberRooms([{ id: roomId, name: info.name }]);
    return info;
  }

  private async fetchRoomSchedule(
    roomId: number,
    period: AcademicPeriod,
    academicYearStartYear: number,
  ): Promise<ParsedScheduleDay[]> {
    const cacheKey = `room:${roomId}:${period}:${academicYearStartYear}-${academicYearStartYear + 1}`;
    const cached = await this.cache?.get("schedule", cacheKey);
    if (cached) {
      const page = cached as CachedSchedulePage;
      await this.rememberRooms([{ id: roomId, name: page.ownerName }]);
      return page.days;
    }

    const url = `${BASE}/index/audtt/aud/${roomId}`;
    const { body } = await this.authPost(url, { htype: String(period) });
    const ownerName = this.validateSchedulePage(
      { type: "room", room: { id: roomId, name: "" } },
      body,
      academicYearStartYear,
    );
    const days = parseRoomSchedule(body);
    await this.rememberRooms([{ id: roomId, name: ownerName }]);
    await this.cache?.set("schedule", cacheKey, { days, ownerName });

    // Cache audience info from the same page to avoid an extra request.
    if (!(await this.cache?.get("roomInfo", String(roomId)))) {
      const info = parseRoomInfo(body);
      if (info) await this.cache?.set("roomInfo", String(roomId), info);
      if (info) await this.rememberRooms([{ id: roomId, name: info.name }]);
    }

    return days;
  }

  async getRoomSchedule(
    roomId: number,
    options?: GetScheduleOptions,
  ): Promise<Schedule> {
    return this.getSchedule(
      {
        type: "room",
        room: this._repository.directory.resolveRoom({ id: roomId, name: "" }),
      },
      options,
    );
  }

  private async getCachedRoomImage(
    cacheKey: string,
    fetchUrl: () => Promise<string | undefined>,
  ): Promise<Buffer | null> {
    const cached =
      this.cache?.getLocal("roomImages", cacheKey) ??
      await this.cache?.get("roomImages", cacheKey);
    if (cached !== null && cached !== undefined) {
      const entry = cached as { data?: string | null; blobKey?: string };
      if (entry.data !== undefined) {
        return entry.data ? Buffer.from(entry.data, "base64") : null;
      }
      if (entry.blobKey && this.blobAdapter) {
        const buf = await this.blobAdapter.get(entry.blobKey);
        if (buf) {
          this.cache?.setLocal("roomImages", cacheKey, {
            data: buf.toString("base64"),
          });
          return buf;
        }
      }
    }

    const url = await fetchUrl();
    if (!url) {
      await this.cache?.set("roomImages", cacheKey, { data: null });
      return null;
    }

    const buf = await this.authGetBuffer(`${BASE}${url}`);
    if (buf.length === 0) {
      await this.cache?.set("roomImages", cacheKey, { data: null });
      return null;
    }

    if (this.blobAdapter) {
      const blobKey = `tt/room-images/${cacheKey}`;
      this.cache?.setLocal("roomImages", cacheKey, {
        data: buf.toString("base64"),
      });
      await this.blobAdapter.put(blobKey, buf, {
        ttl: this.cache?.ttl("roomImages"),
      });
      await this.cache?.setExternal("roomImages", cacheKey, { blobKey });
    } else {
      await this.cache?.set("roomImages", cacheKey, {
        data: buf.toString("base64"),
      });
    }
    return buf;
  }

  /** Get the audience photo (audimage). Returns null if missing. */
  async getRoomImage(roomId: number): Promise<Buffer | null> {
    requirePositiveId(roomId, "Room ID");
    return this.getCachedRoomImage(
      `room:${roomId}`,
      async () => (await this.getRoomInfo(roomId))?.audImageUrl,
    );
  }

  /** Get the building exterior image (blockimage). Returns null if missing. */
  async getRoomBuildingImage(roomId: number): Promise<Buffer | null> {
    requirePositiveId(roomId, "Room ID");
    return this.getCachedRoomImage(
      `block:${roomId}`,
      async () => (await this.getRoomInfo(roomId))?.blockImageUrl,
    );
  }

  /** Get the floor plan image for the audience. Returns null if missing. */
  async getRoomFloorPlan(roomId: number): Promise<Buffer | null> {
    requirePositiveId(roomId, "Room ID");
    return this.getCachedRoomImage(
      `floor:${roomId}`,
      async () => (await this.getRoomInfo(roomId))?.floorplanUrl,
    );
  }

  async searchTeachers(name: string): Promise<TeacherRef[]> {
    name = normalizeSearchQuery(name, "Teacher search query");
    const cacheKey = `search:${name}:${this.pertt}`;
    const cached = await this.cache?.get("teachers", cacheKey);
    if (cached) {
      const data = cached as Array<{ id: number; name: string }>;
      await this.rememberTeachers(data);
      return data;
    }

    const { body } = await this.authPost(`${BASE}/`, {
      techname: name,
      findtech: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    const data = parseTeacherButtons(body);
    await this.cache?.set("teachers", cacheKey, data);
    await this.rememberTeachers(data);
    return data;
  }

  // --- Teacher schedule ---

  async getTeachers(): Promise<{ id: number; name: string }[]> {
    const cached = await this.cache?.get("teachers", "all");
    if (cached) {
      const data = cached as TeacherRef[];
      await this.rememberTeachers(data);
      return data as Array<{ id: number; name: string }>;
    }

    const { body } = await this.authGet(`${BASE}/index/tech`);
    const data = parseTeacherButtons(body);
    await this.cache?.set("teachers", "all", data);
    await this.rememberTeachers(data);
    return data;
  }

  private async fetchTeacherSchedule(
    teacherId: number,
    period: AcademicPeriod,
    academicYearStartYear: number,
  ): Promise<ParsedScheduleDay[]> {
    const cacheKey = `teacher:${teacherId}:${period}:${academicYearStartYear}-${academicYearStartYear + 1}`;
    const cached = await this.cache?.get("schedule", cacheKey);
    if (cached) {
      const page = cached as CachedSchedulePage;
      await this.rememberTeachers([{ id: teacherId, name: page.ownerName }]);
      return page.days;
    }

    const url = `${BASE}/index/techtt/tech/${teacherId}`;
    const { body } = await this.authPost(url, { htype: String(period) });
    const ownerName = this.validateSchedulePage(
      { type: "teacher", teacher: { id: teacherId, name: "" } },
      body,
      academicYearStartYear,
    );
    const days = parseTeacherSchedule(body);
    await this.rememberTeachers([{ id: teacherId, name: ownerName }]);
    await this.cache?.set("schedule", cacheKey, { days, ownerName });

    // Cache teacher info from the same page to avoid extra requests
    if (!(await this.cache?.get("teacherInfo", String(teacherId)))) {
      const info = parseTeacherInfo(body);
      if (info) await this.cache?.set("teacherInfo", String(teacherId), info);
      if (info) {
        await this.rememberTeachers([
          {
            id: teacherId,
            name: info.name,
            degree: info.degree,
          },
        ]);
      }
    }

    return days;
  }

  async getTeacherSchedule(
    teacherId: number,
    options?: GetScheduleOptions,
  ): Promise<Schedule> {
    return this.getSchedule(
      {
        type: "teacher",
        teacher: this._repository.directory.resolveTeacher({
          id: teacherId,
          name: "",
        }),
      },
      options,
    );
  }


  async getTeacherInfo(teacherId: number): Promise<TeacherInfo | null> {
    requirePositiveId(teacherId, "Teacher ID");
    const cached = await this.cache?.get("teacherInfo", String(teacherId));
    if (cached) {
      const info = cached as TeacherInfo;
      await this.rememberTeachers([
        { id: teacherId, name: info.name, degree: info.degree },
      ]);
      return info;
    }

    const url = `${BASE}/index/techtt/tech/${teacherId}`;
    const { body } = await this.authGet(url);
    const info = parseTeacherInfo(body);
    if (info) await this.cache?.set("teacherInfo", String(teacherId), info);
    if (info) {
      await this.rememberTeachers([
        { id: teacherId, name: info.name, degree: info.degree },
      ]);
    }
    return info;
  }

  /**
   * Get teacher photo directly by known URL pattern.
   * Does not fetch or parse teacher info first.
   * Returns null if the teacher has no photo.
   */
  async getTeacherPhoto(teacherId: number): Promise<Buffer | null> {
    requirePositiveId(teacherId, "Teacher ID");
    const photoCacheKey = String(teacherId);
    const cachedPhoto =
      this.cache?.getLocal("teacherPhotos", photoCacheKey) ??
      await this.cache?.get("teacherPhotos", photoCacheKey);
    if (cachedPhoto !== null && cachedPhoto !== undefined) {
      const entry = cachedPhoto as { data?: string | null; blobKey?: string };
      if (entry.data !== undefined) {
        return entry.data ? Buffer.from(entry.data, "base64") : null;
      }
      if (entry.blobKey && this.blobAdapter) {
        const buf = await this.blobAdapter.get(entry.blobKey);
        if (buf) {
          this.cache?.setLocal("teacherPhotos", photoCacheKey, {
            data: buf.toString("base64"),
          });
          return buf;
        }
      }
    }

    const url = `${BASE}/index/photo/tech/${teacherId}/id/${teacherId}`;
    const photoBuffer = await this.authGetBuffer(url);

    if (photoBuffer.length === 0) {
      await this.cache?.set("teacherPhotos", photoCacheKey, { data: null });
      return null;
    }

    if (this.blobAdapter) {
      const blobKey = `tt/teacher-photos/${teacherId}`;
      this.cache?.setLocal("teacherPhotos", photoCacheKey, {
        data: photoBuffer.toString("base64"),
      });
      await this.blobAdapter.put(blobKey, photoBuffer, {
        ttl: this.cache?.ttl("teacherPhotos"),
      });
      await this.cache?.setExternal("teacherPhotos", photoCacheKey, { blobKey });
    } else {
      await this.cache?.set("teacherPhotos", photoCacheKey, {
        data: photoBuffer.toString("base64"),
      });
    }
    return photoBuffer;
  }
}
