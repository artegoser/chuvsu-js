import type { AcademicPeriod } from "../../common/types.js";
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
  LessonSubstitution,
  LessonSourceRef,
  OccurrenceObservation,
  RelationCompleteness,
  RelationSet,
  RoomRef,
  ScheduleObservation,
  ScheduleOwner,
  ScheduleSourceSnapshot,
  SerializedScheduleObservation,
  SerializedScheduleSourceSnapshot,
  SeriesObservation,
  TeacherRef,
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

function sameDate(a: string, b: string): boolean {
  return a === b;
}

function rangesOverlap(
  a: { from: number; to: number } | undefined,
  b: { from: number; to: number } | undefined,
): boolean {
  const aFrom = a?.from ?? 1;
  const aTo = a?.to ?? 17;
  const bFrom = b?.from ?? 1;
  const bTo = b?.to ?? 17;
  return Math.max(aFrom, bFrom) <= Math.min(aTo, bTo);
}

function recurrenceWeeks(observation: SeriesObservation): string {
  const from = observation.recurrence.weeks?.from ?? 1;
  const to = observation.recurrence.weeks?.to ?? 17;
  const weeks: number[] = [];
  for (let week = from; week <= to; week++) {
    if (observation.recurrence.parity === "even" && week % 2 !== 0) continue;
    if (observation.recurrence.parity === "odd" && week % 2 === 0) continue;
    weeks.push(week);
  }
  return weeks.join(",");
}

function sameTimeRange(
  left: NonNullable<ScheduleObservation["time"]>,
  right: NonNullable<ScheduleObservation["time"]>,
): boolean {
  return left.start.hours === right.start.hours &&
    left.start.minutes === right.start.minutes &&
    left.end.hours === right.end.hours &&
    left.end.minutes === right.end.minutes;
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

  if (left.kind === "series" && right.kind === "series") {
    if (left.recurrence.weekday !== right.recurrence.weekday) {
      return Number.NEGATIVE_INFINITY;
    }
    if (
      !rangesOverlap(left.recurrence.weeks, right.recurrence.weeks) ||
      recurrenceWeeks(left) !== recurrenceWeeks(right)
    ) {
      return Number.NEGATIVE_INFINITY;
    }
    if (
      left.recurrence.parity != null &&
      right.recurrence.parity != null &&
      left.recurrence.parity !== right.recurrence.parity
    ) {
      return Number.NEGATIVE_INFINITY;
    }
  }
  if (
    left.kind === "occurrence" &&
    right.kind === "occurrence" &&
    !sameDate(left.date, right.date)
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 35;
  if (normalizeScheduleText(left.type) === normalizeScheduleText(right.type)) {
    score += 10;
  } else if (left.type && right.type) {
    score -= 12;
  }

  if (
    left.slotNumber != null &&
    right.slotNumber != null &&
    left.slotNumber === right.slotNumber
  ) score += 12;
  if (
    left.time &&
    right.time &&
    sameTimeRange(left.time, right.time)
  ) {
    score += 12;
  }

  if (left.kind === "series" && right.kind === "series") {
    score += 24;
    if (left.recurrence.parity === right.recurrence.parity) score += 5;
  }

  if (left.kind === "occurrence" && right.kind === "occurrence") {
    score += 34;
    if (
      left.transfer &&
      right.transfer &&
      sameDate(left.transfer.fromDate, right.transfer.fromDate) &&
      left.transfer.fromSlot === right.transfer.fromSlot
    ) {
      score += 30;
    }
  }

  score += relationScore(valuesOverlap(left.rooms.values, right.rooms.values));
  score += relationScore(valuesOverlap(left.teachers.values, right.teachers.values));
  score += relationScore(groupsOverlap(left.groups.values, right.groups.values));
  if (sameSource) score += 8;
  return score;
}

function serializeObservation(
  observation: ScheduleObservation,
): SerializedScheduleObservation {
  return structuredClone(observation);
}

function deserializeObservation(
  observation: SerializedScheduleObservation,
): ScheduleObservation {
  return structuredClone(observation);
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
      claim.observation.groups.values.length +
      claim.observation.teachers.values.length +
      claim.observation.rooms.values.length;
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

function aggregateCompleteness<T>(sets: RelationSet<T>[]): RelationCompleteness {
  if (sets.some((value) => value.completeness === "partial" || value.values.length > 0)) {
    return "partial";
  }
  if (sets.some((value) => value.completeness === "complete")) return "complete";
  return "unknown";
}

function aggregateRelations(claims: ObservationClaim[]): {
  groups: RelationSet<GroupAttendance>;
  teachers: RelationSet<TeacherRef>;
  rooms: RelationSet<RoomRef>;
} {
  const groups: GroupAttendance[] = [];
  const teachers = [];
  const rooms = [];

  for (const claim of claims) {
    groups.push(...claim.observation.groups.values);
    teachers.push(...claim.observation.teachers.values);
    rooms.push(...claim.observation.rooms.values);
    const implicit = ownerEntity(claim.source.owner);
    if (
      implicit.kind === "group" &&
      !claim.observation.groups.values.some(
        (value) =>
          entityKey(value.group) === entityKey(implicit.value.group),
      )
    ) {
      groups.push(implicit.value);
    }
    if (implicit.kind === "teacher") teachers.push(implicit.value.teacher);
    if (implicit.kind === "room") rooms.push(implicit.value.room);
  }

  return {
    groups: {
      values: mergeGroups(groups),
      completeness: aggregateCompleteness(claims.map((value) => value.observation.groups)),
    },
    teachers: {
      values: mergeTeachers(teachers),
      completeness: aggregateCompleteness(claims.map((value) => value.observation.teachers)),
    },
    rooms: {
      values: mergeRooms(rooms),
      completeness: aggregateCompleteness(claims.map((value) => value.observation.rooms)),
    },
  };
}

function ownerMatches(
  owner: ScheduleOwner,
  relations: ReturnType<typeof aggregateRelations>,
): boolean {
  if (owner.type === "group") {
    const key = entityKey(owner.group);
    return relations.groups.values.some((value) => entityKey(value.group) === key);
  }
  if (owner.type === "teacher") {
    const key = entityKey(owner.teacher);
    return relations.teachers.values.some((value) => entityKey(value) === key);
  }
  const key = entityKey(owner.room);
  return relations.rooms.values.some((value) => entityKey(value) === key);
}

export class TimetableRepository {
  private readonly idGenerator: LessonIdGenerator;
  private _directory: TimetableDirectory;
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
    this._directory = new TimetableDirectory();
    if (opts?.snapshot) this.restore(opts.snapshot);
  }

  get directory(): TimetableDirectory {
    return this._directory;
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
    const incoming = structuredClone(snapshot);
    this.validateSource(incoming);
    const prior = this.sources.get(incoming.sourceKey);
    const priorClaims = new Map<string, ObservationClaim>();
    if (prior) {
      for (const observation of prior.observations) {
        priorClaims.set(observation.key, { source: prior, observation });
        this.removeClaim(incoming.sourceKey, observation.key);
      }
    }

    this.sources.set(incoming.sourceKey, incoming);
    const usedTargets = new Set<string>();
    const seriesIds: LessonSeriesId[] = [];
    const lessonIds: LessonId[] = [];
    let created = 0;
    let updated = 0;

    const currentKeys = new Set(incoming.observations.map((value) => value.key));
    for (const observation of incoming.observations) {
      const linkKey = sourceObservationKey(incoming.sourceKey, observation.key);
      const exact = this.links.get(linkKey);
      const exactPrior = priorClaims.get(observation.key);
      let target =
        exact?.kind === observation.kind &&
        exactPrior?.observation.kind === observation.kind &&
        observationScore(observation, exactPrior.observation, true) >= 55 &&
        !usedTargets.has(exact.id)
          ? exact
          : undefined;

      if (!target) {
        target = this.findPriorTarget(observation, priorClaims, usedTargets);
      }
      if (!target) {
        target = this.findCanonicalTarget(
          observation,
          incoming,
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
      this.addClaim(target, incoming, observation);
      if (target.kind === "series") seriesIds.push(target.id);
      else lessonIds.push(target.id);
    }

    if (prior) {
      for (const observation of prior.observations) {
        if (!currentKeys.has(observation.key)) {
          this.links.delete(sourceObservationKey(incoming.sourceKey, observation.key));
        }
      }
    }
    this.pruneEmptyRecords();

    this._revision++;
    return {
      revision: this._revision,
      seriesIds,
      lessonIds,
      created,
      updated,
      removedObservations: Math.max(
        0,
        prior?.observations.filter((value) => !currentKeys.has(value.key)).length ?? 0,
      ),
    };
  }

  getSeries(opts?: {
    owner?: ScheduleOwner;
    academicYearStartYear?: number;
    periods?: readonly AcademicPeriod[];
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
      (a.slotNumber ?? Number.MAX_SAFE_INTEGER) -
        (b.slotNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.subject.localeCompare(b.subject) ||
      a.id.localeCompare(b.id),
    );
  }

  getDirectOccurrences(opts?: {
    owner?: ScheduleOwner;
    academicYearStartYear?: number;
    periods?: readonly AcademicPeriod[];
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
      (a, b) =>
        a.scheduledDate.localeCompare(b.scheduledDate) ||
        ((a.time?.start.hours ?? 24) * 60 + (a.time?.start.minutes ?? 0)) -
          ((b.time?.start.hours ?? 24) * 60 + (b.time?.start.minutes ?? 0)) ||
        a.id.localeCompare(b.id),
    );
  }

  export(): TimetableRepositorySnapshot {
    return {
      schemaVersion: 5,
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

  replaceSnapshot(snapshot: TimetableRepositorySnapshot): void {
    this.restore(snapshot);
  }

  private restore(snapshot: TimetableRepositorySnapshot): void {
    if (snapshot.schemaVersion !== 5) {
      throw new Error(
        `Unsupported timetable repository schema: ${snapshot.schemaVersion}`,
      );
    }
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new Error("Invalid timetable repository revision");
    }
    const sources = snapshot.sources.map(deserializeSource);
    const sourceKeys = new Set<string>();
    for (const source of sources) {
      this.validateSource(source);
      if (sourceKeys.has(source.sourceKey)) {
        throw new Error(`Duplicate timetable source: ${source.sourceKey}`);
      }
      sourceKeys.add(source.sourceKey);
    }

    this.sources.clear();
    this.links.clear();
    this.seriesRecords.clear();
    this.occurrenceRecords.clear();
    this._directory = new TimetableDirectory(snapshot.directory);
    this._revision = snapshot.revision;
    for (const source of sources) {
      this.sources.set(source.sourceKey, source);
    }
    const linkedObservations = new Set<string>();
    for (const link of snapshot.links) {
      const key = sourceObservationKey(link.sourceKey, link.observationKey);
      if (!link.id || linkedObservations.has(key)) {
        throw new Error(`Invalid or duplicate timetable link: ${link.sourceKey}/${link.observationKey}`);
      }
      const source = this.sources.get(link.sourceKey);
      const observation = source?.observations.find(
        (value) => value.key === link.observationKey,
      );
      if (!observation || observation.kind !== link.kind) {
        throw new Error(`Dangling timetable link: ${link.sourceKey}/${link.observationKey}`);
      }
      linkedObservations.add(key);
      this.links.set(
        key,
        { kind: link.kind, id: link.id },
      );
    }
    for (const source of this.sources.values()) {
      for (const observation of source.observations) {
        const link = this.links.get(
          sourceObservationKey(source.sourceKey, observation.key),
        );
        if (!link) {
          throw new Error(`Missing timetable link: ${source.sourceKey}/${observation.key}`);
        }
        this.addClaim(link, source, observation);
      }
    }
  }

  private validateSource(source: ScheduleSourceSnapshot): void {
    if (!source.sourceKey.trim()) throw new Error("Timetable source key is empty");
    if (!Number.isInteger(source.academicYearStartYear)) {
      throw new Error(`Invalid academic year for source ${source.sourceKey}`);
    }
    if (!(source.observedAt instanceof Date) || !Number.isFinite(source.observedAt.getTime())) {
      throw new Error(`Invalid observation time for source ${source.sourceKey}`);
    }
    const keys = new Set<string>();
    for (const observation of source.observations) {
      if (!observation.key.trim() || keys.has(observation.key)) {
        throw new Error(`Invalid or duplicate observation key in ${source.sourceKey}`);
      }
      if (!observation.subject.trim()) {
        throw new Error(`Empty lesson subject in ${source.sourceKey}/${observation.key}`);
      }
      keys.add(observation.key);
    }
  }

  private pruneEmptyRecords(): void {
    for (const [id, record] of this.seriesRecords) {
      if (record.claims.size === 0) this.seriesRecords.delete(id);
    }
    for (const [id, record] of this.occurrenceRecords) {
      if (record.claims.size === 0) this.occurrenceRecords.delete(id);
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

    if (!best || best.score < 95 || best.score - second < 10) return undefined;
    return { kind: observation.kind, id: best.id };
  }

  private aggregateSubstitutions(
    claims: ObservationClaim[],
  ): LessonSubstitution[] {
    const byDate = new Map<string, LessonSubstitution>();
    for (const substitution of claims.flatMap(
      (value) => value.observation.substitutions ?? [],
    )) {
      const current = byDate.get(substitution.date);
      const rooms = mergeRooms(
        [...(current?.rooms ?? []), ...(substitution.rooms ?? [])].map((value) =>
          this.directory.resolveRoom(value)
        ),
      );
      const teachers = mergeTeachers(
        [...(current?.teachers ?? []), ...(substitution.teachers ?? [])].map((value) =>
          this.directory.resolveTeacher(value)
        ),
      );
      byDate.set(substitution.date, {
        date: substitution.date,
        rooms: rooms.length > 0 ? rooms : undefined,
        teachers: teachers.length > 0 ? teachers : undefined,
        isDistance:
          current?.isDistance === true || substitution.isDistance === true
            ? true
            : current?.isDistance ?? substitution.isDistance,
      });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private aggregateSeries(
    record: CanonicalRecord<SeriesObservation>,
  ): LessonSeries {
    const claims = deterministicClaims(record);
    const preferred = preferredClaim(claims);
    const rawRelations = aggregateRelations(claims);
    const relations = {
      groups: {
        values: mergeGroups(
          rawRelations.groups.values.map((value) => ({
            ...value,
            group: this.directory.resolveGroup(value.group),
          })),
        ),
        completeness: rawRelations.groups.completeness,
      },
      teachers: {
        values: mergeTeachers(
          rawRelations.teachers.values.map((value) =>
            this.directory.resolveTeacher(value),
          ),
        ),
        completeness: rawRelations.teachers.completeness,
      },
      rooms: {
        values: mergeRooms(
          rawRelations.rooms.values.map((value) =>
            this.directory.resolveRoom(value),
          ),
        ),
        completeness: rawRelations.rooms.completeness,
      },
    };
    return {
      id: record.id,
      academicYearStartYear: preferred.source.academicYearStartYear,
      period: preferred.source.period,
      subject: preferred.observation.subject,
      type: preferred.observation.type,
      slotNumber: preferred.observation.slotNumber,
      time: preferred.observation.time,
      recurrence: preferred.observation.recurrence,
      ...relations,
      isDistance: claims.some((value) => value.observation.isDistance === true),
      possibleChanges: claims.some(
        (value) => value.observation.possibleChanges === true,
      ),
      substitutions: this.aggregateSubstitutions(claims),
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
      groups: {
        values: mergeGroups(
          rawRelations.groups.values.map((value) => ({
            ...value,
            group: this.directory.resolveGroup(value.group),
          })),
        ),
        completeness: rawRelations.groups.completeness,
      },
      teachers: {
        values: mergeTeachers(
          rawRelations.teachers.values.map((value) =>
            this.directory.resolveTeacher(value),
          ),
        ),
        completeness: rawRelations.teachers.completeness,
      },
      rooms: {
        values: mergeRooms(
          rawRelations.rooms.values.map((value) =>
            this.directory.resolveRoom(value),
          ),
        ),
        completeness: rawRelations.rooms.completeness,
      },
    };
    const transfer = claims
      .map((value) => value.observation.transfer)
      .find((value) => value != null);
    return {
      id: record.id,
      academicYearStartYear: preferred.source.academicYearStartYear,
      period: preferred.source.period,
      nominalDate: transfer?.fromDate ?? preferred.observation.date,
      scheduledDate: transfer?.targetDate ?? preferred.observation.date,
      subject: preferred.observation.subject,
      type: preferred.observation.type,
      slotNumber: preferred.observation.slotNumber,
      time: preferred.observation.time,
      ...relations,
      isDistance: claims.some((value) => value.observation.isDistance === true),
      possibleChanges: claims.some(
        (value) => value.observation.possibleChanges === true,
      ),
      status: transfer ? "moved" : "scheduled",
      movedFrom: transfer
        ? { date: transfer.fromDate, slotNumber: transfer.fromSlot }
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
