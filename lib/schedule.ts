// Design Ref: §2 데이터 흐름 ② 시간표 — PRD must ② 규칙을 코드로 검산한다 (PLAN 작업 9)
// 시간표는 이 파일의 코드가 PRD must ② 규칙대로 배치하고(buildFallbackSchedule), 규칙을 지켰는지 검산한다(verifySchedule). AI는 시간표에 관여하지 않는다.
// 휴식 시간은 자동으로 넣지 않는다.
// 모든 시각은 "오늘 자정부터 몇 분째인지" 정수로 다룬다. (시간대 문제를 피하기 위해)
import type { Task, TaskType } from "./types";
import { localStringToMinutes } from "./priority";
import { DEFAULT_WORK_CONFIG, formatMinutes, type WorkConfig } from "./validate";

/** 업무 시작·끝은 30분 단위 (PRD must ② 규칙 1번) */
export const SLOT = 30;
const MINUTES_PER_DAY = 24 * 60;

export type ScheduleTask = {
  id: string;
  name: string;
  type: TaskType;
  minutes: number;
  /** 고정 시작 시각(분). 없으면 null */
  fixedStart: number | null;
  /** 고정 시작 시각이 아직 지나지 않았고 근무 시작 이후인가 (정각·30분에 딱 맞는 현재 시각이면 그 시각도 배치 가능) */
  fixedOk: boolean;
  /** 마감 시각(오늘 자정 기준 분, 내일 이후면 1440 이상, 지났으면 음수). 없으면 null */
  deadline: number | null;
  overdue: boolean;
};

export type Timetable = {
  schedule: { id: string; start: string; end: string }[];
  unscheduled: string[];
};

export type ScheduleItem = {
  kind: "업무";
  id: string;
  start: string;
  end: string;
  /** "기한 지남" | "기한 초과 예상" | null */
  flag: "기한 지남" | "기한 초과 예상" | null;
};

type Item = { id: string; start: number; end: number; fixed: boolean };

function ceilTo(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function parseHHmm(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 오늘 자정 기준 분으로 바꾼 현재 시각과 첫 배치 가능 시각 */
export function getClock(now: string, cfg: WorkConfig = DEFAULT_WORK_CONFIG) {
  const dayStart = localStringToMinutes(`${now.slice(0, 10)}T00:00`);
  const nowMin = localStringToMinutes(now) - dayStart;
  // PRD must ② 규칙 2번: 현재 시각 다음의 30분 단위 시각(14:10 → 14:30), 근무 시작 전이면 근무 시작
  // 근무 시간은 10분 단위로 정할 수 있지만 시간표 칸은 30분 단위이므로 30분 칸에 맞춰 올린다.
  const earliest = ceilTo(Math.max(cfg.workStart, Math.floor(nowMin / SLOT) * SLOT + SLOT), SLOT);
  return { dayStart, nowMin, earliest };
}

export function prepareScheduleTasks(
  orderedTasks: Task[],
  now: string,
  cfg: WorkConfig = DEFAULT_WORK_CONFIG,
): { tasks: ScheduleTask[]; earliest: number } {
  const { dayStart, nowMin, earliest } = getClock(now, cfg);
  const tasks = orderedTasks.map((t): ScheduleTask => {
    const fixedStart =
      t.fixedTime === "" ? null : Number(t.fixedTime.slice(0, 2)) * 60 + Number(t.fixedTime.slice(3, 5));
    const deadline =
      t.deadline === "" ? null : localStringToMinutes(t.deadline) - dayStart;
    return {
      id: t.id,
      name: t.name.trim(),
      type: t.type,
      minutes: Math.round(Number(t.hours) * 60),
      fixedStart,
      fixedOk: fixedStart !== null && fixedStart >= Math.max(nowMin, cfg.workStart),
      deadline,
      overdue: deadline !== null && deadline < nowMin,
    };
  });
  return { tasks, earliest };
}

/**
 * 단순·협업 업무도 오전에 둘 수 있는 경우: 오후에 시작하면 마감을 못 지키는 업무.
 * (PRD 충돌 순서: 마감 기한 > 업무 유형)
 */
function mayUseMorning(t: ScheduleTask, cfg: WorkConfig): boolean {
  if (t.fixedStart !== null) return true; // 고정 시간 > 업무 유형
  return t.deadline !== null && (t.overdue || t.deadline < cfg.lunchEnd + t.minutes);
}

/** 이 업무가 지금 배치(others) 사이 어딘가에 들어갈 자리가 있는가 */
function findSlot(
  task: ScheduleTask,
  others: Item[],
  earliest: number,
  cfg: WorkConfig,
  morningOnly: boolean,
): number | null {
  if (task.fixedStart !== null) return null;
  for (let s = ceilTo(earliest, SLOT); s + task.minutes <= cfg.workEnd; s += SLOT) {
    const e = s + task.minutes;
    if (morningOnly && e > cfg.lunchStart) break;
    if (s < cfg.lunchEnd && e > cfg.lunchStart) continue; // 점심시간과 겹침
    if (task.type !== "집중" && s < cfg.lunchEnd && !mayUseMorning(task, cfg)) continue; // 단순·협업은 오후만(마감 때문에 어쩔 수 없는 경우 제외)
    const ok = others.every((o) => {
      return o.end <= s || o.start >= e; // 겹치지만 않으면 된다
    });
    if (ok) return s;
  }
  return null;
}

function canFit(
  task: ScheduleTask,
  others: Item[],
  earliest: number,
  cfg: WorkConfig,
  morningOnly: boolean,
): boolean {
  return findSlot(task, others, earliest, cfg, morningOnly) !== null;
}

/**
 * 시간표를 검산한다. 문제가 없으면 null, 있으면 어디가 문제인지 한 줄로 돌려준다.
 * (PRD must ② 규칙 1~8번 + 규칙 9번 "나누지 않음")
 */
export function verifySchedule(
  ai: Timetable,
  tasks: ScheduleTask[],
  earliest: number,
  cfg: WorkConfig = DEFAULT_WORK_CONFIG,
): string | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // 모든 업무가 시간표 또는 처리 불가에 정확히 한 번씩
  const seen = new Set<string>();
  for (const id of [...ai.schedule.map((s) => s.id), ...ai.unscheduled]) {
    if (!byId.has(id)) return "입력에 없는 업무가 들어 있습니다";
    if (seen.has(id)) return `같은 업무가 두 번 나왔습니다 (${byId.get(id)!.name})`;
    seen.add(id);
  }
  if (seen.size !== tasks.length) return "시간표나 처리 불가 목록에서 빠진 업무가 있습니다";

  const items: Item[] = [];
  for (const s of ai.schedule) {
    const t = byId.get(s.id)!;
    const start = parseHHmm(s.start);
    const end = parseHHmm(s.end);
    const label = `'${t.name}'`;
    if (start === null || end === null) return `${label}의 시각 형식이 올바르지 않습니다`;
    if (start % SLOT !== 0 || end % SLOT !== 0) return `${label}이(가) 30분 단위가 아닙니다`;
    if (end - start !== t.minutes) return `${label}의 길이가 소요 시간(${t.minutes}분)과 다릅니다 (나누거나 늘리면 안 됩니다)`;
    if (t.fixedStart === null ? start < earliest : !t.fixedOk) {
      return `${label}이(가) 현재 시각 이후(${formatMinutes(earliest)}부터)가 아닙니다`;
    }
    if (start < cfg.workStart || end > cfg.workEnd) return `${label}이(가) 근무 시간 밖입니다`;
    if (start < cfg.lunchEnd && end > cfg.lunchStart) return `${label}이(가) 점심시간과 겹칩니다`;
    if (t.fixedStart !== null && start !== t.fixedStart) {
      return `${label}은(는) 고정 시간 ${formatMinutes(t.fixedStart)}에 시작해야 합니다`;
    }
    if (t.type !== "집중" && start < cfg.lunchEnd && !mayUseMorning(t, cfg)) {
      return `${label}은(는) ${t.type} 업무라 ${formatMinutes(cfg.lunchEnd)} 이후에만 배치할 수 있습니다`;
    }
    items.push({ id: t.id, start, end, fixed: t.fixedStart !== null });
  }

  // 겹침: 시작 순으로 보며 인접한 업무가 겹치는지 확인
  items.sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < items.length; i++) {
    const a = items[i];
    const b = items[i + 1];
    if (b.start < a.end) {
      return `'${byId.get(a.id)!.name}'과(와) '${byId.get(b.id)!.name}'이(가) 겹칩니다`;
    }
  }

  // 처리 불가 목록: 고정 시간이 이미 지난 경우만, 또는 정말 들어갈 자리가 없는 경우만
  for (const id of ai.unscheduled) {
    const t = byId.get(id)!;
    if (t.fixedStart !== null) {
      if (t.fixedOk) return `고정 시간 업무 '${t.name}'을(를) 빼면 안 됩니다`;
      continue;
    }
    if (canFit(t, items, earliest, cfg, false)) {
      return `'${t.name}'이(가) 들어갈 자리가 있는데 처리 불가로 뺐습니다`;
    }
  }

  // 집중 업무는 오전에 자리가 있으면 오전에
  for (const it of items) {
    const t = byId.get(it.id)!;
    if (t.type === "집중" && t.fixedStart === null && it.start >= cfg.lunchEnd) {
      const others = items.filter((o) => o.id !== it.id);
      if (canFit(t, others, earliest, cfg, true)) {
        return `집중 업무 '${t.name}'은(는) 오전에 자리가 있으므로 오전에 배치해야 합니다`;
      }
    }
  }
  return null;
}

/** 검산을 통과한 시간표에 마감 표시를 붙여 화면용 목록으로 만든다 */
export function buildScheduleItems(ai: Timetable, tasks: ScheduleTask[]): ScheduleItem[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const placed = ai.schedule
    .map((s) => ({ t: byId.get(s.id)!, start: parseHHmm(s.start)!, end: parseHHmm(s.end)! }))
    .sort((a, b) => a.start - b.start);

  const out: ScheduleItem[] = [];
  placed.forEach((p) => {
    const flag =
      p.t.deadline === null
        ? null
        : p.t.overdue
          ? "기한 지남"
          : p.end > p.t.deadline
            ? "기한 초과 예상"
            : null;
    out.push({
      kind: "업무",
      id: p.t.id,
      start: formatMinutes(p.start),
      end: formatMinutes(p.end),
      flag,
    });

  });
  return out;
}

/**
 * 마감을 지킬 수 있는 업무(마감이 있고 아직 안 지남) 중 마감을 놓친 업무 수.
 * - 배치됐는데 끝 시각이 마감을 넘으면 놓친 것
 * - 오늘 못 한 것(처리 불가)은 마감이 오늘일 때만 놓친 것. 마감이 내일 이후면 나중에 해도 되므로 세지 않는다.
 */
export function countDeadlineMisses(result: Timetable, tasks: ScheduleTask[]): number {
  const end = new Map(result.schedule.map((s) => [s.id, parseHHmm(s.end)!]));
  let misses = 0;
  for (const t of tasks) {
    if (t.deadline === null || t.overdue) continue;
    const e = end.get(t.id);
    if (e === undefined ? t.deadline < MINUTES_PER_DAY : e > t.deadline) misses++;
  }
  return misses;
}

function placeInOrder(
  tasks: ScheduleTask[],
  earliest: number,
  cfg: WorkConfig,
): Timetable {
  const items: Item[] = [];
  const unscheduled: string[] = [];

  for (const t of tasks) {
    if (t.fixedStart === null) continue;
    if (!t.fixedOk) unscheduled.push(t.id); // 이미 지난 고정 시간
    else items.push({ id: t.id, start: t.fixedStart, end: t.fixedStart + t.minutes, fixed: true });
  }
  for (const t of tasks) {
    if (t.fixedStart !== null) continue;
    const start =
      (t.type === "집중" ? findSlot(t, items, earliest, cfg, true) : null) ??
      findSlot(t, items, earliest, cfg, false);
    if (start === null) unscheduled.push(t.id);
    else items.push({ id: t.id, start, end: start + t.minutes, fixed: false });
  }

  return {
    schedule: items
      .sort((a, b) => a.start - b.start)
      .map((i) => ({ id: i.id, start: formatMinutes(i.start), end: formatMinutes(i.end) })),
    unscheduled,
  };
}

/**
 * 시간표 배치 (PLAN 작업 9). 코드가 직접 배치한다.
 * 고정 시간 업무를 먼저 놓고, 나머지는 "규칙을 지키는 가장 이른 빈 자리"에 넣는다. verifySchedule을 항상 통과한다.
 * 놓는 순서를 세 가지로 해 보고 가장 나은 결과를 고른다.
 *  ① 우선순위 순서 그대로
 *  ② 마감을 지킬 수 있는 업무를 마감 빠른 순으로 먼저, 나머지는 우선순위 순서
 *  ③ 마감이 오늘인 업무만 마감 빠른 순으로 먼저, 나머지(내일 이후 마감 포함)는 우선순위 순서
 * 고르는 기준: 놓친 마감이 적은 쪽 → 처리 불가가 된 업무가 우선순위상 더 뒤쪽인 쪽 → ①②③ 순
 */
export function buildFallbackSchedule(
  tasks: ScheduleTask[],
  earliest: number,
  cfg: WorkConfig = DEFAULT_WORK_CONFIG,
): Timetable {
  const feasible = (t: ScheduleTask) => t.deadline !== null && !t.overdue;
  const byDeadline = (a: ScheduleTask, b: ScheduleTask) => a.deadline! - b.deadline!;
  const withFirst = (first: ScheduleTask[]) => [...first, ...tasks.filter((t) => !first.includes(t))];

  const orders = [
    tasks,
    withFirst(tasks.filter(feasible).sort(byDeadline)),
    withFirst(tasks.filter((t) => feasible(t) && t.deadline! < MINUTES_PER_DAY).sort(byDeadline)),
  ];
  // 점수: [놓친 마감 수, 우선순위 순서대로 본 처리 불가 여부(앞쪽 업무가 빠질수록 나쁨)]
  const score = (r: Timetable): number[] => [
    countDeadlineMisses(r, tasks),
    ...tasks.map((t) => (r.unscheduled.includes(t.id) ? 1 : 0)),
  ];
  const better = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };
  let best = placeInOrder(orders[0], earliest, cfg);
  let bestScore = score(best);
  for (const order of orders.slice(1)) {
    const r = placeInOrder(order, earliest, cfg);
    const sc = score(r);
    if (better(sc, bestScore)) {
      best = r;
      bestScore = sc;
    }
  }
  return best;
}
