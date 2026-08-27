import assert from "node:assert/strict";
import { TtClient } from "../dist/index.js";

const FALL_SEMESTER = 1;
const DEFAULT_LIMIT = 50;
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

function datesFromSeptemberFirst(year) {
  const dates = [];
  const date = new Date(year, 8, 1);
  do {
    dates.push(new Date(date));
    date.setDate(date.getDate() + 1);
  } while (date.getDay() !== 1);
  return dates;
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

async function loadGroups(tt) {
  const requestedGroup = getOption("group");
  if (requestedGroup) {
    const matches = await tt.searchGroup({ name: requestedGroup });
    assert.ok(matches.length > 0, `Group not found: ${requestedGroup}`);
    return matches;
  }

  const faculties = await tt.getFaculties();
  const groupLists = await mapConcurrent(
    faculties,
    CONCURRENCY,
    (faculty) => tt.getGroupsForFaculty({ facultyId: faculty.id }),
  );
  return groupLists.flat();
}

function validateFirstWeek(schedule, group) {
  const year = schedule.academicYearStartYear;
  const septemberFirst = new Date(year, 8, 1);
  assert.equal(schedule.getWeekNumber(septemberFirst), 1);

  const [firstWeek] = schedule.getSemesterWeeks(1);
  assert.equal(firstWeek.week, 1);
  assert.ok(firstWeek.start <= septemberFirst && septemberFirst <= firstWeek.end);

  let expectedLessons = 0;
  let actualLessons = 0;
  for (const date of datesFromSeptemberFirst(year)) {
    expectedLessons += schedule.forDay(date.getDay(), { week: 1 }).length;
    actualLessons += schedule.forDate(date).length;
  }

  assert.ok(
    expectedLessons === 0 || actualLessons > 0,
    `${group.name} [${group.id}]: ${expectedLessons} week-1 lessons exist, ` +
      "but none appear on first September dates",
  );

  return { expectedLessons, actualLessons };
}

const tt = new TtClient({ cache: 15 * 60 * 1000 });
await tt.login(getCredentials());

const allGroups = await loadGroups(tt);
const requestedLimit = Number(getOption("limit") ?? DEFAULT_LIMIT);
assert.ok(Number.isInteger(requestedLimit) && requestedLimit > 0, "--limit must be a positive integer");
const groups = process.argv.includes("--all")
  ? allGroups
  : allGroups.slice(0, requestedLimit);

console.log(`Testing ${groups.length}/${allGroups.length} groups...`);

// Resolve server academic context before parallel requests. Some group pages
// contain no year metadata, but can still be fetched after context is known.
let contextResolved = false;
for (const group of groups) {
  try {
    await tt.getScheduleForPeriod({
      groupId: group.id,
      period: FALL_SEMESTER,
    });
    contextResolved = true;
    break;
  } catch (error) {
    if (error?.name !== "ParseError") throw error;
  }
}
assert.ok(contextResolved, "No sampled group page exposes academic context");

let groupsWithFirstWeekLessons = 0;
const failures = [];
await mapConcurrent(groups, CONCURRENCY, async (group, index) => {
  try {
    const schedule = await tt.getScheduleForPeriod({
      groupId: group.id,
      period: FALL_SEMESTER,
    });
    const result = validateFirstWeek(schedule, group);
    if (result.expectedLessons > 0) groupsWithFirstWeekLessons++;
    console.log(
      `[${index + 1}/${groups.length}] ${group.name}: ` +
        `${result.actualLessons}/${result.expectedLessons} first-week lessons visible`,
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
  groupsWithFirstWeekLessons > 0,
  "Sample has no groups with first-week lessons; increase --limit or use --all",
);
console.log(`OK: ${groups.length} groups, ${groupsWithFirstWeekLessons} with week-1 lessons`);
