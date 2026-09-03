import {
  entityKey,
  mergeEntityRefs,
  normalizeScheduleText,
} from "./normalize.js";
import type {
  GroupRef,
  NamedEntityRef,
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

function validateRefs<T extends NamedEntityRef>(values: T[], label: string): void {
  for (const value of values) {
    if (!value.name.trim()) throw new TypeError(`${label} name is empty`);
    if (value.id != null && (!Number.isInteger(value.id) || value.id < 1)) {
      throw new RangeError(`${label} ID must be a positive integer`);
    }
  }
}

interface EntityRecord<T extends NamedEntityRef> {
  value: T;
  ids: Set<number>;
  names: Set<string>;
  people: Set<string>;
}

class EntityIndex<T extends NamedEntityRef> {
  private readonly records = new Set<EntityRecord<T>>();
  private readonly byId = new Map<number, EntityRecord<T>>();
  private readonly byName = new Map<string, EntityRecord<T>>();
  private readonly byPerson = new Map<string, Set<EntityRecord<T>>>();

  constructor(
    values: T[],
    private readonly teacherIdentity = false,
  ) {
    for (const value of values) this.rememberOne(structuredClone(value));
  }

  remember(values: T[]): boolean {
    let changed = false;
    for (const value of values) {
      if (this.rememberOne(structuredClone(value))) changed = true;
    }
    return changed;
  }

  resolve(value: T): T {
    const exact = value.id == null
      ? this.byName.get(normalizeScheduleText(value.name))
      : this.byId.get(value.id);
    if (exact) return mergeEntityRefs([value, exact.value])[0];
    if (!this.teacherIdentity) return structuredClone(value);
    const candidates = this.byPerson.get(personKey(value.name)) ?? new Set();
    const identified = [...candidates].filter((candidate) => candidate.value.id != null);
    const ids = new Set(identified.map((candidate) => candidate.value.id));
    return ids.size === 1
      ? mergeEntityRefs([value, identified[0].value])[0]
      : structuredClone(value);
  }

  export(): T[] {
    return [...this.records]
      .map((record) => structuredClone(record.value))
      .sort((a, b) => entityKey(a).localeCompare(entityKey(b)));
  }

  private rememberOne(value: T): boolean {
    const name = normalizeScheduleText(value.name);
    const person = this.teacherIdentity ? personKey(value.name) : "";
    let record = value.id == null ? undefined : this.byId.get(value.id);
    record ??= this.byName.get(name);
    if (!record && this.teacherIdentity) {
      const identified = [...(this.byPerson.get(person) ?? [])]
        .filter((candidate) => candidate.value.id != null);
      const ids = new Set(identified.map((candidate) => candidate.value.id));
      if (ids.size === 1) record = identified[0];
    }

    if (!record) {
      record = { value, ids: new Set(), names: new Set(), people: new Set() };
      this.records.add(record);
      this.index(record, value);
      if (this.teacherIdentity && value.id != null) this.mergeTeacherAliases(record, person);
      return true;
    }

    const before = JSON.stringify(record.value);
    record.value = mergeEntityRefs([record.value, value])[0];
    this.index(record, value);
    this.index(record, record.value);
    if (this.teacherIdentity && record.value.id != null) this.mergeTeacherAliases(record, person);
    return before !== JSON.stringify(record.value);
  }

  private index(record: EntityRecord<T>, value: T): void {
    if (value.id != null) {
      record.ids.add(value.id);
      this.byId.set(value.id, record);
    }
    const name = normalizeScheduleText(value.name);
    if (name) {
      record.names.add(name);
      this.byName.set(name, record);
    }
    if (this.teacherIdentity) {
      const person = personKey(value.name);
      record.people.add(person);
      let records = this.byPerson.get(person);
      if (!records) {
        records = new Set();
        this.byPerson.set(person, records);
      }
      records.add(record);
    }
  }

  private mergeTeacherAliases(target: EntityRecord<T>, person: string): void {
    const aliases = [...(this.byPerson.get(person) ?? [])]
      .filter((candidate) => candidate !== target && candidate.value.id == null);
    for (const alias of aliases) this.mergeRecords(target, alias);
  }

  private mergeRecords(target: EntityRecord<T>, source: EntityRecord<T>): void {
    target.value = mergeEntityRefs([source.value, target.value])[0];
    for (const id of source.ids) {
      target.ids.add(id);
      this.byId.set(id, target);
    }
    for (const name of source.names) {
      target.names.add(name);
      this.byName.set(name, target);
    }
    for (const person of source.people) {
      target.people.add(person);
      const records = this.byPerson.get(person);
      records?.delete(source);
      records?.add(target);
    }
    this.records.delete(source);
  }
}

export class TimetableDirectory {
  private readonly groups: EntityIndex<GroupRef>;
  private readonly teachers: EntityIndex<TeacherRef>;
  private readonly rooms: EntityIndex<RoomRef>;

  constructor(snapshot?: TimetableDirectorySnapshot) {
    const initial = snapshot ?? { groups: [], teachers: [], rooms: [] };
    validateRefs(initial.groups, "Group");
    validateRefs(initial.teachers, "Teacher");
    validateRefs(initial.rooms, "Room");
    this.groups = new EntityIndex(initial.groups);
    this.teachers = new EntityIndex(initial.teachers, true);
    this.rooms = new EntityIndex(initial.rooms);
  }

  rememberGroups(values: GroupRef[]): boolean {
    validateRefs(values, "Group");
    return this.groups.remember(values);
  }

  rememberTeachers(values: TeacherRef[]): boolean {
    validateRefs(values, "Teacher");
    return this.teachers.remember(values);
  }

  rememberRooms(values: RoomRef[]): boolean {
    validateRefs(values, "Room");
    return this.rooms.remember(values);
  }

  resolveGroup(value: GroupRef): GroupRef {
    return this.groups.resolve(value);
  }

  resolveTeacher(value: TeacherRef): TeacherRef {
    return this.teachers.resolve(value);
  }

  resolveRoom(value: RoomRef): RoomRef {
    return this.rooms.resolve(value);
  }

  export(): TimetableDirectorySnapshot {
    return {
      groups: this.groups.export(),
      teachers: this.teachers.export(),
      rooms: this.rooms.export(),
    };
  }
}
