import { Period } from "../../common/types.js";

export function getCurrentPeriod(opts?: { date?: Date }): Period {
  const date = opts?.date ?? new Date();
  const month = date.getMonth();
  const day = date.getDate();

  // Dec 25+ and Jan -> Winter session (зимняя сессия)
  if (month === 0 || (month === 11 && day >= 25)) return Period.WinterSession;
  // Feb-May -> Spring semester (весенний семестр)
  if (month >= 1 && month <= 4) return Period.SpringSemester;
  // Jun-Aug -> Summer session (летняя сессия)
  if (month >= 5 && month <= 7) return Period.SummerSession;
  // Sep - Dec 24 -> Fall semester (осенний семестр)
  return Period.FallSemester;
}

export function isSessionPeriod(period: Period): boolean {
  return period === Period.WinterSession || period === Period.SummerSession;
}

export function getAdjacentSemester(session: Period): Period {
  return session === Period.WinterSession
    ? Period.FallSemester
    : Period.SpringSemester;
}
