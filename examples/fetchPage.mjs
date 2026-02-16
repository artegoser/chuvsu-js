import { createInterface } from "node:readline/promises";
import { HttpClient } from "../dist/common/http.js";

const rl = createInterface({ input: process.stdin, output: process.stderr });

const email = await rl.question("Email: ");
const password = await rl.question("Password: ");
const url = await rl.question("URL (lk/tt page): ");
rl.close();

const http = new HttpClient();
const parsed = new URL(url);
const host = parsed.hostname;

if (host === "lk.chuvsu.ru") {
  const res = await http.post(
    "https://lk.chuvsu.ru/info/login.php",
    { email, password, role: "1", enter: "" },
    false,
  );
  if (!(res.status === 302 && res.location?.includes("student"))) {
    console.error("LK login failed, status:", res.status, "location:", res.location);
    process.exit(1);
  }
  console.error("LK login OK");
} else if (host === "tt.chuvsu.ru") {
  const res = await http.post(
    "https://tt.chuvsu.ru/auth",
    { wname: email, wpass: password, wauto: "1", auth: "Войти", hfac: "0", pertt: "1" },
    false,
  );
  if (res.status !== 302) {
    console.error("TT login failed, status:", res.status);
    process.exit(1);
  }
  console.error("TT login OK");
} else {
  console.error("Unknown host:", host, "— expected lk.chuvsu.ru or tt.chuvsu.ru");
  process.exit(1);
}

const page = await http.get(url);
console.log(page.body);
