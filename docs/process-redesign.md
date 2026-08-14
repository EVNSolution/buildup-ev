# 프로세스 이원화 · 발주서 설계 (초안)

> 2026-08-14 회의 내용을 코드에 얹을 수 있는 형태로 옮긴 것. **결정이 필요한 항목은 §7에 모아 두었다.**
> 이 문서가 확정되기 전에는 개별 기능을 만들지 않는다 — 상태 모델이 바뀌면 그 위의 화면·API를 다시 뜯어야 한다.

---

## 1. 지금 구조와 무엇이 다른가

지금은 주문 진행이 **문자열 한 칸**이다.

```
order.status  "제작착수" → "구조변경" → "튜닝신청" → "안전검사" → "튜닝승인" → "인도완료"
```

한 줄이라 표현할 수 없는 것:

- 차가 아직 안 왔는데 특장은 다 만들어진 상태
- 특장을 만드는 중에 튜닝신청을 넣은 상태
- 어느 단계에서 며칠째 멈춰 있는지 (정체 경고의 기준)
- 각 단계의 증빙(사진·서류)이 무엇이고 누가 언제 올렸는지

**특장은 차 위에서 만들어지지 않는다. 따로 만들어서 차가 오면 얹는다.** 그래서 두 갈래가 독립으로 돌고, 중간에 만난다.

---

## 2. 상태 모델 — 네 갈래

```
 [차량]  차량 도착 ──> 임시번호판 반납 ──> 보험 확인 ──> 번호판·등록증 수령 ──> 번호판 장착
              │                                            │
              │  (자동차등록증이 나오면)                     │
              └──────────> [튜닝] 신청서 생성 ──> 전자서명 ──> 승인서 ──┐
                                                                        │
 [특장]  발주서 발행 ──> 수락(납기) ──> 제작 진행 ──> 제작 완료         │
                                                    │                   │
                                                    ▼                   │
                                          [합류] 특장 장착 ─────────────┤
                                                                        ▼
                                                              안전검사 신청·완료
                                                                        ▼
                                                              서류 일체 ──> 인도
```

- **만나는 지점 = 특장 장착.** 차량 도착 + 특장 제작 완료가 둘 다 되어야 얹을 수 있다.
- **합쳐지는 지점 = 안전검사.** 장착된 실물 + 튜닝승인서가 둘 다 있어야 검사에 넣는다. 여기서부터는 한 줄이다.
- **튜닝은 특장과 무관하게 병행한다.** 필요한 것은 자동차등록증(차량 트랙 산출물)뿐이다.

### 트랙을 나눈 기준

트랙은 **누가 하느냐가 아니라 무엇에 관한 일이냐**로 나눈다. 번호판 장착은 특장사가 하지만 차량 트랙이다. 담당이 섞이는 것은 정상이다.

---

## 3. 단계 카탈로그

| 트랙 | 코드 | 단계 | 담당 | 입력 | 증빙(없으면 완료 불가) |
|---|---|---|---|---|---|
| 차량 | `car_arrived` | 차량 도착 | 특장사 | — | 검수사진, 인수증(서명본) |
| 차량 | `temp_plate_returned` | 임시번호판 반납 | 특장사 | — | 반납확인서 |
| 차량 | `insurance_checked` | 보험 확인 | 관리자 | — | 없음(체크만) |
| 차량 | `plate_received` | 번호판·등록증 수령 | 특장사 | — | 없음 |
| 차량 | `plate_mounted` | 번호판 장착 | 특장사 | — | 장착사진, 자동차등록증 |
| 특장 | `po_issued` | 발주서 발행 | 관리자 | 특장사 선택 | — |
| 특장 | `po_accepted` | 발주서 수락 | 특장사 | **납기일** | — |
| 특장 | `build_done` | 제작 완료 | 특장사 | — | — |
| 튜닝 | `tuning_drafted` | 튜닝신청서 생성 | 자동 | 차명·형식·등록번호·차대번호 | — |
| 튜닝 | `tuning_sign_sent` | 전자서명 요청 | 영업 | — | — |
| 튜닝 | `tuning_signed` | 서명 완료 | 자동(웹훅) | — | — |
| 튜닝 | `tuning_approved` | 승인서 수령 | 특장사 | — | 승인서 |
| 합류 | `mounted` | 특장 장착 | 특장사 | — | — |
| 합류 | `inspection_booked` | 안전검사 신청 | 특장사 | **검사예정일** | — |
| 합류 | `inspection_done` | 안전검사 완료 | 특장사 | — | 자동차등록증(변경분) |
| 합류 | `docs_complete` | 서류 일체 | 특장사 | — | (목록 확정 필요) |
| 합류 | `delivered` | 인도 | 영업 | 인도일 | — |

**선행 조건**

```
mounted            ← car_arrived AND build_done
tuning_drafted     ← plate_mounted (자동차등록증이 있어야 4항목을 채운다)
inspection_booked  ← mounted AND tuning_approved
delivered          ← inspection_done AND docs_complete
```

영업 화면에는 `mounted` 이후부터 **인도 예정일**이 보인다.

---

## 4. DB 초안

### 4-1. 단계 진행

단계마다 행을 만든다. 상태를 컬럼 하나로 두지 않는 이유: 단계가 계속 늘어나고(이번 회의에서만 17개), 단계마다 날짜·담당·증빙이 따로 붙고, **정체 일수를 세려면 각 단계에 들어온 시각이 필요**하기 때문이다.

```sql
CREATE TABLE order_step (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES "order"(id),
  code        VARCHAR(40) NOT NULL,      -- 카탈로그(§3)의 코드. 정의는 코드에 둔다
  track       VARCHAR(10) NOT NULL,      -- vehicle | body | tuning | merged
  status      VARCHAR(12) NOT NULL,      -- pending | in_progress | done | skipped
  planned_at  TIMESTAMP(3),              -- 약속한 날 (납기·검사예정일·인도예정일)
  entered_at  TIMESTAMP(3),              -- 이 단계에 들어온 시각 = 정체 경고의 기준
  done_at     TIMESTAMP(3),
  done_by     VARCHAR(120),              -- user.email
  note        VARCHAR(300),
  UNIQUE (order_id, code)
);
```

단계 정의(순서·선행조건·필수증빙·담당역할)는 **코드의 선언 테이블**에 둔다. DB에 두면 그것을 관리하는 화면이 또 필요해진다.

```ts
const STEPS = {
  car_arrived: {
    track: 'vehicle', label: '차량 도착', actor: 'MAKER',
    requires: [],
    evidence: ['inspection_photo', 'receipt'],   // 이게 없으면 done 불가
    stallDays: 3,                                 // 이 일수를 넘으면 경고
  },
  // …
}
```

### 4-2. 증빙 파일

**지금 시스템에는 사용자가 파일을 올리는 기능이 전혀 없다.** `document` 테이블은 이름과 상태(pending/done/na)만 있고 파일 경로 컬럼조차 없다. 새로 만들어야 한다.

```sql
CREATE TABLE order_file (
  id            SERIAL PRIMARY KEY,
  order_id      INT NOT NULL REFERENCES "order"(id),
  step_code     VARCHAR(40) NOT NULL,
  kind          VARCHAR(30) NOT NULL,   -- inspection_photo | receipt | plate_return
                                        -- | plate_mounted | vehicle_reg | tuning_approval | etc
  path          VARCHAR(300) NOT NULL,  -- 릴리스 슬롯 **밖**에 저장한다(배포마다 지워지면 안 된다)
  original_name VARCHAR(200),
  mime          VARCHAR(60),
  size_bytes    INT,
  uploaded_by   VARCHAR(120) NOT NULL,
  uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT now()
);
```

저장 위치는 문서 저장소와 같은 원칙으로 **`/opt/buildup-ev/shared/uploads/`** — 슬롯 안에 두면 다음 배포에 사라진다.

### 4-3. 발주 품목 · 단가

발주서를 보면 **발주 품목은 견적 옵션과 1:1이 아니다.**

| 견적(고객이 고른 것) | 발주서(특장사에 시키는 것) |
|---|---|
| 차종 STEGO-K + 탑크기 저상 + 트림 … | `STEGO K1 저상형` **SET 1** (한 덩어리) |
| 도어종류 = 슬라이딩 | `슬라이딩 도어 변경` **EA 2** (2짝) |
| 격벽 = 그물망 | `격벽(그물망)` **EA 1** |
| — | `운전석 스윙도어` **EA 1** |

즉 **변환 규칙이 필요하다.** 그리고 단가는 판매가가 아니라 원가이고 **특장사마다 다르다.**

```sql
-- 발주서에 인쇄되는 품목 마스터
CREATE TABLE maker_item (
  code       VARCHAR(40) PRIMARY KEY,
  name       VARCHAR(80) NOT NULL,      -- 발주서에 그대로 찍힌다
  unit       VARCHAR(10) NOT NULL,      -- SET | EA
  section    VARCHAR(10) NOT NULL,      -- base(기본형 사양) | option(추가 옵션 사양)
  sort_order INT NOT NULL DEFAULT 0
);

-- 특장사별 단가 (이력 보존 — 단가가 바뀌어도 지난 발주서는 그대로여야 한다)
CREATE TABLE maker_item_price (
  maker_org_id VARCHAR(30) NOT NULL REFERENCES org(code),
  item_code    VARCHAR(40) NOT NULL REFERENCES maker_item(code),
  unit_price   INT NOT NULL,            -- 공급가 (VAT 별도)
  valid_from   DATE NOT NULL,
  PRIMARY KEY (maker_org_id, item_code, valid_from)
);

-- 견적 선택 → 발주 품목 변환
CREATE TABLE maker_item_rule (
  id         SERIAL PRIMARY KEY,
  model_code VARCHAR(30) NOT NULL,
  item_code  VARCHAR(40) NOT NULL REFERENCES maker_item(code),
  match      JSONB NOT NULL,            -- {"TOPSIZE":"LOW"} — 모두 일치하면 적용(조합 조건 가능)
  qty        INT NOT NULL DEFAULT 1
);
```

**발주서는 발행 시점에 값을 굳힌다.** 단가가 나중에 바뀌어도 이미 나간 발주서는 변하면 안 된다 — 견적서·계약서를 고정하는 것(`docs_frozen_at`)과 같은 원칙이다.

```sql
CREATE TABLE purchase_order (
  id           SERIAL PRIMARY KEY,
  order_id     INT NOT NULL UNIQUE REFERENCES "order"(id),
  po_no        VARCHAR(20) NOT NULL UNIQUE,   -- 문서번호 (예: 2026-08-03-01)
  issued_at    TIMESTAMP(3) NOT NULL,
  issued_by    VARCHAR(120) NOT NULL,         -- 배정 버튼을 누른 계정 = 발주서의 EV& 담당자
  maker_org_id VARCHAR(30) NOT NULL REFERENCES org(code),
  supply_total INT NOT NULL,                  -- 공급가액 (VAT 별도)
  lines        JSONB NOT NULL,                -- 품목·단위·수량·단가·공급가액·비고 (굳힌 값)
  note         VARCHAR(1000)                  -- 특이사항
);
```

### 4-4. 조직 정보 확장

발주서의 **공급사 칸(회사명·주소·담당자·전화번호·이메일)을 채울 데이터가 지금 없다.** `org`에는 `name`, `biz_no`뿐이다.

```sql
ALTER TABLE org ADD COLUMN address       VARCHAR(200);
ALTER TABLE org ADD COLUMN contact_name  VARCHAR(60);
ALTER TABLE org ADD COLUMN contact_phone VARCHAR(20);
ALTER TABLE org ADD COLUMN contact_email VARCHAR(120);
```

발주사(EV&) 칸도 같은 자리에서 읽되, **담당자만 배정 버튼을 누른 계정**(`user.name` / `phone` / `email`)에서 가져온다.

---

## 5. 권한 경계

### 지금 새고 있는 것 (설계와 무관하게 즉시 수정 대상)

```
GET /contracts/:id/contract         rbac('ADMIN','SALES','MAKER')   ← 특장사가 계약서를 본다
GET /contracts/:id/contract/signed  rbac('ADMIN','SALES','MAKER')   ← 고객이 서명한 원본까지 본다
```

견적서·계약서 PDF(`/quotes/:id/pdf`, `/quotes/:id/contract-pdf`)는 이미 `SALES`/`ADMIN`으로 막혀 있다. 모두싸인 계약서 두 개만 열려 있다.

### 특장사가 보는 것 / 못 보는 것

| 볼 수 있음 | 볼 수 없음 |
|---|---|
| 발주서(자기 org 것) | 견적서 · 계약서 · 서명본 |
| 주문 사양(옵션 목록) | 고객 판매가 · 실구매가 · 보조금 |
| 구조변경 서류 | 다른 특장사의 발주서 · 단가 |
| 자기 단계와 증빙 | |

### 제조운영

**별도 화면을 만들지 않는다.** 관리자 페이지 + 관리자 계정을 쓰고, 기능모듈 ON/OFF로 탭 단위 권한을 조절한다. 이미 `access_control`(role/user × module) 구조가 있어 계정별로 켜고 끌 수 있다.

추가할 모듈 코드(안):

```
order.step.vehicle   차량 단계 처리
order.step.body      특장 단계 처리
order.step.tuning    튜닝·인허가 단계 처리
order.po.issue       발주서 발행(= 품의 승인)
order.po.price       발주 단가 관리
order.file.view      증빙 파일 열람
```

`order.po.issue`를 특정 계정에만 켜면 「알파님 고정」이 된다. **고정하되 대리 승인자를 한 명 더 켜 두는 것을 권한다** — 그 계정이 부재중이면 전 주문이 멈춘다.

---

## 6. 알림

### 원칙

- **정해진 시각에 몰아서 보낸다.** 단계가 17개인데 건건이 보내면 하루에 열 통이 되고, 열 통이 되는 순간 아무도 안 본다.
- 즉시 보내는 것은 **사람이 기다리고 있는 것**만: 배정 요청(서명 완료 → 관리자), 튜닝신청서 생성(→ 영업), 서명 완료(→ 특장사).
- 나머지는 **매일 아침 한 통에 묶는다**: 내 할 일 + 정체 중인 건 + 오늘 마감.

### 채널

| 대상 | 채널 | 근거 |
|---|---|---|
| 관리자 · 제조운영 | 회사 메일 | 이미 붙어 있음(Gmail SMTP) |
| 영업 | 메일 + (앱) | |
| **특장사** | **알림톡 또는 앱** | **메일을 잘 안 본다** — 메일로만 보내면 설계가 무의미해진다 |

### 앞당겨야 할 선결 과제

- **알림톡**: 카카오 발신프로필·템플릿 **심사에 2~3주**가 걸린다. 쓸지 확정 전이라도 신청은 지금 걸어 두는 편이 좋다.
- **앱 푸시**: 앱이 필요한 실질적 이유가 여기서 생겼다. 다만 현재 인증이 **쿠키 기반이라 앱에서 그대로 못 쓴다.** Bearer 토큰 + CORS 정리가 선결이다.
- **스케줄러**: 지금 시스템에 cron/스케줄러가 **없다.** 매일 아침 배치를 돌릴 실행 기반부터 필요하다.

---

## 7. 결정이 필요한 것

| # | 항목 | 상태 |
|---|---|---|
| 1 | ~~납기 일수~~ → **15 영업일**(발주서 양식 기준)로 확정 | ✅ 확정 |
| 2 | ~~튜닝승인 ↔ 안전검사 순서~~ → **승인서 → 안전검사**(회의록)로 확정. **현재 파이프라인이 틀린 것**이므로 3단계에서 고친다 | ✅ 확정 |
| 3 | **발주 수량 규칙** — 「슬라이딩 도어 변경 EA 2」의 2는 항상 2인가, 도어 추가 여부에 따라 달라지는가 | 남주 확인 |
| 4 | **문서번호 채번** — `2026-08-03-01` = 날짜 + 일련번호. 일련번호는 하루 단위 리셋인가, 특장사별인가 | 미정 |
| 5 | **차량 발주·출고** — 기아에 차를 넣는 단계가 이 시스템 안에 들어오는가, 밖인가 | 미정 |
| 6 | **`docs_complete`의 서류 목록** — 「추후 전체서류」가 구체적으로 무엇인가 | 미정 |
| 7 | **차량 검수 체크리스트** | 제조운영 요청 중 |
| 8 | **보험** — 지금은 확인(체크)만. 증빙 파일은 파일 업로드 기반이 생긴 뒤 | 확정(1단계 제외) |
| 9 | **인수증의 개인정보** — 고객 서명·이름이 담긴 사진이다. 열람권한·보존기간·파기 기준을 방침에 넣어야 한다 | 기능 우선, 방침은 후속 |

**확정된 것**

- 거절 기능은 만들지 않는다 → **재배정으로 처리**(재배정하면 수락이 초기화된다 — 이미 구현됨)
- 품의 승인자는 **기능모듈 ON/OFF로 계정별 지정**
- 제조운영은 **관리자 페이지 · 관리자 계정** 공용
- 보험은 **확인만**
- 알림은 **정해진 시각에 몰아서**

---

## 8. 진행 순서

```
0단계 (지금 바로 · 설계와 무관)
  · 특장사 계약서 접근 차단 (2줄)
  · 서명 완료 → 관리자에게 배정 요청 메일
  · 납기 입력 + N일 이내 강제

1단계 (기반)
  · order_step + 단계 카탈로그 — 기존 주문 마이그레이션 포함
  · 파일 업로드 기반 (저장소 · 권한 · 크기 제한)

2단계 (발주서)   ← 남주 확인(품목·수량·단가) 대기
  · maker_item / maker_item_price / maker_item_rule
  · 발주서 PDF 생성 + 발행 시점 고정
  · 특장사 수락 화면에서 발주서 먼저 보이기

3단계 (차량 · 튜닝 트랙)
  · 차량 도착 · 번호판 · 보험 · 등록증
  · 튜닝신청서 생성 → 전자서명 → 승인서

4단계 (알림)
  · 스케줄러 + 매일 아침 묶음 발송
  · 정체 경고
  · (알림톡 심사가 끝나 있으면) 특장사 채널 전환
```

**2단계는 남주 확인이 크리티컬 패스다.** 품목·수량 규칙과 특장사별 단가가 없으면 발주서를 만들 수 없고, 발주서가 없으면 특장사 수락 화면도 완성되지 않는다.
