// 저장 기간·개수 상한 (서버 API와 화면 안내문이 같이 쓴다)
/** 이월 보관함: 이 기간이 지난 업무는 자동으로 지운다 (일) */
export const CARRY_RETENTION_DAYS = 30;
/** 이행 기록(주간 리포트): 이 기간이 지난 기록은 자동으로 지운다 (일) */
export const DONE_RETENTION_DAYS = 90;
/** 이름·사번(+PIN) 한 사람이 이월 보관함에 둘 수 있는 업무 수 */
export const MAX_CARRY_ROWS = 60;
/** 한 사람이 쌓을 수 있는 이행 기록 수 */
export const MAX_DONE_ROWS = 2000;
/** PIN 길이 */
export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 30;

/** 지금부터 days일 전 시각 (ISO 문자열) */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
