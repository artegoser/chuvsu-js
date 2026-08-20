/**
 * ChuvSU switches the timetable to the next academic year during August,
 * before classes start in September. Keep this boundary aligned with the
 * timetable site rather than the formal September 1 semester start.
 */
export function getAcademicYearStartYear(date: Date = new Date()): number {
  const year = date.getFullYear();
  return date.getMonth() >= 7 ? year : year - 1;
}

/** Academic year cache/display key, e.g. "2026-2027". */
export function getAcademicYearKey(date: Date = new Date()): string {
  const start = getAcademicYearStartYear(date);
  return `${start}-${start + 1}`;
}
