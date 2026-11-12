// Design Ref: §3 파일 구성 — 입력 확인 규칙 (화면·서버가 같이 사용, PLAN 작업 5)
// PRD 5번 예외 상황: 개수(1~15), 고정 시간 겹침, 점심·근무 외 고정 시간, 필수 항목 누락
import type { Task } from "./types";
import { TIME_RE } from "./patterns";

export const MAX_TASKS = 15;

/** 근무·점심 시간. 분 단위(자정부터 몇 분째인지). nice 14번에서 값을 바꿔 넘길 수 있게 인자로 받는다. */
export type WorkConfig = {
  workStart: number;
  workEnd: number;
  lunchStart: number;
  lunchEnd: number;
};

export const DEFAULT_WORK_CONFIG: WorkConfig = {
  workStart: 9 * 60,
  workEnd: 18 * 60,
  lunchStart: 12 * 60,
  lunchEnd: 13 * 60,
};

export type ValidationError = {
  /** 문제가 있는 업무의 id. 업무 전체에 대한 오류(개수 등)는 없음 */
  taskIds: string[];
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationError[];
  /** 완전히 빈 줄을 뺀 업무 목록 */
  tasks: Task[];
};

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutes(min: number): string {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** 아무것도 입력하지 않은 줄(유형은 기본값 그대로) */
export function isEmptyTask(t: Task): boolean {
  return (
    t.name.trim() === "" &&
    t.importance === "" &&
    t.deadline === "" &&
    t.hours === "" &&
    t.type === "단순" &&
    t.fixedTime === ""
  );
}

export function validateTasks(
  allTasks: Task[],
  config: WorkConfig = DEFAULT_WORK_CONFIG,
): ValidationResult {
  const tasks = allTasks.filter((t) => !isEmptyTask(t));
  const errors: ValidationError[] = [];

  // 1. 개수
  if (tasks.length < 1 || tasks.length > MAX_TASKS) {
    errors.push({
      taskIds: [],
      message: "업무는 1개 이상 15개 이하로 입력해 주세요",
    });
    return { ok: false, errors, tasks };
  }

  // 2. 필수 항목 누락 (번호는 빈 줄을 뺀 목록이 아니라 화면에 보이는 줄 번호)
  const numberOf = (t: Task) => allTasks.indexOf(t) + 1;
  for (const t of tasks) {
    const missing: string[] = [];
    if (t.name.trim() === "") missing.push("업무명");
    if (t.importance === "") missing.push("중요도");
    if (t.hours === "") missing.push("예상 소요 시간");
    if (missing.length > 0) {
      errors.push({
        taskIds: [t.id],
        message: `${numberOf(t)}번 업무: ${missing.join(", ")}을(를) 입력해 주세요`,
      });
    }
  }

  // 3. 고정 시간: 근무·점심 시간 확인 (소요 시간이 있는 업무만 구간으로 계산)
  type Fixed = { task: Task; start: number; end: number };
  const fixed: Fixed[] = [];
  for (const t of tasks) {
    if (t.fixedTime === "") continue;
    if (toMinutes(t.fixedTime) % 30 !== 0) {
      errors.push({
        taskIds: [t.id],
        message: `${numberOf(t)}번 업무: 시작 시각 지정은 30분 단위(예: 14:00, 14:30)로 입력해 주세요`,
      });
      continue;
    }
    if (t.hours === "") continue;
    const start = toMinutes(t.fixedTime);
    const end = start + Math.round(Number(t.hours) * 60);
    const range = `${formatMinutes(start)}~${formatMinutes(end)}`;

    if (start < config.workStart || end > config.workEnd) {
      errors.push({
        taskIds: [t.id],
        message: `${numberOf(t)}번 업무: 시작 시각 지정 ${range}이(가) 근무 시간(${formatMinutes(config.workStart)}~${formatMinutes(config.workEnd)}) 밖입니다`,
      });
      continue;
    }
    if (start < config.lunchEnd && end > config.lunchStart) {
      errors.push({
        taskIds: [t.id],
        message: `${numberOf(t)}번 업무: 시작 시각 지정 ${range}이(가) 점심시간(${formatMinutes(config.lunchStart)}~${formatMinutes(config.lunchEnd)})과 겹칩니다`,
      });
      continue;
    }
    fixed.push({ task: t, start, end });
  }

  // 4. 고정 시간끼리 겹침 (시작~끝 구간 기준)
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i];
      const b = fixed[j];
      if (a.start < b.end && b.start < a.end) {
        const at = formatMinutes(Math.max(a.start, b.start));
        errors.push({
          taskIds: [a.task.id, b.task.id],
          message: `${at}에 시작 시각이 지정된 업무가 2개 겹칩니다 (${numberOf(a.task)}번, ${numberOf(b.task)}번)`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, tasks };
}

/**
 * 화면에서 입력한 근무 시작·종료 시각("HH:mm")을 검사해 WorkConfig로 만든다. (PLAN nice 14번)
 * 점심시간(12:00~13:00)은 고정이다. 시각은 10분 단위여야 하고 시작이 종료보다 빨라야 한다.
 */
export function parseWorkHours(
  start: string,
  end: string,
): { ok: true; config: WorkConfig } | { ok: false; message: string } {
  const message = "근무 시간은 10분 단위로 입력하고, 시작이 종료보다 빨라야 합니다";
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { ok: false, message };
  const workStart = toMinutes(start);
  const workEnd = toMinutes(end);
  if (workStart % 10 !== 0 || workEnd % 10 !== 0 || workStart >= workEnd) {
    return { ok: false, message };
  }
  return {
    ok: true,
    config: { ...DEFAULT_WORK_CONFIG, workStart, workEnd },
  };
}

/**
 * 마감 기한("YYYY-MM-DDTHH:mm")의 분을 가장 가까운 10분 단위로 맞춘다. (예: 10:46 → 10:50, 10:56 → 11:00)
 * 브라우저 기본 날짜·시간 입력칸은 분을 아무 값이나 직접 입력할 수 있어서, 입력이 끝났을 때 맞춰 준다.
 */
export function snapDeadline(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return value;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, Math.round(mi / 10) * 10));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`;
}
