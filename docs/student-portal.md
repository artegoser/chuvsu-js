# Student portal: webinars and portfolio

All new methods belong to `StudentPortalClient` from `chuvsu-js` or
`chuvsu-js/node`. Pure HTML parsers are also available from `chuvsu-js/parsers`.
Types and lesson matching helpers are available from `chuvsu-js/browser`.

```ts
import { StudentPortalClient, TimetableClient, attachWebinars, parseLocalDate } from "chuvsu-js";

const portal = new StudentPortalClient({
  cache: { portfolio: 60_000, webinars: 15_000 },
});
await portal.login({ email, password });

// GET the portal's current day; no machine-local date is sent.
const page = await portal.getWebinarPage();
const webinars = page.webinars;
// Equivalent listing-only helper: await portal.getWebinars();

const timetable = new TimetableClient();
await timetable.loginAsGuest();
const groupId = await portal.getTimetableGroupId();
if (groupId !== null && page.date) {
  const schedule = await timetable.getGroupSchedule(groupId);
  const lessons = schedule.on(parseLocalDate(page.date));
  const linked = attachWebinars(lessons, webinars);
}

const portfolio = await portal.getPortfolio();
console.log(portfolio.student.fields, portfolio.grades);
```

## Webinar listings and links

For participant sessions, live users/chat, presentations and explicit room
actions, see [Live webinars](webinar.md).

`getWebinarPage()` returns `{ date, availableDates, webinars }`.
`getWebinars()` returns just the rows. An optional `{ date: "2026-10-12" }`
filters the listing through LK's `day` form field. Availability depends on LK;
a response for a different date throws `ParseError`. The current live page
exposed today and upcoming dates, so callers should inspect `availableDates`
rather than assume historical access.

Each row includes:

- `subject`: discipline, without the type/teacher/group suffix.
- `title`: webinar topic, as rendered by LK.
- `scheduledDate`, `slotNumber`, `time`, `type` (`LessonType`), `teacher`, `groups`, `subgroup`.
- `server`, `completedAt`, `joinAvailable` and `raw` discipline-cell text.
- `id`: LK join ID, or `null` when no join button is exposed.

Completed and pending rows remain present even when no URL can be obtained.
Dates come from the page. If a saved page has no date, its webinars cannot
be attached to a particular dated lesson.

To resolve a join URL, explicitly call:

```ts
const webinar = webinars.find((row) => row.joinAvailable && row.id !== null);
if (webinar?.id) {
  const url = await portal.getWebinarJoinUrl({ webinarId: webinar.id });
  // The caller decides whether to open the URL.
}
```

This method uses the authenticated LK session and `POST /student/joinweb.php`
with `idw`; separate TT credentials and `idType` are no longer used. URLs are
not cached or automatically opened. HTTP(S) URLs are accepted; malformed or
unsuccessful responses throw `ParseError`. The endpoint contract was inspected
in LK JavaScript and verified with mocked responses and live URL retrieval.

`findWebinar(lesson, webinars)` returns a unique compatible row.
`findWebinars` returns all candidates. Matching checks actual scheduled date,
slot when known, exact time range, normalized discipline, type, and known
group/subgroup/teacher data. Cancelled lessons never match. Name comparison
normalizes case, whitespace and `ё`; it does not guess equivalence between
full names and initials. Ambiguous rows require caller selection.
`attachWebinars` preserves lesson IDs and never changes repository records.

## Portfolio

`getPortfolio()` discovers the portfolio link from the authenticated home
page and fetches it. The site resolves its own portfolio landing URL to the
current student's page; no student ID needs to be supplied. `getPortfolioUrl()`
returns the canonical URL from the same parsed/cached result.

The returned `StudentPortfolio` contains:

- `id`, `url`, `student.fullName`, `student.photoUrl`, and `student.fields`.
  Identity-field keys retain LK's Russian labels without the trailing colon.
- `grades`: semester, subject code, discipline, assessment (`LessonType`),
  grade (`number | boolean | null`), tooltips, and optional referral metadata.
- `controlWeeks`: semester, discipline and numeric grades (`number | null`) for each week.
- `performance`: discipline, attendance cells and planned activity tables.
- `sections`: every top-level tab in page order, including curriculum,
  programs, achievements, interests, practices, coursework and thesis.

Section content is a tree of `text`, `heading`, `group`, `link`, `image`, and
`table` entries. Tables preserve every row/cell, header flags, spans, tooltips,
links and nested content. Nested tab labels are group labels. Document URLs
are resolved against the portfolio page; no linked files are downloaded.
Unknown tabs are preserved without requiring a parser update.

Attendance expands merged month/day headers into individual cells, retaining
month label, day, slot, lesson type (`LessonType`), subgroup and raw mark (`+`, `Н`, grade or
empty). The page does not reliably identify the journal year, so absolute dates
are not invented. Activity `content` preserves separate grade/date fields even
when their displayed text is concatenated. Numeric grades such as `4 (Хорошо)` become `4`; `Зачтено` becomes `true`,
`Не зачтено` becomes `false`. Missing/unrecognized grades become `null`;
control-week `"0"` becomes numeric `0`. No extra source-text fields are added.
Assessment labels such as `Экзамен`, `Зачет`, `Зачет с оценкой`, and
`Курсовой проект` use the existing `LessonType` values. Labels without an
existing enum equivalent use `LessonType.Unknown`. Existing enum IDs remain unchanged; `StateExam = 12` and `ThesisDefense = 13`
distinguish state exams and thesis defenses. Referral endpoint IDs remain
separate from domain lesson types.

Referral `semester`, `disciplineId`, `lessonTypeId`, `type`, `key`, and `code`
are parsed from the existing button. **No referral ordering method is provided
or called.** Scripts, edit/order buttons, and action-dialog fields are excluded
from section content. Parsing never evaluates scripts or follows links.

Offline parsing:

```ts
import { parsePortfolio, parsePortfolioUrl, parseWebinarPage } from "chuvsu-js/parsers";

const portfolio = parsePortfolio(portfolioHtml);
const landingUrl = parsePortfolioUrl(homeHtml);
const page = parseWebinarPage(webinarsHtml);
```

Only same-origin portfolio landing/index routes can be discovered from home.
Unrelated pages, missing identity and mismatched student IDs are rejected before
caching. Cache TTLs are milliseconds. Keep webinar TTL short because LK refreshes
availability frequently. Shared cache adapters should be scoped to one account,
as with the existing profile cache.

## Typed-value migration

Webinar/journal `type` and grade `assessment` are now `LessonType`, replacing
short codes and full text labels. Grade consumers should distinguish numbers,
booleans and `null`; avoid truthiness checks because `false` is a failed credit
and `0` is a reported control-week score. Updated cache keys skip cached results
using the old string schema. Generic portfolio section tables remain display
content; normalized fields are available in `grades`, `controlWeeks`, and
`performance`.

`LessonType` and `parseLessonType` are defined in `common/lesson-type`; LK and
TT share them. Import from `chuvsu-js` or `chuvsu-js/browser`; the old TT utility
exports are removed.
