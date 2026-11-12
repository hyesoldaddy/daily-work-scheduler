// 미완료 업무 이월 API: 이름·사번·PIN별로 못 한 업무를 Supabase에 보관하고 불러온다.
// - Supabase 키(SUPABASE_SERVICE_ROLE_KEY)는 서버에서만 읽는다. (NEXT_PUBLIC_ 없음)
// - 이름·사번·PIN은 저장하지 않고, 서버가 키로 해시(HMAC)한 값만 저장한다. PIN이 다르면 다른 보관함이다.
// - 이름·사번과 업무 내용은 로그에 남기지 않는다. 주소(URL)에도 싣지 않고 요청 본문으로만 받는다.
// - 오래된 보관분은 저장할 때 함께 지운다(CARRY_RETENTION_DAYS). 한 사람이 둘 수 있는 개수에는 상한이 있다.
import { z } from "zod";
import { OWNER_MAX_LENGTH, type CarryRow } from "@/lib/carryover";
import { checkRequest, rateLimit } from "@/lib/guard";
import { OPT_DATETIME_RE, OPT_TIME_RE } from "@/lib/patterns";
import {
  CARRY_RETENTION_DAYS,
  daysAgoIso,
  MAX_CARRY_ROWS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from "@/lib/retention";
import { supabase } from "@/lib/supabaseServer";

const TABLE = "carryover_tasks";
const DONE_TABLE = "done_tasks";

const owner = z.string().trim().min(1).max(OWNER_MAX_LENGTH);
const pin = z.string().trim().min(PIN_MIN_LENGTH).max(PIN_MAX_LENGTH);
const idSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/);

const row = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  importance: z.enum(["상", "중", "하", ""]),
  hours: z.string().regex(/^(\d+(\.5)?)?$/),
  type: z.enum(["집중", "단순", "협업"]),
  deadline: z.string().regex(OPT_DATETIME_RE),
  fixedTime: z.string().regex(OPT_TIME_RE),
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), owner, pin }),
  z.object({ action: z.literal("save"), owner, pin, tasks: z.array(row).max(50) }),
  z.object({ action: z.literal("remove"), owner, pin, ids: z.array(idSchema).max(50) }),
  // 내 저장 기록(이월 보관함 + 이행 기록)을 모두 지운다
  z.object({ action: z.literal("purge"), owner, pin }),
]);

function respond(status: number, payload: Record<string, unknown>) {
  return Response.json(payload, { status });
}

export async function POST(request: Request) {
  // 다른 사이트에서 온 요청·JSON이 아닌 요청을 막고, 같은 사용자의 호출 횟수를 제한한다
  const blocked =
    checkRequest(request) ??
    rateLimit(request, "storage", Number(process.env.RATE_LIMIT_STORAGE_PER_MIN) || 60);
  if (blocked) return blocked;

  const sb = supabase();
  if (!sb) {
    return respond(503, {
      ok: false,
      code: "not_configured",
      error: "이월 저장소(Supabase)가 설정되어 있지 않습니다.",
    });
  }

  const raw = await request.json().catch(() => null);
  // 화면이 접속할 때 저장소가 설정되어 있는지만 확인하는 요청 (위에서 설정이 없으면 이미 503으로 끝난다)
  if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "ping") {
    return respond(200, { ok: true });
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return respond(400, {
      ok: false,
      error: `요청 형식이 올바르지 않습니다. (PIN은 ${PIN_MIN_LENGTH}자 이상 입력해야 합니다)`,
    });
  }
  const req = parsed.data;
  const ownerHash = sb.ownerHash(req.owner, req.pin);

  try {
    if (req.action === "list") {
      const res = await sb.call(
        `${TABLE}?owner_hash=eq.${ownerHash}&select=id,name,importance,hours,type,deadline,fixed_time&order=created_at.asc,id.asc`,
      );
      if (!res.ok) return respond(502, { ok: false, error: "이월 저장소에서 읽지 못했습니다." });
      const rows = (await res.json()) as (Omit<CarryRow, "fixedTime"> & { fixed_time: string })[];
      const tasks: CarryRow[] = rows.map(({ fixed_time, ...rest }) => ({ ...rest, fixedTime: fixed_time }));
      return respond(200, { ok: true, tasks });
    }

    if (req.action === "save") {
      if (req.tasks.length === 0) return respond(200, { ok: true });

      // 저장 개수 상한: 이미 있는 것을 갱신하는 경우는 세지 않고, 새로 늘어나는 개수만 센다
      const existingRes = await sb.call(`${TABLE}?owner_hash=eq.${ownerHash}&select=id&limit=${MAX_CARRY_ROWS + 1}`);
      if (!existingRes.ok) return respond(502, { ok: false, error: "이월 저장소에 저장하지 못했습니다." });
      const existing = new Set(((await existingRes.json()) as { id: string }[]).map((r) => r.id));
      const added = new Set(req.tasks.map((t) => t.id).filter((id) => !existing.has(id)));
      if (existing.size + added.size > MAX_CARRY_ROWS) {
        return respond(409, {
          ok: false,
          error: `이월 보관함에는 ${MAX_CARRY_ROWS}개까지 둘 수 있습니다. 완료한 업무를 체크하거나 삭제해 주세요.`,
        });
      }

      // 보관 기간이 지난 오래된 업무는 이때 함께 지운다 (실패해도 저장에는 영향 없음)
      await sb
        .call(`${TABLE}?created_at=lt.${daysAgoIso(CARRY_RETENTION_DAYS)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        })
        .catch(() => null);

      const rows = req.tasks.map((t) => ({
        owner_hash: ownerHash,
        id: t.id,
        name: t.name,
        importance: t.importance,
        hours: t.hours,
        type: t.type,
        deadline: t.deadline,
        fixed_time: t.fixedTime,
      }));
      // 같은 업무(owner_hash + id)가 이미 있으면 내용만 갱신한다
      const res = await sb.call(`${TABLE}?on_conflict=owner_hash,id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!res.ok) return respond(502, { ok: false, error: "이월 저장소에 저장하지 못했습니다." });
      return respond(200, { ok: true });
    }

    if (req.action === "purge") {
      const [a, b] = await Promise.all([
        sb.call(`${TABLE}?owner_hash=eq.${ownerHash}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
        sb.call(`${DONE_TABLE}?owner_hash=eq.${ownerHash}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
      ]);
      if (!a.ok || !b.ok) return respond(502, { ok: false, error: "저장된 기록을 모두 지우지 못했습니다." });
      return respond(200, { ok: true });
    }

    // remove: 완료 체크하거나 삭제한 업무를 보관함에서 지운다
    if (req.ids.length === 0) return respond(200, { ok: true });
    const list = req.ids.map((id) => `"${id}"`).join(",");
    const res = await sb.call(
      `${TABLE}?owner_hash=eq.${ownerHash}&id=in.(${encodeURIComponent(list)})`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    if (!res.ok) return respond(502, { ok: false, error: "이월 저장소에서 지우지 못했습니다." });
    return respond(200, { ok: true });
  } catch {
    return respond(502, { ok: false, error: "이월 저장소에 연결하지 못했습니다." });
  }
}
