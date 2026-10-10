import { text } from "../../common/parse.js";
import type {
  PortfolioCell,
  PortfolioContent,
  PortfolioLink,
  PortfolioTable,
} from "../portfolio-types.js";

export function resolvePortfolioUrl(raw: string | null, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Ignore executable code and ordering/edit controls; retain line boundaries. */
export function displayedText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll("script,style,button,input,select,textarea")) node.remove();
  for (const br of clone.querySelectorAll("br")) br.replaceWith("\n");
  return text(clone).replace(/[^\S\n]+/gu, " ").replace(/ *\n */gu, "\n").trim();
}

export function portfolioLinks(element: Element, base: string): PortfolioLink[] {
  return [...element.querySelectorAll("a[href]")].flatMap((anchor) => {
    const raw = anchor.getAttribute("href");
    if (raw?.startsWith("#")) return [];
    const url = resolvePortfolioUrl(raw, base);
    return url ? [{ text: displayedText(anchor), url, title: anchor.getAttribute("title") ?? undefined, content: parsePortfolioContent(anchor, base) }] : [];
  });
}

export function portfolioNotes(element: Element): string[] {
  return [...new Set([element, ...element.querySelectorAll("[title]")]
    .filter((node) => !node.matches("button,input,select,textarea"))
    .map((node) => node.getAttribute("title")?.trim()).filter((value): value is string => !!value))];
}

function span(element: Element, name: string): number {
  const value = Number(element.getAttribute(name) ?? 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function parsePortfolioTable(table: Element, base: string): PortfolioTable {
  const rows = [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
  return { rows: rows.map((row) => [...row.children].filter((cell) => cell.matches("td,th"))
    .map((cell): PortfolioCell => ({
      text: displayedText(cell), header: cell.tagName === "TH",
      colspan: span(cell, "colspan"), rowspan: span(cell, "rowspan"),
      links: portfolioLinks(cell, base), notes: portfolioNotes(cell), content: parsePortfolioContent(cell, base),
    }))) };
}

/** Expand both spans so month/day/slot headers align with attendance cells. */
export function expandPortfolioRows(rows: PortfolioCell[][]): PortfolioCell[][] {
  const grid: PortfolioCell[][] = [];
  rows.forEach((row, rowIndex) => {
    const target = grid[rowIndex] ??= [];
    let column = 0;
    for (const cell of row) {
      while (target[column]) column++;
      for (let r = 0; r < cell.rowspan; r++) {
        const output = grid[rowIndex + r] ??= [];
        for (let c = 0; c < cell.colspan; c++) output[column + c] = cell;
      }
      column += cell.colspan;
    }
  });
  return grid;
}

export function parsePortfolioContent(parent: Element, base: string): PortfolioContent[] {
  const result: PortfolioContent[] = [];
  for (const node of parent.childNodes) {
    if (node.nodeType === 3) {
      const value = node.textContent?.replace(/\s+/gu, " ").trim();
      if (value) result.push({ kind: "text", text: value });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.matches("script,style,input,select,textarea")) continue;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/u.test(tag)) {
      result.push({ kind: "heading", level: Number(tag[1]), text: displayedText(element) });
    } else if (tag === "table") {
      result.push({ kind: "table", table: parsePortfolioTable(element, base) });
    } else if (tag === "a" || tag === "button") {
      const raw = tag === "a" ? element.getAttribute("href") :
        element.getAttribute("onclick")?.match(/^\s*window\.open\(\s*['"]([^'"]+)['"]\s*\);?\s*$/u)?.[1];
      if (!raw || raw.startsWith("#")) continue;
      const url = resolvePortfolioUrl(raw, base);
      if (url) result.push({ kind: "link", link: { text: displayedText(element), url, title: element.getAttribute("title") ?? undefined, content: parsePortfolioContent(element, base) } });
    } else if (tag === "img") {
      const url = resolvePortfolioUrl(element.getAttribute("src"), base);
      if (url) result.push({ kind: "image", url, alt: element.getAttribute("alt") ?? "", title: element.getAttribute("title") ?? undefined });
    } else {
      // Tab labels are retained as group labels rather than duplicate fragment links.
      if (element.getAttribute("role") === "tablist") continue;
      const label = element.getAttribute("role") === "tabpanel" && element.id
        ? text([...element.ownerDocument.querySelectorAll('a[href^="#"]')].find((anchor) => anchor.getAttribute("href") === `#${element.id}`) ?? null)
        : undefined;
      const content = parsePortfolioContent(element, base);
      if (content.length) result.push({ kind: "group", label, content });
    }
  }
  return result;
}
