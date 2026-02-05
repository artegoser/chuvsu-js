import { parseHTML } from "linkedom";
import type { Time, WeekRange, Teacher } from "./types.js";

export function parseHtml(html: string) {
  return parseHTML(html).document;
}

/** Extract values set via `document.formName.field.value='...'` in script tags */
export function extractScriptValues(
  html: string,
  formName: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const re = new RegExp(
    `document\\.${formName}\\.(\\w+)\\.value\\s*=\\s*'([^']*)'`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    result[m[1]] = m[2];
  }
  return result;
}

export function text(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

/** Parse "HH:MM" into {hours, minutes} */
export function parseTime(s: string): Time {
  const [h, m] = s.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

/** Parse "2 нед." -> {min:2,max:2}, "6 - 8 нед." -> {min:6,max:8} */
export function parseWeeks(s: string): WeekRange {
  const range = s.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { min: parseInt(range[1]), max: parseInt(range[2]) };
  const single = s.match(/(\d+)/);
  if (single) return { min: parseInt(single[1]), max: parseInt(single[1]) };
  return { min: 0, max: 0 };
}

/**
 * Parse teacher string like:
 * "доц.  к.ф.-м.н. Матвеев С. В." -> {position:"доц.", degree:"к.ф.-м.н.", name:"Матвеев С. В."}
 * "Дигуева О. Г." -> {name:"Дигуева О. Г."}
 */
/** Parse <sup>*</sup> / <sup>**</sup> markers: * = odd week, ** = even week */
export function parseWeekParity(html: string): "even" | "odd" | undefined {
  const match = html.match(/<sup>\s*(\*{1,2})\s*<\/sup>/);
  if (!match) return undefined;
  return match[1] === "**" ? "even" : "odd";
}

export function parseTeacher(s: string): Teacher {
  const trimmed = s.trim();
  if (!trimmed) return { name: "" };

  // Positions: доц., проф., ст.преп., преп., асс.
  const posMatch = trimmed.match(
    /^(доц\.|проф\.|ст\.преп\.|ст\. преп\.|преп\.|асс\.)\s*/,
  );
  const afterPos = posMatch ? trimmed.slice(posMatch[0].length) : trimmed;

  // Degrees: к.ф.-м.н., к.э.н., к.т.н., д.т.н., etc.
  const degMatch = afterPos.match(/^([кд]\.[а-яё.-]+н\.)\s*/);
  const name = degMatch ? afterPos.slice(degMatch[0].length).trim() : afterPos.trim();

  const result: Teacher = { name };
  if (posMatch) result.position = posMatch[1];
  if (degMatch) result.degree = degMatch[1];
  return result;
}
