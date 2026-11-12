// API 공통 보호: ① 다른 사이트에서 온 요청 막기(Origin) ② JSON만 받기 ③ 요청 횟수 제한
// 횟수 제한은 서버 한 대의 메모리에서 세는 간단한 방식이다. 배포 환경에서는 Vercel Firewall의 Rate Limit도 함께 쓴다.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function tooMany(retryAfterSec: number) {
  return Response.json(
    { ok: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

/**
 * 요청이 같은 사이트에서 온 JSON 요청인지 확인한다. 문제가 있으면 돌려줄 응답, 괜찮으면 null.
 * - 브라우저는 다른 사이트에서 보낸 POST에 Origin을 붙이므로, 내 주소와 다르면 막는다.
 * - Origin이 없는 요청(서버끼리·시험 스크립트)은 통과시킨다.
 */
export function checkRequest(request: Request): Response | null {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return Response.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 415 });
  }
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      // 잘못된 Origin이면 아래에서 막힌다
    }
    if (!host || originHost !== host) {
      return Response.json({ ok: false, error: "허용되지 않은 요청입니다." }, { status: 403 });
    }
  }
  return null;
}

/** 같은 사용자(IP)가 1분에 보낼 수 있는 횟수를 제한한다. 넘으면 돌려줄 응답, 아니면 null. */
export function rateLimit(request: Request, name: string, limitPerMinute: number): Response | null {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const key = `${name}:${clientIp(request)}`;
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  b.count += 1;
  if (b.count > limitPerMinute) return tooMany(Math.max(1, Math.ceil((b.resetAt - now) / 1000)));
  return null;
}
