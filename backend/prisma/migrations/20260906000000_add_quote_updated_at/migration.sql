-- 견적서에 찍히는 날짜를 「마지막으로 고친 날」로 바꾸기 위한 컬럼 (추가 전용).
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 기존 견적은 **만든 날 그대로** 둔다.
-- 컬럼을 더한 순간(now())으로 채우면, 아무도 손대지 않은 옛 견적이 전부
-- 「오늘 고친 것」으로 보이고 다시 뽑은 견적서 날짜가 죄다 바뀐다.
UPDATE "quote" SET "updated_at" = "created_at" WHERE "updated_at" <> "created_at";
