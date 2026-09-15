-- 도어 변경 발주 수량은 이제 선택으로 정한다(도어 추가 없으면 1, 있으면 2 — shared/docs/po-lines lineQty).
-- 단가표 메모의 「좌·우 2개」는 틀린 설명이 되어 발주서 비고에 그대로 찍히므로 **그 문구만** 걷어낸다.
-- 행·컬럼·단가는 건드리지 않는다. qty 컬럼도 남겨 둔다(읽지 않을 뿐).
UPDATE "maker_price"
SET "memo" = replace("memo", ' · 좌·우 2개', '')
WHERE "group_code" = 'DOORTYPE' AND "memo" LIKE '%좌·우 2개%';
