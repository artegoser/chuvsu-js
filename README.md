# chuvsu-js

Typed clients and schedule model for ChuvSU services:

- `tt.chuvsu.ru` — group, teacher, room, and webinar schedules;
- `lk.chuvsu.ru` — student profile portal.

Version 5 uses one canonical timetable repository. The same lesson observed on
group, teacher, and room pages receives one identity and accumulates the most
complete known participants, teacher IDs, and room IDs.

## Install

```bash
npm install chuvsu-js
```

Node.js 20+ and ESM are recommended.

## Timetable quick start

```ts
import { TimetableClient } from "chuvsu-js";

const client = new TimetableClient({ cache: 15 * 60_000 });
await client.loginAsGuest();

const [group] = await client.searchGroups("КТ-41-24");
const schedule = await client.getGroupSchedule(group.id);

for (const lesson of schedule.today({ subgroup: 1 })) {
  console.log(lesson.id, lesson.subject, lesson.teachers, lesson.rooms);
}
```

Every concrete result has `lesson.id`. Recurring semester definitions also have
`seriesId`:

```ts
const definitions = schedule.series();
const monday = schedule.weekday(1, { week: 4 });
const date = schedule.on(new Date(2026, 8, 7));
const week = schedule.week(4);
const current = schedule.current();
```

IDs do not contain date, time, or room. Room changes and transfers therefore do
not inherently change lesson identity. Persist the canonical repository when
IDs must survive process restarts.

## One API for every schedule owner

Convenience methods:

```ts
await client.getGroupSchedule(groupId);
await client.getTeacherSchedule(teacherId);
await client.getRoomSchedule(roomId);
```

Generic form:

```ts
await client.getSchedule({
  type: "teacher",
  teacher: { id: teacherId, name: "Иванов Иван Иванович" },
});
```

Limit fetched periods when all four are unnecessary:

```ts
import { AcademicPeriod } from "chuvsu-js";

await client.getGroupSchedule(groupId, {
  periods: [AcademicPeriod.FallSemester],
});
```

## Cross-page enrichment

Group pages often expose only abbreviated teacher names. Teacher pages expose
group lists. Room pages expose both but omit their own room in each row. v5
treats these as partial observations:

```ts
const groupSchedule = await client.getGroupSchedule(groupId);
const before = groupSchedule.on(date);

await client.getTeacherSchedule(teacherId);
await client.getRoomSchedule(roomId);

const after = groupSchedule.on(date);
// Same lesson IDs; entity relations may now contain more groups and IDs.
```

`Schedule` is a live view over the repository. Existing schedule objects see
later enrichment through their next query.

## Entity directory without hidden cascades

Schedule requests never issue automatic teacher/group/room search requests.
Normal search and list calls seed a persistent directory:

```ts
await client.getTeachers();
await client.getRooms();
await client.getFacultyGroups(facultyId);

const teacher = await client.resolveTeacher("Иванов И. И.");
```

Default resolution is cache-only. Explicit targeted resolution may perform one
search:

```ts
const teacher = await client.resolveTeacher("Иванов И. И.", {
  strategy: "search",
});
```

Bulk preload is also explicit:

```ts
await client.preloadDirectory({
  teachers: true,
  rooms: true,
  facultyIds: [19],
});
```

An abbreviated name receives an ID only when the directory match is unique.

## Persistent canonical repository

Transport cache and canonical identity storage are separate. Implement
`TimetableRepositoryAdapter` for a DB, KV store, or durable file service:

```ts
const client = new TimetableClient({
  cache: 15 * 60_000,
  cacheAdapter,
  repositoryAdapter,
});
```

The repository adapter uses compare-and-set revisions so concurrent writers do
not silently replace established IDs.

Snapshots are portable JSON values:

```ts
const snapshot = await client.exportRepository();
```

For single-process use:

```ts
import {
  MemoryTimetableRepositoryAdapter,
  TimetableClient,
} from "chuvsu-js";

const repositoryAdapter = new MemoryTimetableRepositoryAdapter();
const client = new TimetableClient({ repositoryAdapter });
```

## Browser/core entry point

`chuvsu-js/browser` contains no `undici`, ChuvSU certificates, `Buffer`, or HTML
parser. It can import a server-produced repository snapshot and query it
locally:

```ts
import { Schedule, TimetableRepository } from "chuvsu-js/browser";

const repository = new TimetableRepository({ snapshot });
const schedule = new Schedule(
  repository,
  { type: "group", group: { id: 8919, name: "КТ-41-24" } },
  2026,
);

const lessons = schedule.on(new Date(2026, 8, 7));
```

Network clients remain Node-only because ChuvSU authentication, cookies,
certificates, and browser CORS cannot be handled reliably by a pure browser
bundle.

Available entry points:

```ts
import { TimetableClient } from "chuvsu-js";          // Node + core
import { TimetableClient } from "chuvsu-js/node";     // explicit Node
import { TimetableRepository } from "chuvsu-js/browser";
import { parseGroupSchedule } from "chuvsu-js/parsers";
```

## Discovery and metadata

```ts
const faculties = await client.getFaculties();
const groups = await client.getFacultyGroups(facultyId);
const groupsByName = await client.searchGroups("КТ-41");
const teachers = await client.searchTeachers("Иванов");
const rooms = await client.searchRooms("Г-40");

const teacherInfo = await client.getTeacherInfo(teacherId);
const teacherPhoto = await client.getTeacherPhoto(teacherId);
const roomInfo = await client.getRoomInfo(roomId);
const roomPhoto = await client.getRoomImage(roomId);
const buildingPhoto = await client.getRoomBuildingImage(roomId);
const floorPlan = await client.getRoomFloorPlan(roomId);
```

Teacher photos use their direct known URL and do not fetch a teacher page first.

## Student portal

```ts
import { StudentPortalClient } from "chuvsu-js";

const portal = new StudentPortalClient({ cache: 60_000 });
await portal.login({ email: "student@example.com", password: "password" });

const profile = await portal.getProfile();
const photo = await portal.getProfilePhoto();
const groupId = await portal.getTimetableGroupId();
```

## Cache and blobs

`cache` controls short-lived transport/metadata caching. It may be one TTL or a
per-category object. `cacheAdapter` adds external L2 JSON storage.

`blobAdapter` stores photos and floor plans externally. Binary methods return
Node.js `Buffer` values and exist only on Node clients.

Clearing transport cache does not clear canonical IDs. Canonical repository
storage has its own adapter and lifecycle.

## Development

```bash
pnpm build
pnpm test
pnpm fixtures:audit
```

Architecture details: [`docs/v5-architecture.md`](docs/v5-architecture.md).
