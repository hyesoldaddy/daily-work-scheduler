// 서버(API)에서만 쓰는 Supabase 접근 공통 코드. 키는 NEXT_PUBLIC_ 없이 서버에서만 읽는다.
import { createHmac } from "node:crypto";
import { normalizeOwner } from "./carryover";

const TIMEOUT_MS = 5000;

/**
 * Supabase 저장소를 부르는 공통 함수 (PostgREST). 설정이 하나라도 없으면 null.
 * 이름·사번 변환 키(OWNER_HASH_SECRET)는 서비스 키와 따로 둔다. 비어 있으면 다른 키로 대신하지 않고 저장소를 쓰지 않는다.
 */
export function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.OWNER_HASH_SECRET;
  if (!url || !key || !secret) return null;

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

  return {
    /**
     * 이름·사번과 PIN을 함께 키로 변환(HMAC)한 값만 저장한다. 이름·사번·PIN 자체는 저장하지 않는다.
     * PIN이 다르면 완전히 다른 값이 되므로, 이름·사번만 알아서는 남의 보관함을 열 수 없다.
     */
    ownerHash: (owner: string, pin: string) =>
      createHmac("sha256", secret).update(`${normalizeOwner(owner)}\u0000${pin.trim()}`).digest("hex"),
    call,
    /** 조건(filter)에 맞는 행 수. 알 수 없으면 null */
    async count(table: string, filter: string): Promise<number | null> {
      const res = await call(`${table}?${filter}&select=id`, {
        headers: { Prefer: "count=exact", Range: "0-0" },
      });
      if (!res.ok) return null;
      const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
      return total ? Number(total[1]) : null;
    },
  };
}
