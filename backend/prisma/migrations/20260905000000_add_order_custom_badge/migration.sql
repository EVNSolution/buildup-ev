-- 「커스텀」 배지를 관리자가 정하게 한다 (기존 데이터는 건드리지 않고 컬럼만 추가).
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "custom_badge" BOOLEAN NOT NULL DEFAULT false;

-- 지금 화면에 배지가 붙어 있는 주문은 **그대로 유지**한다.
-- 규칙만 바뀌는 것이지, 이미 특장사가 보고 있던 표시를 없애는 변경이 아니다.
-- (예전 규칙 = 비고에 뭐라도 적혀 있으면 배지)
UPDATE "order"
   SET "custom_badge" = true
 WHERE "custom_badge" = false
   AND "remark" IS NOT NULL
   AND btrim("remark") <> '';
