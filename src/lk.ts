import { HttpClient } from "./http.js";
import { parseHtml, extractScriptValues, text } from "./parse.js";
import type { PersonalData, ExamDay, Exam } from "./types.js";

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

  async getExams(): Promise<ExamDay[]> {
    const { body } = await this.http.get(`${STUDENT_BASE}/exams.php`);
    const doc = parseHtml(body);
    const days: ExamDay[] = [];

    const tabs = doc.querySelectorAll("[role='tabpanel']");
    const tabHeaders = doc.querySelectorAll("[role='tab'] a");

    for (let i = 0; i < tabs.length; i++) {
      const panel = tabs[i];
      const date = text(tabHeaders[i]);
      const exams: Exam[] = [];

      const rows = panel.querySelectorAll("tbody tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) continue;

        const timeParts = text(cells[0]);
        const info = cells[1];

        const subject = text(info.querySelector(".blue"));
        const fullText = text(info);

        const typeMatch = fullText.match(/\((зач|экз|зчО|кр)\)/);
        const subgroupMatch = fullText.match(/\((\d+ подгруппа)\)/);
        const room = text(info.querySelector(".red")) || "";
        const teacher = fullText
          .replace(subject, "")
          .replace(room, "")
          .replace(typeMatch?.[0] ?? "", "")
          .replace(subgroupMatch?.[0] ?? "", "")
          .trim();

        exams.push({
          time: timeParts.split("\n")[0]?.trim() ?? "",
          subject,
          type: typeMatch?.[1] ?? "",
          teacher,
          room,
          subgroup: subgroupMatch?.[1],
        });
      }

      if (exams.length > 0) days.push({ date, exams });
    }

    return days;
  }

  /** Get the group ID from the schedule link on tt.php */
  async getGroupId(): Promise<number | null> {
    const { body } = await this.http.get(`${STUDENT_BASE}/tt.php`);
    const match = body.match(/tt\.chuvsu\.ru\/index\/grouptt\/gr\/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }
}
