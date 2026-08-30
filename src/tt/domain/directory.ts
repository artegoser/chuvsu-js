import {
  mergeEntityRefs,
  normalizeScheduleText,
} from "./normalize.js";
import type {
  GroupRef,
  RoomRef,
  TeacherRef,
  TimetableDirectorySnapshot,
} from "./types.js";

function personKey(name: string): string {
  const words = normalizeScheduleText(name)
    .replace(/[.,]/gu, " ")
    .split(/\s+/gu)
    .filter(Boolean);
  const surname = words[0] ?? "";
  const initials = words
    .slice(1)
    .map((word) => word[0] ?? "")
    .join("");
  return `${surname}|${initials}`;
}

function exactKey(name: string): string {
  return normalizeScheduleText(name);
}

function mergeByIdAndName<T extends { id?: number; name: string }>(
  current: T[],
  incoming: T[],
): { values: T[]; changed: boolean } {
  const values = mergeEntityRefs([...current, ...incoming]);
  const before = JSON.stringify(current);
  const after = JSON.stringify(values);
  return { values, changed: before !== after };
}

function resolveUnique<T extends { id?: number; name: string }>(
  value: T,
  known: T[],
  key: (name: string) => string,
): T {
  if (value.id != null) {
    const byId = known.find((candidate) => candidate.id === value.id);
    return byId ? mergeEntityRefs([value, byId])[0] : value;
  }
  const lookup = key(value.name);
  const candidates = known.filter(
    (candidate) => candidate.id != null && key(candidate.name) === lookup,
  );
  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (ids.size !== 1) return value;
  return mergeEntityRefs([value, candidates[0]])[0];
}

export class TimetableDirectory {
  private groups: GroupRef[] = [];
  private teachers: TeacherRef[] = [];
  private rooms: RoomRef[] = [];

  constructor(snapshot?: TimetableDirectorySnapshot) {
    if (snapshot) {
      this.groups = structuredClone(snapshot.groups);
      this.teachers = structuredClone(snapshot.teachers);
      this.rooms = structuredClone(snapshot.rooms);
    }
  }

  rememberGroups(values: GroupRef[]): boolean {
    const result = mergeByIdAndName(this.groups, values);
    this.groups = result.values;
    return result.changed;
  }

  rememberTeachers(values: TeacherRef[]): boolean {
    const result = mergeByIdAndName(this.teachers, values);
    this.teachers = result.values;
    return result.changed;
  }

  rememberRooms(values: RoomRef[]): boolean {
    const result = mergeByIdAndName(this.rooms, values);
    this.rooms = result.values;
    return result.changed;
  }

  resolveGroup(value: GroupRef): GroupRef {
    return resolveUnique(value, this.groups, exactKey);
  }

  resolveTeacher(value: TeacherRef): TeacherRef {
    return resolveUnique(value, this.teachers, personKey);
  }

  resolveRoom(value: RoomRef): RoomRef {
    return resolveUnique(value, this.rooms, exactKey);
  }

  export(): TimetableDirectorySnapshot {
    return {
      groups: structuredClone(this.groups),
      teachers: structuredClone(this.teachers),
      rooms: structuredClone(this.rooms),
    };
  }
}
