# chuvsu-js v5 schedule architecture

Status: accepted for v5 implementation.

## Goals

- Represent one real lesson once even when group, teacher, and room pages expose
  different subsets of it.
- Give recurring series and concrete lesson occurrences stable IDs that are not
  derived from mutable date, time, or room fields.
- Treat semester and session schedules as two ingestion formats for one query
  model.
- Keep source-page caching independent from persistent canonical identity.
- Make schedule querying and persisted snapshots usable in browsers without
  Node.js networking, certificates, `Buffer`, or an HTML DOM implementation.

## Public vocabulary

| v4 | v5 | Reason |
| --- | --- | --- |
| `TtClient` | `TimetableClient` | Describes the service instead of its hostname. |
| `LkClient` | `StudentPortalClient` | Describes the portal responsibility. |
| `Audience` | `Room` | Natural English API name. |
| `ScheduleEntry` | `ScheduleObservation` (internal) | Parsed page rows are incomplete observations, not canonical lessons. |
| `FullScheduleDay` | `ParsedScheduleDay` (parser boundary) | Makes raw/parser ownership explicit. |
| `groupId` on every `Schedule` | `owner: ScheduleOwner` | A schedule can belong to a group, teacher, or room. |

Deprecated v4 aliases may remain where they do not weaken the v5 model. New
code and documentation use v5 names.

## Package boundaries

- `chuvsu-js` and `chuvsu-js/node`: Node.js clients, HTML parsers, and all core
  exports.
- `chuvsu-js/browser`: canonical repository, schedule views, calendar helpers,
  public domain types, and snapshot import/export. It must not reach Node-only
  modules or `linkedom`.
- `chuvsu-js/parsers`: HTML parsers for server/tooling use without exporting
  authenticated clients.

Relative ESM imports keep explicit `.js` extensions. Every package export has a
matching `types` condition.

## Domain model

### Owners and entities

```text
ScheduleOwner = GroupOwner | TeacherOwner | RoomOwner
EntityRef     = { id?: upstream numeric ID, name }
```

The requested page owner is authoritative implicit data:

- a group page proves group participation;
- a teacher page proves teacher participation;
- a room page proves the room.

Visible page text supplies complementary, lower-authority entity claims.

### Source snapshot

A source snapshot records owner, academic year, period, fetch time, and parsed
observations. Missing fields mean “not exposed by this projection”; they never
mean an authoritative empty list.

Snapshots replace only their own previous source projection. A lesson is not
deleted merely because another projection omits it.

### Lesson series

A `LessonSeries` represents a semester recurrence:

- stable random `seriesId`;
- academic year and period;
- weekday, slot, time, week range, and optional parity;
- subject and type;
- group participation scopes, teachers, and rooms;
- substitutions and transfer observations;
- source provenance.

### Lesson occurrence

A `LessonOccurrence` represents one concrete meeting:

- stable `lessonId`;
- optional `seriesId`;
- nominal academic week and date;
- actual date/time after transfer or substitution;
- participants, teachers, rooms, status, and provenance.

Semester occurrences use a collision-free structural ID inside one repository:
`seriesId + academic week + occurrence ordinal`. The mutable actual date, room,
and time are not part of identity. Session rows are direct persisted
occurrences with assigned IDs.

## Reconciliation

Reconciliation runs whenever a source snapshot is ingested.

1. Normalize text, entity names, recurrence, and local dates.
2. Prefer an existing canonical ID previously linked to the same source row.
3. Otherwise build candidates from academic year/period and compatible nominal
   position or date.
4. Score subject, type, recurrence, slot, room, teacher, and group evidence.
5. Merge only one unambiguous candidate above threshold.
6. Preserve conflicting claims and provenance; never use last-write-wins to
   fabricate certainty.
7. Create a new ID for ambiguous observations.

Request order must not affect the canonical result. Group arrays, teacher
arrays, and room arrays are compatible unions. Scalar conflicts remain source
claims until a deterministic authority rule resolves them.

Complete unrecognizable edits cannot be proven to be the same upstream lesson.
Those create a new ID and may carry predecessor/successor lineage.

## Repository and cache

Three independent layers:

1. Transport cache: fetched/parsed page snapshots; TTL is allowed.
2. Canonical repository: IDs, series, occurrences, relations, source links,
   revision; persisted independently from cache TTL.
3. Query-view cache: optional derived owner/date views, invalidated by canonical
   repository revision.

`TimetableRepository` has an in-memory implementation, snapshot import/export,
and an optional compare-and-set persistence adapter. Concurrent writers retry
against repository revision instead of silently overwriting identities.

### Entity directory

Canonical storage includes a persistent entity directory for groups, teachers,
and rooms. Search/list responses and requested page owners seed it. Schedule
ingestion and reads resolve incomplete visible names against already-known
entities:

- exact normalized names for groups and rooms;
- normalized surname plus initials for teachers;
- an ID is attached only when the lookup is unique.

Schedule fetching never performs hidden entity lookups. This prevents one
schedule from causing an N+1 cascade. Callers can explicitly choose cache-only
resolution, one targeted search, or a deliberate directory preload. Ambiguous
teacher initials remain unresolved instead of receiving a guessed ID.

## Query behavior

`Schedule` is a lightweight view over `TimetableRepository` and one owner. Its
queries are synchronous after client ingestion:

- `on(date)`;
- `week(academicWeek?)`;
- `today()` / `tomorrow()` / `thisWeek()`;
- `current()`;
- `series()` for recurring definitions.

Compatibility aliases (`forDate`, `forWeek`, `currentLesson`) may delegate to
the new names.

Query resolution expands recurring series into occurrences, applies holiday
rules, substitutions, transfers, and cancellations, then combines direct
session occurrences. Session-specific branching stays inside ingestion and
occurrence resolution, not public query methods.

## Client API

Primary API:

```text
getSchedule(owner, options?)
getGroupSchedule(groupId, options?)
getTeacherSchedule(teacherId, options?)
getRoomSchedule(roomId, options?)
```

Search methods use plural resource names and direct query values where useful:
`searchGroups`, `searchTeachers`, and `searchRooms`. Explicit resource helpers
remain discoverable and all return typed entity references.

Directory helpers expose `resolveGroup`, `resolveTeacher`, and `resolveRoom`
with cache-only defaults, plus explicit preload methods for applications that
need fully resolved entity IDs before rendering schedules.

## Verification order

1. Implement domain, repository, reconciliation, and query model.
2. Migrate all existing group golden fixtures to the v5 parser/canonical
   boundary and prove current behavior parity.
3. Add complete teacher and room corpora with frozen reviewed expectations.
4. Add cross-projection bundles and request-order invariance tests.
5. Add ID stability, ambiguity, persistence, session, browser-boundary, and
   client tests.
6. Run fixture audit, build, complete tests, export checks, and packed-package
   smoke tests before v5 release.
