import assert from "node:assert/strict";
import { TimetableClient } from "../dist/index.js";

const FALL_SEMESTER = 1;
const REQUIRED_GROUP = "КТ-41-24";
const DEFAULT_LIMIT = 50;
const DEFAULT_SEED = 20260830;
const CONCURRENCY = 5;

function getOption(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function getCredentials() {
  const email =
    process.env.TT_EMAIL ??
    process.env.CHUVSU_EMAIL ??
    process.env.TT_LOGIN ??
    process.env.EMAIL;
  const password =
    process.env.TT_PASSWORD ??
    process.env.CHUVSU_PASSWORD ??
    process.env.TT_PASS ??
    process.env.PASSWORD;

  assert.ok(
    email && password,
    "Set TT_EMAIL and TT_PASSWORD in .env (values are never printed)",
  );
  return { email, password };
}

function datesFromWeek(week) {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(week.start);
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return date;
  });
}

async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle(items, seed) {
  const random = seededRandom(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

async function loadGroups(tt) {
  const requestedGroup = getOption("group");
  if (requestedGroup) {
    const matches = await tt.searchGroups(requestedGroup);
    assert.ok(matches.length > 0, `Group not found: ${requestedGroup}`);
    return matches;
  }

  const faculties = await tt.getFaculties();
  const groupLists = await mapConcurrent(
    faculties,
    CONCURRENCY,
    (faculty) => tt.getFacultyGroups(faculty.id),
  );
  return groupLists.flat();
}

function validateAllWeeks(schedule, group) {
  const weeks = schedule.getSemesterWeeks();
  assert.equal(weeks.length, 17, `${group.name} [${group.id}]: expected 17 weeks`);

  let expectedLessons = 0;
  let actualLessons = 0;
  let weeksWithLessons = 0;
  for (const week of weeks) {
    const dates = datesFromWeek(week);
    const expectedWeekLessons = dates.reduce(
      (total, date) =>
        total + schedule.weekday(date.getDay(), { week: week.week }).length,
      0,
    );
    const actualWeekLessons = dates.reduce(
      (total, date) => total + schedule.on(date).length,
      0,
    );

    expectedLessons += expectedWeekLessons;
    actualLessons += actualWeekLessons;
    if (expectedWeekLessons > 0) {
      weeksWithLessons++;
      assert.ok(
        actualWeekLessons > 0,
        `${group.name} [${group.id}]: week ${week.week} has ` +
          `${expectedWeekLessons} scheduled lessons but no dated lessons`,
      );
    }
  }

  return { expectedLessons, actualLessons, weeksWithLessons, totalWeeks: weeks.length };
}

function validateEntryShape(schedule, group) {
  const entries = schedule.series();
  for (const entry of entries) {
    assert.ok(entry.subject, `${group.name} [${group.id}]: subject missing`);
    assert.ok(entry.type, `${group.name} [${group.id}]: lesson type missing`);
    if (entry.isDistance) {
      assert.ok(entry.rooms.values.some((room) => room.name === "Дистанционно (ДОТ)"));
      assert.ok(entry.teachers.values.every((teacher) => !teacher.name.includes("ДОТ")));
    }
  }
  return entries.length;
}

const tt = new TimetableClient({ cache: 15 * 60 * 1000 });
await tt.login(getCredentials());

const allGroups = await loadGroups(tt);
const requestedLimit = Number(getOption("limit") ?? DEFAULT_LIMIT);
assert.ok(
  Number.isInteger(requestedLimit) && requestedLimit > 0,
  "--limit must be a positive integer",
);
const seed = Number(getOption("seed") ?? DEFAULT_SEED);
assert.ok(Number.isInteger(seed), "--seed must be an integer");
let groups;
if (process.argv.includes("--all") || getOption("group")) {
  groups = allGroups;
} else {
  const required = allGroups.find((group) => group.name === REQUIRED_GROUP);
  assert.ok(required, `Required group not found: ${REQUIRED_GROUP}`);
  groups = [
    required,
    ...shuffle(
      allGroups.filter((group) => group.id !== required.id),
      seed,
    ),
  ].slice(0, Math.min(requestedLimit, allGroups.length));
}

console.log(`Testing ${groups.length}/${allGroups.length} groups...`);

let contextResolved = false;
for (const group of groups) {
  try {
    await tt.getGroupSchedule(group.id, { periods: [FALL_SEMESTER] });
    contextResolved = true;
    break;
  } catch (error) {
    if (error?.name !== "ParseError") throw error;
  }
}
assert.ok(contextResolved, "No sampled group page exposes academic context");

let groupsWithScheduledWeeks = 0;
let parsedEntries = 0;
const failures = [];
await mapConcurrent(groups, CONCURRENCY, async (group, index) => {
  try {
    const schedule = await tt.getGroupSchedule(group.id, {
      periods: [FALL_SEMESTER],
    });
    const result = validateAllWeeks(schedule, group);
    parsedEntries += validateEntryShape(schedule, group);
    if (result.weeksWithLessons > 0) groupsWithScheduledWeeks++;
    console.log(
      `[${index + 1}/${groups.length}] ${group.name}: ` +
        `${result.actualLessons}/${result.expectedLessons} lessons across ` +
        `${result.weeksWithLessons}/${result.totalWeeks} scheduled weeks`,
    );
  } catch (error) {
    failures.push(error);
    console.error(`[${index + 1}/${groups.length}] ${group.name}: ${error.message}`);
  }
});

assert.equal(
  failures.length,
  0,
  `${failures.length} group schedule validation(s) failed`,
);
assert.ok(
  groupsWithScheduledWeeks > 0,
  "Sample has no groups with semester lessons; increase --limit or use --all",
);
console.log(
  `OK: ${groups.length} groups, ${parsedEntries} parsed entries, ` +
    `${groupsWithScheduledWeeks} with scheduled semester weeks`,
);
