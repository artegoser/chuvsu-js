import { parseHtml, text } from "../../common/parse.js";
import { AcademicPeriod } from "../../common/types.js";
import type { Faculty, Group, Room } from "../types.js";

const PERIOD_LABELS: Record<string, AcademicPeriod> = {
  "осенний семестр": 1 as AcademicPeriod,
  "зимняя сессия": 2 as AcademicPeriod,
  "весенний семестр": 3 as AcademicPeriod,
  "летняя сессия": 4 as AcademicPeriod,
};

export function parsePeriodFromPage(html: string): AcademicPeriod | null {
  const doc = parseHtml(html);

  // Schedule pages expose the active period as the checked radio button.
  const checked = doc.querySelector('input[name="pertype"][checked]');
  const checkedValue = Number(checked?.getAttribute("value"));
  if (checkedValue >= 1 && checkedValue <= 4) {
    return checkedValue as AcademicPeriod;
  }

  // Some pages keep the selected period only in the hidden form field.
  const hiddenValue = Number(doc.querySelector('#htype')?.getAttribute("value"));
  if (hiddenValue >= 1 && hiddenValue <= 4) {
    return hiddenValue as AcademicPeriod;
  }

  // Legacy markup used an italic textual marker.
  const match = html.match(/идет\s+(.+?)\s*</i);
  if (!match) return null;
  const label = match[1].toLowerCase().trim();
  return PERIOD_LABELS[label] ?? null;
}

/** Parse the start year from labels like "2026/2027 учебный год". */
export function parseAcademicYearFromPage(html: string): number | null {
  const match = html.match(/(\d{4})\s*[\/-]\s*(\d{4})\s*учебный\s+год/i);
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1 ? start : null;
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

export function parseGroupName(html: string): string | null {
  const doc = parseHtml(html);
  const name = text(
    doc.querySelector('span.htext span[style*="color: blue"]'),
  );
  return name || null;
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

export function parseRoomButtons(html: string): Room[] {
  const results: Room[] = [];
  const seen = new Set<number>();
  const re = /<button[^>]*\bname="aud(\d+)"[^>]*\bvalue="([^"]*)"/g;
  for (const m of html.matchAll(re)) {
    const id = parseInt(m[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({ id, name: m[2] });
  }
  return results;
}

export function parseRoomName(html: string): string | null {
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
