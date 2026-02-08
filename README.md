# chuvsu-js

Node.js библиотека для работы с порталами ЧувГУ:

- **tt.chuvsu.ru** — расписание занятий (факультеты, группы, преподаватели)
- **lk.chuvsu.ru** — личный кабинет студента (персональные данные)

Пока что очень сырая, много что можно оптимизировать.

## Установка

```bash
npm install chuvsu-js
```

## Быстрый старт

### Расписание (TtClient)

```ts
import { TtClient } from "chuvsu-js";

const tt = new TtClient();

// Войти гостем (без учётной записи)
await tt.loginAsGuest();

// Найти группу по названию
const groups = await tt.searchGroup({ name: "КТ-41-24" });
console.log(groups); // [{ id: 123, name: "КТ-41-24", specialty: "...", profile: "..." }]

// Получить расписание на сегодня
const lessons = await tt.getScheduleForDate({
  groupId: groups[0].id,
  date: new Date(),
});

for (const lesson of lessons) {
  console.log(
    `${lesson.start.hours}:${lesson.start.minutes} — ${lesson.subject} (${lesson.type})`,
  );
}
```

### Личный кабинет (LkClient)

```ts
import { LkClient } from "chuvsu-js";

const lk = new LkClient();
await lk.login({ email: "student@mail.ru", password: "password" });

const data = await lk.getPersonalData();
console.log(`${data.lastName} ${data.firstName}, группа ${data.group}`);

// Получить ID группы для использования с TtClient
const groupId = await lk.getGroupId();
```

## API

### TtClient

Клиент для работы с расписанием (`tt.chuvsu.ru`).

#### Конструктор

```ts
new TtClient(options?: TtClientOptions)
```

| Опция           | Тип                     | По умолчанию      | Описание                                                       |
| --------------- | ----------------------- | ----------------- | -------------------------------------------------------------- |
| `educationType` | `EducationType`         | `HigherEducation` | Тип образования: высшее (1) или СПО (2)                        |
| `cache`         | `number \| CacheConfig` | —                 | TTL кеша в мс. Число задаёт единый TTL, объект — по категориям |

#### Авторизация

```ts
// С учётной записью
await tt.login({ email: "...", password: "..." });

// Гостевой вход
await tt.loginAsGuest();
```

#### Расписание

```ts
// Полное расписание группы (все дни, все слоты)
const schedule = await tt.getGroupSchedule({ groupId, period? });

// Расписание на конкретную дату
const lessons = await tt.getScheduleForDate({ groupId, date, filter?, period? });

// Расписание на день недели (0 = воскресенье, 1 = понедельник, ...)
const lessons = await tt.getScheduleForDay({ groupId, weekday, filter?, period? });

// Расписание на неделю
const week = await tt.getScheduleForWeek({ groupId, week?, filter?, period? });

// Текущая пара
const lesson = await tt.getCurrentLesson({ groupId, filter? });
```

**ScheduleFilter** — фильтрация по подгруппе и/или неделе:

```ts
{ subgroup?: number; week?: number }
```

#### Поиск

```ts
// Список факультетов
const faculties = await tt.getFaculties();

// Группы факультета
const groups = await tt.getGroupsForFaculty({ facultyId });

// Поиск группы по названию
const groups = await tt.searchGroup({ name: "ЗИ" });

// Поиск преподавателя
const teachers = await tt.searchTeacher({ name: "Иванов" });
```

#### Кеш

```ts
// Очистить весь кеш или по категории
tt.clearCache();
tt.clearCache("schedule");

// Экспорт/импорт (для сохранения между запусками)
const data = tt.exportCache();
tt.importCache(data);
```

Категории кеша: `schedule`, `faculties`, `groups`, `currentPeriod`.

#### Утилиты семестра

```ts
import {
  getSemesterStart,
  getSemesterWeeks,
  getWeekNumber,
  Period,
} from "chuvsu-js";

// Начало семестра
getSemesterStart({ period: Period.FallSemester, year: 2025 });

// Все недели семестра
getSemesterWeeks({ period: Period.SpringSemester });

// Номер текущей недели
getWeekNumber({ period: Period.SpringSemester });
```

### LkClient

Клиент для личного кабинета (`lk.chuvsu.ru`).

```ts
await lk.login({ email, password });
const data = await lk.getPersonalData();
const groupId = await lk.getGroupId();
```

**PersonalData** содержит: `lastName`, `firstName`, `patronymic`, `sex`, `birthday`, `recordBookNumber`, `faculty`, `specialty`, `profile`, `group`, `course`, `email`, `phone`.

## Типы

### Period

```ts
enum Period {
  FallSemester = 1, // Осенний семестр
  WinterSession = 2, // Зимняя сессия
  SpringSemester = 3, // Весенний семестр
  SummerSession = 4, // Летняя сессия
}
```

### EducationType

```ts
enum EducationType {
  HigherEducation = 1, // Высшее образование
  VocationalEducation = 2, // СПО
}
```

### Lesson

```ts
interface Lesson {
  number: number; // Номер пары
  start: LessonTime; // Начало { date, hours, minutes }
  end: LessonTime; // Конец { date, hours, minutes }
  subject: string; // Предмет
  type: string; // Тип (лекция, практика, лаб. работа)
  room: string; // Аудитория
  teacher: Teacher; // Преподаватель { name, position?, degree? }
  weeks: WeekRange; // Диапазон недель { from, to }
  subgroup?: number; // Подгруппа
  weekParity?: "even" | "odd"; // Чётность недели
}
```

## Обработка ошибок

```ts
import { AuthError, ParseError } from "chuvsu-js";

try {
  await tt.login({ email: "...", password: "wrong" });
} catch (e) {
  if (e instanceof AuthError) {
    console.error("Неверные данные для входа");
  }
}
```

## Лицензия

MIT
