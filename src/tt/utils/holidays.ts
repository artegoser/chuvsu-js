import { isSameDay } from "./date.js";

export interface Holiday {
  /** Month number, 1-12. */
  month: number;
  /** Day of month. */
  day: number;
  /** Human-readable name. */
  name: string;
}

/**
 * A government-decree day-off transfer (Постановление Правительства).
 * Moves a day off from one date to another.
 */
export interface HolidayTransfer {
  /** The date that becomes a day off. */
  dayOff: Date;
  /** The date that becomes a working day (e.g. a Saturday). `null` if no compensating work day. */
  workDay: Date | null;
}

/** Russian non-working public holidays (Статья 112 ТК РФ). */
export const RUSSIAN_HOLIDAYS: Holiday[] = [
  { month: 1, day: 1, name: "Новый год" },
  { month: 1, day: 2, name: "Новогодние каникулы" },
  { month: 1, day: 3, name: "Новогодние каникулы" },
  { month: 1, day: 4, name: "Новогодние каникулы" },
  { month: 1, day: 5, name: "Новогодние каникулы" },
  { month: 1, day: 6, name: "Новогодние каникулы" },
  { month: 1, day: 7, name: "Рождество Христово" },
  { month: 1, day: 8, name: "Новогодние каникулы" },
  { month: 2, day: 23, name: "День защитника Отечества" },
  { month: 3, day: 8, name: "Международный женский день" },
  { month: 5, day: 1, name: "Праздник Весны и Труда" },
  { month: 5, day: 9, name: "День Победы" },
  { month: 6, day: 12, name: "День России" },
  { month: 11, day: 4, name: "День народного единства" },
];

/**
 * January holiday dates (1-8) are excluded from automatic weekend transfer
 * per Art. 112 ТК РФ. Their transfers are decided by government decree.
 */
function isJanuaryHoliday(h: Holiday): boolean {
  return h.month === 1 && h.day >= 1 && h.day <= 8;
}

/**
 * Bridge-day transfers for non-January holidays.
 *
 * Pattern (consistent across government decrees):
 * - Holiday on Tuesday -> Monday becomes day off, preceding Saturday is work day
 * - Holiday on Thursday -> Friday becomes day off, following Saturday is work day
 *   (only for 5-day week; 6-day week has Saturday classes, so no gap to bridge)
 *
 * January holidays are excluded (their 2 transfers are unpredictable).
 */
function computeBridgeDays(
  year: number,
  holidays: Holiday[],
  effectiveDays: Date[],
  sixDayWeek: boolean,
): HolidayTransfer[] {
  const bridges: HolidayTransfer[] = [];

  for (const h of holidays) {
    if (isJanuaryHoliday(h)) continue;

    const date = new Date(year, h.month - 1, h.day);
    const dow = date.getDay();

    if (dow === 2) {
      // Tuesday -> Monday off, preceding Saturday works
      const monday = new Date(date);
      monday.setDate(date.getDate() - 1);
      const saturday = new Date(date);
      saturday.setDate(date.getDate() - 3);

      if (!effectiveDays.some((d) => isSameDay(d, monday))) {
        bridges.push({
          dayOff: monday,
          workDay: sixDayWeek ? null : saturday,
        });
      }
    } else if (dow === 4 && !sixDayWeek) {
      // Thursday -> Friday off, following Saturday works
      // Only for 5-day week: 6-day week has no gap (Saturday is a work day)
      const friday = new Date(date);
      friday.setDate(date.getDate() + 1);
      const saturday = new Date(date);
      saturday.setDate(date.getDate() + 2);

      if (!effectiveDays.some((d) => isSameDay(d, friday))) {
        bridges.push({ dayOff: friday, workDay: saturday });
      }
    }
  }

  return bridges;
}

/**
 * Compute effective non-working holiday dates for a given year.
 *
 * Rules (Art. 112 ТК РФ):
 * 1. All holidays in the list are non-working days.
 * 2. For non-January holidays: if a holiday falls on Sat/Sun, the day off
 *    automatically transfers to the next working day.
 * 3. For January holidays (1-8): weekend transfers are NOT automatic —
 *    they are decided by annual government decree. Pass them via `transfers`.
 * 4. Bridge days: if a non-January holiday falls on Tue, Mon is day off
 *    (preceding Sat works); if on Thu, Fri is day off (following Sat works).
 *    Computed automatically, can be overridden via `transfers`.
 * 5. Government decree transfers (`transfers`) add extra days off and
 *    override auto-computed bridge days.
 * 6. For 6-day week (`sixDayWeek`): Saturday is a work day, so
 *    Thursday bridges don't apply and Saturday holidays don't auto-transfer.
 */
export function getEffectiveHolidays(
  year: number,
  holidays: Holiday[] = RUSSIAN_HOLIDAYS,
  transfers: HolidayTransfer[] = [],
  sixDayWeek: boolean = true,
): Date[] {
  const originalDates = holidays.map(
    (h) => new Date(year, h.month - 1, h.day),
  );

  const isOriginalHoliday = (d: Date) =>
    originalDates.some((od) => isSameDay(od, d));

  const effectiveDays: Date[] = [...originalDates];

  // Auto-transfer: only non-January holidays that fall on weekends
  const nonJanuaryOnWeekend = holidays
    .filter((h) => !isJanuaryHoliday(h))
    .map((h) => new Date(year, h.month - 1, h.day))
    .filter((d) => d.getDay() === 0 || d.getDay() === 6)
    .sort((a, b) => a.getTime() - b.getTime());

  for (const holiday of nonJanuaryOnWeekend) {
    let candidate = new Date(holiday);
    if (candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 2);
    } else {
      candidate.setDate(candidate.getDate() + 1);
    }

    while (
      candidate.getDay() === 0 ||
      candidate.getDay() === 6 ||
      isOriginalHoliday(candidate) ||
      effectiveDays.some((ed) => isSameDay(ed, candidate))
    ) {
      candidate.setDate(candidate.getDate() + 1);
    }

    effectiveDays.push(new Date(candidate));
  }

  // Bridge days (auto-computed, can be overridden)
  const autoBridges = computeBridgeDays(
    year,
    holidays,
    effectiveDays,
    sixDayWeek,
  );

  // Merge: explicit transfers override auto-computed bridges
  const allTransfers = [...autoBridges];
  for (const t of transfers) {
    const idx = allTransfers.findIndex((b) => isSameDay(b.dayOff, t.dayOff));
    if (idx !== -1) {
      allTransfers[idx] = t;
    } else {
      allTransfers.push(t);
    }
  }

  for (const t of allTransfers) {
    if (!effectiveDays.some((d) => isSameDay(d, t.dayOff))) {
      effectiveDays.push(t.dayOff);
    }
  }

  return effectiveDays.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * All transfers (auto bridges + explicit) for a given year.
 * Useful for getting compensating work days (Saturdays that become working).
 */
export function getHolidayTransfers(
  year: number,
  holidays: Holiday[] = RUSSIAN_HOLIDAYS,
  transfers: HolidayTransfer[] = [],
  sixDayWeek: boolean,
): HolidayTransfer[] {
  const originalDates = holidays.map(
    (h) => new Date(year, h.month - 1, h.day),
  );
  const effectiveDays: Date[] = [...originalDates];

  // Replay weekend transfers to build effectiveDays for bridge computation
  const nonJanuaryOnWeekend = holidays
    .filter((h) => !isJanuaryHoliday(h))
    .map((h) => new Date(year, h.month - 1, h.day))
    .filter((d) => d.getDay() === 0 || d.getDay() === 6)
    .sort((a, b) => a.getTime() - b.getTime());

  const isOriginalHoliday = (d: Date) =>
    originalDates.some((od) => isSameDay(od, d));

  for (const holiday of nonJanuaryOnWeekend) {
    let candidate = new Date(holiday);
    if (candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 2);
    } else {
      candidate.setDate(candidate.getDate() + 1);
    }
    while (
      candidate.getDay() === 0 ||
      candidate.getDay() === 6 ||
      isOriginalHoliday(candidate) ||
      effectiveDays.some((ed) => isSameDay(ed, candidate))
    ) {
      candidate.setDate(candidate.getDate() + 1);
    }
    effectiveDays.push(new Date(candidate));
  }

  const autoBridges = computeBridgeDays(
    year,
    holidays,
    effectiveDays,
    sixDayWeek,
  );
  const allTransfers = [...autoBridges];
  for (const t of transfers) {
    const idx = allTransfers.findIndex((b) => isSameDay(b.dayOff, t.dayOff));
    if (idx !== -1) {
      allTransfers[idx] = t;
    } else {
      allTransfers.push(t);
    }
  }

  return allTransfers;
}

/**
 * List of compensating work days (e.g. Saturdays that become working).
 * Includes both auto-computed bridge compensations and explicit transfers.
 */
export function getCompensatingWorkDays(
  year: number,
  holidays: Holiday[] = RUSSIAN_HOLIDAYS,
  transfers: HolidayTransfer[] = [],
  sixDayWeek: boolean,
): Date[] {
  return getHolidayTransfers(year, holidays, transfers, sixDayWeek)
    .filter((t) => t.workDay != null)
    .map((t) => t.workDay!);
}

/**
 * True if the given date is a non-working holiday,
 * including transferred holidays when they fall on weekends (Art. 112 ТК РФ)
 * and auto-computed bridge days.
 * Pass an empty array for `holidays` to disable holiday checking.
 */
export function isHoliday(
  date: Date,
  holidays: Holiday[] = RUSSIAN_HOLIDAYS,
  transfers: HolidayTransfer[] = [],
  sixDayWeek: boolean = true,
): boolean {
  if (holidays.length === 0 && transfers.length === 0) return false;
  const year = date.getFullYear();
  const effectiveDays = getEffectiveHolidays(
    year,
    holidays,
    transfers,
    sixDayWeek,
  );
  return effectiveDays.some((d) => isSameDay(d, date));
}
