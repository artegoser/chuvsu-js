import type {
  FullScheduleDay,
  FullScheduleSlot,
  Lesson,
  LessonTime,
  ScheduleEntry,
} from "../types.js";
import { isSameDay } from "./date.js";

export function sortLessons(a: Lesson, b: Lesson) {
  return a.start.date.getTime() - b.start.date.getTime();
}

function filterEntries(
  entries: ScheduleEntry[],
  opts?: { subgroup?: number; week?: number; date?: Date },
): ScheduleEntry[] {
  return entries.filter((e) => {
    // Subgroup filter applies to all entry types
    if (opts?.subgroup && e.subgroup && e.subgroup !== opts.subgroup) {
      return false;
    }

    // Transfer entries: only include when the query date matches the target date
    if (e.transfer) {
      if (!opts?.date) return false;
      return isSameDay(e.transfer.targetDate, opts.date);
    }

    // Substitute-for entries: only include when the query date matches
    if (e.substituteFor) {
      if (!opts?.date) return false;
      return isSameDay(e.substituteFor.date, opts.date);
    }

    if (opts?.week != null) {
      if (
        e.weeks.from > 0 &&
        (opts.week < e.weeks.from || opts.week > e.weeks.to)
      ) {
        return false;
      }
      if (e.weekParity) {
        const isEven = opts.week % 2 === 0;
        if (e.weekParity === "even" && !isEven) return false;
        if (e.weekParity === "odd" && isEven) return false;
      }
    }
    return true;
  });
}

export function filterSlots(
  slots: FullScheduleSlot[],
  opts?: { subgroup?: number; week?: number; date?: Date },
): FullScheduleSlot[] {
  if (opts?.subgroup == null && opts?.week == null && opts?.date == null)
    return slots;

  return slots
    .map((slot) => ({
      ...slot,
      entries: filterEntries(slot.entries, opts),
    }))
    .filter((slot) => slot.entries.length > 0);
}

function makeLessonTime(
  date: Date,
  time: { hours: number; minutes: number },
): LessonTime {
  const d = new Date(date);
  d.setHours(time.hours, time.minutes, 0, 0);
  return { date: d, hours: time.hours, minutes: time.minutes };
}

export function slotsToLessons(
  slots: FullScheduleSlot[],
  date: Date,
  opts?: { isTeacherSchedule?: boolean },
): Lesson[] {
  const lessons: Lesson[] = [];
  for (const slot of slots) {
    for (const entry of slot.entries) {
      let room = entry.room;
      let teacher = entry.teacher;
      let originalRoom: string | undefined;
      let originalTeacher: typeof teacher | undefined;

      // Apply date-specific substitutions
      if (entry.substitutions) {
        const sub = entry.substitutions.find((s) => isSameDay(s.date, date));
        if (sub) {
          if (sub.room) {
            originalRoom = room;
            room = sub.room;
          }
          if (sub.teacher) {
            // On teacher schedules, a teacher substitution means another teacher
            // is taking over — exclude the lesson entirely.
            if (opts?.isTeacherSchedule) continue;
            originalTeacher = teacher;
            teacher = sub.teacher;
          }
        }
      }

      lessons.push({
        number: slot.number,
        start: makeLessonTime(date, slot.timeStart),
        end: makeLessonTime(date, slot.timeEnd),
        subject: entry.subject,
        type: entry.type,
        room,
        teacher,
        groups: entry.groups,
        weeks: entry.weeks,
        subgroup: entry.subgroup,
        weekParity: entry.weekParity,
        originalRoom,
        originalTeacher,
        transfer: entry.transfer,
        substituteFor: entry.substituteFor,
        possibleChanges: entry.possibleChanges,
      });
    }
  }
  return lessons;
}

/** All transfer entries from the given schedule days. */
export function collectTransfers(days: FullScheduleDay[]): ScheduleEntry[] {
  const transfers: ScheduleEntry[] = [];
  for (const day of days) {
    for (const slot of day.slots) {
      for (const entry of slot.entries) {
        if (entry.transfer) transfers.push(entry);
      }
    }
  }
  return transfers;
}

/** Remove lessons whose source date/slot match a transfer. */
export function suppressTransferredLessons(
  lessons: Lesson[],
  transfers: ScheduleEntry[],
  date: Date,
): Lesson[] {
  return lessons.filter((lesson) => {
    return !transfers.some(
      (t) =>
        t.transfer &&
        isSameDay(t.transfer.fromDate, date) &&
        t.transfer.fromSlot === lesson.number &&
        t.transfer.subject === lesson.subject,
    );
  });
}
