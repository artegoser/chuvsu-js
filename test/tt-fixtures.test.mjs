import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml } from "../dist/common/parse.js";
import { parseFullSchedule } from "../dist/tt/parse/index.js";

const FIXTURE_DIR = new URL("./fixtures/tt/group-schedules/", import.meta.url);
const EXPECTED_DIR = new URL("./fixtures/tt/expected/", import.meta.url);

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

function entriesFrom(days) {
  return days.flatMap((day) =>
    day.slots.flatMap((slot) =>
      slot.entries.map((entry) => ({ day, slot, entry })),
    ),
  );
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map());
}

function stripMarkup(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeRawRoom(value) {
  if (/:\s*\S+$/u.test(value) && /перенос|замен/iu.test(value)) {
    return value.slice(value.lastIndexOf(":") + 1).trim();
  }
  return value;
}

function rawFixtureData(html) {
  // Keep the source-side oracle independent from parseFullSchedule.
  const doc = parseHtml(html);
  const cells = [...doc.querySelectorAll("td")].filter((cell) => {
    const subject = cell.querySelector('span[style*="color: blue"]');
    const subjectText = subject?.textContent?.trim() ?? "";
    return (
      subject?.closest("td") === cell &&
      subjectText &&
      !/^День самостоятельной работы$/iu.test(subjectText)
    );
  });

  return {
    layout: doc.querySelector('td[id^="trd2"]') ? "session" : "semester",
    entries: cells.map((cell) => {
      const subjectElement = cell.querySelector('span[style*="color: blue"]');
      const subject = subjectElement?.textContent?.trim() ?? "";
      const text = cell.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const subjectIndex = text.indexOf(subject);
      const beforeSubject = text
        .slice(0, subjectIndex)
        .replace(/^\*+\s*/, "")
        .trim();
      const lines = (cell.innerHTML ?? "")
        .split(/<br\s*\/?\s*>/iu)
        .map(stripMarkup)
        .filter(Boolean);
      const teacher = lines
        .slice(1)
        .find((line) => !/^\d+\s*подгруппа$/iu.test(line)) ?? "";

      return {
        subject,
        room: /дистанционно|ДОТ/iu.test(beforeSubject)
          ? "Дистанционно (ДОТ)"
          : normalizeRawRoom(beforeSubject),
        hasTeacher: Boolean(teacher),
        isDistance: /дистанционно|ДОТ/iu.test(text),
      };
    }),
  };
}

test("group fixture corpus parses every recorded pair", async () => {
  const fixtures = await loadCorpus();
  assert.ok(fixtures.length >= 50, "fixture corpus unexpectedly small");
  assert.ok(new Set(fixtures.map((fixture) => fixture.groupId)).size >= 50);
  assert.ok(new Set(fixtures.map((fixture) => fixture.period)).has(1));
  assert.ok(fixtures.some((fixture) => fixture.groupId === 8919));

  let totalEntries = 0;
  let semesterFixtures = 0;

  for (const fixture of fixtures) {
    const raw = rawFixtureData(fixture.html);
    const days = parseFullSchedule(fixture.html);
    const parsed = entriesFrom(days);
    const subjectCounts = countValues(parsed.map(({ entry }) => entry.subject));
    const expectedSubjectCounts = countValues(
      raw.entries.map(({ subject }) => subject),
    );

    assert.equal(
      parsed.length,
      raw.entries.length,
      `${fixture.file}: pair count changed`,
    );
    assert.deepEqual(
      subjectCounts,
      expectedSubjectCounts,
      `${fixture.file}: subject set changed`,
    );

    for (const [index, { entry }] of parsed.entries()) {
      const expected = raw.entries[index];
      assert.ok(entry.subject, `${fixture.file}: subject missing`);
      assert.ok(entry.type, `${fixture.file}: lesson type missing`);
      if (expected.room) {
        assert.equal(
          entry.room,
          expected.room,
          `${fixture.file}: room changed for ${entry.subject}`,
        );
      }
      if (expected.hasTeacher) {
        assert.ok(
          entry.teacher.name,
          `${fixture.file}: teacher missing for ${entry.subject}`,
        );
      }
      assert.ok(
        !entry.teacher.name.includes("ДОТ"),
        `${fixture.file}: remote marker leaked into teacher`,
      );
      if (expected.isDistance) {
        assert.equal(entry.isDistance, true);
        assert.equal(entry.room, "Дистанционно (ДОТ)");
      }
    }

    if (raw.layout === "session") {
      if (parsed.length > 0) {
        assert.ok(days.every((day) => day.date), `${fixture.file}: session date missing`);
      }
    } else {
      semesterFixtures++;
      assert.ok(days.every((day) => !day.date), `${fixture.file}: semester date leaked`);
    }

    totalEntries += parsed.length;
  }

  assert.ok(totalEntries >= 59, "fixture corpus unexpectedly small");
  assert.ok(semesterFixtures > 0, "semester layout is not covered");
});

test("KT-41-24 fixture locks remote teacher and room fields", async () => {
  const fixtures = await loadCorpus();
  const expected = JSON.parse(
    await readFile(new URL("kt-41-24-period-1.json", EXPECTED_DIR), "utf8"),
  );
  const fixture = fixtures.find(
    (item) =>
      item.groupId === expected.groupId && item.period === expected.period,
  );
  assert.ok(fixture, `${expected.group} fixture missing`);

  const parsed = entriesFrom(parseFullSchedule(fixture.html));
  const remote = parsed.filter(({ entry }) => entry.isDistance);

  assert.equal(parsed.length, expected.entryCount);
  assert.equal(remote.length, expected.remoteEntryCount);
  assert.ok(remote.every(({ entry }) => entry.room === expected.remoteRoom));
  assert.ok(remote.every(({ entry }) => entry.teacher.name));
  const remoteTeachers = [
    ...new Set(remote.map(({ entry }) => entry.teacher.name)),
  ];
  assert.deepEqual(
    remoteTeachers.sort(),
    [...expected.remoteTeachers].sort(),
  );
});
