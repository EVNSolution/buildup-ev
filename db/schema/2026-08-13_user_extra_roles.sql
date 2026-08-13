-- 겸직 역할(extra_roles) — 한 계정이 여러 화면(영업·관리·특장)을 쓸 수 있게 한다.
--
-- 왜 role 을 배열로 바꾸지 않는가: role 은 "로그인하면 어디로 보낼지"와 배지의 기준이라
-- 하나여야 한다. 겸직은 여기에 더한다. 기존 계정은 빈 배열이므로 동작이 달라지지 않는다.
--
-- 실행: sudo docker exec -i buildup-ev-postgres psql -U buildup -d buildup_ev -f - < 이 파일
-- ⚠️ 실행 전 pg_dump 백업.

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS extra_roles "Role"[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN "user".extra_roles IS '겸직 역할 — 주 역할(role) 외에 추가로 가진 역할. 권한은 역할들의 합집합.';
