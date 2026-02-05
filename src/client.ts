import { LkClient } from "./lk.js";
import { TtClient } from "./tt.js";
import type {
  PersonalData,
  Faculty,
  Group,
  FullScheduleDay,
  FullScheduleSlot,
  ScheduleEntry,
  CurrentLesson,
  Time,
} from "./types.js";
import { Period, EducationType } from "./types.js";

const WEEKDAY_NAMES = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

export interface ChuvsuClientOptions {
  email: string;
  password: string;
  groupId?: number;
  educationType?: EducationType;
}

export interface ScheduleFilter {
  subgroup?: number;
  week?: number;
}

export class ChuvsuClient {
  private lk: LkClient;
  private tt: TtClient;
  private cache = {
    groupId: null as number | null,
    personalData: null as PersonalData | null,
    currentPeriod: undefined as Period | null | undefined,
    faculties: null as Faculty[] | null,
    schedule: new Map<number, FullScheduleDay[]>(),
    groups: new Map<number, Group[]>(),
  };

  constructor(private opts: ChuvsuClientOptions) {
    this.lk = new LkClient(opts.email, opts.password);
    this.tt = new TtClient(
      opts.email,
      opts.password,
      opts.educationType ?? EducationType.HigherEducation,
    );
    if (opts.groupId) this.cache.groupId = opts.groupId;
  }

  clearCache(): void {
    this.cache.groupId = this.opts.groupId ?? null;
    this.cache.personalData = null;
    this.cache.currentPeriod = undefined;
    this.cache.faculties = null;
    this.cache.schedule.clear();
    this.cache.groups.clear();
  }

  async login(): Promise<void> {
    const [lkOk, ttOk] = await Promise.all([
      this.lk.login(),
      this.tt.login(),
    ]);
    if (!lkOk) throw new Error("LK login failed");
    if (!ttOk) throw new Error("TT login failed");
  }

  async getPersonalData(): Promise<PersonalData> {
    if (this.cache.personalData) return this.cache.personalData;
    const data = await this.lk.getPersonalData();
    this.cache.personalData = data;
    return data;
  }

  async getGroupId(): Promise<number> {
    if (this.cache.groupId) return this.cache.groupId;
    const id = await this.lk.getGroupId();
    if (!id) throw new Error("Could not determine group ID");
    this.cache.groupId = id;
    return id;
  }

  async getFullSchedule(period?: Period): Promise<FullScheduleDay[]> {
    const groupId = await this.getGroupId();
    const key = period ?? 0;
    const cached = this.cache.schedule.get(key);
    if (cached) return cached;
    const data = await this.tt.getGroupSchedule(groupId, period);
    this.cache.schedule.set(key, data);
    return data;
  }

  async getCurrentPeriod(): Promise<Period | null> {
    if (this.cache.currentPeriod !== undefined) return this.cache.currentPeriod;
    const groupId = await this.getGroupId();
    const period = await this.tt.getCurrentPeriod(groupId);
    this.cache.currentPeriod = period;
    return period;
  }

  async getServerTime(): Promise<Time> {
    return this.tt.getServerTime();
  }

  async getScheduleForDay(
    weekday: number,
    filter?: ScheduleFilter,
    period?: Period,
  ): Promise<FullScheduleSlot[]> {
    const schedule = await this.getFullSchedule(period);
    const dayName = WEEKDAY_NAMES[weekday];
    const day = schedule.find(
      (d) => d.weekday.toLowerCase() === dayName?.toLowerCase(),
    );
    if (!day) return [];
    return filterSlots(day.slots, filter);
  }

  async getScheduleForDate(
    date: Date,
    filter?: ScheduleFilter & { semesterStart?: Date },
    period?: Period,
  ): Promise<FullScheduleSlot[]> {
    const weekday = date.getDay();
    const effectiveFilter = { ...filter };

    if (filter?.semesterStart && !filter.week) {
      effectiveFilter.week = getWeekNumber(filter.semesterStart, date);
    }

    return this.getScheduleForDay(weekday, effectiveFilter, period);
  }

  async getCurrentLesson(
    filter?: ScheduleFilter,
  ): Promise<CurrentLesson | null> {
    const [time, period] = await Promise.all([
      this.getServerTime(),
      this.getCurrentPeriod(),
    ]);

    const now = new Date();
    const weekday = now.getDay();
    const slots = await this.getScheduleForDay(weekday, filter, period ?? undefined);

    const timeMinutes = time.hours * 60 + time.minutes;

    for (const slot of slots) {
      const start = slot.timeStart.hours * 60 + slot.timeStart.minutes;
      const end = slot.timeEnd.hours * 60 + slot.timeEnd.minutes;

      if (timeMinutes >= start && timeMinutes <= end) {
        for (const entry of slot.entries) {
          return {
            slot,
            entry,
            weekday: WEEKDAY_NAMES[weekday] ?? "",
            period: period ?? Period.FallSemester,
          };
        }
      }
    }

    return null;
  }

  async getFaculties(): Promise<Faculty[]> {
    if (this.cache.faculties) return this.cache.faculties;
    const data = await this.tt.getFaculties();
    this.cache.faculties = data;
    return data;
  }

  async getGroupsForFaculty(facultyId: number): Promise<Group[]> {
    const cached = this.cache.groups.get(facultyId);
    if (cached) return cached;
    const data = await this.tt.getGroupsForFaculty(facultyId);
    this.cache.groups.set(facultyId, data);
    return data;
  }

  async searchGroup(name: string): Promise<Group[]> {
    return this.tt.searchGroup(name);
  }

  async searchTeacher(name: string): Promise<{ id: number; name: string }[]> {
    return this.tt.searchTeacher(name);
  }
}

function filterSlots(
  slots: FullScheduleSlot[],
  filter?: ScheduleFilter,
): FullScheduleSlot[] {
  if (!filter?.subgroup && !filter?.week) return slots;

  return slots
    .map((slot) => ({
      ...slot,
      entries: filterEntries(slot.entries, filter),
    }))
    .filter((slot) => slot.entries.length > 0);
}

function filterEntries(
  entries: ScheduleEntry[],
  filter?: ScheduleFilter,
): ScheduleEntry[] {
  return entries.filter((e) => {
    if (filter?.subgroup && e.subgroup && e.subgroup !== filter.subgroup) {
      return false;
    }
    if (filter?.week) {
      if (e.weeks.min > 0 && (filter.week < e.weeks.min || filter.week > e.weeks.max)) {
        return false;
      }
      if (e.weekParity) {
        const isEven = filter.week % 2 === 0;
        if (e.weekParity === "even" && !isEven) return false;
        if (e.weekParity === "odd" && isEven) return false;
      }
    }
    return true;
  });
}

function getWeekNumber(semesterStart: Date, date: Date): number {
  const startMonday = getMonday(semesterStart);
  const targetMonday = getMonday(date);
  const diff = targetMonday.getTime() - startMonday.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
