import type {
  LessonId,
  LessonIdGenerator,
  LessonSeriesId,
} from "./types.js";

function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `${prefix}_${cryptoApi.randomUUID()}`;

  const random = Math.random().toString(36).slice(2);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${random}`;
}

export class RandomLessonIdGenerator implements LessonIdGenerator {
  seriesId(): LessonSeriesId {
    return randomId("ser");
  }

  lessonId(): LessonId {
    return randomId("les");
  }
}

/** Stable occurrence identity inside a persisted series. */
export function occurrenceIdForSeries(
  seriesId: LessonSeriesId,
  academicWeek: number,
  ordinal = 0,
): LessonId {
  return `les_${seriesId}_${academicWeek}_${ordinal}`;
}
