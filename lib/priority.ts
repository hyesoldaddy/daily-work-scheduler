// Design Ref: §2 데이터 흐름 ① 우선순위 — PRD must ① 규칙 1~4번을 코드로도 가지고 있다 (PLAN 작업 7)
// 순서는 이 파일의 코드가 규칙대로 정하고(sortByRules), AI는 업무마다 이유 문구만 쓴다. verifyPriority는 정한 순서와 이유가 규칙을 지켰는지 검산한다.
import type { Task } from "./types";

/** 마감까지 이 시간(분) 이하면 1순위 그룹 (PRD must ① 규칙 1번: 4시간 이내) */
export const URGENT_MINUTES = 4 * 60;

export const REASON_MAX_LENGTH = 30;

const IMPORTANCE_RANK = { 상: 0, 중: 1, 하: 2 } as const;

export type PreparedTask = {
  id: string;
  name: string;
  importance: "상" | "중" | "하";
  /** 마감 기한 문구 "YYYY-MM-DDTHH:mm" 또는 null */
  deadline: string | null;
  /** 마감까지 남은 분. 마감이 없으면 null, 이미 지났으면 음수 */
  minutesUntilDeadline: number | null;
  overdue: boolean;
  urgent: boolean;
};

export type PriorityItem = { id: string; reason: string };

/** "YYYY-MM-DDTHH:mm"을 시간대 없이 '분' 숫자로 바꾼다. (현재 시각과 마감이 같은 기준이면 차이만 맞으면 된다) */
export function localStringToMinutes(s: string): number {
  const [date, time] = s.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

export function prepareTasks(tasks: Task[], now: string): PreparedTask[] {
  const nowMin = localStringToMinutes(now);
  return tasks.map((t) => {
    const deadline = t.deadline === "" ? null : t.deadline;
    const minutesUntilDeadline =
      deadline === null ? null : localStringToMinutes(deadline) - nowMin;
    const overdue = minutesUntilDeadline !== null && minutesUntilDeadline < 0;
    const urgent =
      minutesUntilDeadline !== null &&
      minutesUntilDeadline >= 0 &&
      minutesUntilDeadline <= URGENT_MINUTES;
    return {
      id: t.id,
      name: t.name.trim(),
      importance: t.importance as "상" | "중" | "하",
      deadline,
      minutesUntilDeadline,
      overdue,
      urgent,
    };
  });
}

/**
 * PRD must ① 규칙 1~4번의 정렬 키.
 * 그룹 0(기한 지남) → 그룹 1(4시간 이내) → 그룹 2(그 외)
 * 그룹 0·1: 마감 빠른 순, 같으면 중요도 높은 순
 * 그룹 2: 중요도(상→중→하), 같으면 마감 빠른 순(마감 없으면 맨 뒤)
 */
function sortKey(t: PreparedTask): [number, number, number] {
  const group = t.overdue ? 0 : t.urgent ? 1 : 2;
  const deadline = t.minutesUntilDeadline ?? Number.POSITIVE_INFINITY;
  const importance = IMPORTANCE_RANK[t.importance];
  return group < 2 ? [group, deadline, importance] : [group, importance, deadline];
}

export function compare(a: PreparedTask, b: PreparedTask): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < 3; i++) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 정한 순서와 이유를 검산한다. 문제가 없으면 null, 있으면 사유 문구를 돌려준다.
 * (같은 조건끼리는 어느 쪽이 먼저여도 통과)
 */
export function verifyPriority(
  order: PriorityItem[],
  prepared: PreparedTask[],
): string | null {
  const byId = new Map(prepared.map((t) => [t.id, t]));

  // 모든 업무가 정확히 한 번씩, 없는 업무는 없음 (규칙 6번)
  if (order.length !== prepared.length) return "업무 개수가 맞지 않습니다";
  const seen = new Set<string>();
  for (const item of order) {
    if (!byId.has(item.id)) return "입력에 없는 업무가 포함되었습니다";
    if (seen.has(item.id)) return "같은 업무가 두 번 나왔습니다";
    seen.add(item.id);
    // 이유는 30자 이내 (규칙 5번)
    if (item.reason.trim() === "" || [...item.reason].length > REASON_MAX_LENGTH) {
      return "이유가 비었거나 30자를 넘습니다";
    }
  }

  // 정렬 규칙 1~4번
  for (let i = 0; i + 1 < order.length; i++) {
    const a = byId.get(order[i].id)!;
    const b = byId.get(order[i + 1].id)!;
    if (compare(a, b) > 0) return "정렬 규칙에 맞지 않는 순서입니다";
  }
  return null;
}

/** AI가 실패했을 때 쓰는 대체 정렬: PRD must ① 규칙 1~4번을 코드가 그대로 적용한다. (같으면 입력 순서 유지) */
export function sortByRules(prepared: PreparedTask[]): PreparedTask[] {
  return prepared
    .map((t, i) => ({ t, i }))
    .sort((a, b) => compare(a.t, b.t) || a.i - b.i)
    .map((x) => x.t);
}

/** 대체 정렬에서 쓰는 이유 문구 (30자 이내) */
export function fallbackReason(t: PreparedTask): string {
  if (t.overdue) return "마감 기한이 지나 가장 먼저 처리";
  if (t.urgent) return "마감까지 4시간 이내라 먼저 처리";
  if (t.minutesUntilDeadline === null) return `중요도 ${t.importance}, 마감 없음`;
  return `중요도 ${t.importance}, 마감이 가까운 순`;
}
