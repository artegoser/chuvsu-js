import { parseTeacher, text } from "../../common/parse.js";
import type { LocalDate, Teacher } from "../../common/types.js";
import type {
  ParsedLesson,
  Substitution,
  TransferInfo,
} from "../types.js";
import { parseGroupsString } from "./groups.js";
import {
  containsGroupCode,
  hasDistanceMarker,
  linesAfterSubject,
  stripDistanceMarker,
} from "./entry-parts.js";
import {
  LESSON_TYPE_RE,
  LESSON_TYPE_RE_I,
  SUBGROUP_RE,
} from "./patterns.js";

const GROUP_CODE_RE = /[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+/u;
const ROOM_CODE_RE = /^[А-Яа-яA-Za-z]-\d+$/u;
const BLUE_SPAN_RE =
  /<span\b(?=[^>]*(?:style=["'][^"']*color:\s*blue|class=["'][^"']*\bblue\b))[^>]*>([^<]+)<\/span>/i;

export function parseDate(dd: string, mm: string, yyyy: string): LocalDate {
  return `${yyyy}-${mm}-${dd}` as LocalDate;
}

export function parseTransferDiv(
  div: Element,
): { transfer: TransferInfo; entry: ParsedLesson } | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*перенос\s*[cс]\s*(\d{2})\.(\d{2})\.(\d{4})\s*\((\d+)\s*пара\)/iu,
  );
  if (!m) return null;

  const targetDate = parseDate(m[1], m[2], m[3]);
  const fromDate = parseDate(m[4], m[5], m[6]);
  const fromSlot = parseInt(m[7]);

  const lineHtmls = divHtml.split(/<br\s*\/?>/i);
  const lessonLineHtml =
    lineHtmls.find((line) => {
      const lineText = line.replace(/<[^>]*>/g, "").trim();
      return BLUE_SPAN_RE.test(line) && LESSON_TYPE_RE_I.test(lineText);
    }) ?? "";
  const subjectMatch = lessonLineHtml.match(BLUE_SPAN_RE);
  const subjectEl = div.querySelector('span[style*="color: blue"]');
  const subject = subjectMatch?.[1]?.trim() ?? (subjectEl ? text(subjectEl) : "");
  if (!subject) return null;

  const roomMatch = lessonLineHtml.match(/([А-Яа-яA-Za-z]-\d+)/) ??
    divHtml.match(/([А-Яа-яA-Za-z]-\d+)/);
  const typeMatch = divText.match(LESSON_TYPE_RE);
  const parts = lineHtmls
    .map((part) => part.replace(/<[^>]*>/g, "").trim())
    .filter((part) => part.length > 0);

  let teacherPart = "";
  let groupsPart = "";
  for (const part of parts.slice(1)) {
    const cleaned = part.trim();
    if (!cleaned) continue;

    const isLessonMeta =
      cleaned.includes(subject) ||
      (roomMatch?.[1] != null && cleaned.includes(roomMatch[1])) ||
      LESSON_TYPE_RE_I.test(cleaned);

    if (isLessonMeta) continue;

    if (GROUP_CODE_RE.test(cleaned)) {
      groupsPart = cleaned;
      continue;
    }

    if (!isLessonMeta && !teacherPart) {
      teacherPart = cleaned;
    }
  }

  const transfer: TransferInfo = { targetDate, fromDate, fromSlot, subject };
  const subgroupMatch = divText.match(SUBGROUP_RE);
  const groups = parseGroupsString(groupsPart);

  return {
    transfer,
    entry: {
      room: roomMatch?.[1] || undefined,
      subject,
      type: typeMatch?.[1] ?? "",
      teacher: teacherPart ? parseTeacher(teacherPart) : undefined,
      groups: groups.length > 0 ? groups : undefined,
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      isDistance: hasDistanceMarker(divText) || hasDistanceMarker(roomMatch?.[1] ?? ""),
      transfer,
    },
  };
}

export function parseSubstitutionDiv(div: Element): Substitution | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(/(\d{2})\.(\d{2})\.(\d{4})\s*замена\s*на:/);
  if (!m) return null;

  const date = parseDate(m[1], m[2], m[3]);

  let room: string | undefined;
  let teacher: Teacher | undefined;

  const roomMatch = divHtml.match(
    /Аудитория:\s*<span[^>]*>([^<]+)<\/span>/,
  );
  if (roomMatch) room = roomMatch[1].trim();

  const teacherMatch = divHtml.match(
    /Преподаватель:\s*<span[^>]*>([^<]+)<\/span>/,
  );
  if (teacherMatch) teacher = parseTeacher(teacherMatch[1].trim());

  return { date, room, teacher, isDistance: hasDistanceMarker(room ?? divText) };
}

export function parseSubstituteForDiv(div: Element): {
  entry: ParsedLesson;
} | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(/(\d{2})\.(\d{2})\.(\d{4})\s*замена\s*вместо:/);
  if (!m) return null;

  const date = parseDate(m[1], m[2], m[3]);

  // Original teacher: first blue span (right after "замена вместо:")
  const origTeacherMatch = divHtml.match(
    /замена\s*вместо:\s*<\/b><\/span>\s*<span[^>]*>([^<]+)<\/span>/,
  );
  const originalValue = origTeacherMatch?.[1].trim();
  const originalTeacher = originalValue && !ROOM_CODE_RE.test(originalValue)
    ? parseTeacher(originalValue)
    : undefined;

  // Subject: second blue span
  const subjectEl = div.querySelectorAll('span[style*="color: blue"]');
  let subject = "";
  for (const el of subjectEl) {
    const t = text(el);
    if (t && t !== origTeacherMatch?.[1]?.trim()) {
      subject = t;
      break;
    }
  }
  if (!subject) return null;

  const roomMatch = divHtml.match(/(?:<br\s*\/?>)\s*([А-Яа-яA-Za-z]-\d+)/);
  const typeMatch = divText.match(LESSON_TYPE_RE);
  const parts = linesAfterSubject(divHtml, subject);
  const teacherLine = stripDistanceMarker(
    parts.find((line) => !containsGroupCode(stripDistanceMarker(line))) ?? "",
  );
  const groupsLine = parts
    .filter((line) => containsGroupCode(stripDistanceMarker(line)))
    .map(stripDistanceMarker)
    .join(" ");
  const subgroupMatch = divText.match(SUBGROUP_RE);
  const groups = parseGroupsString(groupsLine);

  return {
    entry: {
      room: roomMatch?.[1] || undefined,
      subject,
      type: typeMatch?.[1] ?? "",
      teacher: teacherLine ? parseTeacher(teacherLine) : undefined,
      groups: groups.length > 0 ? groups : undefined,
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      isDistance: hasDistanceMarker(divText) || hasDistanceMarker(roomMatch?.[1] ?? ""),
      substituteFor: { date, originalTeacher },
    },
  };
}
