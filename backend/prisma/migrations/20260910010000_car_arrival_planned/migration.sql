-- 차량 도착 **예정일** — 관리자가 특장사에게 알려 주는 날짜.
--
-- 특장사가 완료 처리하는 「차량 도착」 단계와 다르다. 이건 예정이고, 정하는 사람도
-- 관리자다(차를 보내는 쪽이 안다). 수락 전이든 진행 중이든 언제든 찍고 고칠 수
-- 있어야 하므로 단계가 아니라 주문에 둔다 — 단계에 매달면 수락 전에 쓸 자리가 없다.
--
-- ⚠️ **더하기만** 한다(CLAUDE.md).
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "car_arrival_planned_at" DATE;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "car_arrival_set_by"     VARCHAR(120);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "car_arrival_set_at"     TIMESTAMP(3);
