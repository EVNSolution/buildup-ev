-- 로그인 30일 유지 — 비밀번호 변경·초기화 때 기존 로그인을 끊는 기준 시각
-- 추가만 한다. 기존 행은 NULL(끊을 것 없음)로 남는다.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "sessions_valid_after" TIMESTAMP(3);
