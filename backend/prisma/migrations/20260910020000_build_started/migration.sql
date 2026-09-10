-- 특장 트랙을 **착수 / 완료** 둘로 나눈다.
--
-- 완료 하나만 두면 「받아는 놨는데 손도 안 댔다」와 「만들고 있다」가 구분되지 않는다.
-- 납기가 다가올 때 물어봐야 하는 것이 바로 그 차이다.
--
-- ⚠️ **진행 중인 주문이 모순 상태가 되지 않게** 기존 행을 채운다.
--    새 단계는 완료의 선행조건이라, 이미 제작 완료인 주문에 착수가 비어 있으면
--    「완료됐는데 착수는 안 함」이 되고 되돌리기 로직도 갈 곳을 잃는다.
--    이미 완료한 주문은 실제로 착수도 했으므로 같은 시각·같은 사람으로 채운다.
INSERT INTO "order_step" ("order_id", "code", "track", "status", "entered_at", "done_at", "done_by", "note")
SELECT s."order_id", 'build_started', 'body', 'done', s."entered_at", s."done_at", s."done_by",
       '기존 제작 완료 건 — 착수 단계가 생기면서 함께 채움'
  FROM "order_step" s
 WHERE s."code" = 'build_done' AND s."status" = 'done'
ON CONFLICT ("order_id", "code") DO NOTHING;

-- 아직 완료 전인 주문에는 **빈 착수 단계**를 깔아 둔다. 없으면 화면에 칸이 안 그려져
-- 특장사가 누를 자리를 찾지 못한다(진행 중 주문은 단계 행이 미리 깔려 있는 구조다).
INSERT INTO "order_step" ("order_id", "code", "track", "status")
SELECT DISTINCT s."order_id", 'build_started', 'body', 'pending'
  FROM "order_step" s
 WHERE s."order_id" NOT IN (SELECT "order_id" FROM "order_step" WHERE "code" = 'build_started')
ON CONFLICT ("order_id", "code") DO NOTHING;
