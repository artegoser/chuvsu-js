import {
  parseHtml,
  parseTeacher,
  parseWeekParity,
  parseWeeks,
  text,
} from "../../common/parse.js";
import type {
  AudienceInfo,
  FullScheduleDay,
  ScheduleEntry,
  Substitution,
} from "../types.js";
import { parseSemesterScheduleWith } from "./full-schedule.js";
import { parseGroupsString } from "./groups.js";
import {
  parseSubstituteForDiv,
  parseSubstitutionDiv,
  parseTransferDiv,
} from "./overlays.js";

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
    groups: parseGroupsString(groupsLine),
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
