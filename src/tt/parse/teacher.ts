import {
  parseHtml,
  parseTime,
  parseWeekParity,
  parseWeeks,
  text,
} from "../../common/parse.js";
import { EducationLevel } from "../../common/types.js";
import type {
  ParsedScheduleDay,
  ParsedScheduleSlot,
  ParsedScheduleEntry,
  Substitution,
  TeacherInfo,
} from "../types.js";
import { getLessonNumber } from "../utils/index.js";
import { parseSemesterScheduleWith } from "./full-schedule.js";
import { parseGroupsString } from "./groups.js";
import {
  parseSubstituteForDiv,
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

export function parseTeacherSchedule(
  html: string,
  educationLevel?: EducationLevel,
): ParsedScheduleDay[] {
  const doc = parseHtml(html);
  const edType = educationLevel ?? EducationLevel.HigherEducation;

  if (doc.querySelector('td[id^="trd2"]')) {
    return parseTeacherSessionSchedule(doc, edType);
  }

  return parseSemesterScheduleWith(doc, parseTeacherSemesterEntry);
}

function parseTeacherSemesterEntry(el: Element): ParsedScheduleEntry | null {
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

  // "замена вместо:" (substitute lesson for another teacher)
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

  const typeMatch = cleanText.match(LESSON_TYPE_RE);
  const weeksMatch = cleanText.match(WEEKS_RE);
  const room = parseEntryRoom(cleanHtml, subject);
  const groupsLine = linesAfterSubject(cleanHtml, subject).find(
    (line) => containsGroupCode(stripDistanceMarker(line)),
  ) ?? "";
  const subgroupMatch = cleanText.match(SUBGROUP_RE);
  const weekParity = parseWeekParity(cleanHtml);

  return {
    room,
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: { name: "" },
    groups: parseGroupsString(stripDistanceMarker(groupsLine)),
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    isDistance: DISTANCE_RE.test(cleanText) || DISTANCE_RE.test(room),
    substitutions: substitutions.length > 0 ? substitutions : undefined,
    possibleChanges,
  };
}

function parseTeacherSessionSchedule(
  doc: Document,
  educationLevel: EducationLevel,
): ParsedScheduleDay[] {
  const days: ParsedScheduleDay[] = [];

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

    const dataCell = dateCell.nextElementSibling;
    if (!dataCell?.matches("td.trdata:not(.trfd)")) {
      continue;
    }

    const slots: ParsedScheduleSlot[] = [];

    for (const entryRow of dataCell.querySelectorAll("table tr")) {
      const td = entryRow.querySelector("td") ?? entryRow;
      const entry = parseTeacherSessionEntry(td);
      if (!entry) continue;

      slots.push({
        number: getLessonNumber(entry.timeStart, educationLevel),
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
): {
  entry: ParsedScheduleEntry;
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

  const typeMatch = plainText.match(FLEXIBLE_LESSON_TYPE_RE_I);
  const type = typeMatch ? typeMatch[1].replace(/\.$/, "").toLowerCase() : "";
  const subgroupMatch = plainText.match(SUBGROUP_RE);

  const timeMatch = fullHtml.match(
    /<br\s*\/?>\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/,
  );
  if (!timeMatch) return null;

  const parts = linesAfterSubject(fullHtml, subject);
  const groupsPart =
    parts.find(
      (part) =>
        stripDistanceMarker(part).length > 0 &&
        !/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(part) &&
        containsGroupCode(stripDistanceMarker(part)),
    ) ?? "";

  return {
    entry: {
      room,
      subject,
      type,
      weeks: { from: 0, to: 0 },
      teacher: { name: "" },
      groups: parseGroupsString(stripDistanceMarker(groupsPart)),
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      isDistance: DISTANCE_RE.test(plainText) || DISTANCE_RE.test(room),
      possibleChanges,
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

  return {
    name,
    degree: degree || undefined,
    department: department || undefined,
    photoUrl,
  };
}
