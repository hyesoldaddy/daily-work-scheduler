// 화면 구성: 네이비 머리말 → 스케줄러 (Design Ref: §1 화면 구성)
import Image from "next/image";
import { CARRY_RETENTION_DAYS, DONE_RETENTION_DAYS } from "@/lib/retention";
import TaskPlanner from "./TaskPlanner";

export default function Home() {
  return (
    <>
      <header className="bg-navy text-white">
        <div className="mx-auto flex w-full max-w-3xl items-end justify-between gap-4 px-6 py-10 sm:gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-bold tracking-[0.2em] text-tan">DAILY WORK SCHEDULER</p>
            {/* 휴대폰 폭에서 "러" 한 글자만 다음 줄로 내려가지 않도록: 작은 화면은 글자를 줄이고, 줄이 나뉘어도 단어 단위로 나눈다 */}
            <h1 className="break-keep text-balance text-2xl font-bold leading-tight tracking-tight min-[400px]:text-3xl sm:text-4xl">
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
            className="h-14 w-auto shrink-0 min-[400px]:h-20 sm:h-28"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <ul className="flex flex-col gap-2 rounded-md border border-tan/60 bg-beige/30 p-4 text-sm text-navy">
          <li>⚠ 대외비·비밀 내용은 입력하지 마세요</li>
          <li>⚠ 고객·직원의 실명, 전화번호, 주민등록번호 등을 넣지 마세요</li>
          <li>ⓘ 이월 업무는 {CARRY_RETENTION_DAYS}일, 이행 기록은 {DONE_RETENTION_DAYS}일 뒤 자동 삭제</li>
        </ul>
        <TaskPlanner />
      </main>
    </>
  );
}
