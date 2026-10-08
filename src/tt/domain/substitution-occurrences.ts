import { entityKey, mergeGroups, normalizeScheduleText } from "./normalize.js";
import type {
  GroupAttendance,
  LessonOccurrence,
  NamedEntityRef,
} from "./types.js";

function sameEntity(left: NamedEntityRef, right: NamedEntityRef): boolean {
  return left.id != null && right.id != null
    ? entityKey(left) === entityKey(right)
    : normalizeScheduleText(left.name) === normalizeScheduleText(right.name);
}

function compatibleSets<T>(
  left: T[],
  right: T[],
  equal: (left: T, right: T) => boolean,
): boolean {
  if (!left.length || !right.length) return false;
  return (
    left.every((value) => right.some((other) => equal(value, other))) ||
    right.every((value) => left.some((other) => equal(value, other)))
  );
}

function sameEntities(
  left: NamedEntityRef[],
  right: NamedEntityRef[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.some((other) => sameEntity(value, other)))
  );
}

function sameAttendance(
  left: GroupAttendance,
  right: GroupAttendance,
): boolean {
  return (
    sameEntity(left.group, right.group) && left.subgroup === right.subgroup
  );
}

function sameSlot(left: LessonOccurrence, right: LessonOccurrence): boolean {
  if (
    left.slotNumber != null &&
    right.slotNumber != null &&
    left.slotNumber !== right.slotNumber
  ) {
    return false;
  }
  if (left.time && right.time) {
    return (
      left.time.start.hours === right.time.start.hours &&
      left.time.start.minutes === right.time.start.minutes &&
      left.time.end.hours === right.time.end.hours &&
      left.time.end.minutes === right.time.end.minutes
    );
  }
  return left.slotNumber != null && left.slotNumber === right.slotNumber;
}

function sameReplacement(
  left: LessonOccurrence,
  right: LessonOccurrence,
): boolean {
  return (
    left.scheduledDate === right.scheduledDate &&
    left.period === right.period &&
    left.academicYearStartYear === right.academicYearStartYear &&
    normalizeScheduleText(left.subject) ===
      normalizeScheduleText(right.subject) &&
    left.type === right.type &&
    left.retakeAttempt === right.retakeAttempt &&
    left.isDistance === right.isDistance &&
    sameSlot(left, right) &&
    compatibleSets(left.groups.values, right.groups.values, sameAttendance) &&
    left.teachers.values.length > 0 &&
    sameEntities(left.teachers.values, right.teachers.values) &&
    ((left.isDistance &&
      !left.rooms.values.length &&
      !right.rooms.values.length) ||
      (left.rooms.values.length > 0 &&
        sameEntities(left.rooms.values, right.rooms.values)))
  );
}

/** Keep the recurring ID and substitution history when a dated projection repeats it. */
export function coalesceSubstitutionOccurrences(
  occurrences: LessonOccurrence[],
  substitutedSeriesIds: ReadonlySet<string>,
): LessonOccurrence[] {
  const recurring = occurrences.filter(
    (value) =>
      value.seriesId != null && substitutedSeriesIds.has(value.seriesId),
  );
  return occurrences.filter((value) => {
    if (value.seriesId || value.movedFrom || value.status !== "scheduled")
      return true;
    const matches = recurring.filter((candidate) =>
      sameReplacement(candidate, value),
    );
    // Multiple candidates or incomplete evidence must not hide a real lesson.
    if (matches.length !== 1) return true;
    const target = matches[0];
    target.groups.values = mergeGroups([
      ...target.groups.values,
      ...value.groups.values,
    ]);
    for (const source of value.sources) {
      if (
        !target.sources.some(
          (existing) =>
            existing.sourceKey === source.sourceKey &&
            existing.observationKey === source.observationKey,
        )
      )
        target.sources.push(source);
    }
    return false;
  });
}
