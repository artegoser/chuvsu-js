import { HttpClient, type HttpResponse } from "../common/http.js";
import { Cache } from "../common/cache.js";
import type { CacheEntry } from "../common/cache.js";
import { EducationType, AuthError, Period } from "../common/types.js";
import {
  parseGroupButtons,
  parseFacultyButtons,
  parseTeacherButtons,
  parseFullSchedule,
} from "./parse.js";
import { Schedule } from "./schedule.js";
import type {
  Faculty,
  Group,
  FullScheduleDay,
  TtClientOptions,
  CacheConfig,
} from "./types.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;

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

  async getSchedule(opts: {
    groupId: number;
    period?: Period;
  }): Promise<Schedule> {
    const period = opts.period ?? this.getCurrentPeriod();
    const cacheKey = `${opts.groupId}:${period}`;
    const cached = this.cache?.get("schedule", cacheKey);

    let days: FullScheduleDay[];
    if (cached) {
      days = cached as FullScheduleDay[];
    } else {
      const url = `${BASE}/index/grouptt/gr/${opts.groupId}`;

      let body: string;
      if (opts.period !== undefined) {
        ({ body } = await this.authPost(url, { htype: String(opts.period) }));
      } else {
        ({ body } = await this.authGet(url));
      }

      days = parseFullSchedule(body);
      this.cache?.set("schedule", cacheKey, days);
    }

    return new Schedule(opts.groupId, period, days);
  }

  // --- Period ---

  getCurrentPeriod(opts?: { date?: Date }): Period {
    const date = opts?.date ?? new Date();
    const month = date.getMonth();
    const day = date.getDate();

    // Dec 25+ and Jan → Winter session (зимняя сессия)
    if (month === 0 || (month === 11 && day >= 25)) return Period.WinterSession;
    // Feb–May → Spring semester (весенний семестр)
    if (month >= 1 && month <= 4) return Period.SpringSemester;
    // Jun–Aug → Summer session (летняя сессия)
    if (month >= 5 && month <= 7) return Period.SummerSession;
    // Sep – Dec 24 → Fall semester (осенний семестр)
    return Period.FallSemester;
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
}
