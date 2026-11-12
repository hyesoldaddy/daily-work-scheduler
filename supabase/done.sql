-- 이행한 업무 기록 (주간 리포트용). Supabase 대시보드 > SQL Editor 에서 한 번 실행한다.
-- 이름·사번은 저장하지 않고 서버가 변환한 값(owner_hash)만 저장한다.
create table if not exists public.done_tasks (
  owner_hash text not null,
  id         text not null,
  done_date  date not null,
  week_start date not null,           -- 그 주의 월요일 (주간 저장·조회 기준)
  name       text not null,
  importance text not null default '',
  hours      text not null default '',
  type       text not null,
  done_at    timestamptz not null default now(),
  primary key (owner_hash, id)
);

create index if not exists done_tasks_week_idx on public.done_tasks (owner_hash, week_start);

-- 브라우저에서 직접 접근하지 못하게 막는다. (서버의 service-role 키만 접근)
alter table public.done_tasks enable row level security;
