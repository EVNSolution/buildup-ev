-- 단가표 행을 **옵션값에 묶는다.**
--
-- 옵션마다 행이 하나씩 미리 있고, 관리자는 값만 고친다(추가·삭제하지 않는다).
-- 아무 코드나 적어 행을 만들 수 있으면 어느 선택에도 걸리지 않는 유령 줄이 쌓이고,
-- 「이 옵션은 누가 하기로 했더라」를 표에서 답할 수 없게 된다.
--
-- ⚠️ 제약을 **더하기만** 한다. 기존 행·컬럼은 그대로다(CLAUDE.md).
DO $$
BEGIN
    ALTER TABLE "maker_price"
        ADD CONSTRAINT "maker_price_value_code_fkey"
        FOREIGN KEY ("value_code") REFERENCES "option_value"("code")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
