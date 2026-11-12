"use client";

// Design Ref: §1 ③ 업무 입력 목록 — 한 줄 = 업무명* | 중요도* | 마감기한 | 소요시간* | 유형 | 시작 시각 지정 (PLAN 작업 3)
import { snapDeadline } from "@/lib/validate";
import {
  HOUR_OPTIONS,
  IMPORTANCE_OPTIONS,
  TYPE_OPTIONS,
  type Importance,
  type Task,
  type TaskType,
} from "@/lib/types";

type Props = {
  task: Task;
  /** 줄 번호(1부터). 화면 표시용 */
  index: number;
  /** 삭제 버튼 글자. 마지막 한 줄은 "비우기"로 보여 준다. */
  removeLabel: string;
  /** 입력 확인에서 문제가 나온 줄이면 테두리를 빨갛게 */
  invalid?: boolean;
  onChange: (task: Task) => void;
  onRemove: () => void;
};

const fieldClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

function Field({
  label,
  required,
  hint,
  hintAlign = "left",
  className,
  children,
}: {
  label: string;
  required?: boolean;
  /** 있으면 이름 위에 커서를 올리거나 키보드로 이동했을 때 설명 팝업을 보여 준다 */
  hint?: string;
  /** 설명 팝업을 칸의 왼쪽/오른쪽 끝에 맞춘다 (화면 밖으로 나가지 않게) */
  hintAlign?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium ${className ?? ""}`}>
      <span>
        {hint ? (
          <span className="group relative inline-flex cursor-help items-center gap-1 whitespace-nowrap" tabIndex={0}>
            <span className="underline decoration-dotted underline-offset-2">{label}</span>
            <span
              aria-hidden="true"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-400 text-[10px] dark:border-zinc-500"
            >
              ?
            </span>
            <span
              role="tooltip"
              className={`pointer-events-none invisible absolute top-full z-20 mt-1 w-64 whitespace-normal rounded-md bg-zinc-900 p-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 dark:bg-zinc-100 dark:text-zinc-900 ${
                hintAlign === "right" ? "right-0" : "left-0"
              }`}
            >
              {hint}
            </span>
          </span>
        ) : (
          label
        )}
        {required && (
          <span className="ml-0.5 text-red-600" aria-label="필수">
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

export default function TaskRow({
  task,
  index,
  removeLabel,
  invalid,
  onChange,
  onRemove,
}: Props) {
  const set = <K extends keyof Task>(key: K, value: Task[K]) =>
    onChange({ ...task, [key]: value });

  return (
    <div
      className={`grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-9 ${
        invalid
          ? "border-red-500"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <div className="col-span-2 flex items-end gap-2 sm:col-span-9">
        <Field label={`업무명 (${index}번)`} required className="flex-1">
          <input
            type="text"
            value={task.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="예: 주간 보고서 작성"
            className={fieldClass}
          />
        </Field>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          {removeLabel}
        </button>
      </div>

      <Field label="중요도" required className="sm:col-span-1">
        <select
          value={task.importance}
          onChange={(e) => set("importance", e.target.value as Importance | "")}
          className={fieldClass}
        >
          <option value="">선택</option>
          {IMPORTANCE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>

      <Field label="예상 소요 시간" required className="sm:col-span-2">
        <select
          value={task.hours}
          onChange={(e) => set("hours", e.target.value)}
          className={fieldClass}
        >
          <option value="">선택</option>
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={String(h)}>
              {h}시간
            </option>
          ))}
        </select>
      </Field>

      <Field label="업무 유형" className="sm:col-span-1">
        <select
          value={task.type}
          onChange={(e) => set("type", e.target.value as TaskType)}
          className={fieldClass}
        >
          {TYPE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>

      <Field label="마감 기한 (선택)" className="col-span-2 sm:col-span-3">
        <input
          type="datetime-local"
          step={600}
          value={task.deadline}
          onChange={(e) => set("deadline", e.target.value)}
          onBlur={(e) => {
            // 값이 달라질 때만 반영한다. (그냥 지나가기만 해도 시간표가 지워지지 않게)
            const snapped = snapDeadline(e.target.value);
            if (snapped !== task.deadline) set("deadline", snapped);
          }}
          className={fieldClass}
        />
      </Field>

      <Field
        label="시작 시각 지정 (선택)"
        hint="회의·면담처럼 시작 시각이 정해진 일정에 입력합니다. 입력한 시각에 그대로 배치되고, 비워 두면 빈 시간에 알아서 배치됩니다. 30분 단위(예: 14:00, 14:30)만 가능합니다."
        hintAlign="right"
        className="col-span-2 sm:col-span-2"
      >
        <input
          type="time"
          step={1800}
          value={task.fixedTime}
          onChange={(e) => set("fixedTime", e.target.value)}
          className={fieldClass}
        />
      </Field>
    </div>
  );
}
