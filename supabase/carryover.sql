-- 미완료 업무 이월 저장소 (PLAN 추가 기능)
-- 사용법: Supabase 대시보드 → SQL Editor 에 이 내용을 붙여넣고 Run 한 번 실행합니다.
-- 이 앱은 서버(API)에서만 service role 키로 이 테이블에 접근합니다. 브라우저는 직접 접근하지 않습니다.

create table if not exists public.carryover_tasks (
  owner_hash  text        not null,            -- 이름·사번을 서버가 해시한 값 (이름·사번 자체는 저장하지 않음)
  id          text        not null,            -- 앱이 만든 업무 키 (예: co:2026-11-12:task-1)
  name        text        not null,
  importance  text        not null default '',
  hours       text        not null default '',
  type        text        not null default '단순',
  deadline    text        not null default '',
  fixed_time  text        not null default '',
  created_at  timestamptz not null default now(),
  primary key (owner_hash, id)
);

-- 정책을 하나도 만들지 않고 RLS를 켜 두면, 브라우저용 공개 키(anon)로는 아무것도 읽고 쓸 수 없습니다.
-- service role 키(서버 전용)는 RLS를 건너뛰므로 앱 서버만 사용할 수 있습니다.
alter table public.carryover_tasks enable row level security;
