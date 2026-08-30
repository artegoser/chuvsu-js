import type { Teacher } from "../common/types.js";
import type {
  ParsedScheduleDay,
  ParsedScheduleEntry,
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

function groupsFor(
  entry: ParsedScheduleEntry,
  owner: ScheduleOwner,
): GroupAttendance[] | undefined {
  const groups = entry.groups.map((name) => ({
    group: { name },
    subgroup: entry.subgroup,
  }));
  if (owner.type === "group") {
    groups.unshift({ group: owner.group, subgroup: entry.subgroup });
  }
  return groups.length === 0 ? undefined : groups;
}

function teachersFor(entry: ParsedScheduleEntry): TeacherRef[] | undefined {
  const teacher = teacherRef(entry.teacher);
  return teacher ? [teacher] : undefined;
}

function roomsFor(entry: ParsedScheduleEntry): RoomRef[] | undefined {
  return entry.room ? [{ name: entry.room }] : undefined;
}

function substitutionsFor(
  substitutions: Substitution[] | undefined,
): LessonSubstitution[] | undefined {
  if (!substitutions?.length) return undefined;
  return substitutions.map((value) => ({
    date: new Date(value.date),
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
  entry: ParsedScheduleEntry,
  slot: ParsedScheduleDay["slots"][number],
  owner: ScheduleOwner,
) {
  return {
    key,
    subject: entry.subject,
    type: entry.type,
    slot: {
      number: slot.number,
      start: slot.timeStart,
      end: slot.timeEnd,
    },
    groups: groupsFor(entry, owner),
    teachers: teachersFor(entry),
    rooms: roomsFor(entry),
    isDistance: entry.isDistance,
    possibleChanges: entry.possibleChanges,
    substitutions: substitutionsFor(entry.substitutions),
  };
}

function occurrenceFrom(
  key: string,
  entry: ParsedScheduleEntry,
  slot: ParsedScheduleDay["slots"][number],
  date: Date,
  owner: ScheduleOwner,
): OccurrenceObservation {
  return {
    kind: "occurrence",
    ...observationBase(key, entry, slot, owner),
    date: new Date(date),
    transfer: entry.transfer
      ? {
          fromDate: new Date(entry.transfer.fromDate),
          fromSlot: entry.transfer.fromSlot,
          targetDate: new Date(entry.transfer.targetDate),
        }
      : undefined,
  };
}

function seriesFrom(
  key: string,
  entry: ParsedScheduleEntry,
  slot: ParsedScheduleDay["slots"][number],
  weekday: number,
  owner: ScheduleOwner,
): SeriesObservation {
  return {
    kind: "series",
    ...observationBase(key, entry, slot, owner),
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
      day.date?.getDay() ?? WEEKDAY_INDEX.get(day.weekday.toLowerCase());
    if (weekday == null) continue;

    for (const [slotIndex, slot] of day.slots.entries()) {
      for (const [entryIndex, entry] of slot.entries.entries()) {
        const key = `day:${dayIndex}:slot:${slotIndex}:entry:${entryIndex}`;
        const directDate =
          entry.transfer?.targetDate ?? entry.substituteFor?.date ?? day.date;
        observations.push(
          directDate
            ? occurrenceFrom(key, entry, slot, directDate, options.owner)
            : seriesFrom(key, entry, slot, weekday, options.owner),
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
