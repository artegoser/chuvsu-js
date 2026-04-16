import {
  parseHtml,
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
    groups: parseGroupsString(groupsMatch?.[1]),
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
): {
  entry: ScheduleEntry;
  timeStart: { hours: number; minutes: number };
  timeEnd: { hours: number; minutes: number };
} | null {
  const fullHtml = td.innerHTML ?? "";
  const plainText = text(td);
  if (!plainText) return null;

  const subjectEl = td.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const roomMatch = fullHtml.match(/^([^<]*?)\s*<span/);
  const room = roomMatch ? roomMatch[1].trim() : "";

  const typeMatch = plainText.match(
    /\((лк|пр|лб|зач|экз|зчО|кр|конс\.?|Экз)\)/i,
  );
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
      groups: parseGroupsString(groupsMatch?.[1]),
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
