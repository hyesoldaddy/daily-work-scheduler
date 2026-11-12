"use client";

// 시·분을 따로 고르는 선택칸. 분은 0~50을 10분 단위로만 고를 수 있다. (PLAN 작업 14: 근무 시간)
// 값은 "HH:mm" 문자열이다.

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

const selectClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** 스크린 리더용 이름 (예: "근무 시작 시각") */
  label: string;
};

export default function TimeSelect({ value, onChange, label }: Props) {
  const [h = "09", m = "00"] = value.split(":");
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <select
        aria-label={`${label} 시`}
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m}`)}
        className={selectClass}
      >
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {x}시
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} 분`}
        value={m}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
        className={selectClass}
      >
        {MINUTES.map((x) => (
          <option key={x} value={x}>
            {x}분
          </option>
        ))}
      </select>
    </span>
  );
}
