import { HttpClient } from "./http.js";
import {
  parseHtml,
  text,
  parseTime,
  parseWeeks,
  parseTeacher,
  parseWeekParity,
} from "./parse.js";

import type {
  Faculty,
  Group,
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
  ScheduleFilter,
  Lesson,
  ScheduleWeekDay,
  TtClientOptions,
  CacheConfig,
} from "./types.js";

import { type Period, EducationType, AuthError } from "./types.js";

import {
  filterSlots,
  getMonday,
  getWeekdayName,
  getWeekNumber,
  getSemesterStart,
  getSemesterWeeks,
  slotsToLessons,
} from "./schedule.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;

const PERIOD_LABELS: Record<string, Period> = {
  "осенний семестр": 1 as Period,
  "зимняя сессия": 2 as Period,
  "весенний семестр": 3 as Period,
  "летняя сессия": 4 as Period,
};

export interface CacheEntry {
  data: unknown;
  timestamp: number;
}

export class TtClient {
  private http = new HttpClient();
  private educationType: EducationType;
  private cacheTtls: CacheConfig | null;
  private cacheStore = new Map<string, CacheEntry>();

  constructor(opts?: TtClientOptions) {
    this.educationType = opts?.educationType ?? EducationType.HigherEducation;

    if (opts?.cache == null) {
      this.cacheTtls = null;
    } else if (typeof opts.cache === "number") {
      this.cacheTtls = {
        schedule: opts.cache,
        faculties: opts.cache,
        groups: opts.cache,
        currentPeriod: opts.cache,
      };
    } else {
      this.cacheTtls = opts.cache;
    }
  }

  private get pertt(): string {
    return String(this.educationType);
  }

  // --- Cache helpers ---

  private cacheGet(category: keyof CacheConfig, key: string): unknown | null {
    if (!this.cacheTtls) return null;
    const ttl = this.cacheTtls[category];
    if (ttl == null) return null;

    const entry = this.cacheStore.get(`${category}:${key}`);
    if (!entry) return null;

    if (ttl !== Infinity && Date.now() - entry.timestamp > ttl) {
      this.cacheStore.delete(`${category}:${key}`);
      return null;
    }

    return entry.data;
  }

  private cacheSet(
    category: keyof CacheConfig,
    key: string,
    data: unknown,
  ): void {
    if (!this.cacheTtls) return;
    if (this.cacheTtls[category] == null) return;
    this.cacheStore.set(`${category}:${key}`, {
      data,
      timestamp: Date.now(),
    });
  }

  clearCache(category?: keyof CacheConfig): void {
    if (!category) {
      this.cacheStore.clear();
      return;
    }
    const prefix = `${category}:`;
    for (const key of this.cacheStore.keys()) {
      if (key.startsWith(prefix)) {
        this.cacheStore.delete(key);
      }
    }
  }

  exportCache(): Record<string, CacheEntry> {
    return Object.fromEntries(this.cacheStore);
  }

  importCache(data: Record<string, CacheEntry>): void {
    for (const [key, entry] of Object.entries(data)) {
      this.cacheStore.set(key, entry);
    }
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
    const cached = this.cacheGet("schedule", cacheKey);
    if (cached) return cached as FullScheduleDay[];

    const url = `${BASE}/index/grouptt/gr/${opts.groupId}`;

    let body: string;
    if (opts.period !== undefined) {
      ({ body } = await this.http.post(url, { htype: String(opts.period) }));
    } else {
      ({ body } = await this.http.get(url));
    }

    const data = parseFullSchedule(body);
    this.cacheSet("schedule", cacheKey, data);
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
        startMonday.getDate() + week * 7 + (weekday === 0 ? 6 : weekday - 1),
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
    const period =
      opts.period ??
      (await this.getCurrentPeriod({ groupId: opts.groupId })) ??
      (1 as Period);
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
    filter?: ScheduleFilter;
    period?: Period;
  }): Promise<Lesson[]> {
    const weekday = opts.date.getDay();
    const period =
      opts.period ?? (await this.getCurrentPeriod({ groupId: opts.groupId }));

    const effectiveFilter: ScheduleFilter = { ...opts.filter };
    if (period && !effectiveFilter.week) {
      effectiveFilter.week = getWeekNumber({ period, date: opts.date });
    }

    const slots = await this.getFilteredSlots({
      groupId: opts.groupId,
      weekday,
      filter: effectiveFilter,
      period: period ?? undefined,
    });
    return slotsToLessons(slots, opts.date);
  }

  async getScheduleForWeek(opts: {
    groupId: number;
    week?: number;
    filter?: ScheduleFilter;
    period?: Period;
  }): Promise<ScheduleWeekDay[]> {
    const period =
      opts.period ??
      (await this.getCurrentPeriod({ groupId: opts.groupId })) ??
      (1 as Period);
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

      // weekday: 1=Mon, 2=Tue, ..., 6=Sat, 0=Sun
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
    filter?: ScheduleFilter;
  }): Promise<Lesson | null> {
    const now = new Date();
    const lessons = await this.getScheduleForDate({
      groupId: opts.groupId,
      date: now,
      filter: opts.filter,
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

  async getCurrentPeriod(opts: { groupId: number }): Promise<Period | null> {
    const cacheKey = String(opts.groupId);
    const cached = this.cacheGet("currentPeriod", cacheKey);
    if (cached !== null) return cached as Period;

    const { body } = await this.http.get(
      `${BASE}/index/grouptt/gr/${opts.groupId}`,
    );
    const period = parsePeriodFromPage(body);
    if (period !== null) {
      this.cacheSet("currentPeriod", cacheKey, period);
    }
    return period;
  }

  // --- Search / Discovery ---

  async getFaculties(): Promise<Faculty[]> {
    const cached = this.cacheGet("faculties", "all");
    if (cached) return cached as Faculty[];

    const { body } = await this.http.get(`${BASE}/`);
    const doc = parseHtml(body);
    const faculties: Faculty[] = [];

    for (const btn of doc.querySelectorAll(".facbut")) {
      const onclick = btn.getAttribute("onClick") ?? "";
      const idMatch = onclick.match(/val\((\d+)\)/);
      if (idMatch) {
        faculties.push({ id: parseInt(idMatch[1]), name: text(btn) });
      }
    }

    this.cacheSet("faculties", "all", faculties);
    return faculties;
  }

  async getGroupsForFaculty(opts: { facultyId: number }): Promise<Group[]> {
    const cacheKey = String(opts.facultyId);
    const cached = this.cacheGet("groups", cacheKey);
    if (cached) return cached as Group[];

    const { body } = await this.http.post(`${BASE}/`, {
      hfac: String(opts.facultyId),
      pertt: this.pertt,
    });
    const data = parseGroupButtons(parseHtml(body));
    this.cacheSet("groups", cacheKey, data);
    return data;
  }

  async searchGroup(opts: { name: string }): Promise<Group[]> {
    const { body } = await this.http.post(`${BASE}/`, {
      grname: opts.name,
      findgr: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseGroupButtons(parseHtml(body));
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
    const doc = parseHtml(body);
    const results: { id: number; name: string }[] = [];

    for (const btn of doc.querySelectorAll(".techbut")) {
      const onclick = btn.getAttribute("onClick") ?? "";
      const idMatch = onclick.match(/val\((\d+)\)/);
      if (idMatch) {
        results.push({
          id: parseInt(idMatch[1]),
          name: btn.getAttribute("value") ?? text(btn),
        });
      }
    }

    return results;
  }
}

// --- Internal parsing ---

function parsePeriodFromPage(html: string): Period | null {
  const match = html.match(/идет\s+(.+?)\s*</i);
  if (!match) return null;
  const label = match[1].toLowerCase().trim();
  return PERIOD_LABELS[label] ?? null;
}

function parseGroupButtons(doc: Document): Group[] {
  const groups: Group[] = [];
  for (const btn of doc.querySelectorAll("button[id^='gr']")) {
    const onclick = btn.getAttribute("onClick") ?? "";
    const idMatch = onclick.match(/val\((\d+)\)/);
    if (idMatch) {
      groups.push({
        id: parseInt(idMatch[1]),
        name: btn.getAttribute("value") ?? text(btn),
      });
    }
  }
  return groups;
}

function parseFullSchedule(html: string): FullScheduleDay[] {
  const doc = parseHtml(html);
  const days: FullScheduleDay[] = [];

  const rows = doc.querySelectorAll("tr");
  let currentDay: FullScheduleDay | null = null;

  for (const row of rows) {
    const style = row.getAttribute("style") ?? "";
    const cls = row.getAttribute("class") ?? "";

    if (style.includes("lightgray") && cls.includes("trfd")) {
      const dayName = text(row.querySelector("td"));
      if (dayName) {
        currentDay = { weekday: dayName, slots: [] };
        days.push(currentDay);
      }
      continue;
    }

    if (!currentDay) continue;

    const timeCell = row.querySelector("td.trf");
    const dataCell = row.querySelector("td.trdata:not(.trf)");
    if (!timeCell || !dataCell) continue;

    const timeDiv = timeCell.querySelector(".trfd");
    if (!timeDiv) continue;

    const timeText = text(timeDiv);
    const numberMatch = timeText.match(/(\d+)\s*пара/);
    const timeMatch = timeText.match(/\((\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\)/);
    if (!numberMatch) continue;

    const entries: ScheduleEntry[] = [];
    for (const entryRow of dataCell.querySelectorAll("table tr")) {
      const entry = parseScheduleEntry(entryRow);
      if (entry) entries.push(entry);
    }

    currentDay.slots.push({
      number: parseInt(numberMatch[1]),
      timeStart: parseTime(timeMatch?.[1] ?? "00:00"),
      timeEnd: parseTime(timeMatch?.[2] ?? "00:00"),
      entries,
    });
  }

  return days;
}

function parseScheduleEntry(el: Element): ScheduleEntry | null {
  const td = el.querySelector("td") ?? el;
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);

  if (!plainText) return null;

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const typeMatch = plainText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const weeksMatch = plainText.match(/\(([^)]*нед\.?[^)]*)\)/);
  const roomMatch = fullHtml.match(
    /(?:<sup>[^<]*<\/sup>)?([А-Яа-яA-Za-z]-\d+)/,
  );
  const teacherMatch = fullHtml.match(
    /<br\s*\/?>\s*([^<]+?)(?:<br|<\/td|<i|$)/,
  );
  const subgroupMatch = plainText.match(/(\d+)\s*подгруппа/);
  const weekParity = parseWeekParity(fullHtml);

  return {
    room: roomMatch?.[1] ?? "",
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: parseTeacher(teacherMatch?.[1] ?? ""),
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
  };
}
