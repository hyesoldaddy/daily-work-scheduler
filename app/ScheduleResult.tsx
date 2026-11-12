"use client";

// Design Ref: §1 ④-2 시간표 / ④-3 오늘 처리 불가 업무 (PLAN 작업 10), [시간표 복사] 버튼 (PLAN 작업 13)
import { useState } from "react";

export type ScheduleEntry = {
  id: string;
  /** 화면에 보여 줄 업무명 */
  name: string;
  start: string;
  end: string;
  flag: "기한 지남" | "기한 초과 예상" | null;
};

type Props = {
  schedule: ScheduleEntry[];
  /** 오늘 처리 불가 업무의 이름 */
  unscheduled: string[];
  notice?: string;
  /** 첫 배치 가능 시각 (현재 시각 다음 30분 단위) */
  earliestStart?: string;
  /** 복사할 글자 맨 위에 넣을 날짜 "YYYY-MM-DD" */
  date?: string;
  /** 이행 체크를 바꿨을 때 알린다 (미완료 업무 이월 저장에 쓴다) */
  /** 저장 결과를 돌려준다. false(저장 실패)면 체크를 되돌린다. */
  onToggleDone?: (id: string, done: boolean) => void | Promise<boolean>;
  /** 처음부터 이행 체크되어 있어야 하는 업무 id */
  initialDoneIds?: string[];
};

/** 메신저·메일에 붙여넣기 좋은 글자 형태 */
export function formatScheduleText(
  schedule: ScheduleEntry[],
  unscheduled: string[],
  date?: string,
): string {
  const lines = [date ? `[${date} 업무 시간표]` : "[업무 시간표]"];
  for (const s of schedule) {
    lines.push(`${s.start}~${s.end} ${s.name}${s.flag ? ` (${s.flag})` : ""}`);
  }
  if (unscheduled.length > 0) {
    lines.push("", `오늘 처리 불가: ${unscheduled.join(", ")}`);
  }
  return lines.join("\n");
}

/** 클립보드에 글자를 복사한다. 권한이 없는 환경이면 예전 방식(보이지 않는 입력칸)으로 한 번 더 시도한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function ScheduleResult({
  schedule,
  unscheduled,
  notice,
  earliestStart,
  date,
  onToggleDone,
  initialDoneIds = [],
}: Props) {
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  // 이행 여부 체크: 화면 안에서만 기억한다. 저장하지 않으므로 새로고침하면 사라진다.
  // 같은 업무를 다시 만들 때는 이미 이행 체크한 것을 체크된 채로 시작한다 (initialDoneIds)
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set(initialDoneIds));

  function toggleDone(id: string) {
    const done = !doneIds.has(id);
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (done) next.add(id);
      else next.delete(id);
      return next;
    });
    // 저장에 실패하면(false) 체크를 원래대로 되돌려 화면과 저장된 내용이 어긋나지 않게 한다
    void Promise.resolve(onToggleDone?.(id, done)).then((ok) => {
      if (ok !== false) return;
      setDoneIds((prev) => {
        const next = new Set(prev);
        if (done) next.delete(id);
        else next.add(id);
        return next;
      });
    });
  }

  async function copy() {
    const ok = await copyText(formatScheduleText(schedule, unscheduled, date));
    setCopyState(ok ? "done" : "failed");
    setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <section className="flex flex-col gap-4" aria-label="시간표 결과">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="section-title text-base">시간표</h3>
          {(schedule.length > 0 || unscheduled.length > 0) && (
            <>
              <button
                type="button"
                onClick={copy}
                className="rounded-md border border-zinc-400 px-3 py-1 text-xs dark:border-zinc-600"
              >
                시간표 복사
              </button>
              <span role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
                {copyState === "done" && "복사했습니다. 메신저나 메일에 붙여넣으세요."}
                {copyState === "failed" && "복사하지 못했습니다. 직접 선택해서 복사해 주세요."}
              </span>
            </>
          )}
        </div>
        {earliestStart && schedule.length > 0 && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            현재 시각 이후인 {earliestStart}부터 배치했습니다.
          </p>
        )}
        {notice && <p className="text-sm text-red-700 dark:text-red-300">{notice}</p>}
        {schedule.length > 0 && (
          <>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              시간표 순서는 업무 유형에 따라 우선순위와 다를 수 있습니다.
            </p>
            <p className="stat-strip text-sm" role="status" aria-label="이행 현황">
              이행 {schedule.filter((s) => doneIds.has(s.id)).length} / {schedule.length}
            </p>
            <ul className="flex flex-col gap-2">
              {schedule.map((item) => {
                const done = doneIds.has(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3 text-sm ${
                        done
                          ? "border-green-400 bg-green-50 text-zinc-500 dark:border-green-700 dark:bg-green-950 dark:text-zinc-400"
                          : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggleDone(item.id)}
                        aria-label={`${item.name} 이행 완료`}
                        className="h-4 w-4 accent-green-600"
                      />
                      <span className={`font-mono font-semibold ${done ? "line-through" : ""}`}>
                        {item.start}~{item.end}
                      </span>
                      <span className={`font-medium ${done ? "line-through" : ""}`}>{item.name}</span>
                      {item.flag && (
                        <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                          {item.flag}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {unscheduled.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="section-title text-base">오늘 처리 불가 업무</h3>
          <ul className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            {unscheduled.map((name, i) => (
              <li key={i}>• {name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
