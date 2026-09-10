-- 공휴일 표 — 영업일 계산(납기 한도)의 정본.
--
-- 주말만 빼고 세면 연휴가 낀 달에 한도가 실제보다 짧게 나온다. 추석 연휴가
-- 통째로 무시되면 특장사가 고를 수 있는 날짜가 사라진다(제보: 당장 눈앞의 문제).
--
-- ⚠️ **더하기만** 한다. 기존 표·컬럼은 건드리지 않는다(CLAUDE.md).
CREATE TABLE IF NOT EXISTS "holiday" (
    "day"        DATE         NOT NULL,
    "name"       VARCHAR(60)  NOT NULL,
    "source"     VARCHAR(10)  NOT NULL DEFAULT 'manual',
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "memo"       VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" VARCHAR(120),
    CONSTRAINT "holiday_pkey" PRIMARY KEY ("day")
);

CREATE INDEX IF NOT EXISTS "holiday_active_idx" ON "holiday"("active", "day");

-- 납기 한도를 **주문마다 얼린다.**
--
-- 한도를 15 → 20 영업일로 늘리는데, 이미 나간 발주서에는 「15일 이내」가 문서로
-- 찍혀 있다. 상수만 바꾸면 그 서류를 우리가 소급해 고치는 셈이 된다 —
-- 「발행 시점으로 고정」은 이 제품이 지켜 온 원칙이다.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "due_limit_days" INTEGER;

-- 기존 주문 채우기(지시: 2026-09-10)
--   · 이미 납기를 찍은 건(수락 완료) → 그때 기준인 15일 그대로
--   · 아직 수락 안 된 배정        → 20일 창을 열어 준다. 연휴에 막혀 날짜를
--                                  못 고르고 있던 건들이 이 대상이다.
UPDATE "order"
   SET "due_limit_days" = CASE WHEN "delivery_due" IS NULL THEN 20 ELSE 15 END
 WHERE "due_limit_days" IS NULL;

-- 2026년 공휴일 — **사람이 확인한 값.**
--
-- 무료 공개 API 두 곳(nager.at · holidays.hyunbin.page)을 대조해 보니 둘 다
-- 제헌절(7/17)을 공휴일로 넣고 있었다. 2008년에 공휴일에서 빠진 날이다.
-- 그래서 불러온 값을 그대로 믿지 않고, 확인한 것만 여기 넣는다.
--
-- ⚠️ 전체 seed 를 돌리지 않는다. 신규 참조표는 **격리된 upsert** 로만 넣는다
--    (seed 는 feature_module 등을 deleteMany 하므로 운영에서 돌리면 안 된다).
INSERT INTO "holiday" ("day","name","source","active","memo","updated_at") VALUES
  ('2026-01-01','새해 첫날','manual',true,NULL,NOW()),
  ('2026-02-16','설날 연휴','manual',true,NULL,NOW()),
  ('2026-02-17','설날','manual',true,NULL,NOW()),
  ('2026-02-18','설날 연휴','manual',true,NULL,NOW()),
  ('2026-03-01','삼일절','manual',true,'일요일',NOW()),
  ('2026-03-02','삼일절 대체공휴일','manual',true,'3·1절이 일요일',NOW()),
  ('2026-05-01','근로자의 날','manual',true,'관공서 공휴일은 아니나 제조 현장은 쉰다',NOW()),
  ('2026-05-05','어린이날','manual',true,NULL,NOW()),
  ('2026-05-24','부처님 오신 날','manual',true,'일요일',NOW()),
  ('2026-05-25','부처님 오신 날 대체공휴일','manual',true,NULL,NOW()),
  ('2026-06-03','전국동시지방선거','manual',true,NULL,NOW()),
  ('2026-06-06','현충일','manual',true,NULL,NOW()),
  ('2026-08-15','광복절','manual',true,'토요일',NOW()),
  ('2026-08-17','광복절 대체공휴일','manual',true,NULL,NOW()),
  ('2026-09-24','추석 연휴','manual',true,NULL,NOW()),
  ('2026-09-25','추석','manual',true,NULL,NOW()),
  ('2026-09-26','추석 연휴','manual',true,'토요일 — 설·추석은 일요일과 겹칠 때만 대체공휴일이라 대체 없음',NOW()),
  ('2026-10-03','개천절','manual',true,'토요일',NOW()),
  ('2026-10-05','개천절 대체공휴일','manual',true,NULL,NOW()),
  ('2026-10-09','한글날','manual',true,NULL,NOW()),
  ('2026-12-25','성탄절','manual',true,NULL,NOW())
ON CONFLICT ("day") DO NOTHING;
