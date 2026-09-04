-- 올린 파일에 **찾을 수 있는 이름**을 붙인다.
--
-- 「IMG_4821.jpg」로는 나중에 아무것도 찾을 수 없다. 서버가 단계 기준으로 이름을 지어
-- 여기 넣는다(특장장착.jpg · 특장장착_증빙_1.jpg).
--
-- ⚠️ `original_name` 은 **건드리지 않는다.** 올린 사람의 기기에 있던 이름은 그대로 남긴다 —
--    분쟁이 생기면 「내가 그때 찍은 그 파일」을 가리키는 것이 그 이름이다.
-- ⚠️ 더하기만 한다. 옛 행은 NULL 로 남고, 화면은 NULL 이면 예전처럼 original_name 을 쓴다.
ALTER TABLE "order_file" ADD COLUMN IF NOT EXISTS "display_name" VARCHAR(200);
