import { parseHtml, parseTeacher, parseTime, text } from "../../common/parse.js";
import { ParseError, type LocalDate } from "../../common/types.js";
import { isLocalDate } from "../../tt/utils/date.js";
import { parseLessonType } from "../../common/lesson-type.js";
import { parseGroupsString } from "../../tt/parse/groups.js";
import type { Webinar, WebinarPage } from "../types.js";
import { splitWebinarLesson } from "./webinar-lesson.js";

function dateValue(value: string | null | undefined): LocalDate | undefined {
  return value && isLocalDate(value) ? value : undefined;
}

function timeValue(value: string): string | undefined {
  return value.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/u)?.[0];
}

export function parseWebinarPage(html: string): WebinarPage {
  const doc = parseHtml(html);
  const select = doc.querySelector('select[name="day"]');
  if (!select && !doc.querySelector("table.webtable")) {
    throw new ParseError("LK response has no webinar page");
  }
  const scriptDate = html.match(/\$\(['"]#day['"]\)\.val\(['"]([^'"]+)['"]\)/u)?.[1];
  const date = dateValue(scriptDate) ?? dateValue(
    select?.querySelector("option[selected]")?.getAttribute("value"),
  ) ?? dateValue(select?.querySelector("option")?.getAttribute("value"));
  const availableDates = [...(select?.querySelectorAll("option") ?? [])]
    .map((option) => dateValue(option.getAttribute("value")))
    .filter((value): value is LocalDate => value !== undefined);
  const webinars: Webinar[] = [];
  for (const table of doc.querySelectorAll("table.webtable")) {
    const heading = text(table.parentElement?.querySelector("h3") ?? null);
    const scheduled = /по расписанию/iu.test(heading);
    for (const row of table.querySelectorAll("tbody > tr")) {
      const cells = [...row.children];
      if (cells.length < 6) continue;
      const start = timeValue(text(cells[0]));
      const end = timeValue(text(cells[1]));
      if (!start || !end) continue;
      const raw = text(cells[3]);
      const lesson = splitWebinarLesson(raw);
      const button = cells[5].querySelector('[onclick*="jointo"]');
      const id = button?.getAttribute("onclick")?.match(/jointo\(\s*['"]?(\d+)['"]?\s*\)/u)?.[1] ?? null;
      const server = cells[5].cloneNode(true) as Element;
      for (const control of server.querySelectorAll("button")) control.remove();
      const slot = text(cells[0]).match(/\((\d+)\)/u)?.[1];
      webinars.push({
        id,
        scheduled,
        scheduledDate: date,
        slotNumber: slot ? Number(slot) : undefined,
        time: { start: parseTime(start), end: parseTime(end) },
        subject: lesson.subject,
        type: parseLessonType(lesson.type),
        teacher: parseTeacher(lesson.teacherRaw),
        groups: parseGroupsString(lesson.groupsRaw),
        subgroup: lesson.subgroup,
        title: text(cells[2]),
        raw,
        server: text(server),
        completedAt: text(cells[4]) || null,
        joinAvailable: id !== null && !button?.hasAttribute("disabled"),
      });
    }
  }
  return { date, availableDates: [...new Set(availableDates)], webinars };
}

export function parseWebinars(html: string): Webinar[] {
  return parseWebinarPage(html).webinars;
}
