import {
  parseHtml,
  text,
  parseTime,
  parseWeeks,
  parseTeacher,
  parseWeekParity,
} from "../common/parse.js";
import { type Period, EducationType, type Teacher } from "../common/types.js";
import type {
  Audience,
  AudienceInfo,
  Faculty,
  Group,
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
  Substitution,
  SubstituteForInfo,
  TransferInfo,
  TeacherInfo,
} from "./types.js";
import { getLessonNumber } from "./utils.js";

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

export function parseAudienceButtons(html: string): Audience[] {
  const results: Audience[] = [];
  const seen = new Set<number>();
  const re = /<button[^>]*\bname="aud(\d+)"[^>]*\bvalue="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = parseInt(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({ id, name: m[2] });
  }
  return results;
}

export function parseAudienceName(html: string): string | null {
  const m = html.match(
    /id="path"[\s\S]*?findaud[^>]*>[^<]*<\/a>([\s\S]*?)<\/div>/,
  );
  if (!m) return null;
  const tail = m[1]
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/^[\s/]+/, "")
    .trim();
  return tail || null;
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

export function parseFullSchedule(
  html: string,
  educationType?: EducationType,
): FullScheduleDay[] {
  const doc = parseHtml(html);
  const edType = educationType ?? EducationType.HigherEducation;

  // Session layout has date-based cells with ids like "trd20251224"
  if (doc.querySelector('td[id^="trd2"]')) {
    return parseSessionSchedule(doc, edType);
  }

  return parseSemesterSchedule(doc);
}

// --- Semester schedule parsing (weekday-based, repeating weekly) ---

function parseSemesterScheduleWith(
  doc: Document,
  entryParser: (el: Element) => ScheduleEntry | null,
): FullScheduleDay[] {
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
      const entry = entryParser(entryRow);
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

function parseSemesterSchedule(doc: Document): FullScheduleDay[] {
  return parseSemesterScheduleWith(doc, parseSemesterEntry);
}

function parseDate(dd: string, mm: string, yyyy: string): Date {
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
}

function parseTransferDiv(
  div: Element,
): { transfer: TransferInfo; entry: ScheduleEntry } | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*перенос\s*c\s*(\d{2})\.(\d{2})\.(\d{4})\s*\((\d+)\s*пара\)/,
  );
  if (!m) return null;

  const targetDate = parseDate(m[1], m[2], m[3]);
  const fromDate = parseDate(m[4], m[5], m[6]);
  const fromSlot = parseInt(m[7]);

  const subjectEl = div.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const roomMatch = divHtml.match(/([А-Яа-яA-Za-z]-\d+)/);
  const typeMatch = divText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  // Teacher: last text line that isn't a subgroup marker
  const parts = divHtml.split(/<br\s*\/?>/);
  let teacherPart = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const clean = parts[i].replace(/<[^>]*>/g, "").trim();
    if (clean && !/подгруппа/.test(clean)) {
      teacherPart = clean;
      break;
    }
  }

  const transfer: TransferInfo = { targetDate, fromDate, fromSlot, subject };
  const subgroupMatch = divText.match(/(\d+)\s*подгруппа/);

  return {
    transfer,
    entry: {
      room: roomMatch?.[1] ?? "",
      subject,
      type: typeMatch?.[1] ?? "",
      weeks: { from: 0, to: 0 },
      teacher: parseTeacher(teacherPart),
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      transfer,
    },
  };
}

function parseSubstitutionDiv(div: Element): Substitution | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(/(\d{2})\.(\d{2})\.(\d{4})\s*замена\s*на:/);
  if (!m) return null;

  const date = parseDate(m[1], m[2], m[3]);

  let room: string | undefined;
  let teacher: Teacher | undefined;

  const roomMatch = divHtml.match(
    /Аудитория:\s*<span[^>]*>([^<]+)<\/span>/,
  );
  if (roomMatch) room = roomMatch[1].trim();

  const teacherMatch = divHtml.match(
    /Преподаватель:\s*<span[^>]*>([^<]+)<\/span>/,
  );
  if (teacherMatch) teacher = parseTeacher(teacherMatch[1].trim());

  return { date, room, teacher };
}

function parseSubstituteForDiv(div: Element): {
  entry: ScheduleEntry;
} | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(/(\d{2})\.(\d{2})\.(\d{4})\s*замена\s*вместо:/);
  if (!m) return null;

  const date = parseDate(m[1], m[2], m[3]);

  // Original teacher: first blue span (right after "замена вместо:")
  const origTeacherMatch = divHtml.match(
    /замена\s*вместо:\s*<\/b><\/span>\s*<span[^>]*>([^<]+)<\/span>/,
  );
  const originalTeacher = origTeacherMatch
    ? parseTeacher(origTeacherMatch[1].trim())
    : { name: "" };

  // Subject: second blue span
  const subjectEl = div.querySelectorAll('span[style*="color: blue"]');
  let subject = "";
  for (const el of subjectEl) {
    const t = text(el);
    if (t && t !== origTeacherMatch?.[1]?.trim()) {
      subject = t;
      break;
    }
  }
  if (!subject) return null;

  const roomMatch = divHtml.match(/(?:<br\s*\/?>)\s*([А-Яа-яA-Za-z]-\d+)/);
  const typeMatch = divText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const groupsMatch = divHtml.match(
    /\((?:лк|пр|лб|зач|экз|зчО|кр|конс)\)\s*(?:<br\s*\/?>)\s*([^<]+?)(?:\s*<i|$)/,
  );
  const subgroupMatch = divText.match(/(\d+)\s*подгруппа/);

  return {
    entry: {
      room: roomMatch?.[1] ?? "",
      subject,
      type: typeMatch?.[1] ?? "",
      weeks: { from: 0, to: 0 },
      teacher: { name: "" },
      groups: groupsMatch?.[1]?.trim() ?? "",
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      substituteFor: { date, originalTeacher },
    },
  };
}

function parseSemesterEntry(el: Element): ScheduleEntry | null {
  const td = el.querySelector("td") ?? el;
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);

  if (!plainText) return null;

  const possibleChanges =
    (td.getAttribute("class") ?? "").includes("want") || undefined;

  // Detect red-bordered divs (transfers / substitutions)
  const redDivs = td.querySelectorAll(
    'div[style*="border: 2px solid red"]',
  );

  // Check for transfer (перенос) — the whole entry is the transferred lesson
  for (const div of redDivs) {
    const result = parseTransferDiv(div);
    if (result) {
      if (possibleChanges) result.entry.possibleChanges = true;
      return result.entry;
    }
  }

  // Collect substitutions (замена на)
  const substitutions: Substitution[] = [];
  for (const div of redDivs) {
    const sub = parseSubstitutionDiv(div);
    if (sub) substitutions.push(sub);
  }

  // Strip red divs from HTML/text before parsing the regular entry
  let cleanHtml = fullHtml;
  let cleanText = plainText;
  for (const div of redDivs) {
    cleanHtml = cleanHtml.replace(div.outerHTML ?? "", "");
    cleanText = cleanText.replace(text(div), "");
  }

  // Parse regular entry
  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const typeMatch = cleanText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const weeksMatch = cleanText.match(/\(([^)]*нед\.?[^)]*)\)/);
  const roomMatch = cleanHtml.match(
    /(?:<sup>[^<]*<\/sup>)?([А-Яа-яA-Za-z]-\d+)/,
  );
  const teacherMatch = cleanHtml.match(
    /<br\s*\/?>\s*([^<]+?)(?:<br|<\/td|<div|<i|$)/,
  );
  const subgroupMatch = cleanText.match(/(\d+)\s*подгруппа/);
  const weekParity = parseWeekParity(cleanHtml);

  return {
    room: roomMatch?.[1] ?? "",
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: parseTeacher(teacherMatch?.[1] ?? ""),
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    substitutions: substitutions.length > 0 ? substitutions : undefined,
    possibleChanges,
  };
}

// --- Session schedule parsing (date-based, specific dates) ---

function parseSessionSchedule(
  doc: Document,
  educationType: EducationType,
): FullScheduleDay[] {
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

    for (const entryRow of dataCell.querySelectorAll("table tr")) {
      const td = entryRow.querySelector("td") ?? entryRow;
      const entry = parseSessionEntry(td);
      if (!entry) continue;

      slots.push({
        number: getLessonNumber(entry.timeStart, educationType),
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

// --- Audience schedule & info parsing ---

export function parseAudienceInfo(html: string): AudienceInfo | null {
  const doc = parseHtml(html);

  // Name: <span class="htext"><nobr>Аудитория <span style="color: blue;">NAME</span></nobr></span>
  const nameEl = doc.querySelector('.htext span[style*="color: blue"]');
  const name = nameEl ? text(nameEl).trim() : "";
  if (!name) return null;

  // Details: <span class="htextb"> (Корпус Б; 3 этаж - Учебная лаборатория)</span>
  const detailsEl = doc.querySelector(".htextb");
  const details = detailsEl ? text(detailsEl).trim() : "";
  let building: string | undefined;
  let floor: number | undefined;
  let usage: string | undefined;

  if (details) {
    const buildingMatch = details.match(/Корпус\s+([^\s;,)]+)/i);
    if (buildingMatch) building = buildingMatch[1];
    const floorMatch = details.match(/(\d+)\s*этаж/i);
    if (floorMatch) floor = parseInt(floorMatch[1]);
    const usageMatch = details.match(/этаж\s*-\s*([^)]+?)\s*\)?\s*$/i);
    if (usageMatch) usage = usageMatch[1].trim();
  }

  const audImg = doc.querySelector("#audsrc");
  const blockImg = doc.querySelector("#blocksrc");
  const floorImg = doc.querySelector("#floorsrc");

  // Highlight rect from the image map: prefer the <area> whose id matches
  // the current audience (planaudNNNN); fall back to the first rect area.
  let floorplanRect: { x1: number; y1: number; x2: number; y2: number } | undefined;
  const areas = doc.querySelectorAll('map[name="flooraud"] area[shape="rect"]');
  let chosen: Element | undefined = undefined;
  for (const a of areas) {
    if (a.getAttribute("alt")?.trim() === name) {
      chosen = a;
      break;
    }
  }
  if (!chosen && areas.length > 0) chosen = areas[0];
  if (chosen) {
    const coords = chosen.getAttribute("coords") ?? "";
    const parts = coords.split(",").map((s) => parseInt(s.trim(), 10));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      floorplanRect = { x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] };
    }
  }

  return {
    name,
    building,
    floor,
    usage,
    audImageUrl: audImg?.getAttribute("src") || undefined,
    blockImageUrl: blockImg?.getAttribute("src") || undefined,
    floorplanUrl: floorImg?.getAttribute("src") || undefined,
    floorplanRect,
  };
}

function parseAudienceSemesterEntry(el: Element): ScheduleEntry | null {
  const td = el.querySelector("td") ?? el;
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);

  if (!plainText) return null;

  const possibleChanges =
    (td.getAttribute("class") ?? "").includes("want") || undefined;

  const redDivs = td.querySelectorAll(
    'div[style*="border: 2px solid red"]',
  );

  for (const div of redDivs) {
    const result = parseTransferDiv(div);
    if (result) {
      if (possibleChanges) result.entry.possibleChanges = true;
      return result.entry;
    }
  }

  for (const div of redDivs) {
    const result = parseSubstituteForDiv(div);
    if (result) {
      if (possibleChanges) result.entry.possibleChanges = true;
      return result.entry;
    }
  }

  const substitutions: Substitution[] = [];
  for (const div of redDivs) {
    const sub = parseSubstitutionDiv(div);
    if (sub) substitutions.push(sub);
  }

  let cleanHtml = fullHtml;
  let cleanText = plainText;
  for (const div of redDivs) {
    cleanHtml = cleanHtml.replace(div.outerHTML ?? "", "");
    cleanText = cleanText.replace(text(div), "");
  }

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const typeMatch = cleanText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const weeksMatch = cleanText.match(/\(([^)]*нед\.?[^)]*)\)/);
  const subgroupMatch = cleanText.match(/(\d+)\s*подгруппа/);
  const weekParity = parseWeekParity(cleanHtml);

  // Audience entries layout:
  //   <span blue>SUBJ</span> (TYPE) (WEEKS) <br>TEACHER<br>GROUPS
  // Teacher is the first line after </span>...<br>, groups is the next line.
  // We split on <br> after the blue subject span.
  const afterSubject = cleanHtml.split(/<\/span>/i).slice(1).join("</span>");
  const parts = afterSubject
    .split(/<br\s*\/?>/i)
    .map((p) => p.replace(/<[^>]*>/g, "").trim())
    .filter((p) => p.length > 0);

  // parts[0] = " (лк) (1 - 16 нед.) " — trailing metadata; drop tokens that
  // look like (type)/(weeks)/(N подгруппа). First real text line = teacher.
  const textLines: string[] = [];
  for (const p of parts) {
    const cleaned = p
      .replace(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/g, "")
      .replace(/\([^)]*нед\.?[^)]*\)/g, "")
      .replace(/\(\d+\s*подгруппа\)/g, "")
      .trim();
    if (cleaned) textLines.push(cleaned);
  }

  const teacherLine = textLines[0] ?? "";
  const groupsLine = textLines.slice(1).join(" ").trim();

  return {
    room: "",
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: parseTeacher(teacherLine),
    groups: groupsLine || undefined,
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    substitutions: substitutions.length > 0 ? substitutions : undefined,
    possibleChanges,
  };
}

export function parseAudienceFullSchedule(html: string): FullScheduleDay[] {
  const doc = parseHtml(html);
  return parseSemesterScheduleWith(doc, parseAudienceSemesterEntry);
}

// --- Teacher schedule parsing ---

export function parseTeacherFullSchedule(
  html: string,
  educationType?: EducationType,
): FullScheduleDay[] {
  const doc = parseHtml(html);
  const edType = educationType ?? EducationType.HigherEducation;

  if (doc.querySelector('td[id^="trd2"]')) {
    return parseTeacherSessionSchedule(doc, edType);
  }

  return parseSemesterScheduleWith(doc, parseTeacherSemesterEntry);
}

function parseTeacherSemesterEntry(el: Element): ScheduleEntry | null {
  const td = el.querySelector("td") ?? el;
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);

  if (!plainText) return null;

  const possibleChanges =
    (td.getAttribute("class") ?? "").includes("want") || undefined;

  const redDivs = td.querySelectorAll(
    'div[style*="border: 2px solid red"]',
  );

  for (const div of redDivs) {
    const result = parseTransferDiv(div);
    if (result) {
      if (possibleChanges) result.entry.possibleChanges = true;
      return result.entry;
    }
  }

  // Check for "замена вместо:" (substitute lesson for another teacher)
  for (const div of redDivs) {
    const result = parseSubstituteForDiv(div);
    if (result) {
      if (possibleChanges) result.entry.possibleChanges = true;
      return result.entry;
    }
  }

  const substitutions: Substitution[] = [];
  for (const div of redDivs) {
    const sub = parseSubstitutionDiv(div);
    if (sub) substitutions.push(sub);
  }

  let cleanHtml = fullHtml;
  let cleanText = plainText;
  for (const div of redDivs) {
    cleanHtml = cleanHtml.replace(div.outerHTML ?? "", "");
    cleanText = cleanText.replace(text(div), "");
  }

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const typeMatch = cleanText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const weeksMatch = cleanText.match(/\(([^)]*нед\.?[^)]*)\)/);
  const roomMatch = cleanHtml.match(
    /(?:<sup>[^<]*<\/sup>)?([А-Яа-яA-Za-z]-\d+)/,
  );
  const groupsMatch = cleanHtml.match(
    /<br\s*\/?>\s*([^<]+?)(?:<br|<\/td|<div|<i|$)/,
  );
  const subgroupMatch = cleanText.match(/(\d+)\s*подгруппа/);
  const weekParity = parseWeekParity(cleanHtml);

  return {
    room: roomMatch?.[1] ?? "",
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: { name: "" },
    groups: groupsMatch?.[1]?.trim().replace(/\s*\(\d+\s*подгруппа\)/, "") ?? "",
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    substitutions: substitutions.length > 0 ? substitutions : undefined,
    possibleChanges,
  };
}

function parseTeacherSessionSchedule(
  doc: Document,
  educationType: EducationType,
): FullScheduleDay[] {
  const days: FullScheduleDay[] = [];

  for (const dateCell of doc.querySelectorAll('td[id^="trd2"]')) {
    const id = dateCell.getAttribute("id") ?? "";
    const dateMatch = id.match(/trd(\d{4})(\d{2})(\d{2})/);
    if (!dateMatch) continue;

    const year = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1;
    const dayNum = parseInt(dateMatch[3]);
    const date = new Date(year, month, dayNum);

    const cellHtml = dateCell.innerHTML ?? "";
    const brMatch = cellHtml.match(/<br\s*\/?>\s*(.+)/i);
    const weekday = brMatch ? brMatch[1].trim() : "";

    const row = dateCell.parentElement;
    if (!row) continue;
    const dataCell = row.querySelector("td.trdata:not(.trfd)");
    if (!dataCell) continue;

    const slots: FullScheduleSlot[] = [];

    for (const entryRow of dataCell.querySelectorAll("table tr")) {
      const td = entryRow.querySelector("td") ?? entryRow;
      const entry = parseTeacherSessionEntry(td);
      if (!entry) continue;

      slots.push({
        number: getLessonNumber(entry.timeStart, educationType),
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

function parseTeacherSessionEntry(
  td: Element,
): { entry: ScheduleEntry; timeStart: { hours: number; minutes: number }; timeEnd: { hours: number; minutes: number } } | null {
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);
  if (!plainText) return null;

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const roomMatch = fullHtml.match(/^([^<]*?)\s*<span/);
  const room = roomMatch ? roomMatch[1].trim() : "";

  const typeMatch = plainText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс\.?|Экз)\)/i);
  const type = typeMatch ? typeMatch[1].replace(/\.$/, "").toLowerCase() : "";

  // Groups: text between </span> type and <br>time
  const groupsMatch = fullHtml.match(
    /\((?:лк|пр|лб|зач|экз|зчО|кр|конс\.?|Экз)\)\s*([^<]+?)\s*<br/i,
  );

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
      groups: groupsMatch?.[1]?.trim() ?? "",
    },
    timeStart: parseTime(timeMatch[1]),
    timeEnd: parseTime(timeMatch[2]),
  };
}

export function parseTeacherInfo(html: string): TeacherInfo | null {
  const doc = parseHtml(html);
  const nameEl = doc.querySelector(".htextb");
  if (!nameEl) return null;

  const nameHtml = nameEl.innerHTML ?? "";
  const nameMatch = nameHtml.match(/^([^<]+)/);
  const name = nameMatch?.[1]?.trim() ?? "";
  if (!name) return null;

  const degreeEl = nameEl.querySelector('span[style*="color: blue"]');
  const degree = degreeEl ? text(degreeEl).trim() : undefined;

  const deptEl = doc.querySelector(".htext");
  const department = deptEl ? text(deptEl).trim() : undefined;

  const photoImg = doc.querySelector("#photosrc");
  const photoUrl = photoImg?.getAttribute("src") || undefined;

  return { name, degree: degree || undefined, department: department || undefined, photoUrl };
}
