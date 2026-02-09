import {
  parseHtml,
  text,
  parseTime,
  parseWeeks,
  parseTeacher,
  parseWeekParity,
} from "../common/parse.js";
import type { Period } from "../common/types.js";
import type {
  Faculty,
  Group,
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
} from "./types.js";

const PERIOD_LABELS: Record<string, Period> = {
  "осенний семестр": 1 as Period,
  "зимняя сессия": 2 as Period,
  "весенний семестр": 3 as Period,
  "летняя сессия": 4 as Period,
};

export function parsePeriodFromPage(html: string): Period | null {
  const match = html.match(/идет\s+(.+?)\s*</i);
  if (!match) return null;
  const label = match[1].toLowerCase().trim();
  return PERIOD_LABELS[label] ?? null;
}

export function parseGroupButtons(html: string): Group[] {
  const doc = parseHtml(html);
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

export function parseFacultyButtons(html: string): Faculty[] {
  const doc = parseHtml(html);
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

export function parseTeacherButtons(
  html: string,
): { id: number; name: string }[] {
  const doc = parseHtml(html);
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

export function parseFullSchedule(html: string): FullScheduleDay[] {
  const doc = parseHtml(html);

  // Session layout has date-based cells with ids like "trd20251224"
  if (doc.querySelector('td[id^="trd2"]')) {
    return parseSessionSchedule(doc);
  }

  return parseSemesterSchedule(doc);
}

// --- Semester schedule parsing (weekday-based, repeating weekly) ---

function parseSemesterSchedule(doc: Document): FullScheduleDay[] {
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
      const entry = parseSemesterEntry(entryRow);
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

function parseSemesterEntry(el: Element): ScheduleEntry | null {
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

// --- Session schedule parsing (date-based, specific dates) ---

function parseSessionSchedule(doc: Document): FullScheduleDay[] {
  const days: FullScheduleDay[] = [];

  for (const dateCell of doc.querySelectorAll('td[id^="trd2"]')) {
    // Parse date from cell id: trd20251224 -> 2025-12-24
    const id = dateCell.getAttribute("id") ?? "";
    const dateMatch = id.match(/trd(\d{4})(\d{2})(\d{2})/);
    if (!dateMatch) continue;

    const year = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1;
    const dayNum = parseInt(dateMatch[3]);
    const date = new Date(year, month, dayNum);

    // Extract weekday from after <br>
    const cellHtml = dateCell.innerHTML ?? "";
    const brMatch = cellHtml.match(/<br\s*\/?>\s*(.+)/i);
    const weekday = brMatch ? brMatch[1].trim() : "";

    // Data cell is the next td.trdata sibling in the same row
    const row = dateCell.parentElement;
    if (!row) continue;
    const dataCell = row.querySelector("td.trdata:not(.trfd)");
    if (!dataCell) continue;

    // Parse entries
    const slots: FullScheduleSlot[] = [];
    let slotNumber = 1;

    for (const entryRow of dataCell.querySelectorAll("table tr")) {
      const td = entryRow.querySelector("td") ?? entryRow;
      const entry = parseSessionEntry(td);
      if (!entry) continue;

      slots.push({
        number: slotNumber++,
        timeStart: entry.timeStart,
        timeEnd: entry.timeEnd,
        entries: [entry.entry],
      });
    }

    if (slots.length > 0) {
      days.push({ weekday, date, slots });
    }
  }

  return days;
}

function parseSessionEntry(
  td: Element,
): { entry: ScheduleEntry; timeStart: { hours: number; minutes: number }; timeEnd: { hours: number; minutes: number } } | null {
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);
  if (!plainText) return null;

  // Subject from blue span
  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  // Room: text before the first <span
  const roomMatch = fullHtml.match(/^([^<]*?)\s*<span/);
  const room = roomMatch ? roomMatch[1].trim() : "";

  // Type: parenthesized text after </span>, case-insensitive
  const typeMatch = plainText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс\.?|Экз)\)/i);
  const type = typeMatch ? typeMatch[1].replace(/\.$/, "").toLowerCase() : "";

  // Time: after <br>, format HH:MM - HH:MM
  const timeMatch = fullHtml.match(
    /<br\s*\/?>\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/,
  );
  if (!timeMatch) return null;

  return {
    entry: {
      room,
      subject,
      type,
      weeks: { from: 0, to: 0 },
      teacher: { name: "" },
    },
    timeStart: parseTime(timeMatch[1]),
    timeEnd: parseTime(timeMatch[2]),
  };
}
