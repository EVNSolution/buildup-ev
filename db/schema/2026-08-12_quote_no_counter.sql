-- 견적번호 채번대장 — 배포 시 프로덕션에 **먼저** 만들어야 한다(코드가 이 표를 읽는다).
--
-- 예전엔 남아 있는 견적의 최대번호 +1 로 매겨서, 견적을 지우면 그 번호가 다시 나왔다.
-- 이미 고객에게 나간 견적서·계약서와 같은 번호가 다른 건에 붙으면 되돌릴 수 없으므로,
-- 발급 기록을 견적 행과 분리해 여기에 남긴다. 견적을 지워도 이 값은 줄지 않는다.
CREATE TABLE IF NOT EXISTS quote_no_counter (
  year       INTEGER PRIMARY KEY,      -- 4자리 연도(2026)
  last_seq   INTEGER NOT NULL,         -- 그 해에 마지막으로 발급한 일련번호
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기존 견적번호에서 출발점을 잡는다(같은 번호가 두 번 나가지 않게).
-- ⚠️ 이미 지워진 견적의 번호는 여기서 알 수 없다. 지운 번호가 고객에게 나갔다면
--    아래 UPDATE 로 그 해 last_seq 를 손으로 올려둘 것.
INSERT INTO quote_no_counter (year, last_seq)
SELECT 2000 + LEFT(quote_no, 2)::int AS year,
       MAX(SUBSTRING(quote_no FROM 4)::int) AS last_seq
  FROM quote
 WHERE quote_no ~ '^[0-9]{2}-[0-9]{4}$'
 GROUP BY 1
ON CONFLICT (year) DO UPDATE
   SET last_seq = GREATEST(quote_no_counter.last_seq, EXCLUDED.last_seq),
       updated_at = CURRENT_TIMESTAMP;

-- 예) 2026년에 26-0003 까지 나갔는데 그 견적들을 지운 경우:
-- INSERT INTO quote_no_counter (year, last_seq) VALUES (2026, 3)
--   ON CONFLICT (year) DO UPDATE SET last_seq = GREATEST(quote_no_counter.last_seq, 3),
--                                    updated_at = CURRENT_TIMESTAMP;
