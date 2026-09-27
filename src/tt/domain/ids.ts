import type {
  LessonId,
  LessonIdGenerator,
  LessonSeriesId,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function encodeUuid(uuid: string): string {
  const hex = uuid.replaceAll('-', '');
  const bytes = new Uint8Array(hex.match(/.{2}/gu)!.map((pair) => Number.parseInt(pair, 16)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomId(prefix: 's' | 'l'): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `${prefix}${encodeUuid(cryptoApi.randomUUID())}`;

  const random = Math.random().toString(36).slice(2);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${random}`;
}

export class RandomLessonIdGenerator implements LessonIdGenerator {
  seriesId(): LessonSeriesId {
    return randomId("s");
  }

  lessonId(): LessonId {
    return randomId("l");
  }
}

/** Stable occurrence identity inside a persisted series. */
export function occurrenceIdForSeries(
  seriesId: LessonSeriesId,
  academicWeek: number,
  ordinal = 0,
): LessonId {
  if (/^s[A-Za-z0-9_-]{22}$/u.test(seriesId) && academicWeek >= 0 && academicWeek < 1296 && ordinal >= 0 && ordinal < 36) {
    return `o${seriesId.slice(1)}${academicWeek.toString(36).padStart(2, '0')}${ordinal.toString(36)}`;
  }
  return `les_${seriesId}_${academicWeek}_${ordinal}`;
}

/** Convert persisted v5 UUID IDs without changing their identity. */
export function compactLegacyLessonId(id: string): string {
  const occurrence = /^les_ser_([0-9a-f-]{36})_(\d+)_(\d+)$/iu.exec(id);
  if (occurrence && UUID_PATTERN.test(occurrence[1])) {
    return occurrenceIdForSeries(`s${encodeUuid(occurrence[1])}`, Number(occurrence[2]), Number(occurrence[3]));
  }
  const series = /^ser_([0-9a-f-]{36})$/iu.exec(id);
  if (series && UUID_PATTERN.test(series[1])) return `s${encodeUuid(series[1])}`;
  const direct = /^les_([0-9a-f-]{36})$/iu.exec(id);
  if (direct && UUID_PATTERN.test(direct[1])) return `l${encodeUuid(direct[1])}`;
  return id;
}
