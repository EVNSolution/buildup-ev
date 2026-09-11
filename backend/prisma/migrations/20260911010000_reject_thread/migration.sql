-- 거부한 특장사와 **계속 이야기한다** · 대화를 **특장사별로** 가른다.
--
-- 20영업일 안에 못 맞추는 건은 특장사가 거부하고, 대화로 날짜를 맞춘 뒤 다시 배정한다
-- (지시: 2026-09-11). 그런데 거부하면 배정이 풀려(`maker_org_id` = NULL) 그 특장사는
-- 이 건을 **아예 볼 수 없게** 됐다 — 이야기할 자리가 사라지는 셈이다.
--
-- ⚠️ **더하기만** 한다(CLAUDE.md).

-- 마지막으로 거부한 특장사
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "rejected_by_org" VARCHAR(30);

-- 대화가 어느 특장사와의 것인가 — 다른 특장사로 넘어가면 앞의 대화는 새 특장사에게 안 보인다
ALTER TABLE "order_step_comment" ADD COLUMN IF NOT EXISTS "maker_org_id" VARCHAR(30);

-- 지금까지의 대화는 **지금 배정된 특장사**의 것이다. 재배정이 한 번도 되지 않던
-- 상태였으므로(#387) 한 주문의 대화는 모두 한 특장사와 나눈 것이다.
UPDATE "order_step_comment" c
   SET "maker_org_id" = o."maker_org_id"
  FROM "order" o
 WHERE c."order_id" = o."id" AND c."maker_org_id" IS NULL AND o."maker_org_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "order_step_comment_org_idx" ON "order_step_comment"("order_id", "maker_org_id");
