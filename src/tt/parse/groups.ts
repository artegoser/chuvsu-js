import { SUBGROUP_ANNOTATION_RE_I } from "./patterns.js";

/**
 * Split a raw "groups" string from the schedule HTML into individual group names.
 *
 * Preserves in-name annotations (e.g. "КТ-42-25 (АихС)") and strips service
 * markers like "(N подгруппа)" — the subgroup number is carried separately on
 * {@link import("../types.js").ScheduleEntry.subgroup}.
 *
 * Examples:
 *   "КТ-42-25"                          -> ["КТ-42-25"]
 *   "КТ-42-25 (АихС) КТ-41-25"          -> ["КТ-42-25 (АихС)", "КТ-41-25"]
 *   "КТ-42-25 (1 подгруппа)"            -> ["КТ-42-25"]
 *   "КТ-42-25 (АихС) (1 подгруппа)"     -> ["КТ-42-25 (АихС)"]
 *   ""                                  -> []
 */
export function parseGroupsString(raw: string | undefined | null): string[] {
  if (!raw) return [];

  const cleaned = raw
    .replace(SUBGROUP_ANNOTATION_RE_I, " ")
    .trim();
  if (!cleaned) return [];

  const out: string[] = [];

  // A new group starts from a code-like token. Optional qualifiers like "ин"
  // may be attached either directly ("М-30-25ин") or as a separate tail
  // ("УП-51-23 ин"), so they stay with the current group until the next code.
  const startsGroup = (token: string): boolean =>
    /^[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+$/u.test(token);

  let current = "";
  for (const token of cleaned.split(/\s+/)) {
    if (startsGroup(token)) {
      if (current) out.push(current);
      current = token;
      continue;
    }

    current = current ? `${current} ${token}` : token;
  }

  if (current) out.push(current);
  return out;
}
