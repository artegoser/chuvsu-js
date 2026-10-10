import { text } from "../../common/parse.js";
import type { PortfolioPerformance } from "../portfolio-types.js";
import { expandPortfolioRows, parsePortfolioTable } from "./portfolio-content.js";

export function parsePortfolioPerformance(panel: Element, base: string): PortfolioPerformance[] {
  return [...panel.querySelectorAll("h3")].flatMap((heading) => {
    const body = heading.nextElementSibling;
    if (!body?.querySelector("table.journtable")) return [];
    const performance: PortfolioPerformance = { subject: text(heading), attendance: [], activities: [] };
    for (const table of body.querySelectorAll("table.journtable")) {
      const parsed = parsePortfolioTable(table, base);
      const headerCount = [...table.querySelectorAll("thead > tr")].length;
      const headers = expandPortfolioRows(parsed.rows.slice(0, headerCount));
      const values = parsed.rows.slice(headerCount).filter((row) => row.some((cell) => !cell.header));
      if (/Пропуски занятий/iu.test(headers[0]?.[0]?.text ?? "") && headers.length >= 5) {
        for (const row of values) {
          row.forEach((cell, index) => {
            const day = Number(headers[2]?.[index]?.text);
            const slotNumber = Number(headers[3]?.[index]?.text);
            if (!Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(slotNumber) || slotNumber < 1) return;
            const typeRaw = headers[4]?.[index]?.text ?? "";
            const subgroup = typeRaw.match(/\((\d+)\)/u)?.[1];
            performance.attendance.push({
              month: headers[1]?.[index]?.text ?? "", day, slotNumber,
              type: typeRaw.replace(/\s*\(\d+\)/u, "").trim(),
              subgroup: subgroup ? Number(subgroup) : undefined,
              mark: cell.text, notes: cell.notes,
            });
          });
        }
      } else if (/Запланированная активность/iu.test(headers[0]?.[0]?.text ?? "")) {
        performance.activities.push({
          teacher: headers[1]?.[0]?.text ?? "",
          items: values.flatMap((row) => row.map((cell, index) => ({
            title: headers.at(-1)?.[index]?.text ?? "", value: cell.text, notes: cell.notes, links: cell.links, content: cell.content,
          }))),
        });
      }
    }
    return [performance];
  });
}
