# Migrating from v4 to v5

v5 intentionally provides no runtime compatibility aliases.

## Renamed API

| v4 | v5 |
| --- | --- |
| `TtClient` | `TimetableClient` |
| `LkClient` | `StudentPortalClient` |
| `Audience` | `Room` |
| `AudienceInfo` | `RoomInfo` |
| `EducationType` | `EducationLevel` |
| `Period` | `AcademicPeriod` |
| `getSchedule(groupId)` | `getGroupSchedule(groupId)` |
| `getAudienceSchedule(id)` | `getRoomSchedule(id)` |
| `searchGroup({ name })` | `searchGroups(name)` |
| `searchTeacher({ name })` | `searchTeachers(name)` |
| `searchAudience({ name })` | `searchRooms(name)` |
| `getGroupsForFaculty({ facultyId })` | `getFacultyGroups(facultyId)` |
| `schedule.forDate(date)` | `schedule.on(date)` |
| `schedule.forWeek(week)` | `schedule.week(week)` |
| `schedule.forDay(day)` | `schedule.weekday(day)` |
| `schedule.currentLesson()` | `schedule.current()` |
| `getPersonalData()` | `getProfile()` |
| `getPhoto()` | `getProfilePhoto()` |
| `getGroupId()` | `getTimetableGroupId()` |

## Changed schedule data

`Schedule` no longer exposes parser-shaped day/slot maps. Query methods return
canonical `LessonOccurrence` objects:

- `id` is mandatory;
- `seriesId` identifies recurring definitions;
- `teachers`, `rooms`, and `groups` are entity relations with optional upstream
  IDs;
- `date` is actual start date/time;
- `nominalDate` remains stable across transfers;
- `sources` describes contributing page observations.

Use `schedule.series()` when recurring definitions are required. Raw HTML parser
output is available only from `chuvsu-js/parsers`.

## Cache split

v4 cache export/import does not preserve v5 lesson identity. Configure a
`repositoryAdapter` or persist `exportRepository()` output separately. TTL cache
expiration is no longer allowed to erase canonical IDs.
