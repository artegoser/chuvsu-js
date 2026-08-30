import type { Period } from "../../common/types.js";
import { TimetableDirectory } from "./directory.js";
import { RandomLessonIdGenerator } from "./ids.js";
import {
  entityKey,
  mergeGroups,
  mergeRooms,
  mergeTeachers,
  normalizeScheduleText,
} from "./normalize.js";
import type {
  GroupAttendance,
  IngestResult,
  LessonId,
  LessonIdGenerator,
  LessonOccurrence,
  LessonSeries,
  LessonSeriesId,
  LessonSourceRef,
  OccurrenceObservation,
  ScheduleObservation,
  ScheduleOwner,
  ScheduleSourceSnapshot,
  SerializedLessonSubstitution,
  SerializedScheduleObservation,
  SerializedScheduleSourceSnapshot,
  SeriesObservation,
  TimetableRepositoryAdapter,
  TimetableRepositorySnapshot,
} from "./types.js";

interface ObservationClaim<T extends ScheduleObservation = ScheduleObservation> {
  source: ScheduleSourceSnapshot;
  observation: T;
}

interface CanonicalRecord<T extends ScheduleObservation> {
  id: string;
  claims: Map<string, ObservationClaim<T>>;
}

interface CanonicalLink {
  kind: "series" | "occurrence";
  id: string;
}

function claimKey(sourceKey: string, observationKey: string): string {
  return `${sourceKey}\u0000${observationKey}`;
}

function sourceObservationKey(sourceKey: string, observationKey: string): string {
  return claimKey(sourceKey, observationKey);
}

function sameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function rangesOverlap(
  a: { from: number; to: number },
  b: { from: number; to: number },
): boolean {
  const aFrom = a.from || 1;
  const aTo = a.to || 17;
  const bFrom = b.from || 1;
  const bTo = b.to || 17;
  return Math.max(aFrom, bFrom) <= Math.min(aTo, bTo);
}

function valuesOverlap(
  left: Array<{ id?: number; name: string }> | undefined,
  right: Array<{ id?: number; name: string }> | undefined,
): boolean | undefined {
  if (!left?.length || !right?.length) return undefined;
  const keys = new Set(left.map(entityKey));
  return right.some((value) => keys.has(entityKey(value)));
}

function groupsOverlap(
  left: GroupAttendance[] | undefined,
  right: GroupAttendance[] | undefined,
): boolean | undefined {
  if (!left?.length || !right?.length) return undefined;
  const keys = new Set(left.map((value) => entityKey(value.group)));
  return right.some((value) => keys.has(entityKey(value.group)));
}

function relationScore(overlap: boolean | undefined): number {
  if (overlap === true) return 14;
  if (overlap === false) return -18;
  return 0;
}

function observationScore(
  left: ScheduleObservation,
  right: ScheduleObservation,
  sameSource: boolean,
): number {
  if (left.kind !== right.kind) return Number.NEGATIVE_INFINITY;
  if (
    normalizeScheduleText(left.subject) !== normalizeScheduleText(right.subject)
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 35;
  if (normalizeScheduleText(left.type) === normalizeScheduleText(right.type)) {
    score += 10;
  } else if (left.type && right.type) {
    score -= 12;
  }

  if (left.slot.number === right.slot.number) score += 12;
  if (
    left.slot.start.hours === right.slot.start.hours &&
    left.slot.start.minutes === right.slot.start.minutes
  ) {
    score += 5;
  }

  if (left.kind === "series" && right.kind === "series") {
    if (left.recurrence.weekday === right.recurrence.weekday) score += 16;
    if (rangesOverlap(left.recurrence.weeks, right.recurrence.weeks)) score += 8;
    if (left.recurrence.parity === right.recurrence.parity) score += 5;
  }

  if (left.kind === "occurrence" && right.kind === "occurrence") {
    if (sameDate(left.date, right.date)) score += 34;
    if (
      left.transfer &&
      right.transfer &&
      sameDate(left.transfer.fromDate, right.transfer.fromDate) &&
      left.transfer.fromSlot === right.transfer.fromSlot
    ) {
      score += 30;
    }
  }

  score += relationScore(valuesOverlap(left.rooms, right.rooms));
  score += relationScore(valuesOverlap(left.teachers, right.teachers));
  score += relationScore(groupsOverlap(left.groups, right.groups));
  if (sameSource) score += 8;
  return score;
}

function serializeSubstitutions(
  substitutions: ScheduleObservation["substitutions"],
): SerializedLessonSubstitution[] | undefined {
  return substitutions?.map((value) => ({
    ...value,
    date: value.date.toISOString(),
  }));
}

function serializeObservation(
  observation: ScheduleObservation,
): SerializedScheduleObservation {
  if (observation.kind === "series") {
    return {
      ...observation,
      substitutions: serializeSubstitutions(observation.substitutions),
    };
  }
  return {
    ...observation,
    date: observation.date.toISOString(),
    transfer: observation.transfer
      ? {
          ...observation.transfer,
          fromDate: observation.transfer.fromDate.toISOString(),
          targetDate: observation.transfer.targetDate.toISOString(),
        }
      : undefined,
    substitutions: serializeSubstitutions(observation.substitutions),
  };
}

function deserializeObservation(
  observation: SerializedScheduleObservation,
): ScheduleObservation {
  const substitutions = observation.substitutions?.map((value) => ({
    ...value,
    date: new Date(value.date),
  }));
  if (observation.kind === "series") {
    return { ...observation, substitutions };
  }
  return {
    ...observation,
    date: new Date(observation.date),
    transfer: observation.transfer
      ? {
          ...observation.transfer,
          fromDate: new Date(observation.transfer.fromDate),
          targetDate: new Date(observation.transfer.targetDate),
        }
      : undefined,
    substitutions,
  };
}

function serializeSource(
  source: ScheduleSourceSnapshot,
): SerializedScheduleSourceSnapshot {
  return {
    ...source,
    observedAt: source.observedAt.toISOString(),
    observations: source.observations.map(serializeObservation),
  };
}

function deserializeSource(
  source: SerializedScheduleSourceSnapshot,
): ScheduleSourceSnapshot {
  return {
    ...source,
    observedAt: new Date(source.observedAt),
    observations: source.observations.map(deserializeObservation),
  };
}

function sourceRef(claim: ObservationClaim): LessonSourceRef {
  return {
    sourceKey: claim.source.sourceKey,
    observationKey: claim.observation.key,
    observedAt: new Date(claim.source.observedAt),
    owner: claim.source.owner,
  };
}

function deterministicClaims<T extends ScheduleObservation>(
  record: CanonicalRecord<T>,
): ObservationClaim<T>[] {
  return [...record.claims.values()].sort((a, b) => {
    const source = a.source.sourceKey.localeCompare(b.source.sourceKey);
    return source || a.observation.key.localeCompare(b.observation.key);
  });
}

function preferredClaim<T extends ScheduleObservation>(
  claims: ObservationClaim<T>[],
): ObservationClaim<T> {
  return [...claims].sort((a, b) => {
    const completeness = (claim: ObservationClaim<T>) =>
      (claim.observation.groups?.length ?? 0) +
      (claim.observation.teachers?.length ?? 0) +
      (claim.observation.rooms?.length ?? 0);
    return (
      completeness(b) - completeness(a) ||
      a.source.sourceKey.localeCompare(b.source.sourceKey) ||
      a.observation.key.localeCompare(b.observation.key)
    );
  })[0];
}

function ownerEntity(owner: ScheduleOwner):
  | { kind: "group"; value: GroupAttendance }
  | { kind: "teacher"; value: ScheduleOwner & { type: "teacher" } }
  | { kind: "room"; value: ScheduleOwner & { type: "room" } } {
  if (owner.type === "group") {
    return { kind: "group", value: { group: owner.group } };
  }
  if (owner.type === "teacher") return { kind: "teacher", value: owner };
  return { kind: "room", value: owner };
}

function aggregateRelations(claims: ObservationClaim[]): {
  groups: GroupAttendance[];
  teachers: ReturnType<typeof mergeTeachers>;
  rooms: ReturnType<typeof mergeRooms>;
} {
  const groups: GroupAttendance[] = [];
  const teachers = [];
  const rooms = [];

  for (const claim of claims) {
    groups.push(...(claim.observation.groups ?? []));
    teachers.push(...(claim.observation.teachers ?? []));
    rooms.push(...(claim.observation.rooms ?? []));
    const implicit = ownerEntity(claim.source.owner);
    if (implicit.kind === "group") groups.push(implicit.value);
    if (implicit.kind === "teacher") teachers.push(implicit.value.teacher);
    if (implicit.kind === "room") rooms.push(implicit.value.room);
  }

  return {
    groups: mergeGroups(groups),
    teachers: mergeTeachers(teachers),
    rooms: mergeRooms(rooms),
  };
}

function ownerMatches(
  owner: ScheduleOwner,
  relations: ReturnType<typeof aggregateRelations>,
): boolean {
  if (owner.type === "group") {
    const key = entityKey(owner.group);
    return relations.groups.some((value) => entityKey(value.group) === key);
  }
  if (owner.type === "teacher") {
    const key = entityKey(owner.teacher);
    return relations.teachers.some((value) => entityKey(value) === key);
  }
  const key = entityKey(owner.room);
  return relations.rooms.some((value) => entityKey(value) === key);
}

export class TimetableRepository {
  private readonly idGenerator: LessonIdGenerator;
  readonly directory: TimetableDirectory;
  private readonly sources = new Map<string, ScheduleSourceSnapshot>();
  private readonly links = new Map<string, CanonicalLink>();
  private readonly seriesRecords = new Map<
    LessonSeriesId,
    CanonicalRecord<SeriesObservation>
  >();
  private readonly occurrenceRecords = new Map<
    LessonId,
    CanonicalRecord<OccurrenceObservation>
  >();
  private _revision = 0;

  constructor(opts?: {
    idGenerator?: LessonIdGenerator;
    snapshot?: TimetableRepositorySnapshot;
  }) {
    this.idGenerator = opts?.idGenerator ?? new RandomLessonIdGenerator();
    this.directory = new TimetableDirectory(opts?.snapshot?.directory);
    if (opts?.snapshot) this.restore(opts.snapshot);
  }

  get revision(): number {
    return this._revision;
  }

  rememberGroups(values: Parameters<TimetableDirectory["rememberGroups"]>[0]): void {
    if (this.directory.rememberGroups(values)) this._revision++;
  }

  rememberTeachers(
    values: Parameters<TimetableDirectory["rememberTeachers"]>[0],
  ): void {
    if (this.directory.rememberTeachers(values)) this._revision++;
  }

  rememberRooms(values: Parameters<TimetableDirectory["rememberRooms"]>[0]): void {
    if (this.directory.rememberRooms(values)) this._revision++;
  }

  ingest(snapshot: ScheduleSourceSnapshot): IngestResult {
    const prior = this.sources.get(snapshot.sourceKey);
    const priorClaims = new Map<string, ObservationClaim>();
    if (prior) {
      for (const observation of prior.observations) {
        priorClaims.set(observation.key, { source: prior, observation });
        this.removeClaim(snapshot.sourceKey, observation.key);
      }
    }

    this.sources.set(snapshot.sourceKey, snapshot);
    const usedTargets = new Set<string>();
    const seriesIds: LessonSeriesId[] = [];
    const lessonIds: LessonId[] = [];
    let created = 0;
    let updated = 0;

    for (const observation of snapshot.observations) {
      const linkKey = sourceObservationKey(snapshot.sourceKey, observation.key);
      const exact = this.links.get(linkKey);
      let target =
        exact?.kind === observation.kind && !usedTargets.has(exact.id)
          ? exact
          : undefined;

      if (!target) {
        target = this.findPriorTarget(observation, priorClaims, usedTargets);
      }
      if (!target) {
        target = this.findCanonicalTarget(
          observation,
          snapshot,
          usedTargets,
        );
      }
      if (!target) {
        target =
          observation.kind === "series"
            ? { kind: "series", id: this.idGenerator.seriesId() }
            : { kind: "occurrence", id: this.idGenerator.lessonId() };
        created++;
      } else {
        updated++;
      }

      this.links.set(linkKey, target);
      usedTargets.add(target.id);
      this.addClaim(target, snapshot, observation);
      if (target.kind === "series") seriesIds.push(target.id);
      else lessonIds.push(target.id);
    }

    this._revision++;
    return {
      revision: this._revision,
      seriesIds,
      lessonIds,
      created,
      updated,
      removedObservations: Math.max(
        0,
        (prior?.observations.length ?? 0) - snapshot.observations.length,
      ),
    };
  }

  getSeries(opts?: {
    owner?: ScheduleOwner;
    academicYearStartYear?: number;
    periods?: readonly Period[];
  }): LessonSeries[] {
    const values: LessonSeries[] = [];
    for (const record of this.seriesRecords.values()) {
      if (record.claims.size === 0) continue;
      const value = this.aggregateSeries(record);
      if (
        opts?.academicYearStartYear != null &&
        value.academicYearStartYear !== opts.academicYearStartYear
      ) {
        continue;
      }
      if (opts?.periods && !opts.periods.includes(value.period)) continue;
      if (opts?.owner && !ownerMatches(opts.owner, value)) continue;
      values.push(value);
    }
    return values.sort((a, b) =>
      a.recurrence.weekday - b.recurrence.weekday ||
      a.slot.number - b.slot.number ||
      a.subject.localeCompare(b.subject) ||
      a.id.localeCompare(b.id),
    );
  }

  getDirectOccurrences(opts?: {
    owner?: ScheduleOwner;
    academicYearStartYear?: number;
    periods?: readonly Period[];
  }): LessonOccurrence[] {
    const values: LessonOccurrence[] = [];
    for (const record of this.occurrenceRecords.values()) {
      if (record.claims.size === 0) continue;
      const value = this.aggregateOccurrence(record);
      if (
        opts?.academicYearStartYear != null &&
        value.academicYearStartYear !== opts.academicYearStartYear
      ) {
        continue;
      }
      if (opts?.periods && !opts.periods.includes(value.period)) continue;
      if (opts?.owner && !ownerMatches(opts.owner, value)) continue;
      values.push(value);
    }
    return values.sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id),
    );
  }

  export(): TimetableRepositorySnapshot {
    return {
      schemaVersion: 1,
      revision: this._revision,
      directory: this.directory.export(),
      sources: [...this.sources.values()]
        .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
        .map(serializeSource),
      links: [...this.links.entries()]
        .map(([key, value]) => {
          const separator = key.indexOf("\u0000");
          return {
            sourceKey: key.slice(0, separator),
            observationKey: key.slice(separator + 1),
            ...value,
          };
        })
        .sort(
          (a, b) =>
            a.sourceKey.localeCompare(b.sourceKey) ||
            a.observationKey.localeCompare(b.observationKey),
        ),
    };
  }

  private restore(snapshot: TimetableRepositorySnapshot): void {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(
        `Unsupported timetable repository schema: ${snapshot.schemaVersion}`,
      );
    }
    this._revision = snapshot.revision;
    for (const source of snapshot.sources.map(deserializeSource)) {
      this.sources.set(source.sourceKey, source);
    }
    for (const link of snapshot.links) {
      this.links.set(
        sourceObservationKey(link.sourceKey, link.observationKey),
        { kind: link.kind, id: link.id },
      );
    }
    for (const source of this.sources.values()) {
      for (const observation of source.observations) {
        const link = this.links.get(
          sourceObservationKey(source.sourceKey, observation.key),
        );
        if (link) this.addClaim(link, source, observation);
      }
    }
  }

  private removeClaim(sourceKey: string, observationKey: string): void {
    const link = this.links.get(sourceObservationKey(sourceKey, observationKey));
    if (!link) return;
    const record =
      link.kind === "series"
        ? this.seriesRecords.get(link.id)
        : this.occurrenceRecords.get(link.id);
    record?.claims.delete(claimKey(sourceKey, observationKey));
  }

  private addClaim(
    link: CanonicalLink,
    source: ScheduleSourceSnapshot,
    observation: ScheduleObservation,
  ): void {
    const key = claimKey(source.sourceKey, observation.key);
    if (link.kind === "series" && observation.kind === "series") {
      let record = this.seriesRecords.get(link.id);
      if (!record) {
        record = { id: link.id, claims: new Map() };
        this.seriesRecords.set(link.id, record);
      }
      record.claims.set(key, { source, observation });
    }
    if (link.kind === "occurrence" && observation.kind === "occurrence") {
      let record = this.occurrenceRecords.get(link.id);
      if (!record) {
        record = { id: link.id, claims: new Map() };
        this.occurrenceRecords.set(link.id, record);
      }
      record.claims.set(key, { source, observation });
    }
  }

  private findPriorTarget(
    observation: ScheduleObservation,
    prior: Map<string, ObservationClaim>,
    usedTargets: Set<string>,
  ): CanonicalLink | undefined {
    let best: { link: CanonicalLink; score: number } | undefined;
    let tied = false;
    for (const claim of prior.values()) {
      const link = this.links.get(
        sourceObservationKey(claim.source.sourceKey, claim.observation.key),
      );
      if (!link || link.kind !== observation.kind || usedTargets.has(link.id)) {
        continue;
      }
      const score = observationScore(observation, claim.observation, true);
      if (!best || score > best.score) {
        best = { link, score };
        tied = false;
      } else if (score === best.score) {
        tied = true;
      }
    }
    return best && best.score >= 55 && !tied ? best.link : undefined;
  }

  private findCanonicalTarget(
    observation: ScheduleObservation,
    source: ScheduleSourceSnapshot,
    usedTargets: Set<string>,
  ): CanonicalLink | undefined {
    const records =
      observation.kind === "series"
        ? this.seriesRecords.values()
        : this.occurrenceRecords.values();
    let best: { id: string; score: number } | undefined;
    let second = Number.NEGATIVE_INFINITY;

    for (const record of records) {
      if (usedTargets.has(record.id) || record.claims.size === 0) continue;
      let recordScore = Number.NEGATIVE_INFINITY;
      for (const claim of record.claims.values()) {
        if (
          claim.source.academicYearStartYear !==
            source.academicYearStartYear ||
          claim.source.period !== source.period
        ) {
          continue;
        }
        recordScore = Math.max(
          recordScore,
          observationScore(observation, claim.observation, false),
        );
      }
      if (!best || recordScore > best.score) {
        second = best?.score ?? Number.NEGATIVE_INFINITY;
        best = { id: record.id, score: recordScore };
      } else if (recordScore > second) {
        second = recordScore;
      }
    }

    if (!best || best.score < 75 || best.score - second < 10) return undefined;
    return { kind: observation.kind, id: best.id };
  }

  private aggregateSeries(
    record: CanonicalRecord<SeriesObservation>,
  ): LessonSeries {
    const claims = deterministicClaims(record);
    const preferred = preferredClaim(claims);
    const rawRelations = aggregateRelations(claims);
    const relations = {
      groups: rawRelations.groups.map((value) => ({
        ...value,
        group: this.directory.resolveGroup(value.group),
      })),
      teachers: rawRelations.teachers.map((value) =>
        this.directory.resolveTeacher(value),
      ),
      rooms: rawRelations.rooms.map((value) =>
        this.directory.resolveRoom(value),
      ),
    };
    return {
      id: record.id,
      academicYearStartYear: preferred.source.academicYearStartYear,
      period: preferred.source.period,
      subject: preferred.observation.subject,
      type: preferred.observation.type,
      slot: preferred.observation.slot,
      recurrence: preferred.observation.recurrence,
      ...relations,
      isDistance: claims.some((value) => value.observation.isDistance === true),
      possibleChanges: claims.some(
        (value) => value.observation.possibleChanges === true,
      ),
      substitutions: claims.flatMap(
        (value) => value.observation.substitutions ?? [],
      ),
      sources: claims.map(sourceRef),
    };
  }

  private aggregateOccurrence(
    record: CanonicalRecord<OccurrenceObservation>,
  ): LessonOccurrence {
    const claims = deterministicClaims(record);
    const preferred = preferredClaim(claims);
    const rawRelations = aggregateRelations(claims);
    const relations = {
      groups: rawRelations.groups.map((value) => ({
        ...value,
        group: this.directory.resolveGroup(value.group),
      })),
      teachers: rawRelations.teachers.map((value) =>
        this.directory.resolveTeacher(value),
      ),
      rooms: rawRelations.rooms.map((value) =>
        this.directory.resolveRoom(value),
      ),
    };
    const transfer = claims
      .map((value) => value.observation.transfer)
      .find((value) => value != null);
    return {
      id: record.id,
      academicYearStartYear: preferred.source.academicYearStartYear,
      period: preferred.source.period,
      nominalDate: transfer?.fromDate ?? preferred.observation.date,
      date: transfer?.targetDate ?? preferred.observation.date,
      subject: preferred.observation.subject,
      type: preferred.observation.type,
      slot: preferred.observation.slot,
      ...relations,
      isDistance: claims.some((value) => value.observation.isDistance === true),
      possibleChanges: claims.some(
        (value) => value.observation.possibleChanges === true,
      ),
      status: transfer ? "moved" : "scheduled",
      movedFrom: transfer
        ? { date: transfer.fromDate, slot: transfer.fromSlot }
        : undefined,
      sources: claims.map(sourceRef),
    };
  }
}

export class MemoryTimetableRepositoryAdapter
  implements TimetableRepositoryAdapter
{
  private snapshot: TimetableRepositorySnapshot | null = null;

  async load(): Promise<TimetableRepositorySnapshot | null> {
    return this.snapshot == null
      ? null
      : structuredClone(this.snapshot);
  }

  async compareAndSet(
    expectedRevision: number,
    snapshot: TimetableRepositorySnapshot,
  ): Promise<boolean> {
    const currentRevision = this.snapshot?.revision ?? 0;
    if (currentRevision !== expectedRevision) return false;
    this.snapshot = structuredClone(snapshot);
    return true;
  }

  async clear(): Promise<void> {
    this.snapshot = null;
  }
}
