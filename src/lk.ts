import { HttpClient } from "./http.js";
import { extractScriptValues } from "./parse.js";
import type { PersonalData } from "./types.js";
import { AuthError } from "./types.js";

const BASE = "https://lk.chuvsu.ru";
const LOGIN_URL = `${BASE}/info/login.php`;
const STUDENT_BASE = `${BASE}/student`;

export class LkClient {
  private http = new HttpClient();

  async login(opts: { email: string; password: string }): Promise<void> {
    const res = await this.http.post(
      LOGIN_URL,
      { email: opts.email, password: opts.password, role: "1", enter: "" },
      false,
    );
    if (!(res.status === 302 && res.location?.includes("student"))) {
      throw new AuthError("LK login failed");
    }
  }

  async getPersonalData(): Promise<PersonalData> {
    const { body } = await this.http.get(`${STUDENT_BASE}/personal_data.php`);
    const vals = extractScriptValues(body, "form_personal_data");
    return {
      lastName: vals.fam ?? "",
      firstName: vals.nam ?? "",
      patronymic: vals.oth ?? "",
      sex: vals.sex ?? "",
      birthday: vals.birthday ?? "",
      recordBookNumber: vals.zachetka ?? "",
      faculty: vals.faculty ?? "",
      specialty: vals.spec ?? "",
      profile: vals.profile ?? "",
      group: vals.groupname ?? "",
      course: vals.course ?? "",
      email: vals.email ?? "",
      phone: vals.phone ?? "",
    };
  }

  async getGroupId(): Promise<number | null> {
    const { body } = await this.http.get(`${STUDENT_BASE}/tt.php`);
    const match = body.match(/tt\.chuvsu\.ru\/index\/grouptt\/gr\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }
}
