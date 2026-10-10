import { FLEXIBLE_LESSON_TYPE_RE_I, SUBGROUP_RE } from "../../tt/parse/patterns.js";

const GROUP_CODE_RE = /[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+(?:\s*ин)?/u;

export function splitWebinarLesson(raw: string): {
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

