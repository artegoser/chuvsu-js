import {
  parseHtml,
  parseTeacher,
  parseTime,
  parseWeekParity,
  parseWeeks,
  text,
} from "../../common/parse.js";
import type {
  RoomInfo,
  ParsedScheduleDay,
  ParsedLesson,
  Substitution,
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
  LESSON_TYPE_GLOBAL_RE,
  LESSON_TYPE_RE,
  FLEXIBLE_LESSON_TYPE_RE_I,
  SUBGROUP_ANNOTATION_RE,
  SUBGROUP_RE,
  WEEKS_GLOBAL_RE,
  WEEKS_RE,
} from "./patterns.js";
import {
  containsGroupCode,
  linesAfterSubject,
  stripDistanceMarker,
} from "./entry-parts.js";

const DISTANCE_RE = /дистанционно|ДОТ/i;

export function parseRoomInfo(html: string): RoomInfo | null {
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
  let floorplanRect:
    | { x1: number; y1: number; x2: number; y2: number }
    | undefined;
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
      floorplanRect = {
        x1: parts[0],
        y1: parts[1],
        x2: parts[2],
        y2: parts[3],
      };
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

function parseRoomSemesterEntry(el: Element): ParsedLesson | null {
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

  const typeMatch = cleanText.match(LESSON_TYPE_RE);
  const weeksMatch = cleanText.match(WEEKS_RE);
  const subgroupMatch = cleanText.match(SUBGROUP_RE);
  const weekParity = parseWeekParity(cleanHtml);

  // Audience entries: subject line, then teacher line, then group line(s).
  const parts = linesAfterSubject(cleanHtml, subject);
  const teacherLine = stripDistanceMarker(
    parts.find((line) => !containsGroupCode(stripDistanceMarker(line))) ?? "",
  );
  const groupsLine = parts
    .filter((line) => containsGroupCode(stripDistanceMarker(line)))
    .map(stripDistanceMarker)
    .map((line) =>
      line
        .replace(LESSON_TYPE_GLOBAL_RE, "")
        .replace(WEEKS_GLOBAL_RE, "")
        .replace(SUBGROUP_ANNOTATION_RE, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
  const groups = parseGroupsString(groupsLine);

  return {
    subject,
    type: typeMatch?.[1] ?? "",
    weeks: parseWeeks(weeksMatch?.[1] ?? ""),
    teacher: teacherLine ? parseTeacher(teacherLine) : undefined,
    groups: groups.length > 0 ? groups : undefined,
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
    weekParity,
    isDistance: DISTANCE_RE.test(cleanText),
    substitutions: substitutions.length > 0 ? substitutions : undefined,
    possibleChanges,
  };
}

export function parseRoomSchedule(html: string): ParsedScheduleDay[] {
  const doc = parseHtml(html);
  if (doc.querySelector('td[id^="trd2"]')) {
    return parseSessionScheduleWith(doc, parseRoomSessionEntry);
  }
  return parseSemesterScheduleWith(doc, parseRoomSemesterEntry);
}

function parseRoomSessionEntry(td: Element): {
  lesson: ParsedLesson;
  time: { start: { hours: number; minutes: number }; end: { hours: number; minutes: number } };
} | null {
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);
  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!plainText || !subject) return null;

  const timeMatch = fullHtml.match(
    /<br\s*\/?>\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/,
  );
  if (!timeMatch) return null;

  const typeMatch = plainText.match(FLEXIBLE_LESSON_TYPE_RE_I);
  const parts = linesAfterSubject(fullHtml, subject);
  const teacherLine = parts.find((part) =>
    !/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(part) &&
    !containsGroupCode(stripDistanceMarker(part))
  );
  const groupsLine = parts.find((part) =>
    containsGroupCode(stripDistanceMarker(part))
  );
  const groups = parseGroupsString(stripDistanceMarker(groupsLine ?? ""));
  const subgroupMatch = plainText.match(SUBGROUP_RE);

  return {
    lesson: {
      subject,
      type: typeMatch?.[1].replace(/\.$/, "").toLowerCase() ?? "",
      teacher: teacherLine ? parseTeacher(stripDistanceMarker(teacherLine)) : undefined,
      groups: groups.length > 0 ? groups : undefined,
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      isDistance: DISTANCE_RE.test(plainText),
      possibleChanges:
        (td.getAttribute("class") ?? "").includes("want") || undefined,
    },
    time: { start: parseTime(timeMatch[1]), end: parseTime(timeMatch[2]) },
  };
}
