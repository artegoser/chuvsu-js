import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseAcademicYearFromPage,
  parseGroupSchedule,
} from "../dist/tt/parse/index.js";
import { createScheduleSourceSnapshot } from "../dist/tt/observations.js";
import { TimetableRepository } from "../dist/tt/domain/repository.js";

const FIXTURE_DIR = new URL("./fixtures/tt/group-schedules/", import.meta.url);
const EXPECTED_DIR = new URL("./fixtures/tt/expected/", import.meta.url);
const REQUIRED_GROUP_ID = 8919;
const REQUIRED_PERIODS = [1];
const REQUIRED_GROUP_COUNT = 34;

async function loadCorpus() {
  const fixtureFiles = (await readdir(FIXTURE_DIR))
    .filter((file) => /^group-\d+-period-\d+\.html$/.test(file))
    .sort();
  const expectedFiles = (await readdir(EXPECTED_DIR))
    .filter((file) => /^group-\d+-period-\d+\.json$/.test(file))
    .sort();

  assert.deepEqual(
    expectedFiles,
    fixtureFiles.map((file) => file.replace(/\.html$/u, ".json")),
    "fixture and static expectation indexes differ",
  );

  return Promise.all(
    fixtureFiles.map(async (file) => ({
      file,
      groupId: Number(file.match(/^group-(\d+)-/)?.[1]),
      period: Number(file.match(/-period-(\d+)\.html$/)?.[1]),
      html: await readFile(new URL(file, FIXTURE_DIR), "utf8"),
      expected: JSON.parse(
        await readFile(
          new URL(file.replace(/\.html$/u, ".json"), EXPECTED_DIR),
          "utf8",
        ),
      ),
    })),
  );
}

function dateKey(date) {
  if (!date) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function actualSubstitution(substitution) {
  return {
    date: dateKey(substitution.date),
    room: substitution.room ?? null,
    isDistance: Boolean(substitution.isDistance),
    teacher: substitution.teacher ?? null,
  };
}

function actualTransfer(transfer) {
  return transfer
    ? {
        targetDate: dateKey(transfer.targetDate),
        fromDate: dateKey(transfer.fromDate),
        fromSlot: transfer.fromSlot,
        subject: transfer.subject,
      }
    : null;
}

function actualEntry(entry, layout) {
  return {
    subject: entry.subject,
    type: layout === "session" ? entry.type.toLowerCase() : entry.type,
    weeks: entry.weeks,
    room: entry.room,
    teacher: entry.teacher,
    groups: entry.groups,
    subgroup: entry.subgroup ?? null,
    weekParity: entry.weekParity ?? null,
    isDistance: Boolean(entry.isDistance),
    possibleChanges: Boolean(entry.possibleChanges),
    substitutions: (entry.substitutions ?? []).map(actualSubstitution),
    transfer: actualTransfer(entry.transfer),
    substituteFor: entry.substituteFor
      ? {
          date: dateKey(entry.substituteFor.date),
          originalTeacher: entry.substituteFor.originalTeacher,
        }
      : null,
  };
}

function assertExpectedShape(expected, fixture) {
  assert.equal(expected.schemaVersion, 1, `${fixture.file}: schema changed`);
  assert.equal(expected.file, fixture.file, `${fixture.file}: file index changed`);
  assert.equal(expected.groupId, fixture.groupId, `${fixture.file}: group id changed`);
  assert.equal(expected.period, fixture.period, `${fixture.file}: period changed`);
  assert.ok(expected.groupName, `${fixture.file}: expected group name missing`);
  assert.ok(
    expected.layout === "semester" || expected.layout === "session",
    `${fixture.file}: expected layout invalid`,
  );
  assert.ok(Array.isArray(expected.days), `${fixture.file}: expected days missing`);

  for (const [dayIndex, day] of expected.days.entries()) {
    assert.equal(day.index, dayIndex, `${fixture.file}: day index is not stable`);
    assert.ok(day.weekday, `${fixture.file}: weekday missing at ${dayIndex}`);
    if ("isSelfStudyDay" in day) {
      assert.equal(
        typeof day.isSelfStudyDay,
        "boolean",
        `${fixture.file}: self-study marker invalid at ${dayIndex}`,
      );
    }
    assert.ok(Array.isArray(day.slots), `${fixture.file}: slots missing at ${dayIndex}`);
    for (const [slotIndex, slot] of day.slots.entries()) {
      assert.equal(
        slot.index,
        slotIndex,
        `${fixture.file}: slot index is not stable at day ${dayIndex}`,
      );
      assert.ok(Number.isInteger(slot.number), `${fixture.file}: slot number missing`);
      assert.ok(Array.isArray(slot.entries), `${fixture.file}: entries missing`);
      for (const [entryIndex, entry] of slot.entries.entries()) {
        assert.equal(
          entry.index,
          entryIndex,
          `${fixture.file}: entry index is not stable at ${dayIndex}/${slotIndex}`,
        );
        assert.ok(entry.subject, `${fixture.file}: subject missing at ${dayIndex}/${slotIndex}/${entryIndex}`);
        assert.equal(typeof entry.type, "string");
        assert.deepEqual(Object.keys(entry.weeks).sort(), ["from", "to"]);
        assert.equal(typeof entry.room, "string");
        assert.equal(typeof entry.teacher?.name, "string");
        assert.ok(Array.isArray(entry.groups));
        assert.equal(typeof entry.isDistance, "boolean");
        assert.equal(typeof entry.possibleChanges, "boolean");
        assert.ok(Array.isArray(entry.substitutions));
        assert.ok("transfer" in entry);
        assert.ok("substituteFor" in entry);
      }
    }
  }
}

function compareFixture(fixture) {
  const { expected } = fixture;
  assertExpectedShape(expected, fixture);
  assert.ok(expected.days.length > 0, `${fixture.file}: empty schedule fixture included`);

  const parsedDays = parseGroupSchedule(fixture.html);
  assert.equal(parsedDays.length, expected.days.length, `${fixture.file}: day count changed`);

  for (const [dayIndex, expectedDay] of expected.days.entries()) {
    const parsedDay = parsedDays[dayIndex];
    assert.equal(parsedDay.weekday, expectedDay.weekday, `${fixture.file}: weekday changed`);
    assert.equal(dateKey(parsedDay.date), expectedDay.date, `${fixture.file}: date changed`);
    assert.equal(
      Boolean(parsedDay.isSelfStudyDay),
      Boolean(expectedDay.isSelfStudyDay),
      `${fixture.file}: self-study marker changed at day ${dayIndex}`,
    );
    assert.equal(
      parsedDay.slots.length,
      expectedDay.slots.length,
      `${fixture.file}: slot count changed at day ${dayIndex}`,
    );

    for (const [slotIndex, expectedSlot] of expectedDay.slots.entries()) {
      const parsedSlot = parsedDay.slots[slotIndex];
      assert.equal(parsedSlot.number, expectedSlot.number, `${fixture.file}: slot number changed at ${dayIndex}/${slotIndex}`);
      assert.deepEqual(parsedSlot.timeStart, expectedSlot.timeStart, `${fixture.file}: slot start changed at ${dayIndex}/${slotIndex}`);
      assert.deepEqual(parsedSlot.timeEnd, expectedSlot.timeEnd, `${fixture.file}: slot end changed at ${dayIndex}/${slotIndex}`);
      assert.equal(
        parsedSlot.entries.length,
        expectedSlot.entries.length,
        `${fixture.file}: entry count changed at ${dayIndex}/${slotIndex}`,
      );

      for (const [entryIndex, expectedEntry] of expectedSlot.entries.entries()) {
        const parsedEntry = parsedSlot.entries[entryIndex];
        assert.deepEqual(
          actualEntry(parsedEntry, expected.layout),
          {
            subject: expectedEntry.subject,
            type: expectedEntry.type,
            weeks: expectedEntry.weeks,
            room: expectedEntry.room,
            teacher: expectedEntry.teacher,
            groups: expectedEntry.groups,
            subgroup: expectedEntry.subgroup,
            weekParity: expectedEntry.weekParity,
            isDistance: expectedEntry.isDistance,
            possibleChanges: expectedEntry.possibleChanges,
            substitutions: expectedEntry.substitutions,
            transfer: expectedEntry.transfer,
            substituteFor: expectedEntry.substituteFor,
          },
          `${fixture.file}: fields changed at ${dayIndex}/${slotIndex}/${entryIndex} (${expectedEntry.subject})`,
        );
      }
    }
  }
}

function assertCanonicalFixture(fixture) {
  let seriesSequence = 0;
  let lessonSequence = 0;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: () => `ser_fixture_${++seriesSequence}`,
      lessonId: () => `les_fixture_${++lessonSequence}`,
    },
  });
  const parsedDays = parseGroupSchedule(fixture.html);
  const academicYearStartYear = parseAcademicYearFromPage(fixture.html);
  assert.ok(academicYearStartYear != null, `${fixture.file}: academic year missing`);
  const owner = {
    type: "group",
    group: { id: fixture.groupId, name: fixture.expected.groupName },
  };
  const snapshot = createScheduleSourceSnapshot({
    sourceKey: `fixture:${fixture.file}`,
    owner,
    academicYearStartYear,
    period: fixture.period,
    observedAt: new Date("2026-08-30T00:00:00.000Z"),
    days: parsedDays,
  });
  const result = repository.ingest(snapshot);
  const series = repository.getSeries({ owner });
  const occurrences = repository.getDirectOccurrences({ owner });
  const canonical = new Map([
    ...series.map((value) => [value.id, value]),
    ...occurrences.map((value) => [value.id, value]),
  ]);
  const exported = repository.export();
  const links = exported.links.filter(
    (value) => value.sourceKey === snapshot.sourceKey,
  );

  assert.equal(
    links.length,
    snapshot.observations.length,
    `${fixture.file}: every observation must have an identity`,
  );
  assert.equal(
    new Set(links.map((value) => value.id)).size,
    links.length,
    `${fixture.file}: distinct source rows unexpectedly share an identity`,
  );
  assert.equal(result.created, snapshot.observations.length);

  for (const observation of snapshot.observations) {
    const link = links.find(
      (value) => value.observationKey === observation.key,
    );
    assert.ok(link?.id, `${fixture.file}/${observation.key}: ID missing`);
    assert.match(
      link.id,
      observation.kind === "series" ? /^ser_/ : /^les_/,
      `${fixture.file}/${observation.key}: wrong ID kind`,
    );
    const value = canonical.get(link.id);
    assert.ok(value, `${fixture.file}/${observation.key}: canonical value missing`);
    assert.equal(value.subject, observation.subject);
    assert.equal(value.type, observation.type);
    assert.equal(value.slot.number, observation.slot.number);
    assert.ok(
      value.groups.some((group) => group.group.id === fixture.groupId),
      `${fixture.file}/${observation.key}: implicit group ID missing`,
    );
  }
}

const fixtures = await loadCorpus();

for (const fixture of fixtures) {
  test(`group fixture ${fixture.file} matches static JSON by index`, () => {
    compareFixture(fixture);
  });

  test(`group fixture ${fixture.file} has canonical v5 identities`, () => {
    assertCanonicalFixture(fixture);
  });
}

test("group fixture index and feature coverage", () => {
  const groupIds = new Set(fixtures.map((fixture) => fixture.groupId));
  const periods = new Set(fixtures.map((fixture) => fixture.period));
  assert.equal(
    fixtures.length,
    REQUIRED_GROUP_COUNT * REQUIRED_PERIODS.length,
    "fixture corpus must contain one expectation per group and period",
  );
  assert.equal(groupIds.size, REQUIRED_GROUP_COUNT, "group sample size changed");
  assert.deepEqual([...periods].sort((a, b) => a - b), REQUIRED_PERIODS);

  const requiredFixture = fixtures.find(
    (fixture) => fixture.groupId === REQUIRED_GROUP_ID && fixture.period === 1,
  );
  assert.ok(requiredFixture, "КТ-41-24 fixture missing");
  assert.equal(requiredFixture.expected.groupName, "КТ-41-24");

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
    selfStudyDays: 0,
    types: new Set(),
  };

  for (const fixture of fixtures) {
    const { expected } = fixture;
    assertExpectedShape(expected, fixture);
    assert.ok(expected.days.length > 0, `${fixture.file}: empty schedule fixture included`);
    coverage[expected.layout]++;
    for (const expectedDay of expected.days) {
      if (expectedDay.isSelfStudyDay) coverage.selfStudyDays++;
      for (const expectedSlot of expectedDay.slots) {
        for (const expectedEntry of expectedSlot.entries) {
          coverage.entries++;
          coverage.types.add(expectedEntry.type.toLowerCase());
          if (expectedEntry.room) coverage.room++;
          if (expectedEntry.teacher.name) coverage.teacher++;
          if (expectedEntry.subgroup != null) coverage.subgroup++;
          if (expectedEntry.weekParity) coverage.parity++;
          if (expectedEntry.isDistance) coverage.distance++;
          if (expectedEntry.possibleChanges) coverage.possibleChanges++;
          coverage.substitutions += expectedEntry.substitutions.length;
          if (expectedEntry.transfer) coverage.transfers++;
        }
      }
    }
  }

  assert.ok(coverage.entries > 0, "expectation corpus has no lessons");
  assert.ok(coverage.semester > 0, "semester layout is not covered");
  assert.ok(coverage.distance > 0, "distance lessons are not covered");
  assert.ok(coverage.teacher > 0, "teacher fields are not covered");
  assert.ok(coverage.room > 0, "room fields are not covered");
  assert.ok(coverage.subgroup > 0, "subgroup fields are not covered");
  assert.ok(coverage.parity > 0, "week parity is not covered");
  assert.ok(coverage.possibleChanges > 0, "possible-change entries are not covered");
  assert.ok(coverage.substitutions > 0, "substitution overlays are not covered");
  assert.ok(coverage.transfers > 0, "transfer overlays are not covered");
  assert.ok(coverage.selfStudyDays > 0, "self-study days are not covered");
  for (const type of ["из", "гз", "крп"]) {
    assert.ok(coverage.types.has(type), `${type} lesson type is not covered`);
  }
});
