import assert from "node:assert/strict";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { HttpClient } from "../dist/common/http.js";
import {
  parseRoomButtons,
  parseRoomName,
  parseRoomSchedule,
  parseTeacherButtons,
  parseTeacherInfo,
  parseTeacherSchedule,
} from "../dist/tt/parse/index.js";

const BASE = "https://tt.chuvsu.ru";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function credentials() {
  const email = process.env.TT_EMAIL ?? process.env.CHUVSU_EMAIL;
  const password = process.env.TT_PASSWORD ?? process.env.CHUVSU_PASSWORD;
  assert.ok(email && password, "Set TT_EMAIL and TT_PASSWORD in .env");
  return { email, password };
}

function seededShuffle(values, seed) {
  let state = seed >>> 0;
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const target = Math.floor((state / 0x100000000) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function entryCount(body, parseSchedule) {
  return parseSchedule(body).reduce(
    (days, day) => days + day.blocks.reduce(
      (blocks, block) => blocks + block.lessons.length,
      0,
    ),
    0,
  );
}

async function login(http) {
  const { email, password } = credentials();
  const response = await http.post(
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
  assert.equal(response.status, 302, "TT login failed");
}

async function entities(http, kind) {
  if (kind === "teacher") {
    return parseTeacherButtons((await http.get(`${BASE}/index/tech`)).body);
  }
  return parseRoomButtons(
    (await http.post(`${BASE}/`, {
      audname: "%%%",
      findaud: "найти",
      hfac: "0",
      pertt: "1",
    })).body,
  );
}

function config(kind) {
  return kind === "teacher"
    ? {
        route: "techtt/tech",
        pageName: (body) => parseTeacherInfo(body)?.name,
        parseSchedule: parseTeacherSchedule,
      }
    : {
        route: "audtt/aud",
        pageName: parseRoomName,
        parseSchedule: parseRoomSchedule,
      };
}

const kind = option("kind");
assert.ok(kind === "teacher" || kind === "room", "--kind must be teacher or room");
const period = Number(option("period") ?? 1);
const limit = Number(option("limit") ?? 4);
const seed = Number(option("seed") ?? 20260831);
assert.ok(Number.isInteger(period) && period >= 1 && period <= 4, "invalid period");
assert.ok(Number.isInteger(limit) && limit > 0, "invalid limit");
assert.ok(Number.isInteger(seed), "invalid seed");

const output = resolve(option("output") ?? `test/fixtures/tt/${kind}-schedules`);
const http = new HttpClient();
await login(http);
const allEntities = await entities(http, kind);
const preferredNames = new Set(
  (option("names") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
);
const preferredIds = new Set(
  (option("ids") ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Number.isInteger),
);
const candidates = [
  ...allEntities.filter((value) => preferredIds.has(value.id)),
  ...allEntities.filter(
    (value) => !preferredIds.has(value.id) && preferredNames.has(value.name),
  ),
  ...seededShuffle(
    allEntities.filter(
      (value) => !preferredIds.has(value.id) && !preferredNames.has(value.name),
    ),
    seed,
  ),
];
const selected = [];
const { route, pageName, parseSchedule } = config(kind);

for (const entity of candidates) {
  const response = await http.post(
    `${BASE}/index/${route}/${entity.id}`,
    { htype: String(period) },
  );
  if (response.body.includes('name="wname"')) {
    await login(http);
    continue;
  }
  if (entryCount(response.body, parseSchedule) === 0) continue;
  assert.equal(pageName(response.body), entity.name, `${kind} ${entity.id}: wrong page owner`);
  selected.push({ entity, body: response.body });
  if (selected.length === limit) break;
}

assert.equal(selected.length, limit, `only ${selected.length} populated ${kind} pages found`);
await mkdir(output, { recursive: true });
for (const file of await readdir(output)) {
  if (new RegExp(`^${kind}-\\d+-period-\\d+\\.html$`, "u").test(file)) {
    await unlink(join(output, file));
  }
}
for (const { entity, body } of selected) {
  await writeFile(join(output, `${kind}-${entity.id}-period-${period}.html`), body, "utf8");
}

console.log(JSON.stringify({ kind, period, selected: selected.map(({ entity }) => entity) }));
