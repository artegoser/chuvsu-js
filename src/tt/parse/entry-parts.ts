const BR_RE = /<br\s*\/?>/i;
const TAG_RE = /<[^>]*>/g;
const DISTANCE_RE =
  /(?:^|[^\p{L}\p{N}])(?:дистанционно|ДОТ)(?=$|[^\p{L}\p{N}])/iu;
const GROUP_TOKEN_RE = /^[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+$/u;
const LEADING_PARENTHESIZED_RE = /^\s*\(([^()]*)\)/u;
const WEEK_METADATA_RE = /(?:^|\s)нед\.?(?:\s|$)/iu;
const SUBGROUP_METADATA_RE = /^\d+\s*подгруппа$/iu;

export function entryHtmlLines(html: string): string[] {
  return html.split(BR_RE).map((line) => line.trim());
}

export function entryTextLines(html: string): string[] {
  return entryHtmlLines(html)
    .map(stripHtml)
    .filter((line) => line.length > 0);
}

export function stripHtml(html: string): string {
  return html.replace(TAG_RE, " ").replace(/\s+/g, " ").trim();
}

export function hasDistanceMarker(value: string): boolean {
  return DISTANCE_RE.test(value);
}

export function linesAfterSubject(html: string, subject: string): string[] {
  const lines = entryTextLines(html);
  const index = lines.findIndex((line) => line.includes(subject));
  return index < 0 ? [] : lines.slice(index + 1);
}

export function parseEntryRoom(html: string, subject: string): string {
  const lines = entryHtmlLines(html);
  const line = lines.find((part) => stripHtml(part).includes(subject));
  if (!line) return "";

  const lineText = stripHtml(line);
  const subjectIndex = lineText.indexOf(subject);
  if (subjectIndex < 0) return "";

  const beforeSubject = lineText
    .slice(0, subjectIndex)
    .replace(/^\*+\s*/, "")
    .trim();
  if (hasDistanceMarker(stripHtml(html))) {
    return "Дистанционно (ДОТ)";
  }
  if (!beforeSubject) return "";

  return beforeSubject;
}

export function stripDistanceMarker(value: string): string {
  return value
    .replace(/\(\s*ДОТ\s*\)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsGroupCode(value: string): boolean {
  return value.split(/\s+/).some((token) => GROUP_TOKEN_RE.test(token));
}

/**
 * Lesson type is free-form portal data. Its stable marker is position: the first
 * parenthesized value immediately after the blue subject span.
 */
export function parseLessonTypeAfterSubject(subjectElement: Element): string {
  let suffix = "";
  for (
    let sibling = subjectElement.nextSibling;
    sibling;
    sibling = sibling.nextSibling
  ) {
    if ((sibling as Element).tagName?.toLowerCase() === "br") break;
    suffix += sibling.textContent ?? "";
  }

  const candidate = suffix.match(LEADING_PARENTHESIZED_RE)?.[1]
    ?.trim()
    .replace(/\.$/, "") ?? "";
  if (
    !candidate ||
    WEEK_METADATA_RE.test(candidate) ||
    SUBGROUP_METADATA_RE.test(candidate) ||
    candidate.toUpperCase() === "ДОТ"
  ) {
    return "";
  }
  return candidate;
}
