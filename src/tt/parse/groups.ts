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
    .replace(/\s*\(\s*\d+\s*подгруппа\s*\)\s*/gi, " ")
    .trim();
  if (!cleaned) return [];

  const out: string[] = [];

  // A new group starts from its code; trailing qualifiers like "ин" belong to
  // the current group until the next code begins.
  const startsGroup = (token: string): boolean =>
    /^[A-ZА-ЯЁ]{1,}-\d{1,2}-\d{2,4}[A-ZА-ЯЁa-zа-яё]*$/u.test(token);

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
