import { parseHtml, text } from "../../common/parse.js";
import { ParseError } from "../../common/types.js";
import type { StudentPortfolio } from "../portfolio-types.js";
import { displayedText, parsePortfolioContent, resolvePortfolioUrl } from "./portfolio-content.js";
import { parsePortfolioControlWeeks, parsePortfolioGrades } from "./portfolio-grades.js";
import { parsePortfolioPerformance } from "./portfolio-performance.js";

const BASE = "https://lk.chuvsu.ru";

/** Only the portfolio landing route or index.php?id=N can be discovered. */
export function parsePortfolioUrl(html: string): string {
  const doc = parseHtml(html);
  for (const element of doc.querySelectorAll("a[href],button[onclick]")) {
    const raw = element.getAttribute("href") ?? element.getAttribute("onclick")
      ?.match(/window\.open\(\s*['"]([^'"]+)['"]/u)?.[1];
    const value = resolvePortfolioUrl(raw ?? null, `${BASE}/student/`);
    if (!value) continue;
    const url = new URL(value);
    if (url.origin !== BASE || !["/portfolio", "/portfolio/", "/portfolio/index.php"].includes(url.pathname)) continue;
    if ([...url.searchParams.keys()].some((key) => key !== "id")) continue;
    const id = url.searchParams.get("id");
    if (id !== null && !/^[1-9]\d*$/u.test(id)) continue;
    return url.href;
  }
  throw new ParseError("LK home response has no portfolio link");
}

export function parsePortfolio(html: string, opts?: { url?: string }): StudentPortfolio {
  const doc = parseHtml(html);
  const fullName = text(doc.querySelector(".port_name"));
  if (!fullName) throw new ParseError("LK portfolio response has no student identity");
  const photo = doc.querySelector('.port_pic[src]');
  const photoUrl = resolvePortfolioUrl(photo?.getAttribute("src") ?? null, `${BASE}/portfolio/`);
  const photoId = photoUrl ? new URL(photoUrl).searchParams.get("id") : null;
  const requestedId = opts?.url ? new URL(opts.url).searchParams.get("id") : null;
  const rawId = photoId ?? requestedId;
  if (!rawId || !/^[1-9]\d*$/u.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
    throw new ParseError("LK portfolio response has no valid student ID");
  }
  if (requestedId && photoId && requestedId !== photoId) {
    throw new ParseError("LK portfolio student ID differs from requested ID");
  }
  const url = `${BASE}/portfolio/index.php?id=${rawId}`;
  const fields: Record<string, string> = {};
  for (const label of doc.querySelectorAll(".port_param")) {
    fields[text(label).replace(/:\s*$/u, "")] = label.nextElementSibling ? displayedText(label.nextElementSibling) : "";
  }
  const panels = [...doc.querySelectorAll('[role="tabpanel"]')].filter((panel) =>
    !panel.parentElement?.closest('[role="tabpanel"]'),
  );
  if (!panels.length) throw new ParseError("LK portfolio response has no sections");
  const anchors = [...doc.querySelectorAll('a[href^="#"]')];
  const titleFor = (panel: Element): string => text(anchors.find((anchor) => anchor.getAttribute("href") === `#${panel.id}`) ?? panel.querySelector("h2"));
  const gradesPanel = panels.find((panel) => titleFor(panel) === "Зачетная книжка");
  const controlsPanel = panels.find((panel) => titleFor(panel) === "Контрольные недели");
  const performancePanel = panels.find((panel) => titleFor(panel) === "Текущая успеваемость");
  return {
    id: Number(rawId), url, student: { fullName, photoUrl, fields },
    grades: gradesPanel ? parsePortfolioGrades(gradesPanel) : [],
    controlWeeks: controlsPanel ? parsePortfolioControlWeeks(controlsPanel) : [],
    performance: performancePanel ? parsePortfolioPerformance(performancePanel, url) : [],
    sections: panels.map((panel) => ({ title: titleFor(panel), content: parsePortfolioContent(panel, url) })),
  };
}
