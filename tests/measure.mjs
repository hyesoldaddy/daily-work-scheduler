// PLAN 작업 12: 성공 기준 점검 스크립트
// 사용법: 서버를 켠 뒤(npm run dev 또는 npm run build && npm start) 다른 터미널에서
//   node tests/measure.mjs            (기본 주소 http://localhost:3000, 5회)
//   BASE_URL=http://localhost:3111 RUNS=5 node tests/measure.mjs
// 이 파일은 서버의 /api/schedule 을 호출만 하며, 아무것도 저장하지 않는다.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 5);

// ── 테스트 입력: "지금"을 2026-11-12 09:10으로 고정해 언제 돌려도 같은 조건이 되게 한다.
const NOW = "2026-11-12T09:10";
const T = (id, name, importance, deadline, hours, type, fixedTime = "") => ({
  id, name, importance, deadline, hours, type, fixedTime,
});
const TASKS = [
  T("1", "예산안 검토", "상", "2026-11-12T16:00", "2", "집중"),
  T("2", "결재 처리", "중", "2026-11-12T10:30", "0.5", "단순"),
  T("3", "민원 회신", "하", "", "1", "협업"),
  T("4", "팀 회의", "중", "", "1", "협업", "14:00"),
  T("5", "자료 정리", "상", "", "1", "단순"),
  T("6", "어제 못 한 보고서", "상", "2026-11-11T17:00", "1.5", "집중"),
  T("7", "메일 답장", "하", "", "0.5", "단순"),
  T("8", "교육 자료 준비", "중", "2026-11-13T10:00", "2.5", "집중"),
  T("9", "비품 신청", "하", "", "0.5", "단순"),
  T("10", "연간 계획 초안", "상", "", "8", "집중"),
];

// ── 정답 순서(PRD 규칙을 사람이 손으로 적용한 것). 작성자가 직접 고치면 된다.
// 6 기한 지남 → 2 마감까지 80분(4시간 이내) → 1 중요도 상·마감 있음 → 5·10 상·마감 없음 → 8 중·마감 있음 → 4 중 → 3·7·9 하
const EXPECTED_TOP3 = ["6", "2", "1"];

const nameOf = Object.fromEntries(TASKS.map((t) => [t.id, t.name]));
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const NOW_DAY = NOW.slice(0, 10);
// 마감 문구를 오늘 자정 기준 분으로 (같은 방식으로 now도 계산)
const dayMinutes = (s) => {
  const [d, t] = s.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  return Date.UTC(y, mo - 1, da) / 60000 + toMin(t);
};
const TODAY0 = dayMinutes(`${NOW_DAY}T00:00`);

async function callOnce() {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: TASKS, now: NOW }),
  });
  const data = await res.json();
  return { sec: (Date.now() - t0) / 1000, status: res.status, data };
}

function checkDeadline(data) {
  // 마감이 있고 아직 안 지난 업무 중, 마감 전에 끝나게 배치된 비율
  const nowMin = dayMinutes(NOW) - TODAY0;
  let target = 0, met = 0;
  const misses = [];
  for (const t of TASKS) {
    if (t.deadline === "") continue;
    const dl = dayMinutes(t.deadline) - TODAY0;
    if (dl < nowMin) continue; // 이미 기한 지남: 제외
    target++;
    const item = data.schedule.find((s) => s.id === t.id);
    if (!item && dl >= 24 * 60) { target--; continue; } // 마감이 내일 이후라 오늘 못 해도 괜찮음
    if (item && toMin(item.end) <= dl) met++;
    else misses.push(`${t.name}(${item ? item.end + "에 끝남" : "처리 불가"})`);
  }
  return { target, met, misses };
}

function checkLayout(data) {
  // 독립 검사: 30분 단위, 근무·점심 시간, 겹침, 고정 시간, 현재 시각 이후
  const problems = [];
  const items = data.schedule.map((s) => ({ ...s, a: toMin(s.start), b: toMin(s.end) })).sort((x, y) => x.a - y.a);
  for (const [i, s] of items.entries()) {
    if (s.a % 30 || s.b % 30) problems.push(`${nameOf[s.id]}: 30분 단위 아님`);
    if (s.a < 9 * 60 || s.b > 18 * 60) problems.push(`${nameOf[s.id]}: 근무 시간 밖`);
    if (s.a < 13 * 60 && s.b > 12 * 60) problems.push(`${nameOf[s.id]}: 점심과 겹침`);
    if (i > 0 && s.a < items[i - 1].b) problems.push(`${nameOf[s.id]}: 겹침`);
    const task = TASKS.find((t) => t.id === s.id);
    if (task.fixedTime && s.start !== task.fixedTime) problems.push(`${task.name}: 고정 시간 불일치`);
    if (s.a < toMin(NOW.slice(11)) + 1) problems.push(`${task.name}: 현재 시각 이전`);
  }
  return problems;
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await callOnce();
  runs.push(r);
  const d = r.data;
  console.log(
    `#${i + 1} ${r.sec.toFixed(1)}초 HTTP ${r.status}`,
    d.ok ? `이유 문구:${d.reasonSource}` : `오류: ${d.error}`,
  );
}

const ok = runs.filter((r) => r.data.ok);
console.log("\n── 결과 ──");

// 응답 속도
const maxSec = Math.max(...runs.map((r) => r.sec));
console.log(`응답 속도 (목표 10초 이내): 최대 ${maxSec.toFixed(1)}초, 평균 ${(runs.reduce((a, r) => a + r.sec, 0) / runs.length).toFixed(1)}초 → ${maxSec <= 10 ? "통과" : "미달"}`);

// 정확도
const accuracy = ok.map((r) => {
  const top3 = r.data.priority.slice(0, 3).map((p) => p.id);
  return top3.filter((id) => EXPECTED_TOP3.includes(id)).length;
});
console.log(`정확도 (목표 상위 3개 중 2개 이상 일치): 일치 개수 ${accuracy.join(", ")} → ${accuracy.length > 0 && accuracy.every((n) => n >= 2) ? "통과" : "미달"}`);

// 일관성
const orders = ok.map((r) => r.data.priority.map((p) => p.id).join(">"));
const counts = {};
for (const o of orders) counts[o] = (counts[o] ?? 0) + 1;
const best = Math.max(0, ...Object.values(counts));
console.log(`일관성 (목표 5번 중 4번 이상 같은 순서): 가장 많은 같은 순서 ${best}/${runs.length}회, 서로 다른 순서 ${Object.keys(counts).length}가지 → ${best >= Math.ceil(runs.length * 0.8) ? "통과" : "미달"}`);
const schedKeys = ok.map((r) => r.data.schedule.map((s) => `${s.id}@${s.start}`).join(","));
const schedCounts = {};
for (const k of schedKeys) schedCounts[k] = (schedCounts[k] ?? 0) + 1;
console.log(`  (참고) 시간표까지 같은 횟수: ${Math.max(0, ...Object.values(schedCounts))}/${runs.length}`);

// 기한 준수
const dl = ok.map((r) => checkDeadline(r.data));
const target = dl.reduce((a, x) => a + x.target, 0);
const met = dl.reduce((a, x) => a + x.met, 0);
console.log(`기한 준수 (목표 100%): ${met}/${target} → ${target > 0 && met === target ? "통과" : "미달"}`);
for (const x of dl) if (x.misses.length) console.log("  놓친 업무:", x.misses.join(", "));

// 규칙 독립 검사
const layout = ok.flatMap((r) => checkLayout(r.data));
console.log(`시간표 규칙 독립 검사: ${layout.length === 0 ? "문제 없음" : "문제 " + layout.length + "건 → " + [...new Set(layout)].join("; ")}`);

// 마지막 결과 보기
if (ok.length) {
  const d = ok.at(-1).data;
  console.log("\n── 마지막 결과 ──");
  console.log("우선순위:");
  for (const p of d.priority) console.log(`  ${nameOf[p.id]}${p.overdue ? "(지남)" : ""} — ${p.reason}`);
  console.log("시간표:", d.schedule.map((s) => `${s.start}~${s.end} ${nameOf[s.id]}${s.flag ? "[" + s.flag + "]" : ""}`).join(" | "));
  console.log("처리 불가:", d.unscheduled.map((id) => nameOf[id]).join(", ") || "없음");
}
console.log("\n시간 절감(입력부터 결과까지 3분)은 사람이 직접 재야 하는 항목이라 이 스크립트에서는 재지 않는다.");
