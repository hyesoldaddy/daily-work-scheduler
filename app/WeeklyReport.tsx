"use client";

// 주간 이행 업무 리포트: 이름·사번으로 저장된 그 주(월~일)의 이행 업무를 일자별로 보여 준다.
import { useCallback, useEffect, useRef, useState } from "react";
import { PIN_MIN_LENGTH } from "@/lib/retention";
import { addDays, WEEKDAYS, weekStartOf, type DoneRow } from "@/lib/week";

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-11-09" → "11/09" */
function mmdd(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

function sumHours(rows: DoneRow[]): number {
  return rows.reduce((acc, r) => acc + (parseFloat(r.hours) || 0), 0);
}

const TYPE_STYLE: Record<string, string> = {
  집중: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  단순: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  협업: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};

export default function WeeklyReport({
  owner,
  pin,
  refreshKey,
}: {
  owner: string;
  /** 이름·사번과 함께 내 기록을 여는 PIN */
  pin: string;
  /** 이행 체크가 바뀔 때마다 올라가서, 열려 있는 리포트를 새로 읽는다 */
  refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [rows, setRows] = useState<DoneRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = owner.trim();
  const ready = name !== "" && pin.trim().length >= PIN_MIN_LENGTH;
  // 요청 번호: 주나 이름이 바뀌면 이전 요청의 늦은 응답은 버린다
  const seq = useRef(0);

  const load = useCallback(
    async (week: string) => {
      if (!ready || !week) return;
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "week", owner: name, pin: pin.trim(), weekStart: week }),
        });
        const data = await res.json().catch(() => null);
        if (seq.current !== mine) return;
        if (!res.ok || !data?.ok) throw new Error(data?.error ?? "리포트를 불러오지 못했습니다.");
        setRows(data.tasks as DoneRow[]);
      } catch (e) {
        if (seq.current !== mine) return;
        setRows([]);
        setError((e as Error).message);
      } finally {
        if (seq.current === mine) setLoading(false);
      }
    },
    [name, pin, ready],
  );

  // 열려 있을 때 주·이름·체크 변경에 맞춰 다시 읽는다. 이름을 입력하는 도중에는 입력이 잠시 멈춘 뒤에 읽는다.
  useEffect(() => {
    if (!open || !weekStart) return;
    const timer = setTimeout(() => void load(weekStart), 400);
    return () => clearTimeout(timer);
  }, [open, weekStart, refreshKey, load]);

  function toggle() {
    if (!open && !weekStart) setWeekStart(weekStartOf(localToday()));
    setOpen(!open);
  }

  // 현재 시각은 리포트를 열었을 때만 읽는다 (처음 화면을 그릴 때 읽으면 Next.js가 경고한다)
  const thisWeek = open ? weekStartOf(localToday()) : "";
  const days = weekStart ? WEEKDAYS.map((w, i) => ({ w, date: addDays(weekStart, i) })) : [];
  const total = sumHours(rows);

  return (
    <section className="mt-10 flex flex-col gap-3 border-t border-zinc-300 pt-6 dark:border-zinc-700">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-fit rounded-md border border-zinc-400 px-4 py-2 text-sm font-medium dark:border-zinc-600"
      >
        {open ? "주간 이행 업무 리포트 닫기" : "주간 이행 업무 리포트 확인하기"}
      </button>

      {open && (
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
          {!ready ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              위의 “이름 또는 사번”과 PIN을 입력하면 저장된 이행 업무를 볼 수 있습니다.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                  className="rounded-md border border-zinc-400 px-3 py-1 text-sm dark:border-zinc-600"
                >
                  ◀ 이전 주
                </button>
                <h3 className="text-base font-bold text-navy">
                  {weekStart && `${weekStart} ~ ${addDays(weekStart, 6)}`}
                </h3>
                <button
                  type="button"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                  className="rounded-md border border-zinc-400 px-3 py-1 text-sm dark:border-zinc-600"
                >
                  다음 주 ▶
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(thisWeek)}
                  disabled={weekStart === thisWeek}
                  className="rounded-md border border-zinc-400 px-3 py-1 text-xs disabled:opacity-40 dark:border-zinc-600"
                >
                  이번 주
                </button>
              </div>

              <p className="stat-strip text-sm" aria-live="polite">
                {loading
                  ? "불러오는 중…"
                  : `이 주 이행 ${rows.length}건 · 소요 시간 합계 ${total}시간`}
              </p>

              {error && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                  {error}
                </p>
              )}

              <ol className="flex flex-col gap-3">
                {days.map(({ w, date }) => {
                  const list = rows.filter((r) => r.doneDate === date);
                  const isWeekend = w === "토" || w === "일";
                  return (
                    <li
                      key={date}
                      className={`rounded-md border border-zinc-200 p-3 dark:border-zinc-800 ${
                        list.length === 0 && isWeekend ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-baseline gap-2 text-sm font-semibold">
                        <span>
                          {mmdd(date)} ({w})
                        </span>
                        <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                          {list.length > 0
                            ? `${list.length}건 · ${sumHours(list)}시간`
                            : "이행한 업무 없음"}
                        </span>
                      </div>
                      {list.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {list.map((r) => (
                            <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                              <span aria-hidden="true">✅</span>
                              <span>{r.name}</span>
                              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                {r.importance && `중요도 ${r.importance} · `}
                                {r.hours && `${r.hours}시간`}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs ${TYPE_STYLE[r.type] ?? ""}`}
                              >
                                {r.type}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
