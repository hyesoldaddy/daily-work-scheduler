// Design Ref: §2 데이터 흐름 — 서버 API (PLAN 작업 2, 7, 9)
// 정렬과 시간표 배치는 코드가 PRD 규칙대로 정한다. AI는 우선순위 "이유 문구"만 쓴다.
// 키는 서버에서만 읽는다(NEXT_PUBLIC_ 없음). 업무 내용·오류 객체는 로그에 남기지 않는다.
import OpenAI from "openai";
import { z } from "zod";
import { checkRequest, rateLimit } from "@/lib/guard";
import { DATETIME_RE, OPT_DATETIME_RE, OPT_TIME_RE, TIME_RE } from "@/lib/patterns";
import { buildReasonMessages, REASON_JSON_SCHEMA } from "@/lib/prompt";
import {
  fallbackReason,
  prepareTasks,
  REASON_MAX_LENGTH,
  sortByRules,
  verifyPriority,
} from "@/lib/priority";
import {
  buildFallbackSchedule,
  buildScheduleItems,
  prepareScheduleTasks,
  SLOT,
  verifySchedule,
} from "@/lib/schedule";
import { formatMinutes, parseWorkHours, validateTasks } from "@/lib/validate";

export const maxDuration = 10;

const FAIL_MESSAGE = "시간표를 만들지 못했습니다. 다시 시도해 주세요";
// 이유 한 줄 쓰기는 쉬운 일이라 빠르고 저렴한 모델로 충분하다. .env의 OPENAI_MODEL로 바꿀 수 있다.
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
/** 버튼을 누른 뒤 서버가 쓸 수 있는 전체 시간(밀리초). 화면의 10초 기준보다 조금 짧게 잡는다. */
const BUDGET_MS = 9000;
/** AI를 부르기 위해 남아 있어야 하는 최소 시간 (이보다 적으면 코드가 만든 이유 문구를 쓴다) */
const MIN_AI_MS = 1500;

const requestSchema = z.object({
  now: z.string().regex(DATETIME_RE),
  // 근무 시작·종료 (생략하면 09:00~18:00)
  work: z
    .object({ start: z.string().regex(TIME_RE), end: z.string().regex(TIME_RE) })
    .optional(),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().max(200),
        importance: z.enum(["상", "중", "하", ""]),
        deadline: z.string().regex(OPT_DATETIME_RE),
        hours: z.string().regex(/^(\d+(\.5)?)?$/),
        type: z.enum(["집중", "단순", "협업"]),
        fixedTime: z.string().regex(OPT_TIME_RE),
      }),
    )
    .max(50),
});

const reasonAnswer = z.object({
  order: z.array(z.object({ id: z.string(), reason: z.string() })),
});

function fail(status: number, error: string = FAIL_MESSAGE) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  // 다른 사이트에서 온 요청·JSON이 아닌 요청을 막고, 같은 사용자의 호출 횟수를 제한한다(호출마다 OpenAI 비용이 든다)
  const blocked =
    checkRequest(request) ??
    rateLimit(request, "schedule", Number(process.env.RATE_LIMIT_SCHEDULE_PER_MIN) || 10);
  if (blocked) return blocked;

  const startedAt = Date.now();
  const remaining = () => BUDGET_MS - (Date.now() - startedAt);

  const body = await request.json().catch(() => null);

  // 서버에서 입력을 한 번 더 검사한다 (화면 검사와 같은 규칙)
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "입력 형식이 올바르지 않습니다.");
  const { tasks, now, work } = parsed.data;
  const workHours = parseWorkHours(work?.start ?? "09:00", work?.end ?? "18:00");
  if (!workHours.ok) return fail(400, workHours.message);
  const cfg = workHours.config;
  const check = validateTasks(tasks, cfg);
  if (!check.ok) {
    return Response.json(
      { ok: false, error: check.errors.map((e) => e.message).join("\n") },
      { status: 400 },
    );
  }

  // ① 우선순위: 코드가 PRD must ① 규칙 1~4번으로 정렬한다
  const sorted = sortByRules(prepareTasks(check.tasks, now));

  // 이유 문구: 기본은 코드가 만든 문구, AI가 제대로 써 오면 AI 문구로 바꾼다
  const reasons = new Map(sorted.map((t) => [t.id, fallbackReason(t)]));
  let reasonSource: "ai" | "code" = "code";
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && remaining() >= MIN_AI_MS) {
    try {
      // 재시도는 끈다: 내부 재시도가 겹치면 9초 예산을 넘어 10초 제한을 못 지킨다.
      const client = new OpenAI({ apiKey, maxRetries: 0 });
      const res = await client.chat.completions.create(
        {
          model: MODEL,
          temperature: 0,
          messages: buildReasonMessages(sorted, now),
          response_format: { type: "json_schema", json_schema: REASON_JSON_SCHEMA },
        },
        { timeout: remaining() },
      );
      const content = res.choices[0]?.message?.content;
      const answer = content ? reasonAnswer.safeParse(JSON.parse(content)) : null;
      if (answer?.success) {
        // 모든 업무가 한 번씩, 이유가 비지 않고 30자 이내일 때만 받아들인다 (PRD must ① 규칙 5·6번)
        const ids = new Set(answer.data.order.map((o) => o.id));
        const valid =
          answer.data.order.length === sorted.length &&
          ids.size === sorted.length &&
          sorted.every((t) => ids.has(t.id)) &&
          answer.data.order.every(
            (o) => o.reason.trim() !== "" && [...o.reason.trim()].length <= REASON_MAX_LENGTH,
          );
        if (valid) {
          for (const o of answer.data.order) reasons.set(o.id, o.reason.trim());
          reasonSource = "ai";
        }
      }
    } catch {
      // AI 호출 실패: 코드가 만든 이유 문구를 그대로 쓴다
    }
  }

  // 코드가 정한 순서와 이유가 규칙(정렬 1~4번, 이유 30자 이내)을 지켰는지 검산한다. 어긋나면 코드 버그이므로 잘못된 결과를 보여주지 않는다.
  if (verifyPriority(sorted.map((t) => ({ id: t.id, reason: reasons.get(t.id)! })), sorted) !== null) return fail(500);

  const priority = sorted.map((t) => ({
    id: t.id,
    reason: reasons.get(t.id)!,
    overdue: t.overdue,
  }));

  // ② 시간표: 코드가 PRD must ② 규칙대로 배치한다
  const byId = new Map(check.tasks.map((t) => [t.id, t]));
  const { tasks: scheduleTasks, earliest } = prepareScheduleTasks(
    priority.map((p) => byId.get(p.id)!),
    now,
    cfg,
  );

  // 오늘 남은 근무 시간이 업무 한 칸(30분)도 안 되면 모두 처리 불가로 돌려준다
  if (earliest + SLOT > cfg.workEnd) {
    return Response.json({
      ok: true,
      priority,
      reasonSource,
      schedule: [],
      unscheduled: scheduleTasks.map((t) => t.id),
      notice: "오늘 남은 근무 시간이 없습니다",
    });
  }

  const result = buildFallbackSchedule(scheduleTasks, earliest, cfg);
  // 코드가 만든 시간표도 규칙 검산을 거친다. (어긋나면 코드 버그이므로 잘못된 시간표를 보여주지 않는다)
  if (verifySchedule(result, scheduleTasks, earliest, cfg) !== null) return fail(500);

  return Response.json({
    ok: true,
    priority,
    reasonSource,
    schedule: buildScheduleItems(result, scheduleTasks),
    unscheduled: result.unscheduled,
    earliestStart: formatMinutes(earliest),
  });
}
