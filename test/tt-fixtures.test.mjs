import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml } from "../dist/common/parse.js";
import { parseFullSchedule } from "../dist/tt/parse/index.js";

const FIXTURE_DIR = new URL("./fixtures/tt/group-schedules/", import.meta.url);
const REQUIRED_GROUP_ID = 8919;
const REQUIRED_PERIODS = [1, 2, 3, 4];
const REQUIRED_GROUP_COUNT = 50;

async function loadCorpus() {
  const files = (await readdir(FIXTURE_DIR))
    .filter((file) => /^group-\d+-period-\d+\.html$/.test(file))
    .sort();

  return Promise.all(
    files.map(async (file) => ({
      file,
      groupId: Number(file.match(/^group-(\d+)-/)?.[1]),
      period: Number(file.match(/-period-(\d+)\.html$/)?.[1]),
      html: await readFile(new URL(file, FIXTURE_DIR), "utf8"),
    })),
  );
}

function normalizeSpace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkup(value) {
  return normalizeSpace(
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:nbsp|#160);/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;/giu, "'"),
  );
}

function htmlLines(html) {
  return html
    .split(/<br\s*\/?\s*>/iu)
    .map(stripMarkup)
    .filter(Boolean);
}

function distanceMarked(value) {
  return /дистанционно|ДОТ/iu.test(value);
}

function isSubgroupLine(value) {
  return /^\d+\s*подгруппа$/iu.test(value);
}

function containsGroupCode(value) {
  return value
    .split(/\s+/u)
    .some((token) => /^[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+$/u.test(token));
}

function parseRawTeacher(value) {
  const trimmed = normalizeSpace(
    value.replace(/\(\s*ДОТ\s*\)/giu, " "),
  );
  if (!trimmed) return { name: "" };

  const positionMatch = trimmed.match(
    /^(доц\.|проф\.|ст\.преп\.|ст\. преп\.|преп\.|асс\.|зав\.каф\.)\s*/u,
  );
  const afterPosition = positionMatch
    ? trimmed.slice(positionMatch[0].length)
    : trimmed;
  const degreeMatch = afterPosition.match(/^([кд]\.[а-яё.-]+н\.)\s*/u);
  const name = degreeMatch
    ? afterPosition.slice(degreeMatch[0].length).trim()
    : afterPosition.trim();

  const teacher = { name };
  if (positionMatch) teacher.position = positionMatch[1];
  if (degreeMatch) teacher.degree = degreeMatch[1];
  return teacher;
}

function parseRawWeeks(value) {
  const match = value.match(/\((\d+)\s*(?:-\s*(\d+)\s*)?нед\.?\)/iu);
  if (!match) return { from: 0, to: 0 };
  const from = Number(match[1]);
  return { from, to: match[2] ? Number(match[2]) : from };
}

function parseRawType(value) {
  const match = value.match(
    /\((лк|пр|лб|зачо|зач|экз|конс|кп|из|гз|крп)\.?\)/iu,
  );
  return match?.[1]?.replace(/\.$/u, "") ?? "";
}

function parseRawParity(html) {
  const match = html.match(/<sup>\s*(\*{1,2})\s*<\/sup>/iu);
  if (!match) return undefined;
  return match[1] === "**" ? "even" : "odd";
}

function parseRawDate(value) {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/u);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

function dateKey(date) {
  if (!date) return undefined;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseRawTime(value) {
  const match = value.match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/u);
  if (!match) return undefined;
  return {
    start: { hours: Number(match[1]), minutes: Number(match[2]) },
    end: { hours: Number(match[3]), minutes: Number(match[4]) },
  };
}

function removeRedDivs(html, redDivs) {
  return redDivs.reduce(
    (result, div) => result.replace(div.outerHTML ?? "", ""),
    html,
  );
}

function subjectElement(element) {
  return element.querySelector('span[style*="color: blue"]');
}

function sourceGroupName(html) {
  const doc = parseHtml(html);
  return doc.querySelector('span.htext span[style*="color: blue"]')?.textContent?.trim();
}

function roomBeforeSubject(html, subject, textValue) {
  const line = htmlLines(html).find((item) => item.includes(subject)) ?? "";
  const subjectIndex = line.indexOf(subject);
  const beforeSubject =
    subjectIndex < 0
      ? ""
      : line.slice(0, subjectIndex).replace(/^\*+\s*/u, "").trim();
  if (distanceMarked(textValue)) return "Дистанционно (ДОТ)";
  return beforeSubject;
}

function rawGroupNames(value) {
  const cleaned = normalizeSpace(value).replace(/\(\s*\d+\s*подгруппа\s*\)/giu, " ");
  const startsGroup = (token) =>
    /^[A-ZА-ЯЁ]{1,}(?:-[A-ZА-ЯЁa-zа-яё0-9]+)+$/u.test(token);
  const groups = [];
  let current = "";
  for (const token of cleaned.split(/\s+/u).filter(Boolean)) {
    if (startsGroup(token)) {
      if (current) groups.push(current);
      current = token;
    } else {
      current = current ? `${current} ${token}` : token;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function rawSubstitution(div) {
  const html = div.innerHTML ?? "";
  const textValue = stripMarkup(html);
  if (!/замена\s*на:/iu.test(textValue)) return undefined;

  const lines = htmlLines(html);
  const roomLine = lines.find((line) => /^Аудитория\s*:/iu.test(line));
  const teacherLine = lines.find((line) => /^Преподаватель\s*:/iu.test(line));
  const room = roomLine?.replace(/^Аудитория\s*:\s*/iu, "").trim() || undefined;
  const teacherValue = teacherLine
    ?.replace(/^Преподаватель\s*:\s*/iu, "")
    .trim();

  return {
    date: parseRawDate(textValue),
    room,
    isDistance: distanceMarked(room ?? textValue),
    teacher: teacherValue ? parseRawTeacher(teacherValue) : undefined,
  };
}

function rawTransfer(div, subject) {
  const html = div.innerHTML ?? "";
  const textValue = stripMarkup(html);
  const match = textValue.match(
    /(\d{2}\.\d{2}\.\d{4})\s*перенос\s*[cс]\s*(\d{2}\.\d{2}\.\d{4})\s*\((\d+)\s*пара\)/iu,
  );
  if (!match) return undefined;

  const subjectLine = htmlLines(html).find((line) => line.includes(subject)) ?? "";
  const lines = htmlLines(html);
  const subjectIndex = lines.indexOf(subjectLine);
  const afterSubject = subjectIndex < 0 ? [] : lines.slice(subjectIndex + 1);
  const room = roomBeforeSubject(html, subject, textValue);
  const teacherLine = afterSubject.find(
    (line) => !isSubgroupLine(line) && !containsGroupCode(line),
  );
  const groupsLine = afterSubject.find((line) => containsGroupCode(line));

  return {
    targetDate: parseRawDate(match[1]),
    fromDate: parseRawDate(match[2]),
    fromSlot: Number(match[3]),
    subject,
    room,
    teacher: parseRawTeacher(teacherLine ?? ""),
    groups: rawGroupNames(groupsLine ?? ""),
  };
}

function rawEntryFromCell(cell, layout) {
  const subjectEl = subjectElement(cell);
  const cellSubject = subjectEl?.textContent?.trim() ?? "";
  if (!cellSubject || /^День самостоятельной работы$/iu.test(cellSubject)) {
    return undefined;
  }

  const redDivs = [
    ...cell.querySelectorAll('div[style*="border: 2px solid red"]'),
  ];
  const transferDiv = redDivs.find((div) => {
    const textValue = stripMarkup(div.innerHTML ?? "");
    return /перенос\s*[cс]/iu.test(textValue) && subjectElement(div);
  });

  const sourceHtml = transferDiv
    ? transferDiv.innerHTML ?? ""
    : removeRedDivs(cell.innerHTML ?? "", redDivs);
  const sourceText = stripMarkup(sourceHtml);
  const sourceSubject =
    subjectElement(transferDiv ?? cell)?.textContent?.trim() ?? cellSubject;
  const sourceLines = htmlLines(sourceHtml);
  const subjectLineIndex = sourceLines.findIndex((line) =>
    line.includes(sourceSubject),
  );
  if (subjectLineIndex < 0) return undefined;

  const afterSubject = sourceLines.slice(subjectLineIndex + 1);
  const teacherLine = afterSubject.find((line) => {
    if (!line || isSubgroupLine(line)) return false;
    if (layout === "session") {
      if (/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/u.test(line)) return false;
      if (containsGroupCode(line)) return false;
    }
    return true;
  });
  const subgroupMatch = sourceText.match(/(\d+)\s*подгруппа/iu);
  const type = parseRawType(sourceText.slice(
    sourceText.indexOf(sourceSubject),
  ));
  const transfer = transferDiv
    ? rawTransfer(transferDiv, sourceSubject)
    : undefined;
  const groups = transfer?.groups ?? [];
  const substitutions = transfer
    ? []
    : redDivs.map(rawSubstitution).filter(Boolean);
  const time = layout === "session"
    ? parseRawTime(sourceHtml)
    : undefined;

  if (layout === "session" && !time) return undefined;

  return {
    subject: sourceSubject,
    type,
    weeks: layout === "semester" && !transfer
      ? parseRawWeeks(sourceText)
      : { from: 0, to: 0 },
    room: roomBeforeSubject(sourceHtml, sourceSubject, sourceText),
    teacher: transfer
      ? transfer.teacher
      : parseRawTeacher(teacherLine ?? ""),
    groups,
    subgroup: subgroupMatch ? Number(subgroupMatch[1]) : undefined,
    weekParity: parseRawParity(sourceHtml),
    isDistance: distanceMarked(sourceText),
    possibleChanges:
      (cell.getAttribute("class") ?? "").split(/\s+/u).includes("want"),
    substitutions,
    transfer,
    time,
  };
}

function rawRows(dataCell, layout) {
  return [...dataCell.querySelectorAll("table tr")]
    .map((row) => rawEntryFromCell(row.querySelector("td") ?? row, layout))
    .filter(Boolean);
}

function rawSemesterDays(doc) {
  const days = [];
  let currentDay;

  for (const row of doc.querySelectorAll("tr")) {
    const style = row.getAttribute("style") ?? "";
    const className = row.getAttribute("class") ?? "";
    if (style.includes("lightgray") && className.includes("trfd")) {
      const weekday = row.querySelector("td")?.textContent?.trim() ?? "";
      if (weekday) {
        currentDay = { weekday, slots: [] };
        days.push(currentDay);
      }
      continue;
    }

    if (!currentDay) continue;
    const timeCell = row.querySelector("td.trf");
    const dataCell = row.querySelector("td.trdata:not(.trf)");
    const timeHtml = timeCell?.querySelector(".trfd")?.innerHTML ?? "";
    const timeText = stripMarkup(timeHtml);
    const numberMatch = timeText.match(/(\d+)\s*пара/u);
    const time = parseRawTime(timeText);
    if (!dataCell || !numberMatch) continue;

    currentDay.slots.push({
      number: Number(numberMatch[1]),
      timeStart: time?.start ?? { hours: 0, minutes: 0 },
      timeEnd: time?.end ?? { hours: 0, minutes: 0 },
      entries: rawRows(dataCell, "semester"),
    });
  }

  return days;
}

function expectedSessionSlotNumber(time) {
  const starts = [
    [8, 20],
    [9, 50],
    [11, 40],
    [13, 30],
    [15, 0],
    [16, 40],
    [18, 10],
    [19, 40],
  ];
  const target = time.hours * 60 + time.minutes;
  let number = 1;
  let difference = Number.POSITIVE_INFINITY;
  starts.forEach(([hours, minutes], index) => {
    const nextDifference = Math.abs(hours * 60 + minutes - target);
    if (nextDifference < difference) {
      number = index + 1;
      difference = nextDifference;
    }
  });
  return number;
}

function rawSessionDays(doc) {
  const days = [];
  for (const dateCell of doc.querySelectorAll('td[id^="trd2"]')) {
    const id = dateCell.getAttribute("id") ?? "";
    const dateMatch = id.match(/trd(\d{4})(\d{2})(\d{2})/u);
    const dataCell = dateCell.nextElementSibling;
    if (!dateMatch || !dataCell?.matches("td.trdata:not(.trfd)")) continue;

    const htmlParts = (dateCell.innerHTML ?? "").split(/<br\s*\/?\s*>/iu);
    const weekday = stripMarkup(htmlParts[1] ?? "");
    const slots = [];
    for (const row of dataCell.querySelectorAll("table tr")) {
      const cell = row.querySelector("td") ?? row;
      const entry = rawEntryFromCell(cell, "session");
      if (!entry?.time) continue;
      slots.push({
        number: expectedSessionSlotNumber(entry.time.start),
        timeStart: entry.time.start,
        timeEnd: entry.time.end,
        entries: [{ ...entry, time: undefined }],
      });
    }

    if (slots.length > 0) {
      days.push({
        weekday,
        date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
        slots,
      });
    }
  }
  return days;
}

function rawFixtureData(html) {
  // Independent source oracle: no schedule parser, manifest, or parser output.
  const doc = parseHtml(html);
  const session = Boolean(doc.querySelector('td[id^="trd2"]'));
  return {
    layout: session ? "session" : "semester",
    days: session ? rawSessionDays(doc) : rawSemesterDays(doc),
  };
}

function entriesFrom(days) {
  return days.flatMap((day) =>
    day.slots.flatMap((slot) =>
      slot.entries.map((entry) => ({ day, slot, entry })),
    ),
  );
}

function normalizedType(value) {
  return value.toLowerCase().replace(/\.$/u, "");
}

function comparableSubstitution(substitution) {
  return {
    date: dateKey(substitution.date),
    room: substitution.room,
    isDistance: Boolean(substitution.isDistance),
    teacher: substitution.teacher ?? undefined,
  };
}

function comparableTransfer(transfer) {
  return transfer
    ? {
        targetDate: dateKey(transfer.targetDate),
        fromDate: dateKey(transfer.fromDate),
        fromSlot: transfer.fromSlot,
        subject: transfer.subject,
      }
    : undefined;
}

function comparableEntry(entry) {
  return {
    subject: entry.subject,
    type: normalizedType(entry.type),
    weeks: entry.weeks,
    room: entry.room,
    teacher: entry.teacher,
    groups: entry.groups,
    subgroup: entry.subgroup,
    weekParity: entry.weekParity,
    isDistance: Boolean(entry.isDistance),
    possibleChanges: Boolean(entry.possibleChanges),
    substitutions: (entry.substitutions ?? []).map(comparableSubstitution),
    transfer: comparableTransfer(entry.transfer),
    substituteFor: entry.substituteFor
      ? {
          date: dateKey(entry.substituteFor.date),
          originalTeacher: entry.substituteFor.originalTeacher,
        }
      : undefined,
  };
}

function expectedComparableEntry(entry) {
  return {
    subject: entry.subject,
    type: normalizedType(entry.type),
    weeks: entry.weeks,
    room: entry.room,
    teacher: entry.teacher,
    groups: entry.groups,
    subgroup: entry.subgroup,
    weekParity: entry.weekParity,
    isDistance: entry.isDistance,
    possibleChanges: entry.possibleChanges,
    substitutions: entry.substitutions,
    transfer: entry.transfer
      ? {
          targetDate: entry.transfer.targetDate,
          fromDate: entry.transfer.fromDate,
          fromSlot: entry.transfer.fromSlot,
          subject: entry.transfer.subject,
        }
      : undefined,
    substituteFor: undefined,
  };
}

function assertRawScheduleMatches(parsedDays, rawDays, file) {
  assert.equal(parsedDays.length, rawDays.length, `${file}: day count changed`);
  for (const [dayIndex, rawDay] of rawDays.entries()) {
    const parsedDay = parsedDays[dayIndex];
    assert.equal(parsedDay.weekday, rawDay.weekday, `${file}: weekday changed`);
    if (rawDay.date) {
      assert.equal(dateKey(parsedDay.date), rawDay.date, `${file}: date changed`);
    } else {
      assert.equal(parsedDay.date, undefined, `${file}: semester date leaked`);
    }
    assert.equal(
      parsedDay.slots.length,
      rawDay.slots.length,
      `${file}: slot count changed on ${rawDay.weekday}`,
    );

    for (const [slotIndex, rawSlot] of rawDay.slots.entries()) {
      const parsedSlot = parsedDay.slots[slotIndex];
      assert.equal(parsedSlot.number, rawSlot.number, `${file}: slot number changed`);
      assert.deepEqual(
        parsedSlot.timeStart,
        rawSlot.timeStart,
        `${file}: slot start changed`,
      );
      assert.deepEqual(
        parsedSlot.timeEnd,
        rawSlot.timeEnd,
        `${file}: slot end changed`,
      );
      assert.equal(
        parsedSlot.entries.length,
        rawSlot.entries.length,
        `${file}: entry count changed in slot ${rawSlot.number}`,
      );

      for (const [entryIndex, rawEntry] of rawSlot.entries.entries()) {
        assert.deepEqual(
          comparableEntry(parsedSlot.entries[entryIndex]),
          expectedComparableEntry(rawEntry),
          `${file}: parsed fields changed for ${rawEntry.subject}`,
        );
      }
    }
  }
}

test("group fixture corpus parses every recorded group, slot, entry, and period", async () => {
  const fixtures = await loadCorpus();
  const groupIds = new Set(fixtures.map((fixture) => fixture.groupId));
  const periods = new Set(fixtures.map((fixture) => fixture.period));
  assert.equal(
    fixtures.length,
    REQUIRED_GROUP_COUNT * REQUIRED_PERIODS.length,
    "fixture corpus must contain one source page per group and period",
  );
  assert.equal(groupIds.size, REQUIRED_GROUP_COUNT, "group sample size changed");
  assert.deepEqual([...periods].sort((a, b) => a - b), REQUIRED_PERIODS);
  const requiredFixture = fixtures.find(
    (fixture) => fixture.groupId === REQUIRED_GROUP_ID && fixture.period === 1,
  );
  assert.ok(requiredFixture, "КТ-41-24 fixture missing");
  assert.equal(
    sourceGroupName(requiredFixture.html),
    "КТ-41-24",
    "required group id no longer points to КТ-41-24",
  );

  for (const groupId of groupIds) {
    const groupPeriods = fixtures
      .filter((fixture) => fixture.groupId === groupId)
      .map((fixture) => fixture.period)
      .sort((a, b) => a - b);
    assert.deepEqual(groupPeriods, REQUIRED_PERIODS, `group ${groupId}: period missing`);
  }

  const coverage = {
    entries: 0,
    semester: 0,
    session: 0,
    distance: 0,
    teacher: 0,
    room: 0,
    subgroup: 0,
    parity: 0,
    possibleChanges: 0,
    substitutions: 0,
    transfers: 0,
    types: new Set(),
  };

  for (const fixture of fixtures) {
    const raw = rawFixtureData(fixture.html);
    const parsed = parseFullSchedule(fixture.html);
    assertRawScheduleMatches(parsed, raw.days, fixture.file);

    coverage[raw.layout]++;
    for (const { entry } of entriesFrom(raw.days)) {
      coverage.entries++;
      coverage.types.add(normalizedType(entry.type));
      if (entry.room) coverage.room++;
      if (entry.teacher.name) coverage.teacher++;
      if (entry.subgroup != null) coverage.subgroup++;
      if (entry.weekParity) coverage.parity++;
      if (entry.isDistance) coverage.distance++;
      if (entry.possibleChanges) coverage.possibleChanges++;
      coverage.substitutions += entry.substitutions.length;
      if (entry.transfer) coverage.transfers++;
    }
  }

  assert.ok(coverage.entries > 0, "fixture corpus has no source lessons");
  assert.ok(coverage.semester > 0, "semester layout is not covered");
  assert.ok(coverage.distance > 0, "distance lessons are not covered");
  assert.ok(coverage.teacher > 0, "teacher fields are not covered");
  assert.ok(coverage.room > 0, "room fields are not covered");
  assert.ok(coverage.subgroup > 0, "subgroup fields are not covered");
  assert.ok(coverage.parity > 0, "week parity is not covered");
  assert.ok(coverage.possibleChanges > 0, "possible-change entries are not covered");
  assert.ok(coverage.substitutions > 0, "substitution overlays are not covered");
  assert.ok(coverage.transfers > 0, "transfer overlays are not covered");
  for (const type of ["из", "гз", "крп"]) {
    assert.ok(coverage.types.has(type), `${type} lesson type is not covered`);
  }
});
