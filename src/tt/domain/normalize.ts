import type {
  GroupAttendance,
  GroupRef,
  NamedEntityRef,
  RoomRef,
  TeacherRef,
} from "./types.js";

export function normalizeScheduleText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

export function entityKey(value: NamedEntityRef): string {
  return value.id != null
    ? `id:${value.id}`
    : `name:${normalizeScheduleText(value.name)}`;
}

function mergeNamed<T extends NamedEntityRef>(current: T, next: T): T {
  const merged = { ...current, ...next };
  if (!next.name && current.name) merged.name = current.name;
  return merged;
}

export function mergeEntityRefs<T extends NamedEntityRef>(values: T[]): T[] {
  const byId = new Map<number, T>();
  const byName = new Map<string, T>();

  for (const value of values) {
    const nameKey = normalizeScheduleText(value.name);
    const idMatch = value.id == null ? undefined : byId.get(value.id);
    const nameMatch = nameKey ? byName.get(nameKey) : undefined;
    const existing = idMatch ?? nameMatch;
    const merged = existing ? mergeNamed(existing, value) : { ...value };

    if (merged.id != null) byId.set(merged.id, merged);
    if (nameKey) byName.set(nameKey, merged);
    if (existing && existing !== merged) {
      if (existing.id != null) byId.set(existing.id, merged);
      const oldName = normalizeScheduleText(existing.name);
      if (oldName) byName.set(oldName, merged);
    }
  }

  return [...new Set([...byId.values(), ...byName.values()])].sort((a, b) =>
    entityKey(a).localeCompare(entityKey(b)),
  );
}

export function mergeGroups(values: GroupAttendance[]): GroupAttendance[] {
  const merged = new Map<string, GroupAttendance>();
  for (const value of values) {
    const key = `${entityKey(value.group)}:${value.subgroup ?? 0}`;
    const current = merged.get(key);
    merged.set(key, {
      group: current
        ? mergeEntityRefs<GroupRef>([current.group, value.group])[0]
        : { ...value.group },
      subgroup: value.subgroup,
    });
  }
  return [...merged.values()].sort((a, b) => {
    const group = entityKey(a.group).localeCompare(entityKey(b.group));
    return group || (a.subgroup ?? 0) - (b.subgroup ?? 0);
  });
}

export function mergeTeachers(values: TeacherRef[]): TeacherRef[] {
  return mergeEntityRefs(values);
}

export function mergeRooms(values: RoomRef[]): RoomRef[] {
  return mergeEntityRefs(values);
}
