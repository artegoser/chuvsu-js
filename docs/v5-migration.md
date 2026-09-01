# Переход с v4 на v5

Версия 5 полностью меняет модель расписания и намеренно не содержит слоя
совместимости с v4. Основное отличие: в v4 каждый запрос возвращал независимую
копию HTML-таблицы, а в v5 страницы групп, преподавателей и аудиторий пополняют
единый канонический репозиторий. Одна реальная пара получает один ID и собирает
из разных страниц все известные связи.

## Установка

```bash
npm install chuvsu-js@^5
```

Рекомендуется Node.js 20+ и ESM. Сетевые клиенты доступны из `chuvsu-js` и
`chuvsu-js/node`; браузерное ядро — из `chuvsu-js/browser`; HTML-парсеры — из
`chuvsu-js/parsers`.

## Минимальная миграция

### v4

```ts
import { TtClient } from "chuvsu-js";

const client = new TtClient({ cache: 15 * 60_000 });
await client.loginAsGuest();

const [group] = await client.searchGroup({ name: "КТ-41-24" });
const schedule = await client.getSchedule(group.id);

for (const lesson of schedule.forDate(new Date())) {
  console.log(lesson.number, lesson.subject, lesson.room, lesson.teacher);
}
```

### v5

```ts
import { TimetableClient } from "chuvsu-js";

const client = new TimetableClient({ cache: 15 * 60_000 });
await client.loginAsGuest();

const [group] = await client.searchGroups("КТ-41-24");
const schedule = await client.getGroupSchedule(group.id);

for (const lesson of schedule.on(new Date())) {
  console.log(
    lesson.id,
    lesson.slotNumber,
    lesson.subject,
    lesson.rooms.values,
    lesson.teachers.values,
  );
}
```

## Переименования клиентов и общих типов

| v4 | v5 |
|---|---|
| `TtClient` | `TimetableClient` |
| `TtClientOptions` | `TimetableClientOptions` |
| `LkClient` | `StudentPortalClient` |
| `LkClientOptions` | `StudentPortalClientOptions` |
| `LkCacheConfig` | `StudentPortalCacheConfig` |
| `PersonalData` | `StudentProfile` |
| `Audience` | `Room` |
| `AudienceInfo` | `RoomInfo` |
| `EducationType` | `EducationLevel` |
| `Period` | `AcademicPeriod` |

Опция клиента также переименована:

```ts
// v4
new TtClient({ educationType: EducationType.HigherEducation });

// v5
new TimetableClient({ educationLevel: EducationLevel.HigherEducation });
```

## Методы `TimetableClient`

| v4 | v5 |
|---|---|
| `getSchedule(groupId)` | `getGroupSchedule(groupId)` |
| `getScheduleForPeriod({ groupId, period })` | `getGroupSchedule(groupId, { periods: [period] })` |
| `getTeacherScheduleForPeriod({ teacherId, period })` | `getTeacherSchedule(teacherId, { periods: [period] })` |
| `getAudienceSchedule(id)` | `getRoomSchedule(id)` |
| `getAudienceScheduleForPeriod({ audienceId, period })` | `getRoomSchedule(audienceId, { periods: [period] })` |
| `searchGroup({ name })` | `searchGroups(name)` |
| `searchTeacher({ name })` | `searchTeachers(name)` |
| `searchAudience({ name })` | `searchRooms(name)` |
| `getGroupsForFaculty({ facultyId })` | `getFacultyGroups(facultyId)` |
| `getAudiences()` | `getRooms()` |
| `findAudienceByName({ name })` | `findRoomByName(name)` |
| `getAudienceName(id)` | `getRoomName(id)` |
| `getAudienceInfo(id)` | `getRoomInfo(id)` |
| `getAudienceImage(id)` | `getRoomImage(id)` |
| `getAudienceBlockImage(id)` | `getRoomBuildingImage(id)` |
| `getAudienceFloorplan(id)` | `getRoomFloorPlan(id)` |
| `getTeacherPhoto(id)` / `getTeacherPhotoLazy(id)` | `getTeacherPhoto(id)` |

`getGroupSchedule`, `getTeacherSchedule` и `getRoomSchedule` по умолчанию
загружают все четыре периода. Для ограничения запросов передайте `periods`:

```ts
import { AcademicPeriod } from "chuvsu-js";

const schedule = await client.getTeacherSchedule(teacherId, {
  periods: [
    AcademicPeriod.FallSemester,
    AcademicPeriod.WinterSession,
  ],
});
```

Для кода, который работает с разными владельцами одинаково, добавлен общий
метод:

```ts
const schedule = await client.getSchedule({
  type: "room",
  room: { id: roomId, name: "Г-402" },
});
```

## Методы `Schedule`

| v4 | v5 |
|---|---|
| `forDate(date)` | `on(date)` |
| `forWeek(week, options)` | `week(week, options)` |
| `forDay(weekday, options)` | `weekday(weekday, options)` |
| `currentLesson(options)` | `current(options)` |
| `today(options)` | `today(options)` |
| `tomorrow(options)` | `tomorrow(options)` |
| `thisWeek(options)` | `thisWeek(options)` |

`on`, `week`, `weekday`, `today`, `tomorrow` и `thisWeek` теперь всегда
возвращают `LessonOccurrence[]`. Опция `subgroup` сохранена:

```ts
const lessons = schedule.weekday(1, { week: 4, subgroup: 2 });
```

Новый метод `series()` возвращает повторяющиеся определения
`LessonSeries[]`. Поля v4 `scheduleMap`, `days`, `periods` и `getDays()` удалены:
канонический `Schedule` больше не является оберткой над HTML-таблицей.

## Миграция `Lesson` на `LessonOccurrence`

| v4 `Lesson` | v5 `LessonOccurrence` |
|---|---|
| `number` | `slotNumber` |
| `start.hours`, `start.minutes` | `time?.start.hours`, `time?.start.minutes` |
| `end.hours`, `end.minutes` | `time?.end.hours`, `time?.end.minutes` |
| `start.date` | `scheduledDate` (`YYYY-MM-DD`) |
| `room` | `rooms.values` |
| `teacher` | `teachers.values` |
| `groups: string[]` | `groups.values: GroupAttendance[]` |
| `originalRoom` | `originalRooms` |
| `originalTeacher` | `originalTeachers` |
| `transfer` | `status`, `nominalDate`, `scheduledDate`, `movedFrom` |
| отсутствовало | `id` и необязательный `seriesId` |
| отсутствовало | `sources` |

`slotNumber` и `time` необязательны и независимы. Нельзя использовать
утверждение `lesson.number === 5` как источник времени или вычислять номер пары
по ближайшему интервалу.

```ts
for (const lesson of schedule.on(date)) {
  const roomNames = lesson.rooms.values.map((room) => room.name);
  const teacherNames = lesson.teachers.values.map((teacher) => teacher.name);
  const groupNames = lesson.groups.values.map(({ group }) => group.name);

  if (lesson.time) {
    console.log(lesson.time.start, lesson.time.end);
  }
}
```

Поля повторения больше не дублируются в конкретном занятии. Диапазон недель,
день и чередование находятся в `LessonSeries.recurrence`:

```ts
for (const series of schedule.series()) {
  console.log(
    series.id,
    series.recurrence.weekday,
    series.recurrence.weeks,
    series.recurrence.parity,
  );
}
```

Отсутствующий `recurrence.weeks` означает, что источник не сообщил ограничение,
а не диапазон `0..0`.

## Связи и отсутствие данных

В v4 пустая строка или пустой массив одновременно могли означать «значения
нет» и «страница его не показала». В v5 группы, преподаватели и аудитории имеют
тип `RelationSet<T>`:

```ts
type RelationSet<T> = {
  values: T[];
  completeness: "unknown" | "partial" | "complete";
};
```

- `unknown` — источник ничего не сообщил;
- `partial` — известна только часть списка;
- `complete` — список известен полностью, включая явный пустой список.

Проверяйте не только `values.length`, если для приложения важно различать
неизвестность и подтвержденное отсутствие.

Ссылки на сущности теперь могут содержать ID:

```ts
lesson.teachers.values // TeacherRef[]: { id?, name, position?, degree? }
lesson.rooms.values    // RoomRef[]: { id?, name, building? }
lesson.groups.values   // GroupAttendance[]: { group: GroupRef, subgroup? }
```

## Даты, сессия и переносы

Календарные даты внутри модели представлены `LocalDate` — строкой
`YYYY-MM-DD`. Это предотвращает сдвиг учебного дня при сериализации в UTC.
Методы запросов по-прежнему принимают локальный `Date`.

```ts
import { formatLocalDate, parseLocalDate } from "chuvsu-js";

const key = formatLocalDate(new Date(2026, 8, 3)); // "2026-09-03"
const date = parseLocalDate(key);                  // локальный Date
```

Экзамен, консультация и другая строка сессии сразу являются
`LessonOccurrence` с датой из портала. У них нет фиктивных недель и обычно нет
`seriesId`.

Для перенесенного занятия:

- `nominalDate` — исходная дата;
- `scheduledDate` — фактическая дата;
- `status === "moved"`;
- `movedFrom` содержит исходную дату и номер пары.

## ID и постоянное хранилище

В v4 устойчивых ID занятий не было. Поэтому старый кеш нельзя преобразовать в
ID v5. После первого получения данных v5 ID сохраняются в
`TimetableRepository` и не зависят от даты, аудитории или времени.

TTL-кеш сетевых ответов и репозиторий идентичности — разные хранилища:

```ts
const client = new TimetableClient({
  cache: 15 * 60_000,
  cacheAdapter,
  repositoryAdapter,
});
```

Для сохранения ID между процессами реализуйте `TimetableRepositoryAdapter` или
используйте `MemoryTimetableRepositoryAdapter` в рамках одного процесса.
Снимок можно получить явно:

```ts
const snapshot = await client.exportRepository();
```

Репозиторий предназначен для серверного хранения и дополнения данных. Не
отправляйте полный `TimetableRepositorySnapshot` в браузер: его размер растет
вместе со всеми когда-либо загруженными расписаниями, а восстановление требует
повторной агрегации связей.

Для API, SSR и офлайн-кеша материализуйте только готовое расписание владельца:

```ts
// Сервер: агрегация выполняется один раз, источники можно убрать из payload.
const payload = schedule.materializeSnapshot({ includeSources: false });
return Response.json(payload);

// Браузер: JSON восстанавливается в индексированное по дате представление.
import { MaterializedSchedule } from "chuvsu-js/browser";

const schedule = new MaterializedSchedule(await response.json());
schedule.on(date);                  // O(1) поиск даты
schedule.dateKeys({ subgroup: 2 }); // даты для календаря
```

`MaterializedScheduleSnapshot` содержит уже объединенные `LessonOccurrence`,
но не канонический репозиторий. Поле `repositoryRevision` позволяет серверному
кешу инвалидировать снимок после дополнения пары из расписания преподавателя,
аудитории или другой группы.

Не передавайте экспорт `exportCache()` из v4 в `importCache()` v5: изменились
ключи, категории и форма закешированных страниц. Старый TTL-кеш и старые blob-
ключи следует удалить. Снимок репозитория v5 имеет `schemaVersion: 5`.

## Дополнение данных и справочник сущностей

Полученный `Schedule` является живым представлением репозитория. Последующие
запросы могут дополнить ту же пару, не меняя ее ID:

```ts
const schedule = await client.getGroupSchedule(groupId);
const before = schedule.on(date);

await client.getTeacherSchedule(teacherId);
await client.getRoomSchedule(roomId);

const after = schedule.on(date);
```

Загрузка расписания не запускает каскадный поиск групп, преподавателей или
аудиторий. Справочник можно наполнить явно:

```ts
await client.preloadDirectory({
  teachers: true,
  rooms: true,
  facultyIds: [19],
});

const teacher = await client.resolveTeacher("Иванов И. И.");
const searched = await client.resolveTeacher("Иванов И. И.", {
  strategy: "search",
});
```

Стратегия по умолчанию — `cache-only`. ID сокращенному имени присваивается
только при единственном совпадении.

## HTML-парсеры

Если приложение использовало табличные типы v4 напрямую, миграция выполняется
отдельно от канонического `Schedule`:

| v4 | v5 (`chuvsu-js/parsers`) |
|---|---|
| `FullScheduleDay` | `ParsedScheduleDay` |
| `FullScheduleSlot` | `ParsedScheduleBlock` |
| `ScheduleEntry` | `ParsedLesson` |
| `day.slots` | `day.blocks` |
| `slot.number` | `block.slotNumber` |
| `slot.timeStart`, `slot.timeEnd` | `block.time?.start`, `block.time?.end` |
| `slot.entries` | `block.lessons` |

```ts
import { parseGroupSchedule } from "chuvsu-js/parsers";

const days = parseGroupSchedule(html);
for (const day of days) {
  for (const block of day.blocks) {
    console.log(block.slotNumber, block.time, block.lessons);
  }
}
```

`ParsedLesson.room`, `teacher` и `groups` могут быть `undefined` (источник не
сообщил) или `null` (источник явно сообщил отсутствие). Для загрузки разобранной
страницы в доменную модель используйте `createScheduleSourceSnapshot`, затем
`TimetableRepository.ingest`.

## Вебинары

| v4 | v5 |
|---|---|
| `attachWebinarsToLessons` | `attachWebinars` |
| `matchWebinarToLesson` | `findWebinar` |
| `webinar.date` | `webinar.scheduledDate` |
| `webinar.timeStart`, `webinar.timeEnd` | `webinar.time.start`, `webinar.time.end` |

```ts
import { attachWebinars } from "chuvsu-js";

const lessons = schedule.on(date);
const webinars = await client.getWebinars({ date });
const withWebinars = attachWebinars(lessons, webinars);
```

`attachWebinars` возвращает новые объекты `LessonWithWebinar` и не изменяет
занятия в репозитории.

## Сетка звонков

| v4 | v5 |
|---|---|
| `getTimeSlots()` | `getStandardScheduleBlocks()` |
| `getLessonNumber(time)` | удален |

Стандартная сетка в v5 является только справочником. Она не исправляет данные
портала и не используется для вычисления `slotNumber` по времени.

## Личный кабинет

| v4 | v5 |
|---|---|
| `new LkClient()` | `new StudentPortalClient()` |
| `getPersonalData()` | `getProfile()` |
| `getPhoto()` | `getProfilePhoto()` |
| `getGroupId()` | `getTimetableGroupId()` |

Поля профиля не изменились; изменились имена класса, типа и методов. Ключи
настроек кеша переименованы с `personalData`, `photo`, `groupId` на `profile`,
`profilePhoto`, `timetableGroupId`.

## Ключи `CacheConfig`

В расписании переименованы категории:

| v4 | v5 |
|---|---|
| `audiences` | `rooms` |
| `audienceNames` | `roomNames` |
| `audienceInfo` | `roomInfo` |
| `audienceImages` | `roomImages` |

Остальные категории сохраняют назначение, но содержимое кеша v4 повторно
использовать нельзя.

## Браузер

В v4 браузерный `Schedule` строился из `Map<Period, FullScheduleDay[]>`. В v5
браузер получает снимок канонического репозитория от сервера:

```ts
// Node/server
const snapshot = await client.exportRepository();

// Browser
import { Schedule, TimetableRepository } from "chuvsu-js/browser";

const repository = new TimetableRepository({ snapshot });
const schedule = new Schedule(
  repository,
  { type: "group", group: { id: 8919, name: "КТ-41-24" } },
  2026,
);
```

`chuvsu-js/browser` не включает HTML-парсер, `undici`, сертификаты ЧГУ и
`Buffer`. Авторизацию и загрузку страниц выполняйте на сервере.

## Удаленные допущения v4

- Нельзя считать пустую строку аудитории подтвержденным отсутствием аудитории.
- Нельзя считать номер пары индексом массива или выводить время из номера.
- Нельзя читать недели у экзамена или консультации: это датированные занятия.
- Нельзя сравнивать пары по `дата + аудитория + время`; используйте `id`.
- Нельзя ожидать, что страница группы содержит полное имя и ID преподавателя.
- Нельзя импортировать TTL-кеш v4 как репозиторий v5.
- Нельзя создавать `Schedule` из старых `FullScheduleDay[]`.

## Рекомендуемый порядок перехода

1. Переименовать клиенты, enum и методы поиска.
2. Заменить методы получения расписаний и вызовы `Schedule`.
3. Перевести UI и бизнес-логику с `Lesson` на `LessonOccurrence`.
4. Обработать `RelationSet` и необязательные `slotNumber`/`time`.
5. Перевести сохраняемые даты на `LocalDate`.
6. Перенести работу с повторением в `schedule.series()`.
7. Удалить старый кеш; отдельно подключить `repositoryAdapter`.
8. Если используются парсеры или браузер, перейти на новые точки входа.
9. Обновить сопоставление вебинаров и методы личного кабинета.
10. Проверить сессию, переносы, замены, подгруппы и ДОТ на реальных данных.

Описание внутренней модели: [`v5-architecture.md`](v5-architecture.md).
