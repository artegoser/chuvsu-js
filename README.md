# chuvsu-js

Типизированная библиотека для сервисов ЧГУ им. И. Н. Ульянова:

- `tt.chuvsu.ru` — расписания групп, преподавателей, аудиторий и вебинары;
- `lk.chuvsu.ru` — личный кабинет студента.

В версии 5 расписание хранится в едином каноническом репозитории. Если одна
пара встречается в расписаниях группы, преподавателя и аудитории, она сохраняет
один ID, а сведения из разных страниц дополняют друг друга.

## Установка

```bash
npm install chuvsu-js
```

Рекомендуются Node.js 20+ и ESM.

## Быстрый старт

```ts
import { TimetableClient } from "chuvsu-js";

const client = new TimetableClient({ cache: 15 * 60_000 });
await client.loginAsGuest();

const [group] = await client.searchGroups("КТ-41-24");
const schedule = await client.getGroupSchedule(group.id);

for (const lesson of schedule.today({ subgroup: 1 })) {
  console.log(
    lesson.id,
    lesson.subject,
    lesson.teachers.values,
    lesson.rooms.values,
  );
}
```

У каждой конкретной пары есть `id`. У повторяющейся пары также есть
`seriesId`:

```ts
const series = schedule.series();
const monday = schedule.weekday(1, { week: 4 });
const day = schedule.on(new Date(2026, 8, 7));
const week = schedule.week(4);
const current = schedule.current();
```

ID не строится из даты, аудитории или времени. Перенос и смена аудитории сами
по себе не создают новую сущность. Чтобы ID сохранялись между запусками,
подключите постоянное хранилище репозитория.

## Расписания разных владельцев

```ts
await client.getGroupSchedule(groupId);
await client.getTeacherSchedule(teacherId);
await client.getRoomSchedule(roomId);
```

Общий метод:

```ts
await client.getSchedule({
  type: "teacher",
  teacher: { id: teacherId, name: "Иванов Иван Иванович" },
});
```

Можно загрузить только нужные периоды:

```ts
import { AcademicPeriod } from "chuvsu-js";

await client.getGroupSchedule(groupId, {
  periods: [AcademicPeriod.FallSemester],
});
```

## Дополнение данных из разных страниц

Страница группы часто содержит только фамилию и инициалы преподавателя.
Страница преподавателя сообщает список групп, а страница аудитории — другие
связи той же пары. Все это считается неполными наблюдениями:

```ts
const groupSchedule = await client.getGroupSchedule(groupId);
const before = groupSchedule.on(date);

await client.getTeacherSchedule(teacherId);
await client.getRoomSchedule(roomId);

const after = groupSchedule.on(date);
// ID прежний, но в связях могли появиться дополнительные группы и ID сущностей.
```

`Schedule` — живое представление репозитория: следующий запрос через уже
созданный объект видит новые данные.

Связи имеют вид `RelationSet<T>`:

```ts
lesson.rooms // { values: RoomRef[], completeness: "unknown" | "partial" | "complete" }
```

`unknown` означает, что страница ничего не сообщила. `complete` с пустым
`values` означает, что отсутствие известно явно. Поэтому пустая строка
аудитории в канонической модели не используется.

## Номер пары и время

Портал иногда показывает противоречивые номер пары и время. В v5 это независимые
утверждения:

```ts
lesson.slotNumber // 6
lesson.time       // { start: { hours: 16, minutes: 40 }, end: ... }
```

Номер не вычисляется из времени, а время — из номера. При объединении одна
совпавшая величина может подтвердить пару, если остальные признаки надежны;
разные дни или несовместимое чередование объединяться не будут.

Даты без времени представлены строкой `LocalDate` формата `YYYY-MM-DD`, например
`lesson.scheduledDate === "2026-09-03"`. Это исключает сдвиги даты из-за UTC.

Экзамены, консультации и другие строки сессии являются сразу конкретными
`LessonOccurrence`: дата берется со страницы, `seriesId` и `recurrence` у них
нет. Значения-заглушки наподобие `weeks: { from: 0, to: 0 }` не используются.

## Справочник сущностей без каскадных запросов

Загрузка расписания никогда автоматически не запускает поиск преподавателей,
групп или аудиторий. Обычные методы поиска наполняют общий справочник:

```ts
await client.getTeachers();
await client.getRooms();
await client.getFacultyGroups(facultyId);

const teacher = await client.resolveTeacher("Иванов И. И.");
```

По умолчанию разрешение использует только уже известные данные. Один явный
поиск можно разрешить отдельно:

```ts
const teacher = await client.resolveTeacher("Иванов И. И.", {
  strategy: "search",
});
```

Или заранее загрузить нужные справочники:

```ts
await client.preloadDirectory({
  teachers: true,
  rooms: true,
  facultyIds: [19],
});
```

ID присваивается сокращенному имени только при единственном совпадении.

## Постоянный репозиторий

TTL-кеш ответов и хранилище канонических ID независимы:

```ts
const client = new TimetableClient({
  cache: 15 * 60_000,
  cacheAdapter,
  repositoryAdapter,
});
```

`TimetableRepositoryAdapter` можно реализовать поверх БД, KV-хранилища или
файлового сервиса. Запись использует ревизии compare-and-set, чтобы параллельные
процессы не перезаписывали установленные ID.

```ts
const snapshot = await client.exportRepository();
```

Для одного процесса есть память:

```ts
import {
  MemoryTimetableRepositoryAdapter,
  TimetableClient,
} from "chuvsu-js";

const repositoryAdapter = new MemoryTimetableRepositoryAdapter();
const client = new TimetableClient({ repositoryAdapter });
```

## Использование в браузере

`chuvsu-js/browser` не содержит `undici`, сертификатов ЧГУ, `Buffer` и HTML-
парсера. Браузер может получить снимок с сервера и выполнять запросы локально:

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

Сетевые клиенты остаются Node-only: авторизация, cookie, сертификаты и CORS
портала нельзя надежно перенести в чистый браузерный пакет.

```ts
import { TimetableClient } from "chuvsu-js";          // Node + ядро
import { TimetableClient } from "chuvsu-js/node";     // явно Node
import { TimetableRepository } from "chuvsu-js/browser";
import { parseGroupSchedule } from "chuvsu-js/parsers";
```

## Поиск и метаданные

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

Фото преподавателя загружается по уже известному прямому URL без лишнего
запроса страницы преподавателя.

## Личный кабинет

```ts
import { StudentPortalClient } from "chuvsu-js";

const portal = new StudentPortalClient({ cache: 60_000 });
await portal.login({ email: "student@example.com", password: "password" });

const profile = await portal.getProfile();
const photo = await portal.getProfilePhoto();
const groupId = await portal.getTimetableGroupId();
```

## Разработка

```bash
pnpm build
pnpm test
pnpm test:coverage
pnpm fixtures:test
```

Подробности архитектуры: [`docs/v5-architecture.md`](docs/v5-architecture.md).
Границы и честная интерпретация тестов: [`docs/testing.md`](docs/testing.md).
