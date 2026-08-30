import { AcademicPeriod } from "../../common/types.js";

export function getCurrentPeriod(opts?: { date?: Date }): AcademicPeriod {
  const date = opts?.date ?? new Date();
  const month = date.getMonth();
  const day = date.getDate();

  // Dec 25+ and Jan -> Winter session (зимняя сессия)
  if (month === 0 || (month === 11 && day >= 25)) return AcademicPeriod.WinterSession;
  // Feb-May -> Spring semester (весенний семестр)
  if (month >= 1 && month <= 4) return AcademicPeriod.SpringSemester;
  // Jun-Aug -> Summer session (летняя сессия)
  if (month >= 5 && month <= 7) return AcademicPeriod.SummerSession;
  // Sep - Dec 24 -> Fall semester (осенний семестр)
  return AcademicPeriod.FallSemester;
}

export function isSessionPeriod(period: AcademicPeriod): boolean {
  return period === AcademicPeriod.WinterSession || period === AcademicPeriod.SummerSession;
}

export function getAdjacentSemester(session: AcademicPeriod): AcademicPeriod {
  return session === AcademicPeriod.WinterSession
    ? AcademicPeriod.FallSemester
    : AcademicPeriod.SpringSemester;
}
