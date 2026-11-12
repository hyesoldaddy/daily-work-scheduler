// Design Ref: §1 ④-1 우선순위 — "1. 업무명 — 이유(30자 이내) [기한 지남]" (PLAN 작업 8)

export type PriorityEntry = {
  id: string;
  reason: string;
  overdue: boolean;
  /** 화면에 보여 줄 업무명 */
  name: string;
};

export default function PriorityResult({ items }: { items: PriorityEntry[] }) {
  return (
    <section className="flex flex-col gap-2" aria-label="우선순위 결과">
      <h3 className="section-title text-base">우선순위</h3>
      <ol className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700"
          >
            <span className="font-semibold">{i + 1}.</span>
            <span className="font-medium">{item.name}</span>
            {item.overdue && (
              <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                기한 지남
              </span>
            )}
            <span className="text-zinc-600 dark:text-zinc-400">— {item.reason}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
