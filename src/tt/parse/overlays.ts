import { parseTeacher, text } from "../../common/parse.js";
import type { Teacher } from "../../common/types.js";
import type {
  ScheduleEntry,
  Substitution,
  TransferInfo,
} from "../types.js";
import { parseGroupsString } from "./groups.js";

export function parseDate(dd: string, mm: string, yyyy: string): Date {
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
}

export function parseTransferDiv(
  div: Element,
): { transfer: TransferInfo; entry: ScheduleEntry } | null {
  const divText = text(div);
  const divHtml = div.innerHTML ?? "";

  const m = divText.match(
    /(\d{2})\.(\d{2})\.(\d{4})\s*перенос\s*c\s*(\d{2})\.(\d{2})\.(\d{4})\s*\((\d+)\s*пара\)/,
  );
  if (!m) return null;

  const targetDate = parseDate(m[1], m[2], m[3]);
  const fromDate = parseDate(m[4], m[5], m[6]);
  const fromSlot = parseInt(m[7]);

  const subjectEl = div.querySelector('span[style*="color: blue"]');
  const subject = subjectEl ? text(subjectEl) : "";
  if (!subject) return null;

  const roomMatch = divHtml.match(/([А-Яа-яA-Za-z]-\d+)/);
  const typeMatch = divText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const parts = divHtml
    .split(/<br\s*\/?>/i)
    .map((part) => part.replace(/<[^>]*>/g, "").trim())
    .filter((part) => part.length > 0);

  let teacherPart = "";
  let groupsPart = "";
  for (const part of parts.slice(1)) {
    const cleaned = part.trim();
    if (!cleaned) continue;

    const groups = parseGroupsString(cleaned);
    if (groups.length > 0) {
      groupsPart = cleaned;
      continue;
    }

    const isLessonMeta =
      cleaned.includes(subject) ||
      (roomMatch?.[1] != null && cleaned.includes(roomMatch[1])) ||
      /\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/i.test(cleaned);

    if (!isLessonMeta && !teacherPart) {
      teacherPart = cleaned;
    }
  }

  const transfer: TransferInfo = { targetDate, fromDate, fromSlot, subject };
  const subgroupMatch = divText.match(/(\d+)\s*подгруппа/);

  return {
    transfer,
    entry: {
      room: roomMatch?.[1] ?? "",
      subject,
      type: typeMatch?.[1] ?? "",
      weeks: { from: 0, to: 0 },
      teacher: parseTeacher(teacherPart),
      groups: parseGroupsString(groupsPart),
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
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

  return { date, room, teacher };
}

export function parseSubstituteForDiv(div: Element): {
  entry: ScheduleEntry;
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
  const originalTeacher = origTeacherMatch
    ? parseTeacher(origTeacherMatch[1].trim())
    : { name: "" };

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
  const typeMatch = divText.match(/\((лк|пр|лб|зач|экз|зчО|кр|конс)\)/);
  const groupsMatch = divHtml.match(
    /\((?:лк|пр|лб|зач|экз|зчО|кр|конс)\)\s*(?:<br\s*\/?>)\s*([^<]+?)(?:\s*<i|$)/,
  );
  const subgroupMatch = divText.match(/(\d+)\s*подгруппа/);

  return {
    entry: {
      room: roomMatch?.[1] ?? "",
      subject,
      type: typeMatch?.[1] ?? "",
      weeks: { from: 0, to: 0 },
      teacher: { name: "" },
      groups: parseGroupsString(groupsMatch?.[1]),
      subgroup: subgroupMatch ? parseInt(subgroupMatch[1]) : undefined,
      substituteFor: { date, originalTeacher },
    },
  };
}
