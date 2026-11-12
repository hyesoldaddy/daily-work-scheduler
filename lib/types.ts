// Design Ref: §3 파일 구성 — 업무 입력의 모양 정의 (PLAN 작업 3)

export type Importance = "상" | "중" | "하";
export type TaskType = "집중" | "단순" | "협업";

export type Task = {
  /** 화면이 붙이는 번호. AI와 주고받을 때 업무를 구분하는 데 쓴다. */
  id: string;
  /** 필수 */
  name: string;
  /** 필수. 아직 고르지 않았으면 빈 문자열 */
  importance: Importance | "";
  /** 선택. "YYYY-MM-DDTHH:mm" 또는 빈 문자열 */
  deadline: string;
  /** 필수. 시간 단위(0.5, 1, 1.5 …). 아직 고르지 않았으면 빈 문자열 */
  hours: string;
  /** 기본값 "단순" */
  type: TaskType;
  /** 선택. 시작 시각 "HH:mm" 또는 빈 문자열 */
  fixedTime: string;
};

export const IMPORTANCE_OPTIONS: Importance[] = ["상", "중", "하"];
export const TYPE_OPTIONS: TaskType[] = ["집중", "단순", "협업"];

/** 예상 소요 시간 선택지: 0.5시간 ~ 8시간, 30분 단위 */
export const HOUR_OPTIONS: number[] = Array.from(
  { length: 16 },
  (_, i) => (i + 1) * 0.5,
);

/**
 * id는 호출하는 쪽이 정해 준다. (화면을 처음 그릴 때 랜덤값을 만들면 빌드가 막히므로,
 * 첫 줄은 고정 id, 이후 추가되는 줄은 버튼을 누를 때 만든다.)
 */
export function createEmptyTask(id: string): Task {
  return {
    id,
    name: "",
    importance: "",
    deadline: "",
    hours: "",
    type: "단순",
    fixedTime: "",
  };
}
