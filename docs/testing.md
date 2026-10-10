# Проверка расписания v5

Эталонные JSON поддерживаются и изменяются только вручную. Генератора эталонов
в репозитории нет. Все 42 полных JSON-эталона (1184 занятия) вручную сверены с
соответствующими HTML-страницами. Проверены владелец, учебный год, период,
позиция строки, предмет, тип, день, слот, фактическое время, недели,
чередование, аудитория, преподаватель, группы, подгруппа, ДОТ, замены и
переносы. Журнал проверки: [`fixture-review.md`](fixture-review.md).

Для каждой страницы тест заново получает канонический результат и целиком
сравнивает его с зафиксированным JSON. Детерминированный генератор ID в тесте
нужен только для стабильных идентификаторов; он не создает и не изменяет
эталоны. Дополнительно весь корпус проверяет объединение общих пар между
страницами групп, преподавателей и аудиторий.

Точечные примеры проверяют семестр, сессию, экзамены, консультации, подгруппы,
ДОТ, замены, преподавателя «вместо», переносы и отсутствие данных. Доменные
тесты проверяют ID, неоднозначность, объединение проекций, применение изменений
и календарное раскрытие. `pnpm test:coverage` требует для ядра расписания не
меньше 95% строк, 94% функций и 80% ветвей.

Live-тест сравнивает парсер с текущими страницами портала, но не заменяет
зафиксированные HTML и ручные эталоны.

## Student portal checks

Synthetic LK fixtures cover webinar availability, topics, selected dates,
lesson matching, all portfolio tabs, grades, control weeks, merged attendance
headers, activity fields, documents and referral metadata. LK parsers and webinar
matching participate in `pnpm test:coverage` alongside the timetable core.
Client contracts use mocked HTTP; automated tests never call a real join or
referral endpoint.

Read-only live verification used login, home navigation, webinar listing and
own portfolio only. Join URL resolution was checked against the site's
JavaScript and mocked responses. Live pages and credentials are not fixtures.
