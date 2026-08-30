import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseHtml } from "../dist/common/parse.js";

const FIXTURE_DIR = resolve("test/fixtures/tt/group-schedules");
const EXPECTED_DIR = resolve("test/fixtures/tt/expected");

function normalizeSpace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function text(element) {
  return normalizeSpace(element?.textContent ?? "");
}

function html(element) {
  return element?.innerHTML ?? "";
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

function linesFromHtml(value) {
  return value
    .split(/<br\s*\/?\s*>/iu)
    .map(stripMarkup)
    .filter(Boolean);
}

function dateText(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function timeFromText(value) {
  const match = value.match(
    /(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/u,
  );
  assert.ok(match, `time missing in source: ${value}`);
  return {
    start: { hours: Number(match[1]), minutes: Number(match[2]) },
    end: { hours: Number(match[3]), minutes: Number(match[4]) },
  };
}

function sourceGroupName(doc) {
  return text(doc.querySelector('span.htext span[style*="color: blue"]'));
}

function subjectCell(row) {
  const cell = row.querySelector("td") ?? row;
  const subject = cell.querySelector('span[style*="color: blue"]');
  if (!subject || subject.closest("td") !== cell) return null;
  const subjectName = text(subject);
  if (!subjectName || /^День самостоятельной работы$/iu.test(subjectName)) {
    return null;
  }
  return cell;
}

function sourceSemester(doc) {
  const days = [];
  let currentDay;

  for (const row of doc.querySelectorAll("tr")) {
    const style = row.getAttribute("style") ?? "";
    const className = row.getAttribute("class") ?? "";
    if (style.includes("lightgray") && className.includes("trfd")) {
      const weekday = text(row.querySelector("td"));
      if (weekday) {
        currentDay = { weekday, slots: [] };
        days.push(currentDay);
      }
      continue;
    }

    if (!currentDay) continue;
    const timeCell = row.querySelector("td.trf");
    const dataCell = row.querySelector("td.trdata:not(.trf)");
    const timeDiv = timeCell?.querySelector(".trfd");
    if (!timeDiv || !dataCell) continue;

    const timeValue = text(timeDiv);
    const numberMatch = timeValue.match(/(\d+)\s*пара/u);
    if (!numberMatch) continue;
    const time = timeFromText(timeValue);
    const entries = [...dataCell.querySelectorAll("table tr")]
      .map(subjectCell)
      .filter(Boolean);

    currentDay.slots.push({
      number: Number(numberMatch[1]),
      timeStart: time.start,
      timeEnd: time.end,
      entries,
    });
  }
  return days;
}

function sourceSession(doc) {
  const days = [];
  for (const dateCell of doc.querySelectorAll('td[id^="trd2"]')) {
    const id = dateCell.getAttribute("id") ?? "";
    const match = id.match(/trd(\d{4})(\d{2})(\d{2})/u);
    const dataCell = dateCell.nextElementSibling;
    if (!match || !dataCell?.matches("td.trdata:not(.trfd)")) continue;

    const date = `${match[1]}-${match[2]}-${match[3]}`;
    const dateParts = (html(dateCell).split(/<br\s*\/?\s*>/iu));
    const weekday = normalizeSpace(
      dateParts[1]?.replace(/<[^>]*>/g, " ") ?? "",
    );
    const slots = [];
    for (const row of dataCell.querySelectorAll("table tr")) {
      const cell = subjectCell(row);
      if (!cell) continue;
      const time = timeFromText(text(cell));
      slots.push({
        number: null,
        timeStart: time.start,
        timeEnd: time.end,
        entries: [cell],
      });
    }
    if (slots.length > 0) days.push({ weekday, date, slots });
  }
  return days;
}

function sourceSchedule(doc) {
  const session = Boolean(doc.querySelector('td[id^="trd2"]'));
  return {
    layout: session ? "session" : "semester",
    days: session ? sourceSession(doc) : sourceSemester(doc),
  };
}

function assertTextContains(source, value, label) {
  assert.ok(
    source.includes(normalizeSpace(value)),
    `${label}: ${JSON.stringify(value)} absent from source cell ${JSON.stringify(source)}`,
  );
}

function assertLessonType(source, expected, label) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    source,
    new RegExp(`\\(${escaped}\\.?\\)`, "iu"),
    `${label}: lesson type absent from source cell`,
  );
}

function assertWeeks(source, weeks, label) {
  if (weeks.from === 0 && weeks.to === 0) return;
  const range = weeks.from === weeks.to
    ? `${weeks.from}\\s*нед\\.?`
    : `${weeks.from}\\s*-\\s*${weeks.to}\\s*нед\\.?`;
  assert.match(source, new RegExp(`\\(${range}\\)`, "iu"), `${label}: weeks absent`);
}

function assertParity(cell, parity, label) {
  if (!parity) return;
  const marker = text(cell.querySelector("sup"));
  assert.equal(
    marker,
    parity === "even" ? "**" : "*",
    `${label}: week parity differs in source`,
  );
}

function redOverlays(cell) {
  return [...cell.querySelectorAll('div[style*="border: 2px solid red"]')];
}

function coreHtml(cell, expected) {
  const overlays = redOverlays(cell);
  if (expected.transfer) {
    return overlays.find((div) => /перенос\s*[cс]/iu.test(text(div)))?.innerHTML ?? "";
  }
  return overlays.reduce(
    (value, overlay) => value.replace(overlay.outerHTML ?? "", ""),
    html(cell),
  );
}

function expectedTeacherLine(teacher) {
  return normalizeSpace(
    [teacher.position, teacher.degree, teacher.name].filter(Boolean).join(" "),
  );
}

function assertCoreEntryLines(cell, expected, label) {
  const sourceHtml = coreHtml(cell, expected);
  const sourceLines = linesFromHtml(sourceHtml);
  const subjectLineIndex = sourceLines.findIndex((line) => line.includes(expected.subject));
  assert.ok(subjectLineIndex >= 0, `${label}: subject line absent from source`);

  const subjectLine = sourceLines[subjectLineIndex];
  const subjectIndex = subjectLine.indexOf(expected.subject);
  const room = subjectLine
    .slice(0, subjectIndex)
    .replace(/^\*+\s*/u, "")
    .trim();
  if (!expected.isDistance) {
    assert.equal(room, expected.room, `${label}: raw room differs`);
  }

  const teacherLine = sourceLines
    .slice(subjectLineIndex + 1)
    .find((line) => !/^\d+\s*подгруппа$/iu.test(line)) ?? "";
  assert.equal(
    teacherLine.replace(/\(\s*ДОТ\s*\)/giu, "").replace(/\s+/g, " ").trim(),
    expectedTeacherLine(expected.teacher),
    `${label}: raw teacher differs`,
  );

  const subgroupMatch = stripMarkup(sourceHtml).match(/(\d+)\s*подгруппа/iu);
  assert.equal(
    subgroupMatch ? Number(subgroupMatch[1]) : null,
    expected.subgroup,
    `${label}: raw subgroup differs`,
  );
}

function assertSubstitutions(cell, expected, label) {
  const overlays = redOverlays(cell).filter((div) => /замена\s*на:/iu.test(text(div)));
  assert.equal(overlays.length, expected.length, `${label}: substitution count differs`);
  for (const substitution of expected) {
    const overlay = overlays.find((candidate) => {
      const value = text(candidate);
      return !substitution.date || value.includes(dateText(substitution.date));
    });
    assert.ok(overlay, `${label}: substitution date absent from source`);
    const value = text(overlay);
    if (substitution.room && !substitution.isDistance) {
      assertTextContains(value, substitution.room, `${label}: substitution room`);
    }
    if (substitution.isDistance) {
      assert.match(value, /дистанционно|ДОТ/iu, `${label}: substitution distance marker absent`);
    }
    if (substitution.teacher?.name) {
      assertTextContains(value, substitution.teacher.name, `${label}: substitution teacher`);
    }
  }
}

function assertTransfer(cell, expected, label) {
  const overlays = redOverlays(cell).filter((div) => /перенос\s*[cс]/iu.test(text(div)));
  assert.equal(Boolean(expected), overlays.length > 0, `${label}: transfer marker differs`);
  if (!expected) return;

  const value = text(overlays[0]);
  assertTextContains(value, dateText(expected.targetDate), `${label}: transfer target date`);
  assertTextContains(value, dateText(expected.fromDate), `${label}: transfer source date`);
  assertTextContains(value, `${expected.fromSlot} пара`, `${label}: transfer source slot`);
  assertTextContains(value, expected.subject, `${label}: transfer subject`);
  for (const group of expected.groups ?? []) {
    assertTextContains(value, group, `${label}: transfer group`);
  }
}

function assertEntrySource(cell, expected, label) {
  const source = text(cell);
  const markup = html(cell);
  assertCoreEntryLines(cell, expected, label);
  assertTextContains(source, expected.subject, `${label}: subject`);
  assertLessonType(source, expected.type, label);
  assertWeeks(source, expected.weeks, label);

  if (expected.room && !expected.isDistance) {
    assertTextContains(source, expected.room, `${label}: room`);
  }
  if (expected.teacher.name) {
    assertTextContains(source, expected.teacher.name, `${label}: teacher name`);
  }
  if (expected.teacher.position) {
    assertTextContains(source, expected.teacher.position, `${label}: teacher position`);
  }
  if (expected.teacher.degree) {
    assertTextContains(source, expected.teacher.degree, `${label}: teacher degree`);
  }
  for (const group of expected.groups ?? []) {
    assertTextContains(source, group, `${label}: group`);
  }
  if (expected.subgroup != null) {
    assert.match(
      source,
      new RegExp(`${expected.subgroup}\\s*подгруппа`, "iu"),
      `${label}: subgroup absent`,
    );
  }
  if (expected.possibleChanges) {
    assert.ok(
      (cell.getAttribute("class") ?? "").split(/\s+/u).includes("want"),
      `${label}: possible-change marker absent`,
    );
  }
  assert.equal(
    (cell.getAttribute("class") ?? "").split(/\s+/u).includes("want"),
    expected.possibleChanges,
    `${label}: possible-change marker differs`,
  );
  if (expected.isDistance) {
    assert.match(source, /дистанционно|ДОТ/iu, `${label}: distance marker absent`);
  }
  if (expected.weekParity) assertParity(cell, expected.weekParity, label);
  assertSubstitutions(cell, expected.substitutions, label);
  assertTransfer(cell, expected.transfer, label);

  if (expected.layout === "session") {
    assert.match(markup, /\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/u, `${label}: session time absent`);
  }
}

async function loadPairs() {
  const fixtureFiles = (await readdir(FIXTURE_DIR))
    .filter((file) => /^group-\d+-period-\d+\.html$/.test(file))
    .sort();
  const expectedFiles = (await readdir(EXPECTED_DIR))
    .filter((file) => /^group-\d+-period-\d+\.json$/.test(file))
    .sort();
  assert.deepEqual(
    expectedFiles,
    fixtureFiles.map((file) => file.replace(/\.html$/u, ".json")),
    "source and expected file indexes differ",
  );
  return Promise.all(fixtureFiles.map(async (file) => ({
    file,
    html: await readFile(join(FIXTURE_DIR, file), "utf8"),
    expected: JSON.parse(
      await readFile(join(EXPECTED_DIR, file.replace(/\.html$/u, ".json")), "utf8"),
    ),
  })));
}

const pairs = await loadPairs();
let slotCount = 0;
let entryCount = 0;

for (const { file, html: sourceHtml, expected } of pairs) {
  const doc = parseHtml(sourceHtml);
  const source = sourceSchedule(doc);
  assert.equal(source.layout, expected.layout, `${file}: layout differs from source`);
  assert.equal(sourceGroupName(doc), expected.groupName, `${file}: group differs from source`);
  assert.equal(source.days.length, expected.days.length, `${file}: day count differs from source`);

  for (const [dayIndex, expectedDay] of expected.days.entries()) {
    const sourceDay = source.days[dayIndex];
    assert.equal(sourceDay.weekday, expectedDay.weekday, `${file}: weekday ${dayIndex}`);
    assert.equal(sourceDay.date ?? null, expectedDay.date, `${file}: date ${dayIndex}`);
    assert.equal(sourceDay.slots.length, expectedDay.slots.length, `${file}: slot count ${dayIndex}`);

    for (const [slotIndex, expectedSlot] of expectedDay.slots.entries()) {
      const sourceSlot = sourceDay.slots[slotIndex];
      assert.equal(sourceSlot.number, expectedSlot.number, `${file}: slot number ${dayIndex}/${slotIndex}`);
      assert.deepEqual(sourceSlot.timeStart, expectedSlot.timeStart, `${file}: start time ${dayIndex}/${slotIndex}`);
      assert.deepEqual(sourceSlot.timeEnd, expectedSlot.timeEnd, `${file}: end time ${dayIndex}/${slotIndex}`);
      assert.equal(sourceSlot.entries.length, expectedSlot.entries.length, `${file}: entry count ${dayIndex}/${slotIndex}`);
      slotCount++;

      for (const [entryIndex, expectedEntry] of expectedSlot.entries.entries()) {
        assertEntrySource(
          sourceSlot.entries[entryIndex],
          { ...expectedEntry, layout: expected.layout },
          `${file}:${dayIndex}/${slotIndex}/${entryIndex}`,
        );
        entryCount++;
      }
    }
  }
}

console.log(JSON.stringify({ files: pairs.length, slots: slotCount, entries: entryCount }));
