// 서버가 입력을 받을 때 쓰는 형식 검사 (정규식). 실제로 존재할 수 있는 날짜·시각만 통과시킨다.
const HH = "([01]\\d|2[0-3])";
const MM = "[0-5]\\d";
const DATE_PART = "\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])";

/** "HH:mm" (00:00~23:59) */
export const TIME_RE = new RegExp(`^${HH}:${MM}$`);
/** 비어 있거나 "HH:mm" */
export const OPT_TIME_RE = new RegExp(`^(${HH}:${MM})?$`);
/** "YYYY-MM-DD" */
export const DATE_RE = new RegExp(`^${DATE_PART}$`);
/** "YYYY-MM-DDTHH:mm" */
export const DATETIME_RE = new RegExp(`^${DATE_PART}T${HH}:${MM}$`);
/** 비어 있거나 "YYYY-MM-DDTHH:mm" */
export const OPT_DATETIME_RE = new RegExp(`^(${DATE_PART}T${HH}:${MM})?$`);
