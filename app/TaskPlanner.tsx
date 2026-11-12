"use client";

// Design Ref: §1 ③ 업무 입력 목록 — 1~15줄, [+ 업무 추가], "3 / 15개" (PLAN 작업 4)
// Design Ref: §1 입력칸 규칙 — 마지막 한 줄은 삭제되지 않고 내용만 비워진다.
import { useEffect, useRef, useState } from "react";
import {
  CARRY_PREFIX,
  OWNER_MAX_LENGTH,
  rowKey,
  rowToTask,
  taskToRow,
  type CarryRow,
} from "@/lib/carryover";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/retention";
import { createEmptyTask, type Task } from "@/lib/types";
import {
  MAX_TASKS,
  isEmptyTask,
  parseWorkHours,
  snapDeadline,
  validateTasks,
  type ValidationError,
} from "@/lib/validate";
import PriorityResult, { type PriorityEntry } from "./PriorityResult";
import ScheduleResult, { type ScheduleEntry } from "./ScheduleResult";
import TaskRow from "./TaskRow";
import TimeSelect from "./TimeSelect";
import WeeklyReport from "./WeeklyReport";

/** 버튼을 누른 뒤 화면이 기다리는 최대 시간 (PRD 성공 기준: 10초) */
const REQUEST_TIMEOUT_MS = 10_000;

const FAIL_MESSAGE = "시간표를 만들지 못했습니다. 다시 시도해 주세요";

/** 브라우저의 현재 시각을 "YYYY-MM-DDTHH:mm"(내 시간대 기준)으로 만든다. */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Result = {
  priority: PriorityEntry[];
  schedule: ScheduleEntry[];
  unscheduled: string[];
  notice?: string;
  earliestStart?: string;
  /** 시간표를 만든 날짜 (복사할 글자에 넣는다) */
  date: string;
  /** 시간표를 만들 때 쓴 업무 (이월 저장·삭제에 쓴다) */
  tasks: Task[];
  /** 시간표를 만들 때 입력한 이름·사번. 이후 체크 저장은 입력칸이 바뀌어도 이 이름으로만 한다. */
  owner: string;
  /** 시간표를 만들 때 이미 이행 체크되어 있는 업무 id */
  doneIds: string[];
};

const OWNER_STORAGE_KEY = "carryover-owner";

// 저장·조회에 쓰는 "누구인지"는 이름·사번과 PIN을 합친 한 글자열(who)로 다룬다. 서버로 보낼 때만 나눈다.
// PIN은 브라우저에 저장하지 않고 화면 메모리에만 둔다.
const WHO_SEP = "\u0000";
const makeWho = (owner: string, pin: string) => `${owner.trim()}${WHO_SEP}${pin.trim()}`;
function splitWho(who: string) {
  const [owner = "", pin = ""] = who.split(WHO_SEP);
  return { owner, pin };
}
/** 이름·사번이 있고 PIN이 최소 길이 이상인가 */
function validWho(who: string) {
  const { owner, pin } = splitWho(who);
  return owner !== "" && pin.length >= PIN_MIN_LENGTH;
}

export default function TaskPlanner() {
  const [tasks, setTasks] = useState<Task[]>(() => [createEmptyTask("task-1")]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // 통신 실패·시간 초과·서버 오류면 [다시 시도]를 보여준다. (입력 오류는 고쳐야 하므로 제외)
  const [retryable, setRetryable] = useState(false);
  const controller = useRef<AbortController | null>(null);
  // 근무 시작·종료 시각. 점심시간(12:00~13:00)은 고정이다.
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  // 입력이 바뀌면 올려서, 그 전에 보낸 요청의 응답은 버린다.
  const version = useRef(0);

  // ── 미완료 업무 이월 (Supabase에 보관) ──
  const [ownerInput, setOwnerInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  // 이 PC에 이름·사번(PIN은 제외)을 기억할지. 기본은 기억하지 않는다. (공용 PC에서 다음 사람이 보지 못하게)
  const [rememberName, setRememberName] = useState(false);
  const pinRef = useRef<HTMLInputElement | null>(null);
  // 시간표 결과 영역. 결과가 만들어지면 이 영역으로 화면을 옮긴다.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const currentWho = () => makeWho(ownerInput, pinInput);
  const [carryRows, setCarryRows] = useState<CarryRow[]>([]);
  const [carryMsg, setCarryMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [carryBusy, setCarryBusy] = useState(false);
  const ownerRef = useRef<HTMLInputElement | null>(null);
  // 이행 체크가 바뀔 때마다 올려서 열려 있는 주간 리포트를 새로 읽게 한다
  const [reportKey, setReportKey] = useState(0);
  // 이행 기록 저장 실패 안내 (이월 안내와 따로 시간표 아래에 보여 준다)
  const [doneError, setDoneError] = useState<string | null>(null);
  // 이월·리포트 저장소(Supabase)가 설정되어 있지 않으면 true. 그때는 이름·사번 없이 시간표만 만들 수 있다.
  const [storageOff, setStorageOff] = useState(false);
  const storageOffRef = useRef(false);
  // 이월 확인 요청 번호. 이름·사번을 바꾸면 올려서, 늦게 온 이전 응답을 버린다.
  const checkSeq = useRef(0);
  // 이행 체크한 업무(이름|id). 시간표를 다시 만들어도 체크 상태와 보관 내용이 어긋나지 않게 기억한다.
  const doneRef = useRef<Set<string>>(new Set());
  // 시간표를 만들 때 저장소에 올린 업무의 보관 키와 이름·사번 (업무 id → 키). 업무를 지울 때 쓴다.
  const savedRef = useRef<Map<string, { key: string; owner: string }>>(new Map());

  function markStorageOff() {
    storageOffRef.current = true;
    setStorageOff(true);
  }

  async function carryCall(
    action: "list" | "save" | "remove" | "purge",
    who: string,
    payload: Record<string, unknown> = {},
  ) {
    const res = await fetch("/api/carryover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...splitWho(who), ...payload }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      if (data?.code === "not_configured") markStorageOff();
      throw new Error(data?.error ?? "이월 저장소 요청에 실패했습니다.");
    }
    return data;
  }

  /** "이 PC에 이름 기억하기"를 켠 경우에만 이름·사번(PIN 제외)을 브라우저에 저장하고, 끄면 지운다 */
  function rememberOwner(owner: string, on: boolean = rememberName) {
    try {
      if (on && owner) localStorage.setItem(OWNER_STORAGE_KEY, owner);
      else localStorage.removeItem(OWNER_STORAGE_KEY);
    } catch {
      // 저장이 막힌 브라우저(비공개 창 등)에서는 기억하지 못한다
    }
  }

  /** 이름·사번으로 지난번 못 한 업무가 있는지 확인한다. (채우는 것은 [가져오기]를 눌렀을 때) */
  async function checkCarry() {
    const who = currentWho();
    if (!validWho(who)) {
      setCarryMsg({ text: `이름 또는 사번과 PIN(${PIN_MIN_LENGTH}자 이상)을 입력해 주세요.`, error: true });
      return;
    }
    const mine = ++checkSeq.current;
    setCarryBusy(true);
    setCarryMsg(null);
    try {
      const data = await carryCall("list", who);
      if (checkSeq.current !== mine) return; // 그 사이 이름·사번이 바뀌었으면 이 응답은 버린다
      setCarryRows(data.tasks as CarryRow[]);
      if ((data.tasks as CarryRow[]).length === 0) {
        setCarryMsg({ text: "지난번 못 한 업무가 없습니다." });
      }
    } catch (e) {
      if (checkSeq.current !== mine) return;
      setCarryRows([]);
      setCarryMsg({ text: (e as Error).message, error: true });
    } finally {
      if (checkSeq.current === mine) setCarryBusy(false);
    }
  }

  // 접속할 때 저장소가 설정되어 있는지 확인한다. 없으면 이름·사번 없이도 시간표를 만들 수 있다.
  useEffect(() => {
    void fetch("/api/carryover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ping" }),
    })
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (data?.code === "not_configured") markStorageOff();
      })
      .catch(() => {
        // 확인하지 못해도 이후 저장·불러오기 때 다시 알게 된다
      });
  }, []);

  // "이 PC에 기억하기"를 켜 두었던 경우에만 이름·사번 칸을 미리 채운다. 자동으로 조회하지는 않는다(PIN을 입력해야 조회).
  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(OWNER_STORAGE_KEY) ?? "";
    } catch {
      return;
    }
    if (!saved) return;
    void (async () => {
      setOwnerInput(saved);
      setRememberName(true);
    })();
  }, []);

  /** 이 이름·사번·PIN으로 저장된 이월 업무와 이행 기록을 모두 지운다 (되돌릴 수 없음) */
  async function purgeAll() {
    const who = currentWho();
    if (!validWho(who)) {
      setCarryMsg({ text: `삭제하려면 이름 또는 사번과 PIN(${PIN_MIN_LENGTH}자 이상)을 입력해 주세요.`, error: true });
      return;
    }
    const ok = window.confirm(
      "이 이름·사번·PIN으로 저장된 이월 업무와 주간 이행 기록을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?",
    );
    if (!ok) return;
    try {
      await carryCall("purge", who);
      for (const k of [...doneRef.current]) if (k.startsWith(`${who}|`)) doneRef.current.delete(k);
      for (const [id, v] of [...savedRef.current]) if (v.owner === who) savedRef.current.delete(id);
      setCarryRows([]);
      setReportKey((k) => k + 1);
      setCarryMsg({ text: "저장된 기록을 모두 지웠습니다." });
    } catch (e) {
      setCarryMsg({ text: `삭제하지 못했습니다: ${(e as Error).message}`, error: true });
    }
  }

  /** 저장소의 이월 업무를 1번부터 채운다. 이미 입력 중인 업무는 그 뒤에 둔다. */
  function importCarry() {
    const imported = carryRows.map(rowToTask);
    const importedIds = new Set(imported.map((t) => t.id));
    const mine = tasks.filter((t) => !isEmptyTask(t) && !importedIds.has(t.id));
    // 합쳐서 15개를 넘으면 일부만 가져오지 않고 안내한다. (보관함에는 그대로 남는다)
    if (imported.length + mine.length > MAX_TASKS) {
      setCarryMsg({
        text:
          `가져오면 ${MAX_TASKS}개를 넘습니다. (보관 ${imported.length}개 + 입력 중 ${mine.length}개) ` +
          `입력 중인 업무를 정리한 뒤 가져오세요. 보관함에는 그대로 남아 있습니다.`,
        error: true,
      });
      return;
    }
    resetCheck();
    setTasks([...imported, ...mine]);
    setCarryRows([]);
    setCarryMsg({ text: `지난번 못 한 업무 ${imported.length}개를 1번부터 가져왔습니다.` });
  }

  // 저장·삭제 대상 이름·사번(owner)은 호출하는 쪽이 정한다. 시간표를 만든 뒤 입력칸이 바뀌어도
  // 그 시간표의 업무는 만들 때의 이름·사번 보관함으로만 저장된다. 성공하면 true.
  async function carrySave(list: Task[], date: string, owner: string = currentWho()): Promise<boolean> {
    if (!validWho(owner) || list.length === 0 || storageOffRef.current) return true;
    try {
      await carryCall("save", owner, { tasks: list.map((t) => taskToRow(t, date)) });
      setCarryMsg({ text: "못 한 업무를 이월 보관함에 저장했습니다. 완료 체크하면 보관함에서 지워집니다." });
      return true;
    } catch (e) {
      setCarryMsg({ text: `이월 저장에 실패했습니다: ${(e as Error).message}`, error: true });
      return false;
    }
  }

  async function carryRemove(ids: string[], owner: string = currentWho()): Promise<boolean> {
    if (!validWho(owner) || ids.length === 0 || storageOffRef.current) return true;
    try {
      await carryCall("remove", owner, { ids });
      return true;
    } catch (e) {
      setCarryMsg({ text: `이월 보관함에서 지우지 못했습니다: ${(e as Error).message}`, error: true });
      return false;
    }
  }

  // 이행 체크 요청을 한 줄로 세워 순서대로 처리한다. 빠르게 체크·해제해도 마지막 동작이 최종 상태가 된다.
  const toggleQueue = useRef<Promise<unknown>>(Promise.resolve());

  /** 시간표에서 이행 체크를 바꿀 때: 완료는 보관함에서 지우고, 체크를 풀면 다시 보관한다.
   *  저장에 실패하면 false를 돌려줘서 화면이 체크를 되돌린다. */
  function onToggleDone(id: string, done: boolean): Promise<boolean> {
    if (!result) return Promise.resolve(false);
    const t = result.tasks.find((x) => x.id === id);
    if (!t) return Promise.resolve(false);
    const { owner, date } = result; // 시간표를 만들 때의 이름·사번
    const run = async () => {
      const kept = done ? await carryRemove([rowKey(t, date)], owner) : await carrySave([t], date, owner);
      const recorded = await recordDone(t, date, done, owner);
      const ok = kept && recorded;
      if (ok) {
        // 체크 상태를 기억해 두면 시간표를 다시 만들어도 이미 한 업무가 보관함에 되돌아가지 않는다
        const key = `${owner}|${t.id}`;
        if (done) doneRef.current.add(key);
        else doneRef.current.delete(key);
      }
      return ok;
    };
    const next = toggleQueue.current.then(run, run);
    toggleQueue.current = next;
    return next;
  }

  /** 이행 기록에서 업무 한 건을 뺀다 (업무를 지웠을 때) */
  async function reportUndo(key: string, owner: string) {
    if (!validWho(owner) || storageOffRef.current) return;
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", ...splitWho(owner), ids: [key] }),
      });
      setReportKey((k) => k + 1);
    } catch {
      // 지우지 못해도 입력 화면에는 영향이 없다. 주간 리포트에서 다음에 다시 읽을 때 반영된다.
    }
  }

  /** 이행한 업무를 날짜·주 단위로 기록(체크)하거나 기록에서 뺀다(체크 해제). 주간 리포트가 읽는다. */
  async function recordDone(t: Task, date: string, done: boolean, owner: string): Promise<boolean> {
    if (!validWho(owner) || storageOffRef.current) return true;
    const row = taskToRow(t, date); // 업무 키는 시간표를 만든 날짜 기준
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          done
            ? {
                action: "done",
                ...splitWho(owner),
                date: localNow().slice(0, 10), // 이행 날짜는 체크한 날 (밤을 넘겨 체크해도 그날로 기록)
                tasks: [{ id: row.id, name: row.name, importance: row.importance, hours: row.hours, type: row.type }],
              }
            : { action: "undo", ...splitWho(owner), ids: [row.id] },
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "이행 기록 요청에 실패했습니다.");
      setReportKey((k) => k + 1);
      setDoneError(null);
      return true;
    } catch (e) {
      setDoneError(`이행 기록 저장에 실패했습니다: ${(e as Error).message}`);
      return false;
    }
  }

  const invalidIds = new Set(errors.flatMap((e) => e.taskIds));
  // 이름·사번을 비운 채 시간표를 만들려 했으면 입력칸을 빨갛게 표시한다
  const ownerMissing = errors.some((e) => e.message.startsWith("이름 또는 사번"));
  const pinMissing = errors.some((e) => e.message.startsWith("PIN"));

  // Design Ref: §2 새로고침 경고 — 입력이 하나라도 있으면 나갈 때 브라우저 확인창을 띄운다.
  // 브라우저는 직접 쓴 문구를 보여 주지 않으므로 기본 확인창을 쓴다. 저장은 하지 않는다.
  const hasInput = tasks.some((t) => !isEmptyTask(t));
  useEffect(() => {
    if (!hasInput) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasInput]);

  // 시간표가 만들어지면 결과가 화면 위쪽에 오도록 옮긴다. 입력 줄이 길어 결과가 화면 아래에 가려지는 것을 막는다.
  // 체크박스를 누를 때는 result가 바뀌지 않으므로 움직이지 않는다. "움직임 줄이기" 설정이면 애니메이션 없이 바로 이동한다.
  useEffect(() => {
    if (!result) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // 키보드·스크린리더 사용자는 결과로 초점도 함께 옮긴다 (스크롤은 위에서 이미 했으므로 다시 하지 않는다)
    resultRef.current?.focus({ preventScroll: true });
  }, [result]);

  // 입력이 바뀌면 이전 검사 결과는 지운다.
  function resetCheck() {
    version.current += 1;
    setDoneError(null);
    controller.current?.abort();
    setRetryable(false);
    setErrors([]);
    setResult(null);
    setRequestError(null);
    setLoading(false);
  }

  async function submit() {
    resetCheck();
    // 이름 또는 사번은 필수다: 못 한 업무를 다음 날 누구 것인지 알아보려면 필요하다.
    // (저장소가 설정되어 있지 않으면 저장할 곳이 없으므로 필수가 아니다)
    if (!storageOffRef.current && ownerInput.trim() === "") {
      setErrors([
        {
          taskIds: [],
          message: "이름 또는 사번을 입력해 주세요. (못 한 업무를 다음 날 불러오는 데 필요합니다)",
        },
      ]);
      ownerRef.current?.focus();
      return;
    }
    // PIN은 내 저장 기록을 다른 사람이 열어 보지 못하게 하는 비밀번호 역할이다
    if (!storageOffRef.current && pinInput.trim().length < PIN_MIN_LENGTH) {
      setErrors([
        {
          taskIds: [],
          message: `PIN을 ${PIN_MIN_LENGTH}자 이상 입력해 주세요. (내 저장 기록을 다른 사람이 보지 못하게 합니다)`,
        },
      ]);
      pinRef.current?.focus();
      return;
    }
    const work = parseWorkHours(workStart, workEnd);
    if (!work.ok) {
      setErrors([{ taskIds: [], message: work.message }]);
      return;
    }
    // 마감 기한의 분을 10분 단위로 맞추고, 입력칸에도 맞춘 값을 보여준다.
    // 맨 처음 줄의 id("task-1")는 고정값이라 날마다 같다. 보관 키가 겹치지 않도록 시간표를 만들 때 고유값으로 바꾼다.
    const snapped = tasks.map((t) => ({
      ...t,
      id: t.id === "task-1" ? crypto.randomUUID() : t.id,
      deadline: snapDeadline(t.deadline),
    }));
    if (snapped.some((t, i) => t.deadline !== tasks[i].deadline || t.id !== tasks[i].id)) setTasks(snapped);
    const owner = currentWho();
    const result = validateTasks(snapped, work.config);
    setErrors(result.errors);
    if (!result.ok) return;

    const myVersion = version.current;
    const now = localNow();
    setLoading(true);
    // 10초 안에 응답이 없으면 직접 끊는다. 입력한 내용은 그대로 남는다.
    const ctrl = new AbortController();
    controller.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/schedule", {
        signal: ctrl.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: result.tasks, now, work: { start: workStart, end: workEnd } }),
      });
      const data = await res.json();
      if (version.current !== myVersion) return;
      if (!data.ok) {
        setRequestError(data.error);
        setRetryable(res.status >= 500);
        return;
      }
      const nameOf = new Map(result.tasks.map((t) => [t.id, t.name.trim()]));
      const name = (id: string) => nameOf.get(id) ?? "";
      setResult({
        priority: data.priority.map((p: { id: string; reason: string; overdue: boolean }) => ({
          ...p,
          name: name(p.id),
        })),
        schedule: data.schedule.map(
          (s: { id: string; start: string; end: string; flag: ScheduleEntry["flag"] }) => ({
            id: s.id,
            name: name(s.id),
            start: s.start,
            end: s.end,
            flag: s.flag,
          }),
        ),
        unscheduled: (data.unscheduled as string[]).map(name),
        notice: data.notice,
        earliestStart: data.earliestStart,
        date: now.slice(0, 10),
        tasks: result.tasks,
        owner,
        doneIds: result.tasks.filter((t) => doneRef.current.has(`${owner}|${t.id}`)).map((t) => t.id),
      });
      // 아직 안 한 업무를 이 이름·사번의 보관함에 저장한다. 이미 이행 체크한 업무는 다시 넣지 않는다.
      if (validWho(owner)) {
        rememberOwner(splitWho(owner).owner);
        for (const t of result.tasks) {
          savedRef.current.set(t.id, { key: rowKey(t, now.slice(0, 10)), owner });
        }
      }
      void carrySave(
        result.tasks.filter((t) => !doneRef.current.has(`${owner}|${t.id}`)),
        now.slice(0, 10),
        owner,
      );
    } catch {
      if (version.current !== myVersion) return;
      setRequestError(FAIL_MESSAGE);
      setRetryable(true);
    } finally {
      clearTimeout(timer);
      if (version.current === myVersion) setLoading(false);
    }
  }

  const canAdd = tasks.length < MAX_TASKS;
  const isLast = tasks.length === 1;

  function addTask() {
    resetCheck();
    // 15개를 넘지 않도록 상태를 바꾸는 시점에도 한 번 더 막는다.
    setTasks((prev) =>
      prev.length >= MAX_TASKS
        ? prev
        : [...prev, createEmptyTask(crypto.randomUUID())],
    );
  }

  function updateTask(updated: Task) {
    resetCheck();
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function removeTask(id: string) {
    // 지운 업무는 보관함과 이행 기록에서도 뺀다. (시간표를 만든 뒤 지우면 그때 저장된 키로, 가져온 업무는 자기 키로)
    // 시간표 결과가 이미 지워진 뒤(입력을 고친 직후 등)에도 저장된 키를 찾을 수 있게 따로 기억해 둔다
    const saved = savedRef.current.get(id);
    if (saved) {
      void carryRemove([saved.key], saved.owner);
      void reportUndo(saved.key, saved.owner);
      doneRef.current.delete(`${saved.owner}|${id}`);
      savedRef.current.delete(id);
    } else if (id.startsWith(CARRY_PREFIX)) {
      void carryRemove([id]);
    }
    resetCheck();
    setTasks((prev) =>
      prev.length === 1
        ? [createEmptyTask(crypto.randomUUID())] // 가져온 업무의 보관 키를 빈 줄이 물려받지 않게 새 id를 준다
        : prev.filter((t) => t.id !== id),
    );
  }

  return (
    <section className="mt-8 flex flex-col gap-3">
      <h2 className="section-title text-lg">오늘 할 업무</h2>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        <span className="text-red-600">*</span> 표시는 필수 항목입니다.
      </p>

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="carry-owner" className="font-medium">
            이름 또는 사번
            {!storageOff && (
              <span className="ml-0.5 text-red-600" aria-label="필수">
                *
              </span>
            )}
          </label>
          <input
            id="carry-owner"
            ref={ownerRef}
            required={!storageOff}
            aria-invalid={ownerMissing}
            type="text"
            value={ownerInput}
            maxLength={OWNER_MAX_LENGTH}
            placeholder="예: 홍길동 또는 12345"
            onChange={(e) => {
              setOwnerInput(e.target.value);
              checkSeq.current += 1; // 이전 이름·사번으로 보낸 이월 확인의 응답은 버린다
              setCarryBusy(false);
              setCarryRows([]);
              setCarryMsg(null);
              if (ownerMissing) setErrors([]); // 입력을 시작하면 "이름을 입력해 주세요" 안내를 지운다
              if (rememberName) rememberOwner(e.target.value.trim(), true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void checkCarry();
            }}
            className={`rounded-md border bg-transparent px-2 py-1 ${
              ownerMissing ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
            }`}
          />
          <label htmlFor="carry-pin" className="font-medium">
            PIN
            {!storageOff && (
              <span className="ml-0.5 text-red-600" aria-label="필수">
                *
              </span>
            )}
          </label>
          <input
            id="carry-pin"
            ref={pinRef}
            required={!storageOff}
            aria-invalid={pinMissing}
            type="password"
            autoComplete="off"
            value={pinInput}
            minLength={PIN_MIN_LENGTH}
            maxLength={PIN_MAX_LENGTH}
            placeholder={`${PIN_MIN_LENGTH}자 이상`}
            onChange={(e) => {
              setPinInput(e.target.value);
              checkSeq.current += 1;
              setCarryBusy(false);
              setCarryRows([]);
              setCarryMsg(null);
              if (pinMissing) setErrors([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void checkCarry();
            }}
            className={`w-32 rounded-md border bg-transparent px-2 py-1 ${
              pinMissing ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"
            }`}
          />
          <button
            type="button"
            onClick={() => void checkCarry()}
            disabled={carryBusy || storageOff}
            className="rounded-md border border-zinc-400 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-600"
          >
            {carryBusy ? "확인 중…" : "이월 업무 확인"}
          </button>
        </div>
        {storageOff ? (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
            저장소가 설정되어 있지 않아 못 한 업무 이월과 주간 리포트는 쓸 수 없습니다. 시간표는 이름·사번 없이 만들 수 있습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              체크하지 않은 업무는 다음에 같은 이름·사번·PIN을 입력하면 가져올 수 있습니다. PIN은 저장되지 않아 잊으면 찾을 수 없습니다.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <label className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={rememberName}
                  onChange={(e) => {
                    setRememberName(e.target.checked);
                    rememberOwner(ownerInput.trim(), e.target.checked);
                  }}
                />
                이 PC에 이름·사번 기억하기 (공용 PC에서는 끄세요)
              </label>
              <button
                type="button"
                onClick={() => void purgeAll()}
                className="text-red-700 underline underline-offset-2 dark:text-red-300"
              >
                내 저장 기록 모두 삭제
              </button>
            </div>
          </div>
        )}
        {carryRows.length > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md bg-sky-50 p-2 text-sky-900 dark:bg-sky-950 dark:text-sky-100">
            <span>지난번 못 한 업무가 {carryRows.length}개 있습니다.</span>
            <button
              type="button"
              onClick={importCarry}
              className="rounded-md border border-sky-500 px-3 py-1 text-xs font-medium"
            >
              가져오기
            </button>
          </div>
        )}
        {carryMsg && carryMsg.text && (
          <p
            role="status"
            className={carryMsg.error ? "text-xs text-red-700 dark:text-red-300" : "text-xs text-zinc-700 dark:text-zinc-300"}
          >
            {carryMsg.text}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
        <span className="font-medium">근무 시간</span>
        <TimeSelect
          label="근무 시작 시각"
          value={workStart}
          onChange={(v) => {
            resetCheck();
            setWorkStart(v);
          }}
        />
        <span>~</span>
        <TimeSelect
          label="근무 종료 시각"
          value={workEnd}
          onChange={(v) => {
            resetCheck();
            setWorkEnd(v);
          }}
        />
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          점심 12:00~13:00 (고정) · 기본 09:00~18:00
        </span>
      </div>

      {tasks.map((task, i) => (
        <TaskRow
          key={task.id}
          task={task}
          index={i + 1}
          removeLabel={isLast ? "비우기" : "삭제"}
          invalid={invalidIds.has(task.id)}
          onChange={updateTask}
          onRemove={() => removeTask(task.id)}
        />
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addTask}
          disabled={!canAdd}
          className="rounded-md border border-zinc-400 px-4 py-2 text-sm disabled:opacity-40 dark:border-zinc-600"
        >
          + 업무 추가
        </button>
        <span className="text-sm" aria-live="polite">
          {tasks.length} / {MAX_TASKS}개
        </span>
        {!canAdd && (
          <span className="text-xs text-red-600">
            업무는 최대 {MAX_TASKS}개까지 입력할 수 있습니다.
          </span>
        )}
      </div>

      {errors.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
        >
          {errors.map((e, i) => (
            <li key={i}>• {e.message}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={loading}
        className="w-fit rounded-md bg-navy px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "만드는 중…" : "시간표 만들기"}
      </button>

      {requestError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-700 dark:text-red-300">
          <span className="whitespace-pre-line">{requestError}</span>
          {retryable && (
            <button
              type="button"
              onClick={submit}
              className="rounded-md border border-red-400 px-3 py-1.5 text-sm"
            >
              다시 시도
            </button>
          )}
        </div>
      )}
      {result && (
        <div ref={resultRef} tabIndex={-1} className="flex scroll-mt-4 flex-col gap-6 outline-none">
          <PriorityResult items={result.priority} />
          <ScheduleResult
            key={result.schedule.map((s) => `${s.id}@${s.start}`).join(",") + result.date}
            schedule={result.schedule}
            unscheduled={result.unscheduled}
            notice={result.notice}
            earliestStart={result.earliestStart}
            date={result.date}
            onToggleDone={onToggleDone}
            initialDoneIds={result.doneIds}
          />
          {doneError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {doneError}
            </p>
          )}
        </div>
      )}

      {!storageOff && <WeeklyReport owner={ownerInput} pin={pinInput} refreshKey={reportKey} />}
    </section>
  );
}
