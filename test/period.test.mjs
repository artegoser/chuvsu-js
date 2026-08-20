import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAcademicYearFromPage,
  parsePeriodFromPage,
} from "../dist/tt/parse/index.js";
import {
  getAcademicYearKey,
  getAcademicYearStartYear,
  getCurrentPeriod,
  getSemesterStart,
} from "../dist/tt/utils/index.js";

test("current timetable page exposes 2026/2027 and fall semester", () => {
  const html = `
    <center><span style="color: blue;">2026/2027 учебный год</span></center>
    <fieldset id="pertypef">
      <label><input type="radio" name="pertype" id="pertype-1" value="1" checked="checked">Осенний семестр</label>
      <label><input type="radio" name="pertype" id="pertype-4" value="4">Летняя сессия</label>
    </fieldset>
    <input type="hidden" name="htype" value="1" id="htype">
  `;

  assert.equal(parseAcademicYearFromPage(html), 2026);
  assert.equal(parsePeriodFromPage(html), 1);
});

test("August fallback is already the next ChuvSU academic year and fall period", () => {
  const date = new Date(2026, 7, 20);

  assert.equal(getAcademicYearStartYear(date), 2026);
  assert.equal(getAcademicYearKey(date), "2026-2027");
  assert.equal(getCurrentPeriod({ date }), 1);
});

test("July fallback remains in the ending academic year and summer session", () => {
  const date = new Date(2026, 6, 31);

  assert.equal(getAcademicYearStartYear(date), 2025);
  assert.equal(getAcademicYearKey(date), "2025-2026");
  assert.equal(getCurrentPeriod({ date }), 4);
});

test("fall semester dates still start on September 1 after August rollover", () => {
  const start = getSemesterStart({
    period: 1,
    date: new Date(2026, 7, 20),
  });

  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 8);
  assert.equal(start.getDate(), 1);
});
