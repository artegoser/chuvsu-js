import { text } from "../../common/parse.js";
import type { PortfolioControlWeek, PortfolioGrade, PortfolioReferral } from "../portfolio-types.js";
import { displayedText, portfolioNotes } from "./portfolio-content.js";

function referral(row: Element): PortfolioReferral | undefined {
  const onclick = row.querySelector('[onclick*="iexlist"]')?.getAttribute("onclick");
  const match = onclick?.match(/iexlist\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([^'"]*)['"]\s*\)/u);
  return match ? {
    semester: Number(match[1]), disciplineId: Number(match[2]), lessonTypeId: Number(match[3]),
    type: Number(match[4]), key: Number(match[5]), code: match[6],
  } : undefined;
}

/** Accordion sections are headed with Семестр N; IDs are randomly generated. */
export function semesterBlocks(panel: Element): { semester: number; body: Element }[] {
  return [...panel.querySelectorAll("h3")].flatMap((heading) => {
    const match = text(heading).match(/^Семестр\s+(\d+)$/iu);
    const body = heading.nextElementSibling;
    return match && body ? [{ semester: Number(match[1]), body }] : [];
  });
}

export function parsePortfolioGrades(panel: Element): PortfolioGrade[] {
  return semesterBlocks(panel).flatMap(({ semester, body }) =>
    [...body.querySelectorAll("tbody > tr")].flatMap((row) => {
      const cells = [...row.children];
      if (cells.length < 3) return [];
      const code = text(cells[0].querySelector(".red"));
      const raw = displayedText(cells[0]);
      const assessment = raw.match(/\(([^()]*)\)\s*$/u)?.[1] ?? "";
      const subject = raw.slice(code && raw.startsWith(code) ? code.length : 0)
        .replace(/\s*\([^()]*\)\s*$/u, "").trim();
      return [{ semester, code, subject, assessment, grade: displayedText(cells[2]), notes: portfolioNotes(cells[2]), referral: referral(row) }];
    }),
  );
}

export function parsePortfolioControlWeeks(panel: Element): PortfolioControlWeek[] {
  return semesterBlocks(panel).flatMap(({ semester, body }) =>
    [...body.querySelectorAll("tbody > tr")].flatMap((row) => {
      const cells = [...row.children];
      if (!cells.length || cells.some((cell) => cell.tagName === "TH")) return [];
      return [{ semester, subject: displayedText(cells[0]), grades: cells.slice(1).map(displayedText) }];
    }),
  );
}
