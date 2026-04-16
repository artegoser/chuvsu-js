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
  for (const m of cleaned.matchAll(/(\S+)(?:\s+\(([^)]+)\))?/g)) {
    out.push(m[2] ? `${m[1]} (${m[2]})` : m[1]);
  }
  return out;
}
