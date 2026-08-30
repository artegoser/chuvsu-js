import {
  parseHtml,
  parseTeacher,
  parseTime,
  parseWeekParity,
  parseWeeks,
  text,
} from "../../common/parse.js";
import { EducationType } from "../../common/types.js";
import type {
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
  Substitution,
} from "../types.js";
import { getLessonNumber } from "../utils/index.js";
import {
  parseSubstitutionDiv,
  parseTransferDiv,
} from "./overlays.js";
import {
  FLEXIBLE_LESSON_TYPE_RE_I,
  LESSON_TYPE_RE,
  SUBGROUP_RE,
  WEEKS_RE,
} from "./patterns.js";
import {
  containsGroupCode,
  linesAfterSubject,
  parseEntryRoom,
  stripDistanceMarker,
} from "./entry-parts.js";

const DISTANCE_RE = /дистанционно|ДОТ/i;

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

export function parseSemesterScheduleWith(
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

    const selfStudyMarker = row.querySelector('span[style*="color: blue"]');
    if (
      selfStudyMarker &&
      /^День самостоятельной работы$/i.test(text(selfStudyMarker)) &&
      selfStudyMarker.closest("tr") === row
    ) {
      currentDay.isSelfStudyDay = true;
      continue;
    }

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

  // Transfer (перенос) — the whole entry is the transferred lesson
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

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const typeMatch = cleanText.match(LESSON_TYPE_RE);
  const weeksMatch = cleanText.match(WEEKS_RE);
  const room = parseEntryRoom(cleanHtml, subject);
  const teacherLine = linesAfterSubject(cleanHtml, subject).find((line) => {
    const candidate = stripDistanceMarker(line);
    return candidate.length > 0 && !SUBGROUP_RE.test(candidate);
  }) ?? "";
  const subgroupMatch = cleanText.match(SUBGROUP_RE);
  const weekParity = parseWeekParity(cleanHtml);

  return {
    room,
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: parseTeacher(teacherLine),
    groups: [],
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    isDistance: DISTANCE_RE.test(cleanText) || DISTANCE_RE.test(room),
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

    // Live session tables repeat the date cell after the data cell. Only the
    // leading date cell has the schedule data as its next sibling.
    const dataCell = dateCell.nextElementSibling;
    if (!dataCell?.matches("td.trdata:not(.trfd)")) {
      continue;
    }

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
): {
  entry: ScheduleEntry;
  timeStart: { hours: number; minutes: number };
  timeEnd: { hours: number; minutes: number };
} | null {
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);
  if (!plainText) return null;

  const possibleChanges =
    (td.getAttribute("class") ?? "").includes("want") || undefined;

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const room = parseEntryRoom(fullHtml, subject);

  // Type: parenthesized text after </span>, case-insensitive
  const typeMatch = plainText.match(FLEXIBLE_LESSON_TYPE_RE_I);
  const type = typeMatch ? typeMatch[1].replace(/\.$/, "").toLowerCase() : "";

  const subgroupMatch = plainText.match(SUBGROUP_RE);
  const parts = linesAfterSubject(fullHtml, subject);

  const teacherPart =
    parts.find(
      (part) =>
        stripDistanceMarker(part).length > 0 &&
        !/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(part) &&
        !SUBGROUP_RE.test(part) &&
        !containsGroupCode(stripDistanceMarker(part)),
    ) ?? "";

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
      teacher: parseTeacher(teacherPart),
      groups: [],
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      isDistance: DISTANCE_RE.test(plainText) || DISTANCE_RE.test(room),
      possibleChanges,
    },
    timeStart: parseTime(timeMatch[1]),
    timeEnd: parseTime(timeMatch[2]),
  };
}
