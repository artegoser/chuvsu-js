import { HttpClient } from "../common/http.js";
import { Cache } from "../common/cache.js";
import type { CacheEntry } from "../common/cache.js";
import { EducationType, AuthError, Period } from "../common/types.js";
import {
  parseGroupButtons,
  parseFacultyButtons,
  parseTeacherButtons,
  parseFullSchedule,
} from "./parse.js";
import {
  filterSlots,
  getMonday,
  getWeekdayName,
  getWeekNumber,
  getSemesterStart,
  getSemesterWeeks,
  slotsToLessons,
} from "./schedule.js";
import type {
  Faculty,
  Group,
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleFilter,
  Lesson,
  ScheduleWeekDay,
  TtClientOptions,
  CacheConfig,
} from "./types.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;

export class TtClient {
  private http = new HttpClient();
  private educationType: EducationType;
  private cache: Cache | null;

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
  }

  // --- Schedule ---

  async getGroupSchedule(opts: {
    groupId: number;
    period?: Period;
  }): Promise<FullScheduleDay[]> {
    const cacheKey = `${opts.groupId}:${opts.period ?? 0}`;
    const cached = this.cache?.get("schedule", cacheKey);
    if (cached) return cached as FullScheduleDay[];

    const url = `${BASE}/index/grouptt/gr/${opts.groupId}`;

    let body: string;
    if (opts.period !== undefined) {
      ({ body } = await this.http.post(url, { htype: String(opts.period) }));
    } else {
      ({ body } = await this.http.get(url));
    }

    const data = parseFullSchedule(body);
    this.cache?.set("schedule", cacheKey, data);
    return data;
  }

  private async getFilteredSlots(opts: {
    groupId: number;
    weekday: number;
    filter?: ScheduleFilter;
    period?: Period;
  }): Promise<FullScheduleSlot[]> {
    const schedule = await this.getGroupSchedule({
      groupId: opts.groupId,
      period: opts.period,
    });
    const dayName = getWeekdayName(opts.weekday);
    const day = schedule.find(
      (d) => d.weekday.toLowerCase() === dayName.toLowerCase(),
    );
    if (!day) return [];
    return filterSlots(day.slots, opts.filter);
  }

  private getDateForWeekday(
    weekday: number,
    period: Period,
    week?: number,
  ): Date {
    if (week != null) {
      const semesterStart = getSemesterStart({ period });
      const startMonday = getMonday(semesterStart);
      const date = new Date(startMonday);
      date.setDate(
        startMonday.getDate() +
          (week - 1) * 7 +
          (weekday === 0 ? 6 : weekday - 1),
      );
      return date;
    }
    const now = new Date();
    const currentDay = now.getDay();
    const diff = weekday - currentDay;
    const date = new Date(now);
    date.setDate(now.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  async getScheduleForDay(opts: {
    groupId: number;
    weekday: number;
    filter?: ScheduleFilter;
    period?: Period;
  }): Promise<Lesson[]> {
    const period = opts.period ?? this.getCurrentPeriod();
    const slots = await this.getFilteredSlots({
      groupId: opts.groupId,
      weekday: opts.weekday,
      filter: opts.filter,
      period,
    });
    const date = this.getDateForWeekday(
      opts.weekday,
      period,
      opts.filter?.week,
    );
    return slotsToLessons(slots, date);
  }

  async getScheduleForDate(opts: {
    groupId: number;
    date: Date;
    subgroup?: number;
    period?: Period;
  }): Promise<Lesson[]> {
    const weekday = opts.date.getDay();
    const period = opts.period ?? this.getCurrentPeriod({ date: opts.date });

    const effectiveFilter: ScheduleFilter = { subgroup: opts.subgroup };
    if (effectiveFilter.week == null) {
      effectiveFilter.week = getWeekNumber({ period, date: opts.date });
    }

    const slots = await this.getFilteredSlots({
      groupId: opts.groupId,
      weekday,
      filter: effectiveFilter,
      period,
    });
    return slotsToLessons(slots, opts.date);
  }

  async getScheduleForWeek(opts: {
    groupId: number;
    week?: number;
    filter?: ScheduleFilter;
    period?: Period;
  }): Promise<ScheduleWeekDay[]> {
    const period = opts.period ?? this.getCurrentPeriod();
    const week = opts.week ?? getWeekNumber({ period });

    const effectiveFilter: ScheduleFilter = { ...opts.filter, week };
    const semesterWeeks = getSemesterWeeks({ period, weekCount: week });
    const weekData = semesterWeeks.find((w) => w.week === week);
    const mondayDate = weekData ? weekData.start : new Date();

    const result: ScheduleWeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(mondayDate);
      date.setDate(mondayDate.getDate() + i);
      date.setHours(0, 0, 0, 0);

      const weekday = i === 6 ? 0 : i + 1;
      const slots = await this.getFilteredSlots({
        groupId: opts.groupId,
        weekday,
        filter: effectiveFilter,
        period,
      });

      result.push({ date, lessons: slotsToLessons(slots, date) });
    }
    return result;
  }

  async getCurrentLesson(opts: {
    groupId: number;
    subgroup?: number;
  }): Promise<Lesson | null> {
    const now = new Date();
    const lessons = await this.getScheduleForDate({
      groupId: opts.groupId,
      date: now,
      subgroup: opts.subgroup,
    });

    const timeMinutes = now.getHours() * 60 + now.getMinutes();

    for (const lesson of lessons) {
      const start = lesson.start.hours * 60 + lesson.start.minutes;
      const end = lesson.end.hours * 60 + lesson.end.minutes;
      if (timeMinutes >= start && timeMinutes <= end) {
        return lesson;
      }
    }

    return null;
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

    const { body } = await this.http.get(`${BASE}/`);
    const data = parseFacultyButtons(body);
    this.cache?.set("faculties", "all", data);
    return data;
  }

  async getGroupsForFaculty(opts: { facultyId: number }): Promise<Group[]> {
    const cacheKey = String(opts.facultyId);
    const cached = this.cache?.get("groups", cacheKey);
    if (cached) return cached as Group[];

    const { body } = await this.http.post(`${BASE}/`, {
      hfac: String(opts.facultyId),
      pertt: this.pertt,
    });
    const data = parseGroupButtons(body);
    this.cache?.set("groups", cacheKey, data);
    return data;
  }

  async searchGroup(opts: { name: string }): Promise<Group[]> {
    const { body } = await this.http.post(`${BASE}/`, {
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
    const { body } = await this.http.post(`${BASE}/`, {
      techname: opts.name,
      findtech: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseTeacherButtons(body);
  }
}
