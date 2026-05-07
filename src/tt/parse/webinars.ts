import {
  parseHtml,
  parseTeacher,
  parseTime,
  text,
} from "../../common/parse.js";
import type { Time } from "../../common/types.js";
import type { Webinar } from "../types.js";
import { parseGroupsString } from "./groups.js";
import { FLEXIBLE_LESSON_TYPE_RE_I, SUBGROUP_RE } from "./patterns.js";

const GROUP_CODE_RE = /[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+(?:\s*ин)?/u;

function parseDateValue(value: string | undefined | null): Date | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(
    parseInt(match[1]),
    parseInt(match[2]) - 1,
    parseInt(match[3]),
  );
}

function parseTimeRange(raw: string): { start: Time; end: Time } | null {
  const match = raw.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if (!match) return null;
  return { start: parseTime(match[1]), end: parseTime(match[2]) };
}

function splitLesson(raw: string): {
  subject: string;
  type: string;
  teacherRaw: string;
  groupsRaw: string;
  subgroup?: number;
} {
  const typeMatches = [...raw.matchAll(new RegExp(FLEXIBLE_LESSON_TYPE_RE_I, "gi"))];
  const typeMatch = typeMatches.at(-1);
  if (!typeMatch || typeMatch.index == null) {
    return {
      subject: raw,
      type: "",
      teacherRaw: "",
      groupsRaw: "",
    };
  }

  const subject = raw.slice(0, typeMatch.index).trim();
  const type = typeMatch[1].replace(/\.$/, "").toLowerCase();
  const rest = raw.slice(typeMatch.index + typeMatch[0].length).trim();
  const groupMatch = rest.match(GROUP_CODE_RE);
  const teacherRaw =
    groupMatch?.index == null ? rest : rest.slice(0, groupMatch.index).trim();
  const groupsRaw =
    groupMatch?.index == null ? "" : rest.slice(groupMatch.index).trim();
  const subgroupMatch = raw.match(SUBGROUP_RE);

  return {
    subject,
    type,
    teacherRaw,
    groupsRaw,
    subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
  };
}

function parseWebinarRows(
  doc: Document,
  tableSelector: string,
  scheduled: boolean,
  fallbackDate: Date | undefined,
): Webinar[] {
  const webinars: Webinar[] = [];

  for (const slotRow of doc.querySelectorAll(`${tableSelector} > tbody > tr`)) {
    const slotCells = [...slotRow.children].filter(
      (child) => child.tagName.toLowerCase() === "td",
    );
    const timeCell = slotCells[0];
    const dataCell = slotCells[1];
    if (!timeCell || !dataCell) continue;

    const timeText = text(timeCell);
    const timeRange = parseTimeRange(timeText);
    if (!timeRange) continue;

    const id = timeCell.querySelector("div")?.getAttribute("id") ?? "";
    const idMatch = id.match(/trd(\d{4}-\d{2}-\d{2})t(\d+)/);
    const date = parseDateValue(idMatch?.[1]) ?? fallbackDate;
    const slotNumber = idMatch ? parseInt(idMatch[2]) : undefined;

    for (const row of dataCell.querySelectorAll("table tr")) {
      const cells = [...row.children].filter(
        (child) => child.tagName.toLowerCase() === "td",
      );
      const lessonCell = cells[0];
      const titleCell = cells[1];
      if (!lessonCell || !titleCell) continue;

      const button = row.querySelector("button[onclick*=\"jointo\"]");
      const onclick = button?.getAttribute("onclick") ?? "";
      const joinMatch = onclick.match(/jointo(?:sub)?\('([^']+)',\s*(\d+)\)/);
      const raw = text(lessonCell);
      const parsed = splitLesson(raw);

      webinars.push({
        id: joinMatch?.[1] ?? "",
        idType: joinMatch ? parseInt(joinMatch[2]) : 1,
        scheduled,
        date,
        slotNumber,
        timeStart: timeRange.start,
        timeEnd: timeRange.end,
        subject: parsed.subject,
        type: parsed.type,
        teacher: parseTeacher(parsed.teacherRaw),
        groups: parseGroupsString(parsed.groupsRaw),
        subgroup: parsed.subgroup,
        title: text(titleCell),
        raw,
      });
    }
  }

  return webinars;
}

export function parseWebinars(html: string): Webinar[] {
  const doc = parseHtml(html);
  const selectedDate = doc.querySelector<HTMLSelectElement>(
    'select[name="seldate"] option[selected]',
  )?.getAttribute("value");
  const fallbackDate = parseDateValue(selectedDate);

  return [
    ...parseWebinarRows(doc, "#webstt", true, fallbackDate),
    ...parseWebinarRows(doc, "#websttext", false, fallbackDate),
  ];
}
