import { HttpClient } from "./http.js";
import { extractScriptValues } from "./parse.js";
import type { PersonalData } from "./types.js";

const BASE = "https://lk.chuvsu.ru";
const LOGIN_URL = `${BASE}/info/login.php`;
const STUDENT_BASE = `${BASE}/student`;

export class LkClient {
  private http = new HttpClient();

  constructor(
    private email: string,
    private password: string,
    private role = "1",
  ) {}

  async login(): Promise<boolean> {
    const res = await this.http.post(
      LOGIN_URL,
      { email: this.email, password: this.password, role: this.role, enter: "" },
      false,
    );
    return res.status === 302 && !!res.location?.includes("student");
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

  /** Get the group ID from the schedule link on tt.php */
  async getGroupId(): Promise<number | null> {
    const { body } = await this.http.get(`${STUDENT_BASE}/tt.php`);
    const match = body.match(/tt\.chuvsu\.ru\/index\/grouptt\/gr\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }
}
