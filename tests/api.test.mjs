// API·규칙 시험: 실행 중인 서버(기본 http://localhost:3000)를 대상으로 한다.
//   실행:  npm run dev  (다른 터미널에서)  →  node --test tests/api.test.mjs
// - /api/schedule: 입력 검사, 정렬, 남은 근무 시간·고정 시각 경계 (AI 없이도 통과해야 한다)
// - /api/carryover, /api/report: 실제 Supabase에 시험용 이름으로 저장·조회·삭제하고 마지막에 모두 지운다.
//   (Supabase 설정이 없으면 이월·이행 기록 시험은 건너뛴다)
// - 보안: PIN 분리, Origin·Content-Type 검사, 형식 검사, 요청 횟수 제한
// 주의: 마지막 시험이 요청 횟수 제한(1분에 10회)을 일부러 넘기므로, 끝난 뒤 약 1분간은 같은 PC에서 시간표 만들기가 막힌다.
//       `node tests/measure.mjs`와 이 시험은 1분 이상 간격을 두고 따로 실행한다.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { addDays, weekStartOf } from "../lib/week.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PIN = "test-pin-123456";
const call = async (path, body, headers = {}, raw = false) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = (path, body) => call(path, body);
// 이름·사번 + PIN을 함께 보내는 저장소 호출
const store = (path, owner, body, pin = PIN) => post(path, { ...body, owner, pin });

const task = (id, over = {}) => ({
  id,
  name: `업무 ${id}`,
  importance: "중",
  deadline: "",
  hours: "1",
  type: "집중",
  fixedTime: "",
  ...over,
});

describe("주간 날짜 계산 (lib/week.ts)", () => {
  it("월요일에 시작하는 주로 계산한다", () => {
    assert.equal(weekStartOf("2026-11-09"), "2026-11-09"); // 월
    assert.equal(weekStartOf("2026-11-12"), "2026-11-09"); // 목
    assert.equal(weekStartOf("2026-11-15"), "2026-11-09"); // 일
    assert.equal(weekStartOf("2026-11-16"), "2026-11-16"); // 다음 월
  });
  it("달·해가 바뀌어도 맞다", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(weekStartOf("2027-01-01"), "2026-12-28");
  });
});

describe("/api/schedule", () => {
  const now = "2026-11-12T09:10";

  it("필수 항목이 비면 400", async () => {
    const r = await post("/api/schedule", { tasks: [task("a", { importance: "" })], now });
    assert.equal(r.status, 400);
  });

  it("마감이 4시간 이내인 업무가 먼저 온다 (코드 정렬)", async () => {
    const r = await post("/api/schedule", {
      tasks: [
        task("low", { importance: "하" }),
        task("urgent", { importance: "하", deadline: "2026-11-12T12:00" }),
        task("high", { importance: "상" }),
      ],
      now,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.priority[0].id, "urgent");
    assert.ok(r.body.priority.every((p) => p.reason.trim() !== "" && [...p.reason].length <= 30));
  });

  it("남은 근무 시간이 30분이 안 되면 안내하고 모두 처리 불가", async () => {
    const r = await post("/api/schedule", {
      tasks: [task("a", { hours: "0.5" })],
      now: "2026-11-12T17:20",
      work: { start: "09:00", end: "17:40" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.length, 0);
    assert.deepEqual(r.body.unscheduled, ["a"]);
    assert.ok(r.body.notice);
  });

  it("현재 시각이 정각이면 그 시각의 시작 시각 지정 업무를 배치한다", async () => {
    const r = await post("/api/schedule", {
      tasks: [task("meet", { fixedTime: "14:00", type: "협업" })],
      now: "2026-11-12T14:00",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule[0]?.start, "14:00");
  });

  it("이미 지난 시작 시각 지정 업무는 처리 불가", async () => {
    const r = await post("/api/schedule", {
      tasks: [task("past", { fixedTime: "13:30", type: "협업" })],
      now: "2026-11-12T14:00",
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.unscheduled, ["past"]);
  });

  it("존재할 수 없는 시각·날짜는 400 (99:90, 13월 등)", async () => {
    const t = [task("a")];
    assert.equal((await post("/api/schedule", { tasks: t, now, work: { start: "99:90", end: "18:00" } })).status, 400);
    assert.equal((await post("/api/schedule", { tasks: t, now: "2026-13-45T25:61" })).status, 400);
    assert.equal((await post("/api/schedule", { tasks: [task("a", { fixedTime: "24:00" })], now })).status, 400);
  });
});

describe("보호 장치 (Origin·Content-Type)", () => {
  it("다른 사이트(Origin)에서 온 요청은 403", async () => {
    const r = await call("/api/schedule", { tasks: [task("a")], now: "2026-11-12T09:10" }, { Origin: "https://evil.example" });
    assert.equal(r.status, 403);
  });
  it("JSON이 아닌 요청은 415", async () => {
    const r = await call("/api/schedule", "x=1", { "Content-Type": "text/plain" }, true);
    assert.equal(r.status, 415);
  });
  it("같은 사이트의 Origin은 통과한다", async () => {
    const r = await call("/api/schedule", { tasks: [task("a")], now: "2026-11-12T09:10" }, { Origin: BASE });
    assert.equal(r.status, 200);
  });
});

// ── Supabase를 쓰는 시험 ──
const configured = (await post("/api/carryover", { action: "ping" })).status === 200;
const owners = []; // [이름, PIN]
const newOwner = (pin = PIN) => {
  const o = `시험-${Math.random().toString(36).slice(2, 8)}`;
  owners.push([o, pin]);
  return o;
};
const row = (id, name) => ({ id, name, importance: "상", hours: "1", type: "집중", deadline: "", fixedTime: "" });

describe("/api/carryover (이월 보관함)", { skip: !configured && "Supabase 미설정" }, () => {
  it("저장·조회·삭제, 다른 사람과 분리", async () => {
    const a = newOwner();
    const b = newOwner();
    await store("/api/carryover", a, { action: "save", tasks: [row("co:2026-11-12:1", "보고서"), row("co:2026-11-12:2", "정리")] });
    const listA = await store("/api/carryover", ` ${a.toUpperCase()} `, { action: "list" }); // 공백·대소문자 무시
    assert.equal(listA.body.tasks.length, 2);
    assert.equal((await store("/api/carryover", b, { action: "list" })).body.tasks.length, 0);
    await store("/api/carryover", b, { action: "remove", ids: ["co:2026-11-12:1"] }); // 남의 것은 못 지움
    assert.equal((await store("/api/carryover", a, { action: "list" })).body.tasks.length, 2);
    await store("/api/carryover", a, { action: "remove", ids: ["co:2026-11-12:1"] });
    assert.deepEqual((await store("/api/carryover", a, { action: "list" })).body.tasks.map((t) => t.name), ["정리"]);
  });

  it("이름·사번을 알아도 PIN이 다르면 보이지 않는다", async () => {
    const a = newOwner();
    await store("/api/carryover", a, { action: "save", tasks: [row("co:2026-11-12:p", "비밀 업무")] });
    assert.equal((await store("/api/carryover", a, { action: "list" }, "other-pin-999")).body.tasks.length, 0);
    assert.equal((await store("/api/carryover", a, { action: "list" })).body.tasks.length, 1);
  });

  it("PIN이 짧거나 없으면 400", async () => {
    assert.equal((await store("/api/carryover", "x", { action: "list" }, "123")).status, 400);
    assert.equal((await post("/api/carryover", { action: "list", owner: "x" })).status, 400);
  });

  it("같은 키로 다시 저장하면 갱신되고 중복되지 않는다", async () => {
    const a = newOwner();
    await store("/api/carryover", a, { action: "save", tasks: [row("co:2026-11-12:k", "처음")] });
    await store("/api/carryover", a, { action: "save", tasks: [row("co:2026-11-12:k", "수정")] });
    const l = (await store("/api/carryover", a, { action: "list" })).body.tasks;
    assert.deepEqual(l.map((t) => t.name), ["수정"]);
  });

  it("한 사람이 둘 수 있는 개수(60개)를 넘으면 409", async () => {
    const a = newOwner();
    const mk = (from, n) => Array.from({ length: n }, (_, i) => row(`co:2026-11-12:b${from + i}`, `대량 ${from + i}`));
    await store("/api/carryover", a, { action: "save", tasks: mk(0, 30) });
    await store("/api/carryover", a, { action: "save", tasks: mk(30, 30) });
    const over = await store("/api/carryover", a, { action: "save", tasks: mk(60, 1) });
    assert.equal(over.status, 409);
    // 이미 있는 것을 갱신하는 저장은 허용된다
    assert.equal((await store("/api/carryover", a, { action: "save", tasks: mk(0, 1) })).status, 200);
  });

  it("[내 저장 기록 모두 삭제]는 이월 보관함과 이행 기록을 모두 지운다", async () => {
    const a = newOwner();
    await store("/api/carryover", a, { action: "save", tasks: [row("co:2026-11-12:z", "지울 업무")] });
    await store("/api/report", a, { action: "done", date: "2026-11-10", tasks: [{ id: "r:z", name: "지울 기록", importance: "상", hours: "1", type: "집중" }] });
    assert.equal((await store("/api/carryover", a, { action: "purge" })).status, 200);
    assert.equal((await store("/api/carryover", a, { action: "list" })).body.tasks.length, 0);
    assert.equal((await store("/api/report", a, { action: "week", weekStart: "2026-11-09" })).body.tasks.length, 0);
  });

  it("잘못된 요청은 400", async () => {
    assert.equal((await store("/api/carryover", "", { action: "save", tasks: [] })).status, 400);
    assert.equal((await store("/api/carryover", "x", { action: "remove", ids: ['x"),id=neq.("'] })).status, 400);
  });
});

describe("/api/report (이행 기록·주간 리포트)", { skip: !configured && "Supabase 미설정" }, () => {
  const t = (id, name) => ({ id, name, importance: "상", hours: "2", type: "집중" });

  it("이행 날짜별로 저장되고 주(월~일) 단위로 조회된다", async () => {
    const a = newOwner();
    await store("/api/report", a, { action: "done", date: "2026-11-15", tasks: [t("r:1", "일요일 업무")] }); // 일
    await store("/api/report", a, { action: "done", date: "2026-11-16", tasks: [t("r:2", "월요일 업무")] }); // 다음 주 월
    const w1 = (await store("/api/report", a, { action: "week", weekStart: "2026-11-11" })).body; // 수요일을 줘도 월요일로
    assert.equal(w1.weekStart, "2026-11-09");
    assert.equal(w1.weekEnd, "2026-11-15");
    assert.deepEqual(w1.tasks.map((x) => x.name), ["일요일 업무"]);
    const w2 = (await store("/api/report", a, { action: "week", weekStart: "2026-11-16" })).body;
    assert.deepEqual(w2.tasks.map((x) => x.name), ["월요일 업무"]);
  });

  it("체크를 풀면(undo) 기록에서 빠지고, 다른 사람·다른 PIN에게는 보이지 않는다", async () => {
    const a = newOwner();
    await store("/api/report", a, { action: "done", date: "2026-11-10", tasks: [t("r:3", "화요일 업무")] });
    assert.equal((await store("/api/report", newOwner(), { action: "week", weekStart: "2026-11-09" })).body.tasks.length, 0);
    assert.equal((await store("/api/report", a, { action: "week", weekStart: "2026-11-09" }, "other-pin-999")).body.tasks.length, 0);
    await store("/api/report", a, { action: "undo", ids: ["r:3"] });
    assert.equal((await store("/api/report", a, { action: "week", weekStart: "2026-11-09" })).body.tasks.length, 0);
  });

  it("같은 업무를 다시 체크해도 중복되지 않는다", async () => {
    const a = newOwner();
    await store("/api/report", a, { action: "done", date: "2026-11-10", tasks: [t("r:4", "한 번만")] });
    await store("/api/report", a, { action: "done", date: "2026-11-10", tasks: [t("r:4", "한 번만")] });
    assert.equal((await store("/api/report", a, { action: "week", weekStart: "2026-11-09" })).body.tasks.length, 1);
  });

  it("존재하지 않는 날짜·PIN 없음은 400", async () => {
    assert.equal((await store("/api/report", "x", { action: "done", date: "2026-02-31x", tasks: [] })).status, 400);
    assert.equal((await store("/api/report", "x", { action: "done", date: "2026-13-40", tasks: [t("r:9", "a")] })).status, 400);
    assert.equal((await post("/api/report", { action: "week", owner: "x", weekStart: "2026-11-09" })).status, 400);
  });
});

// 시험용 이름으로 저장한 것을 모두 지운다
after(async () => {
  if (!configured) return;
  for (const [owner, pin] of owners) {
    await store("/api/carryover", owner, { action: "purge" }, pin);
  }
});

// 요청 횟수 제한은 마지막에 확인한다 (이 시험 뒤 약 1분간 시간표 만들기가 막힌다)
describe("요청 횟수 제한", () => {
  it("/api/schedule을 1분에 10회 넘게 부르면 429", async () => {
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      const r = await post("/api/schedule", { tasks: [], now: "2026-11-12T09:10" }); // 형식 오류(400)도 횟수에 센다
      if (r.status === 429) limited++;
    }
    assert.ok(limited > 0, "429가 한 번도 나오지 않았습니다");
  });
});
