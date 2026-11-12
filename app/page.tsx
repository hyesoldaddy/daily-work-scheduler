// 화면 구성: 네이비 머리말 → 스케줄러 (Design Ref: §1 화면 구성)
import Image from "next/image";
import { CARRY_RETENTION_DAYS, DONE_RETENTION_DAYS } from "@/lib/retention";
import TaskPlanner from "./TaskPlanner";

export default function Home() {
  return (
    <>
      <header className="bg-navy text-white">
        <div className="mx-auto flex w-full max-w-3xl items-end justify-between gap-6 px-6 py-10">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold tracking-[0.2em] text-tan">DAILY WORK SCHEDULER</p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              데일리 업무 스케줄러
            </h1>
            <p className="text-sm text-white/70">
              오늘 할 업무를 입력하면 우선순위와 하루 시간표를 만들어 드립니다.
            </p>
          </div>
          {/* 캠코 마스코트 "키우미" (2025 애뉴얼리포트 리플렛, 공공누리 공공저작물) */}
          <Image
            src="/kiwoomi.png"
            alt="캠코 마스코트 키우미"
            width={327}
            height={430}
            priority
            className="h-20 w-auto shrink-0 sm:h-28"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <ul className="flex flex-col gap-2 rounded-md border border-tan/60 bg-beige/30 p-4 text-sm text-navy">
          <li>⚠ 대외비·비밀 내용은 입력하지 마세요</li>
          <li>⚠ 고객·직원의 실명, 전화번호, 주민등록번호 등을 넣지 마세요</li>
          <li>
            ⓘ 입력한 업무명은 우선순위 이유 작성을 위해 AI 서비스(OpenAI, 미국)로 전송됩니다. 이월·주간 리포트용으로
            이름·사번·PIN 기준으로 서버에 저장되며, 이월 업무는 {CARRY_RETENTION_DAYS}일, 이행 기록은 {DONE_RETENTION_DAYS}일 뒤 자동으로 삭제됩니다.
          </li>
        </ul>
        <TaskPlanner />
      </main>
    </>
  );
}
