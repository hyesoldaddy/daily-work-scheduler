// 이행 업무 기록 API: 체크한 업무를 날짜·주 단위로 Supabase에 저장하고, 주간 리포트용으로 읽어 온다.
// - 이름·사번·PIN은 저장하지 않고 변환한 값만 쓴다. 이름·사번과 업무 내용은 로그에 남기지 않는다.
// - 오래된 기록은 저장할 때 함께 지운다(DONE_RETENTION_DAYS). 한 사람이 쌓을 수 있는 개수에는 상한이 있다.
import { z } from "zod";
import { OWNER_MAX_LENGTH } from "@/lib/carryover";
import { checkRequest, rateLimit } from "@/lib/guard";
import { DATE_RE } from "@/lib/patterns";
import {
  daysAgoIso,
  DONE_RETENTION_DAYS,
  MAX_DONE_ROWS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from "@/lib/retention";
import { supabase } from "@/lib/supabaseServer";
import { addDays, weekStartOf, type DoneRow } from "@/lib/week";

const TABLE = "done_tasks";

const owner = z.string().trim().min(1).max(OWNER_MAX_LENGTH);
const pin = z.string().trim().min(PIN_MIN_LENGTH).max(PIN_MAX_LENGTH);
const idSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/);
const date = z.string().regex(DATE_RE);

const row = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  importance: z.enum(["상", "중", "하", ""]),
  hours: z.string().regex(/^(\d+(\.5)?)?$/),
  type: z.enum(["집중", "단순", "협업"]),
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done"), owner, pin, date, tasks: z.array(row).min(1).max(50) }),
  z.object({ action: z.literal("undo"), owner, pin, ids: z.array(idSchema).min(1).max(50) }),
  z.object({ action: z.literal("week"), owner, pin, weekStart: date }),
]);

function respond(status: number, payload: Record<string, unknown>) {
  return Response.json(payload, { status });
}

export async function POST(request: Request) {
  const blocked =
    checkRequest(request) ??
    rateLimit(request, "storage", Number(process.env.RATE_LIMIT_STORAGE_PER_MIN) || 60);
  if (blocked) return blocked;

  const sb = supabase();
  if (!sb) {
    return respond(503, {
      ok: false,
      code: "not_configured",
      error: "저장소(Supabase)가 설정되어 있지 않습니다.",
    });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return respond(400, {
      ok: false,
      error: `요청 형식이 올바르지 않습니다. (PIN은 ${PIN_MIN_LENGTH}자 이상 입력해야 합니다)`,
    });
  }
  const req = parsed.data;
  const ownerHash = sb.ownerHash(req.owner, req.pin);

  try {
    if (req.action === "done") {
      // 저장 개수 상한
      const total = await sb.count(TABLE, `owner_hash=eq.${ownerHash}`);
      if (total !== null && total + req.tasks.length > MAX_DONE_ROWS) {
        return respond(409, { ok: false, error: "저장할 수 있는 이행 기록 수를 넘었습니다." });
      }
      // 보관 기간이 지난 오래된 기록은 이때 함께 지운다 (실패해도 저장에는 영향 없음)
      await sb
        .call(`${TABLE}?done_at=lt.${daysAgoIso(DONE_RETENTION_DAYS)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        })
        .catch(() => null);

      const weekStart = weekStartOf(req.date);
      const rows = req.tasks.map((t) => ({
        owner_hash: ownerHash,
        id: t.id,
        done_date: req.date,
        week_start: weekStart,
        name: t.name,
        importance: t.importance,
        hours: t.hours,
        type: t.type,
      }));
      const res = await sb.call(`${TABLE}?on_conflict=owner_hash,id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!res.ok) return respond(502, { ok: false, error: "이행 기록을 저장하지 못했습니다." });
      return respond(200, { ok: true });
    }

    if (req.action === "undo") {
      const list = req.ids.map((id) => `"${id}"`).join(",");
      const res = await sb.call(
        `${TABLE}?owner_hash=eq.${ownerHash}&id=in.(${encodeURIComponent(list)})`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
      if (!res.ok) return respond(502, { ok: false, error: "이행 기록을 지우지 못했습니다." });
      return respond(200, { ok: true });
    }

    // week: 그 주(월~일)에 이행한 업무
    const weekStart = weekStartOf(req.weekStart);
    const res = await sb.call(
      `${TABLE}?owner_hash=eq.${ownerHash}&week_start=eq.${weekStart}` +
        `&select=id,name,importance,hours,type,done_date&order=done_date.asc,done_at.asc,id.asc`,
    );
    if (!res.ok) return respond(502, { ok: false, error: "이행 기록을 읽지 못했습니다." });
    const raw = (await res.json()) as (Omit<DoneRow, "doneDate"> & { done_date: string })[];
    const tasks: DoneRow[] = raw.map(({ done_date, ...rest }) => ({ ...rest, doneDate: done_date }));
    return respond(200, { ok: true, weekStart, weekEnd: addDays(weekStart, 6), tasks });
  } catch {
    return respond(502, { ok: false, error: "저장소에 연결하지 못했습니다." });
  }
}
