import {
  parseHtml,
  parseTime,
  parseWeekParity,
  parseWeeks,
  text,
} from "../../common/parse.js";
import type {
  ParsedScheduleDay,
  ParsedLesson,
  Substitution,
  TeacherInfo,
} from "../types.js";
import {
  parseSemesterScheduleWith,
  parseSessionScheduleWith,
} from "./full-schedule.js";
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

export function parseTeacherSchedule(html: string): ParsedScheduleDay[] {
  const doc = parseHtml(html);

  if (doc.querySelector('td[id^="trd2"]')) {
    return parseSessionScheduleWith(doc, parseTeacherSessionEntry);
  }

  return parseSemesterScheduleWith(doc, parseTeacherSemesterEntry);
}

function parseTeacherSemesterEntry(el: Element): ParsedLesson | null {
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
  const groups = parseGroupsString(stripDistanceMarker(groupsLine));

  return {
    room: room || undefined,
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    groups: groups.length > 0 ? groups : undefined,
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    isDistance: DISTANCE_RE.test(cleanText) || DISTANCE_RE.test(room ?? ""),
    substitutions: substitutions.length > 0 ? substitutions : undefined,
    possibleChanges,
  };
}

function parseTeacherSessionEntry(
  td: Element,
): {
  lesson: ParsedLesson;
  time: { start: { hours: number; minutes: number }; end: { hours: number; minutes: number } };
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
  const groups = parseGroupsString(stripDistanceMarker(groupsPart));

  return {
    lesson: {
      room: room || undefined,
      subject,
      type,
      groups: groups.length > 0 ? groups : undefined,
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      isDistance: DISTANCE_RE.test(plainText) || DISTANCE_RE.test(room ?? ""),
      possibleChanges,
    },
    time: { start: parseTime(timeMatch[1]), end: parseTime(timeMatch[2]) },
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
