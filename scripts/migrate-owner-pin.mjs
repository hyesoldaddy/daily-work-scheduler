// 기존 저장 기록(PIN 도입 전)을 새 PIN 키로 옮기는 한 번용 도구.
//   사용법:  node scripts/migrate-owner-pin.mjs <이름 또는 사번> <새 PIN>
// PIN 도입 전에 저장한 이월 업무·이행 기록은 "이름·사번"만으로 만든 키로 저장되어 있어서,
// PIN을 넣어 만든 새 키로는 보이지 않는다. 이 도구가 그 기록의 키를 새 PIN 키로 바꿔 준다.
// .env의 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_HASH_SECRET을 읽는다. (값은 출력하지 않는다)
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const [owner, pin] = process.argv.slice(2);
if (!owner || !pin || pin.trim().length < 6) {
  console.error("사용법: node scripts/migrate-owner-pin.mjs <이름 또는 사번> <PIN(6자 이상)>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_HASH_SECRET } = env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OWNER_HASH_SECRET) {
  console.error(".env에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_HASH_SECRET이 모두 있어야 합니다.");
  process.exit(1);
}

const normalize = (s) => s.trim().normalize("NFC").toLowerCase();
const hmac = (text) => createHmac("sha256", OWNER_HASH_SECRET).update(text).digest("hex");
const oldHash = hmac(normalize(owner)); // PIN 도입 전 방식
const newHash = hmac(`${normalize(owner)}\u0000${pin.trim()}`); // PIN 도입 후 방식

for (const table of ["carryover_tasks", "done_tasks"]) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${table}?owner_hash=eq.${oldHash}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ owner_hash: newHash }),
  });
  if (!res.ok) {
    console.error(`${table}: 실패 (HTTP ${res.status}) — 새 키로 이미 같은 업무가 있으면 겹쳐서 실패할 수 있습니다.`);
    continue;
  }
  const moved = await res.json();
  console.log(`${table}: ${moved.length}건 옮김`);
}
