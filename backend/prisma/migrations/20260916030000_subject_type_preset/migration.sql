-- 권한 대상에 「역할 프리셋」을 더한다(2026-09-16) — 기능모듈 화면에서 자리마다 구성을 고친다.
-- ⚠️ 값 추가와 그 값을 쓰는 INSERT 는 **같은 트랜잭션에 둘 수 없다**(PostgreSQL) — 적재는 다음 마이그레이션에서.
ALTER TYPE "SubjectType" ADD VALUE IF NOT EXISTS 'preset';
