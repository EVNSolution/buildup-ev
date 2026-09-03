-- 대화에 사진 첨부. 파일 자체는 증빙과 같은 곳(order_file, kind='chat')에 저장하고
-- 여기서는 그 id 만 가리킨다 — 저장 경로·크기 제한·다운로드 길을 새로 만들지 않는다.
-- ⚠️ 컬럼 하나만 더한다(NULL 허용). 기존 대화는 그대로다.
ALTER TABLE "order_step_comment" ADD COLUMN IF NOT EXISTS "image_file_id" INTEGER;
