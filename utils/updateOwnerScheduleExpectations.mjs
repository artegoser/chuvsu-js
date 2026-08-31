import assert from "node:assert/strict";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  parseAcademicYearFromPage,
  parseRoomName,
  parseRoomSchedule,
  parseTeacherInfo,
  parseTeacherSchedule,
} from "../dist/tt/parse/index.js";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function dateKey(date) {
  if (!date) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function entryValue(entry) {
  return {
    subject: entry.subject,
    type: entry.type,
    weeks: entry.weeks,
    room: entry.room,
    teacher: entry.teacher,
    groups: entry.groups,
    subgroup: entry.subgroup ?? null,
    weekParity: entry.weekParity ?? null,
    isDistance: Boolean(entry.isDistance),
    possibleChanges: Boolean(entry.possibleChanges),
    substitutions: (entry.substitutions ?? []).map((value) => ({
      date: dateKey(value.date),
      room: value.room ?? null,
      isDistance: Boolean(value.isDistance),
      teacher: value.teacher ?? null,
    })),
    transfer: entry.transfer
      ? {
          targetDate: dateKey(entry.transfer.targetDate),
          fromDate: dateKey(entry.transfer.fromDate),
          fromSlot: entry.transfer.fromSlot,
          subject: entry.transfer.subject,
        }
      : null,
    substituteFor: entry.substituteFor
      ? {
          date: dateKey(entry.substituteFor.date),
          originalTeacher: entry.substituteFor.originalTeacher,
        }
      : null,
  };
}

const kind = option("kind");
assert.ok(kind === "teacher" || kind === "room", "--kind must be teacher or room");
const fixtureDir = resolve(`test/fixtures/tt/${kind}-schedules`);
const expectedDir = resolve(`test/fixtures/tt/${kind}-expected`);
const parser = kind === "teacher" ? parseTeacherSchedule : parseRoomSchedule;
const ownerName = kind === "teacher"
  ? (html) => parseTeacherInfo(html)?.name
  : parseRoomName;

await mkdir(expectedDir, { recursive: true });
for (const file of await readdir(expectedDir)) {
  if (new RegExp(`^${kind}-\\d+-period-\\d+\\.json$`, "u").test(file)) {
    await unlink(join(expectedDir, file));
  }
}
const files = (await readdir(fixtureDir))
  .filter((file) => new RegExp(`^${kind}-\\d+-period-\\d+\\.html$`, "u").test(file))
  .sort();
for (const file of files) {
  const html = await readFile(join(fixtureDir, file), "utf8");
  const id = Number(file.match(new RegExp(`^${kind}-(\\d+)-`, "u"))?.[1]);
  const period = Number(file.match(/-period-(\d+)\.html$/u)?.[1]);
  const days = parser(html);
  const expected = {
    schemaVersion: 1,
    file,
    owner: { type: kind, id, name: ownerName(html) },
    academicYearStartYear: parseAcademicYearFromPage(html),
    period,
    layout: days.some((day) => day.date) ? "session" : "semester",
    days: days.map((day, dayIndex) => ({
      index: dayIndex,
      weekday: day.weekday,
      date: dateKey(day.date),
      isSelfStudyDay: Boolean(day.isSelfStudyDay),
      slots: day.slots.map((slot, slotIndex) => ({
        index: slotIndex,
        number: slot.number,
        timeStart: slot.timeStart,
        timeEnd: slot.timeEnd,
        entries: slot.entries.map((entry, entryIndex) => ({
          index: entryIndex,
          ...entryValue(entry),
        })),
      })),
    })),
  };
  assert.ok(expected.owner.name, `${file}: owner name missing`);
  assert.ok(expected.academicYearStartYear != null, `${file}: academic year missing`);
  await writeFile(
    join(expectedDir, file.replace(/\.html$/u, ".json")),
    `${JSON.stringify(expected, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify({ kind, expectations: files.length }));
