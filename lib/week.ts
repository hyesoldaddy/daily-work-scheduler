// 주간 리포트용 날짜 계산. 날짜는 "YYYY-MM-DD" 글자로 다루고, 시간대 영향이 없도록 UTC로만 계산한다.
// 한 주는 월요일에 시작해 일요일에 끝난다.
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 월요일 */
export function weekStartOf(date: string): string {
  const [y, m, d] = parts(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일 … 6=토
  return addDays(date, -((dow + 6) % 7));
}

/** 이행 기록 한 줄 (서버·화면이 주고받는 모양) */
export type DoneRow = {
  id: string;
  name: string;
  importance: string;
  hours: string;
  type: string;
  doneDate: string;
};
