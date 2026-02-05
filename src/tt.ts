import { HttpClient } from "./http.js";
import { parseHtml, text, parseTime, parseWeeks, parseTeacher, parseWeekParity } from "./parse.js";
import type {
  Faculty,
  Group,
  FullScheduleDay,
  ScheduleEntry,
  Time,
} from "./types.js";
import { type Period, EducationType } from "./types.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;

const PERIOD_LABELS: Record<string, Period> = {
  "осенний семестр": 1 as Period,
  "зимняя сессия": 2 as Period,
  "весенний семестр": 3 as Period,
  "летняя сессия": 4 as Period,
};

export class TtClient {
  private http = new HttpClient();

  constructor(
    private email?: string,
    private password?: string,
    private educationType: EducationType = EducationType.HigherEducation,
  ) {}

  private get pertt(): string {
    return String(this.educationType);
  }

  async login(): Promise<boolean> {
    if (!this.email || !this.password) {
      throw new Error("Email and password required for login");
    }
    const res = await this.http.post(
      AUTH_URL,
      {
        wname: this.email,
        wpass: this.password,
        wauto: "1",
        auth: "Войти",
        hfac: "0",
        pertt: this.pertt,
      },
      false,
    );
    return res.status === 302;
  }

  async loginAsGuest(): Promise<boolean> {
    const res = await this.http.post(
      AUTH_URL,
      { guest: "Войти гостем", hfac: "0", pertt: this.pertt },
      false,
    );
    return res.status === 302;
  }

  async getFaculties(): Promise<Faculty[]> {
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

    return faculties;
  }

  async getGroupsForFaculty(facultyId: number): Promise<Group[]> {
    const { body } = await this.http.post(`${BASE}/`, {
      hfac: String(facultyId),
      pertt: this.pertt,
    });
    return parseGroupButtons(parseHtml(body));
  }

  async searchGroup(name: string): Promise<Group[]> {
    const { body } = await this.http.post(`${BASE}/`, {
      grname: name,
      findgr: "найти",
      hfac: "0",
      pertt: this.pertt,
    });
    return parseGroupButtons(parseHtml(body));
  }

  async searchTeacher(name: string): Promise<{ id: number; name: string }[]> {
    const { body } = await this.http.post(`${BASE}/`, {
      techname: name,
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

  async getGroupSchedule(groupId: number, period?: Period): Promise<FullScheduleDay[]> {
    const url = `${BASE}/index/grouptt/gr/${groupId}`;

    if (period !== undefined) {
      const { body } = await this.http.post(url, { htype: String(period) });
      return parseFullSchedule(body);
    }

    const { body } = await this.http.get(url);
    return parseFullSchedule(body);
  }

  async getCurrentPeriod(groupId: number): Promise<Period | null> {
    const { body } = await this.http.get(
      `${BASE}/index/grouptt/gr/${groupId}`,
    );
    return parsePeriodFromPage(body);
  }

  async getServerTime(): Promise<Time> {
    const { body } = await this.http.post(`${BASE}/index/gethtime`, {});
    return parseTime(body.trim());
  }
}

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
    const timeMatch = timeText.match(
      /\((\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\)/,
    );
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
  const teacherMatch = fullHtml.match(/<br\s*\/?>\s*([^<]+?)(?:<br|<\/td|<i|$)/);
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
