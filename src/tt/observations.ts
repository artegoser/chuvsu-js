import type { Teacher } from "../common/types.js";
import { parseLocalDate } from "./utils/index.js";
import type {
  ParsedScheduleDay,
  ParsedLesson,
  Substitution,
} from "./types.js";
import type {
  GroupAttendance,
  LessonSubstitution,
  OccurrenceObservation,
  RoomRef,
  ScheduleObservation,
  ScheduleOwner,
  ScheduleSourceSnapshot,
  SeriesObservation,
  TeacherRef,
  RelationSet,
} from "./domain/types.js";

const WEEKDAY_INDEX = new Map<string, number>([
  ["воскресенье", 0],
  ["понедельник", 1],
  ["вторник", 2],
  ["среда", 3],
  ["четверг", 4],
  ["пятница", 5],
  ["суббота", 6],
]);

export interface CreateScheduleSnapshotOptions {
  sourceKey: string;
  owner: ScheduleOwner;
  academicYearStartYear: number;
  period: ScheduleSourceSnapshot["period"];
  observedAt?: Date;
  days: ParsedScheduleDay[];
}

function teacherRef(value: Teacher): TeacherRef | null {
  if (!value.name) return null;
  return { ...value };
}

function relationSet<T>(
  values: T[] | undefined,
  explicitlyEmpty = false,
): RelationSet<T> {
  return {
    values: values ?? [],
    completeness: explicitlyEmpty ? "complete" : values?.length ? "partial" : "unknown",
  };
}

function groupsFor(
  entry: ParsedLesson,
  owner: ScheduleOwner,
): RelationSet<GroupAttendance> {
  const visible = entry.groups?.map((name) => ({
    group: { name },
    subgroup: entry.subgroup,
  })) ?? [];
  const groups = relationSet(
    visible,
    entry.groups === null || Array.isArray(entry.groups) && entry.groups.length === 0,
  );
  if (owner.type === "group") {
    groups.values.unshift({ group: owner.group, subgroup: entry.subgroup });
    if (groups.completeness === "unknown") groups.completeness = "partial";
  }
  return groups;
}

function teachersFor(
  entry: ParsedLesson,
  owner: ScheduleOwner,
): RelationSet<TeacherRef> {
  const teacher = entry.teacher ? teacherRef(entry.teacher) : null;
  const teachers = relationSet(
    teacher ? [teacher] : undefined,
    entry.teacher === null,
  );
  if (owner.type === "teacher") {
    teachers.values.unshift(owner.teacher);
    if (teachers.completeness === "unknown") teachers.completeness = "partial";
  }
  return teachers;
}

function roomsFor(
  entry: ParsedLesson,
  owner: ScheduleOwner,
): RelationSet<RoomRef> {
  const rooms = relationSet(
    entry.room ? [{ name: entry.room }] : undefined,
    entry.room === null,
  );
  if (owner.type === "room") {
    rooms.values.unshift(owner.room);
    if (rooms.completeness === "unknown") rooms.completeness = "partial";
  }
  return rooms;
}

function substitutionsFor(
  substitutions: Substitution[] | undefined,
): LessonSubstitution[] | undefined {
  if (!substitutions?.length) return undefined;
  return substitutions.map((value) => ({
    date: value.date,
    rooms: value.room ? [{ name: value.room }] : undefined,
    teachers: value.teacher
      ? [teacherRef(value.teacher)].filter(
          (teacher): teacher is TeacherRef => teacher != null,
        )
      : undefined,
    isDistance: value.isDistance,
  }));
}

function observationBase(
  key: string,
  entry: ParsedLesson,
  block: ParsedScheduleDay["blocks"][number],
  owner: ScheduleOwner,
) {
  return {
    key,
    subject: entry.subject,
    type: entry.type,
    slotNumber: block.slotNumber,
    time: block.time,
    groups: groupsFor(entry, owner),
    teachers: teachersFor(entry, owner),
    rooms: roomsFor(entry, owner),
    isDistance: entry.isDistance,
    possibleChanges: entry.possibleChanges,
    substitutions: substitutionsFor(entry.substitutions),
  };
}

function occurrenceFrom(
  key: string,
  entry: ParsedLesson,
  block: ParsedScheduleDay["blocks"][number],
  date: OccurrenceObservation["date"],
  owner: ScheduleOwner,
): OccurrenceObservation {
  return {
    kind: "occurrence",
    ...observationBase(key, entry, block, owner),
    date,
    transfer: entry.transfer
      ? {
          fromDate: entry.transfer.fromDate,
          fromSlot: entry.transfer.fromSlot,
          targetDate: entry.transfer.targetDate,
        }
      : undefined,
  };
}

function seriesFrom(
  key: string,
  entry: ParsedLesson,
  block: ParsedScheduleDay["blocks"][number],
  weekday: number,
  owner: ScheduleOwner,
): SeriesObservation {
  return {
    kind: "series",
    ...observationBase(key, entry, block, owner),
    recurrence: {
      weekday,
      weeks: entry.weeks,
      parity: entry.weekParity,
    },
  };
}

export function createScheduleSourceSnapshot(
  options: CreateScheduleSnapshotOptions,
): ScheduleSourceSnapshot {
  const observations: ScheduleObservation[] = [];

  for (const [dayIndex, day] of options.days.entries()) {
    const weekday =
      (day.date ? parseLocalDate(day.date).getDay() : undefined) ??
      WEEKDAY_INDEX.get(day.weekday.toLowerCase());
    if (weekday == null) continue;

    for (const [blockIndex, block] of day.blocks.entries()) {
      for (const [lessonIndex, entry] of block.lessons.entries()) {
        const key = `day:${dayIndex}:block:${blockIndex}:lesson:${lessonIndex}`;
        const directDate =
          entry.transfer?.targetDate ?? entry.substituteFor?.date ?? day.date;
        observations.push(
          directDate
            ? occurrenceFrom(key, entry, block, directDate, options.owner)
            : seriesFrom(key, entry, block, weekday, options.owner),
        );
      }
    }
  }

  return {
    sourceKey: options.sourceKey,
    owner: options.owner,
    academicYearStartYear: options.academicYearStartYear,
    period: options.period,
    observedAt: options.observedAt ?? new Date(),
    observations,
  };
}
