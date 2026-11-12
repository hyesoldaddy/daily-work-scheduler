# CLAUDE.md — 이 프로젝트에서 지킬 규칙

- 화면·API를 시험할 때 사용자의 실제 데이터(실제 사번의 저장 기록, 브라우저에 저장된 값)를 건드리지 않는다. 시험용 이름으로 저장하거나 저장소 응답을 가짜로 막고, 끝나면 지운다.
- 코드를 바꾸면 PRD·PLAN·DESIGN도 같은 작업에서 함께 고친다. 개발 서버가 예전 화면(CSS)을 내보내면 서버를 끄고 `.next`를 지운 뒤 다시 켜고, `next build`는 서버를 끈 채 실행한다.
- 코드·문서를 수정하면 끝에 GitHub와 Vercel에도 반영한다: (코드를 바꿨으면 lint·build) → 비밀 값 검사 → `git commit`(GitHub noreply 이메일, `Co-Authored-By` 줄) → `git push` → `npx vercel deploy --prod` 순서로 하고, 배포 주소가 200이고 방금 바꾼 내용이 실제로 보이는지까지 확인해 알려 준다.
- 위 작업의 토큰은 `C:\Users\KAMCO\my-app-tokens.env`에서 읽고 절대 출력하지 않는다. Vercel은 GitHub 자동 배포가 연결돼 있지 않으므로 push만으로는 재배포되지 않는다. `.env`·토큰·`screenshot-*.png` 같은 임시 파일은 커밋하지 않는다.
