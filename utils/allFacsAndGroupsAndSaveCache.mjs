import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { TimetableClient } from "../dist/index.js";

const CACHE_FILE = "cache.json";

const tt = new TimetableClient({
  cache: Infinity,
});

if (existsSync(CACHE_FILE)) {
  const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  tt.importCache(data);
  console.log("Кеш загружен из cache.json");
}

console.log("Логин гостем...");
await tt.loginAsGuest();
console.log("OK");

console.log("\nФакультеты");
const faculties = await tt.getFaculties();
for (const f of faculties) {
  console.log(`  [${f.id}] ${f.name}`);
}

let totalGroups = 0;

console.log(`\nГруппы (${faculties.length} факультетов)`);
for (const f of faculties) {
  const groups = await tt.getFacultyGroups(f.id);
  totalGroups += groups.length;
  console.log(`  ${f.name}: ${groups.length} групп`);
  for (const g of groups) {
    console.log(`    [${g.id}] ${g.name}`);
  }
}

console.log(`\nВсего групп: ${totalGroups}`);

const cache = tt.exportCache();
writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
console.log("Кеш сохранён в cache.json");
