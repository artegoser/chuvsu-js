import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { HttpClient } from "../dist/common/http.js";
import { parseHtml } from "../dist/common/parse.js";
import {
  parseFacultyButtons,
  parseGroupButtons,
} from "../dist/tt/parse/lists.js";

const BASE = "https://tt.chuvsu.ru";
const REQUIRED_GROUP = "КТ-41-24";
const DEFAULT_LIMIT = 50;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_OUTPUT = "test/fixtures/tt/group-schedules";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

function credentials() {
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
  assert.ok(email && password, "Set TT_EMAIL and TT_PASSWORD in .env");
  return { email, password };
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

async function login(http) {
  const { email, password } = credentials();
  const res = await http.post(
    `${BASE}/auth`,
    {
      wname: email,
      wpass: password,
      wauto: "1",
      auth: "Войти",
      hfac: "0",
      pertt: "1",
    },
    false,
  );
  assert.equal(res.status, 302, "TT login failed");
}

async function loadGroups(http) {
  const home = await http.get(`${BASE}/`);
  const faculties = parseFacultyButtons(home.body);
  const lists = await mapConcurrent(
    faculties,
    DEFAULT_CONCURRENCY,
    async (faculty) => {
      const response = await http.post(`${BASE}/`, {
        hfac: String(faculty.id),
        pertt: "1",
      });
      return parseGroupButtons(response.body);
    },
  );

  return [...new Map(lists.flat().map((group) => [group.id, group])).values()];
}

function countRawEntries(body) {
  // This is deliberately raw DOM inspection, never the schedule parser.
  const doc = parseHtml(body);
  const schedule = doc.querySelector("#groupstt");
  if (!schedule) return 0;
  return [...schedule.querySelectorAll("td")].filter((cell) => {
    const subject = cell.querySelector('span[style*="color: blue"]');
    const subjectText = subject?.textContent?.trim() ?? "";
    return (
      subject?.closest("td") === cell &&
      subjectText &&
      !/^День самостоятельной работы$/iu.test(subjectText)
    );
  }).length;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSchedulePage(body) {
  const doc = parseHtml(body);
  return Boolean(
    doc.querySelector("#groupstt, td[id^=\"trd2\"]") ||
      body.includes("Расписание занятий"),
  );
}

function pageGroupName(body) {
  const doc = parseHtml(body);
  return doc
    .querySelector('span.htext span[style*="color: blue"]')
    ?.textContent?.trim();
}

async function fetchSchedulePage(http, group, period) {
  const file = `group-${group.id}-period-${period}.html`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await http.post(
      `${BASE}/index/grouptt/gr/${group.id}`,
      { htype: String(period) },
    );

    if (response.body.includes('name="wname"')) {
      await login(http);
      continue;
    } else if (response.status >= 500 || response.status === 429) {
      await wait(500 * (attempt + 1));
      continue;
    }

    if (isSchedulePage(response.body)) {
      assert.equal(
        pageGroupName(response.body),
        group.name,
        `${file}: response belongs to another group`,
      );
      return response.body;
    }

    if (response.status >= 400) {
      throw new Error(`${file}: schedule request returned HTTP ${response.status}`);
    }

    await wait(250 * (attempt + 1));
  }
  throw new Error(`${file}: schedule page not found after retries`);
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
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function parsePositiveInt(value, message) {
  const parsed = Number(value);
  assert.ok(Number.isInteger(parsed) && parsed > 0, message);
  return parsed;
}

function parsePeriods() {
  const raw = option("periods") ?? "1";
  const periods = raw.split(",").map((value) => Number(value.trim()));
  assert.ok(
    periods.length > 0 &&
      periods.every(
        (period) => Number.isInteger(period) && period >= 1 && period <= 4,
      ),
    "--periods must contain comma-separated values 1..4",
  );
  return [...new Set(periods)];
}

async function clearGeneratedFixtures(outputDir) {
  let files;
  try {
    files = await readdir(outputDir);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const generated = files.filter((file) =>
    /^group-\d+-period-\d+\.html$/.test(file),
  );
  await Promise.all(generated.map((file) => unlink(join(outputDir, file))));
}

const outputDir = resolve(option("output") ?? DEFAULT_OUTPUT);
const concurrency = parsePositiveInt(
  option("concurrency") ?? DEFAULT_CONCURRENCY,
  "--concurrency must be positive",
);
const periods = parsePeriods();
const limit = parsePositiveInt(
  option("limit") ?? DEFAULT_LIMIT,
  "--limit must be positive",
);
const seed = Number(option("seed") ?? 20260830);
assert.ok(Number.isInteger(seed), "--seed must be an integer");

const http = new HttpClient();
await login(http);
const allGroups = await loadGroups(http);
const requestedGroup = option("group");
let candidateGroups;

if (requestedGroup) {
  candidateGroups = allGroups.filter(
    (group) =>
      group.name === requestedGroup || String(group.id) === requestedGroup,
  );
} else if (process.argv.includes("--all")) {
  candidateGroups = allGroups;
} else {
  const required = allGroups.find((group) => group.name === REQUIRED_GROUP);
  assert.ok(required, `Required group not found: ${REQUIRED_GROUP}`);
  const randomized = shuffle(
    allGroups.filter((group) => group.id !== required.id),
    seed,
  );
  // Probe bounded randomized pool. Selection happens after raw schedule
  // inspection, so empty groups never consume the requested sample size.
  const candidateLimit = Math.min(allGroups.length, Math.max(limit * 4, limit));
  candidateGroups = [required, ...randomized].slice(0, candidateLimit);
}

assert.ok(candidateGroups.length > 0, "No groups selected");

await mkdir(outputDir, { recursive: true });

const failures = [];
const fetched = [];
const jobs = [];
const batchSize = Math.max(concurrency * 4, 25);
for (let offset = 0; offset < candidateGroups.length; offset += batchSize) {
  const batchJobs = candidateGroups.slice(offset, offset + batchSize).flatMap((group) =>
    periods.map((period) => ({ group, period })),
  );
  jobs.push(...batchJobs);
  await mapConcurrent(batchJobs, concurrency, async ({ group, period }) => {
    const file = `group-${group.id}-period-${period}.html`;
    try {
      const pageHtml = await fetchSchedulePage(http, group, period);
      fetched.push({
        file,
        group,
        period,
        pageHtml,
        entryCount: countRawEntries(pageHtml),
      });
    } catch (error) {
      failures.push({ file, message: error?.message ?? String(error) });
    }
  });

  const populatedGroupCount = new Set(
    fetched.filter((item) => item.entryCount > 0).map((item) => item.group.id),
  ).size;
  if (
    !requestedGroup &&
    !process.argv.includes("--all") &&
    populatedGroupCount >= limit
  ) {
    break;
  }
}
assert.equal(
  failures.length,
  0,
  `${failures.length} fixture fetch(es) failed\n${JSON.stringify(failures, null, 2)}`,
);

const populatedGroupIds = new Set(
  fetched.filter((item) => item.entryCount > 0).map((item) => item.group.id),
);
const selectedGroups = requestedGroup || process.argv.includes("--all")
  ? candidateGroups
  : candidateGroups.filter((group) => populatedGroupIds.has(group.id)).slice(0, limit);

assert.ok(selectedGroups.length > 0, "No groups selected");
if (!requestedGroup && !process.argv.includes("--all")) {
  assert.equal(
    selectedGroups.length,
    Math.min(limit, populatedGroupIds.size),
    "Not enough populated groups; lower --limit or use --all",
  );
  assert.ok(
    selectedGroups.some((group) => group.name === REQUIRED_GROUP),
    `Required group missing from fixtures: ${REQUIRED_GROUP}`,
  );
}

const selectedGroupIds = new Set(selectedGroups.map((group) => group.id));
await clearGeneratedFixtures(outputDir);
let saved = 0;
for (const item of fetched) {
  if (!selectedGroupIds.has(item.group.id)) continue;

  await writeFile(join(outputDir, item.file), item.pageHtml, "utf8");
  saved++;
}

assert.equal(
  saved,
  selectedGroups.length * periods.length,
  "Not every selected group/period response was saved",
);

console.log(
  JSON.stringify({
    selectedGroups: selectedGroups.length,
    candidateGroups: candidateGroups.length,
    populatedGroups: populatedGroupIds.size,
    periods,
    seed,
    jobs: jobs.length,
    saved,
    failures,
  }),
);
