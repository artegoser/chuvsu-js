import { HttpClient } from "./http.js";
import { parseHtml, text, parseTime, parseWeeks, parseTeacher } from "./parse.js";
import type {
  Faculty,
  Group,
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
  Teacher,
} from "./types.js";

const BASE = "https://tt.chuvsu.ru";
const AUTH_URL = `${BASE}/auth`;

export class TtClient {
  private http = new HttpClient();

  constructor(
    private email?: string,
    private password?: string,
  ) {}

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
        pertt: "1",
      },
      false,
    );
    return res.status === 302;
  }

  async loginAsGuest(): Promise<boolean> {
    const res = await this.http.post(
      AUTH_URL,
      { guest: "Войти гостем", hfac: "0", pertt: "1" },
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
      pertt: "1",
    });
    return parseGroupButtons(parseHtml(body));
  }

  async searchGroup(name: string): Promise<Group[]> {
    const { body } = await this.http.post(`${BASE}/`, {
      grname: name,
      findgr: "найти",
      hfac: "0",
      pertt: "1",
    });
    return parseGroupButtons(parseHtml(body));
  }

  async searchTeacher(name: string): Promise<{ id: number; name: string }[]> {
    const { body } = await this.http.post(`${BASE}/`, {
      techname: name,
      findtech: "найти",
      hfac: "0",
      pertt: "1",
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

  async getGroupSchedule(groupId: number): Promise<FullScheduleDay[]> {
    const { body } = await this.http.get(
      `${BASE}/index/grouptt/gr/${groupId}`,
    );
    return parseFullSchedule(body);
  }
}

/** Parse group buttons: <button name="gr{id}" value="{name}" onClick='$("#hgr").val({id});...'> */
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

    // Day header: lightgray background + trfd class
    if (style.includes("lightgray") && cls.includes("trfd")) {
      const dayName = text(row.querySelector("td"));
      if (dayName) {
        currentDay = { weekday: dayName, slots: [] };
        days.push(currentDay);
      }
      continue;
    }

    if (!currentDay) continue;

    // Lesson row: first td has class "trf"
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

  // Subject: <span style="color: blue;">...</span>
  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  // Type: (лк), (пр), (лб), etc.
  const typeMatch = plainText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);

  // Weeks: (N нед.) or (N - M нед.)
  const weeksMatch = plainText.match(/\(([^)]*нед\.?[^)]*)\)/);

  // Room: letter-digits pattern like Г-402, И-208, Е-115, Б-314
  const roomMatch = fullHtml.match(
    /(?:<sup>[^<]*<\/sup>)?([А-Яа-яA-Za-z]-\d+)/,
  );

  // Teacher: after first <br>, text before next <br> or <i>
  const teacherMatch = fullHtml.match(/<br\s*\/?>\s*([^<]+?)(?:<br|<\/td|<i|$)/);

  // Subgroup: number before "подгруппа"
  const subgroupMatch = plainText.match(/(\d+)\s*подгруппа/);

  return {
    room: roomMatch?.[1] ?? "",
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: parseTeacher(teacherMatch?.[1] ?? ""),
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
  };
}
