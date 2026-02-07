import { parseHTML } from "linkedom";
import type { Time, WeekRange, Teacher } from "./types.js";

export function parseHtml(html: string) {
  return parseHTML(html).document;
}

export function text(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

/** Parse "HH:MM" into {hours, minutes} */
export function parseTime(s: string): Time {
  const [h, m] = s.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

/** Parse "2 нед." -> {from:2,to:2}, "6 - 8 нед." -> {from:6,to:8} */
export function parseWeeks(s: string): WeekRange {
  const range = s.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { from: parseInt(range[1]), to: parseInt(range[2]) };
  const single = s.match(/(\d+)/);
  if (single) return { from: parseInt(single[1]), to: parseInt(single[1]) };
  return { from: 0, to: 0 };
}

/** Parse <sup>*</sup> / <sup>**</sup> markers: * = odd week, ** = even week */
export function parseWeekParity(html: string): "even" | "odd" | undefined {
  const match = html.match(/<sup>\s*(\*{1,2})\s*<\/sup>/);
  if (!match) return undefined;
  return match[1] === "**" ? "even" : "odd";
}

export function parseTeacher(s: string): Teacher {
  const trimmed = s.trim();
  if (!trimmed) return { name: "" };

  const posMatch = trimmed.match(
    /^(доц\.|проф\.|ст\.преп\.|ст\. преп\.|преп\.|асс\.)\s*/,
  );
  const afterPos = posMatch ? trimmed.slice(posMatch[0].length) : trimmed;

  const degMatch = afterPos.match(/^([кд]\.[а-яё.-]+н\.)\s*/);
  const name = degMatch ? afterPos.slice(degMatch[0].length).trim() : afterPos.trim();

  const result: Teacher = { name };
  if (posMatch) result.position = posMatch[1];
  if (degMatch) result.degree = degMatch[1];
  return result;
}
