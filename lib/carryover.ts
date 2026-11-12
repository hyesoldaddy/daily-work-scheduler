// 미완료 업무 이월 (다음 날로 넘기기)의 화면·서버 공통 규칙
// 저장소: Supabase 테이블 carryover_tasks (supabase/carryover.sql). 서버(API)만 접근한다.
import type { Importance, Task, TaskType } from "./types";

/** 이월 저장소에 있는 업무의 id는 항상 이 글자로 시작한다. (가져온 업무와 새로 입력한 업무를 구분) */
export const CARRY_PREFIX = "co:";
export const OWNER_MAX_LENGTH = 30;

/** 이름·사번 입력값을 같은 사람이면 같은 값이 되도록 정리한다 (앞뒤 공백 제거, 대소문자 무시) */
export function normalizeOwner(raw: string): string {
  return raw.trim().normalize("NFC").toLowerCase();
}

/** 저장소에서 이 업무를 가리키는 키. 새 업무는 날짜를 붙여 다른 날의 업무와 겹치지 않게 한다. */
export function rowKey(task: Task, date: string): string {
  return task.id.startsWith(CARRY_PREFIX) ? task.id : `${CARRY_PREFIX}${date}:${task.id}`;
}

/** 저장소에 보관되는 한 줄 (서버·화면이 주고받는 모양) */
export type CarryRow = {
  id: string;
  name: string;
  importance: Importance | "";
  hours: string;
  type: TaskType;
  deadline: string;
  fixedTime: string;
};

export function taskToRow(task: Task, date: string): CarryRow {
  return {
    id: rowKey(task, date),
    name: task.name.trim(),
    importance: task.importance,
    hours: task.hours,
    type: task.type,
    deadline: task.deadline,
    fixedTime: task.fixedTime,
  };
}

export function rowToTask(row: CarryRow): Task {
  return { ...row };
}
