# Переход с v4 на v5

В v5 нет алиасов и совместимости старых форм API.

## Переименования

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

## Новая форма расписания

`Schedule` больше не возвращает структуру HTML-таблицы. Методы запросов выдают
канонические `LessonOccurrence`:

- `id` обязателен;
- `seriesId` связывает занятие с повторяющейся серией;
- `slotNumber` и `time` независимы;
- `scheduledDate` и `nominalDate` — строки `YYYY-MM-DD` без часового пояса;
- `groups`, `teachers`, `rooms` имеют `values` и `completeness`;
- `sources` показывает исходные наблюдения.

```ts
const lesson = schedule.on(date)[0];
console.log(lesson.teachers.values);
console.log(lesson.rooms.completeness);
```

Повторяющиеся определения доступны через `schedule.series()`. Сырой результат
HTML-парсера экспортируется из `chuvsu-js/parsers` и использует
`ParsedScheduleDay.blocks[].lessons`; блок также содержит независимые
`slotNumber` и `time`.

## Кеш и ID

Снимок кеша v4 не сохраняет идентичность v5. Подключите `repositoryAdapter` или
храните результат `exportRepository()` отдельно. Истечение TTL сетевого кеша
не удаляет канонические ID.
