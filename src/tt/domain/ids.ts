import type {
  LessonId,
  LessonIdGenerator,
  LessonSeriesId,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeId(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const block = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    encoded += ID_ALPHABET[(block >>> 18) & 63];
    encoded += ID_ALPHABET[(block >>> 12) & 63];
    encoded += ID_ALPHABET[(block >>> 6) & 63];
    encoded += ID_ALPHABET[block & 63];
  }
  return encoded;
}

function encodeLegacyUuid(uuid: string): string {
  const hex = uuid.replaceAll("-", "").slice(0, 18);
  const bytes = new Uint8Array(hex.match(/.{2}/gu)!.map((pair) => Number.parseInt(pair, 16)));
  return encodeId(bytes);
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error("Secure random IDs require Web Crypto");
  return encodeId(cryptoApi.getRandomValues(new Uint8Array(9)));
}

export class RandomLessonIdGenerator implements LessonIdGenerator {
  seriesId(): LessonSeriesId {
    return randomId();
  }

  lessonId(): LessonId {
    return randomId();
  }
}

/** Stable occurrence identity inside a persisted series. */
export function occurrenceIdForSeries(
  seriesId: LessonSeriesId,
  academicWeek: number,
  ordinal = 0,
): LessonId {
  return `${seriesId}.${academicWeek}.${ordinal}`;
}

/** Convert persisted v5 UUID IDs without changing their identity. */
export function migrateLegacyLessonId(id: string): string {
  const occurrence = /^les_ser_([0-9a-f-]{36})_(\d+)_(\d+)$/iu.exec(id);
  if (occurrence && UUID_PATTERN.test(occurrence[1])) {
    return occurrenceIdForSeries(encodeLegacyUuid(occurrence[1]), Number(occurrence[2]), Number(occurrence[3]));
  }
  const series = /^ser_([0-9a-f-]{36})$/iu.exec(id);
  if (series && UUID_PATTERN.test(series[1])) return encodeLegacyUuid(series[1]);
  const direct = /^les_([0-9a-f-]{36})$/iu.exec(id);
  if (direct && UUID_PATTERN.test(direct[1])) return encodeLegacyUuid(direct[1]);
  return id;
}
