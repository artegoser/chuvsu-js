import type { PortfolioGradeValue } from "../portfolio-types.js";

/** Missing/unrecognized grades stay null; numeric zero remains zero. */
export function parseNumericGrade(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)(?:\s*\([^()]*\))?$/u);
  if (!match) return null;
  const grade = Number(match[1].replace(",", "."));
  return Number.isFinite(grade) ? grade : null;
}

export function parseGradeValue(value: string): PortfolioGradeValue {
  const normalized = value.trim().toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ");
  if (normalized === "зачтено") return true;
  if (normalized === "не зачтено") return false;
  return parseNumericGrade(normalized);
}
