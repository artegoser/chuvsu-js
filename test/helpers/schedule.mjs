import { Schedule } from "../../dist/tt/domain/schedule.js";
import { TimetableRepository } from "../../dist/tt/domain/repository.js";
import { createScheduleSourceSnapshot } from "../../dist/tt/observations.js";

export function scheduleFromParsedDays(days, options = {}) {
  const owner = options.owner ?? {
    type: "group",
    group: { id: 8919, name: "КТ-41-24" },
  };
  const period = options.period ?? 1;
  const academicYearStartYear = options.academicYearStartYear ?? 2025;
  const repository = new TimetableRepository({
    idGenerator: {
      seriesId: (() => {
        let sequence = 0;
        return () => `ser_test_${++sequence}`;
      })(),
      lessonId: (() => {
        let sequence = 0;
        return () => `les_test_${++sequence}`;
      })(),
    },
  });
  repository.ingest(
    createScheduleSourceSnapshot({
      sourceKey: options.sourceKey ?? "test:group:8919",
      owner,
      academicYearStartYear,
      period,
      observedAt: new Date("2026-08-30T00:00:00.000Z"),
      days,
    }),
  );
  return new Schedule(repository, owner, academicYearStartYear, {
    period,
    holidays: options.holidays ?? [],
    holidayTransfers: options.holidayTransfers ?? [],
  });
}
