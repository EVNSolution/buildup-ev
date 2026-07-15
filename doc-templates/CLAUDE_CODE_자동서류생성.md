# [Claude Code] 구조변경 서류 자동생성 구현

> 아래 블록 전체를 복사해 Claude Code에 붙여넣으세요.

---

⚠️ **배포·안전 규칙 (CLAUDE.md 참조)**: 배포는 **main push→자동배포뿐**(수동 rsync 금지, git 밖 변경은 소실). main은 **프로덕션 즉시**니 검증된 것만. 인프라는 **추측 말고 `sudo docker ps`/`systemctl` 확인**. `.env`·`*.pem`·`JWT_SECRET`·`DATABASE_URL` 커밋·출력 금지, 서버 `.env` 불가침. DB 변경 전 `pg_dump` 백업. 테스트를 코드에 맞춰 바꾸지 말고 **정답지/제원표 재현**. 서류는 예시 PDF 충실 재현·흑백·후축 기준·탈거/설치만 가변.

---

buildup-ev에 **구조변경 서류 자동생성**을 구현해줘. 옵션 선택 → 값 자동 산출 → Excel 채움 → PDF 출력 → 주문별 저장.

## 이미 준비된 것 (그대로 사용, 재작성 금지)
- `doc-templates/builders/gen_load_calc.py` — **하중계산서 생성기**. 원본 PDF와 픽셀 대조 완료(오차 0.25mm). JSON 입력 → xlsx 출력. **탈거/설치 항목 개수에 따라 행이 자동 가변**.
  - 사용: `python3 gen_load_calc.py data.json out.xlsx`
- `40. 양식/` — 확정된 빈 양식(하중계산서·주요제원대비표·외관도) xlsx/pdf + 예시(4813) 대조본
- `01. 하중계산/PV5_하중계산기_TS모방.xlsx` — TS 구조 + cyberts 검증 수식 + 타이어DB(2,357종) + 드롭다운. **계산 로직의 정답지**
- `doc-templates/option-weights-real.json` — 실측 BOM(옵션→무게·위치)
- `doc-templates/pv5-spec.json` — 차종 고정 제원

## 구현할 것

### 1. 서류 생성 서비스 (backend)
`backend/src/services/docgen.ts`
- 주문 ID를 받아 데이터 조립 → JSON → `python3 gen_load_calc.py` 실행 → xlsx → **LibreOffice(`soffice --headless --convert-to pdf`)로 PDF** → 저장
- 서버에 `python3` + `openpyxl` + LibreOffice 필요 — **없으면 설치 방법을 먼저 확인하고 보고할 것**(추측 설치 금지)

### 2. gen_load_calc.py 의 JSON 스키마 (이대로 채울 것)
```jsonc
{
  "before": {  // 구조변경 전 (오픈베드, pv5-spec)
    "type":"화물차특수용도형","seats":2,"curb":1905,"payload":600,"gvw":2635,
    "wheelbase":2995,"offset":35,
    "length":5040,"width":1895,"height":1950,"bed_len":2420,"bed_wid":1785,"bed_hgt":355
  },
  "after": { /* 동일 키 + tread2f, tread2r, steer_ratio — BOM·load-calc 산출값 */ },
  "extra": { "payload_cut":0, "pusher_w":0, "pusher_d":0, "frame_w":0, "frame_d":0 },
  "load": {   // 축별 하중분포. 키: 전전/전후/후전/후중/후후
    "전전": {"empty_before":1105,"empty_after":1105,"empty_ratio":73.7,
             "full_before":1195,"full_after":1245,"full_ratio":83.0},
    "전후": {...}, "후전": {...}, "후중": {...}, "후후": {...}
  },
  "tire": {
    "전전": {"spec_before":"215/65R16","load_before":750,"spec_after":"215/65R16","load_after":750,"wheels":2},
    "후전": {...}
  },
  "install_items": [ {"name":"탑중량(적재함중량)(냉동탑 저상)","weight":396.7,"dist":-55} ],  // ★가변
  "remove_items":  [ {"name":"기타하중1(오픈베드 데크)","weight":252,"dist":3050} ],          // ★가변
  "crew": {"name":"전방 1열","persons":2,"weight":130,"dist":1895}
}
```
- `dist` = **후축까지 거리(mm)**. BOM의 CG_x(전축기준)에서 `2995 − CG_x` 로 변환.
- `install_items`/`remove_items` 는 **선택 옵션에서 자동 생성** (option-weights-real.json):
  - 탈거 = `기본_탈거`(오픈베드 데크)
  - 설치 = `탑_설치[유형][크기][도어구성]` + `개별_옵션_항목` 중 `무게계산_포함:true` 인 것만
  - **온도기록계·격벽·스포일러는 무게계산 제외**(false). 스포일러는 표준탑 번들.

### 3. 계산 로직 (PV5_하중계산기_TS모방.xlsx 와 동일하게)
- 축하중 분배: `후축반력 = W × CG_x / L`, `전축반력 = W − 후축반력` (L=축간거리)
- **전축 추가하중은 5kg 올림** (cyberts 방식)
- 타이어 부하율 = `축하중 ÷ (허용하중 × 바퀴수) × 100`
- 조향륜 하중분포율 = `적차 전축하중 ÷ 차량총중량 × 100`
- 타이어 허용하중은 **타이어DB(2,357종) VLOOKUP** — `db/seed/tire.csv` 활용
- ★ 검증: PV5 오픈베드 정답지(`99. 구조변경 서류 예시/pv5오픈베드하중계산.pdf`)의 값을 재현해야 함

### 4. API / 저장
- `POST /api/v1/orders/:id/docs/load-calc` → 생성 후 PDF 반환 + 주문별 저장
- 저장: `document` 테이블에 (order_id, type, file_path, generated_at). 파일은 서버 디스크 또는 오브젝트 스토리지
- 관리자·특장사 주문 상세 '서류' 탭에서 생성/다운로드. **영업 화면엔 노출 금지**

### 5. 나머지 서류
- **주요제원대비표**: `40. 양식/Excel/주요제원대비표_양식.xlsx` 기반. 생성기는 `doc-templates/builders/` 에 `gen_spec_compare.py` 로 동일 패턴으로 추가(픽셀 격자는 `40. 양식/_작업중_픽셀대조_진행상황.md` 참조)
- **외관도**: 도면은 플래닝고(VIVAR)가 제공 → 제원표만 채우고 4뷰 영역에 받은 도면 이미지 삽입
- **작업지시서**: `40. 양식/특장제작_작업지시서_양식.xlsx` (EV& 자체 양식)

## 검증 (필수)
1. 4813 예시 데이터로 생성 → `40. 양식/PDF/하중계산서_예시(4813)_대조용.pdf` 와 동일한지 확인
2. **탈거/설치 개수를 바꿔가며** 행이 가변되는지 확인 (설치3/탈거2, 설치1/탈거4 → 모두 A4 1페이지 확인됨)
3. PV5 정답지 값 재현 확인
4. 관리자/특장사 화면에서 실제 생성·다운로드, 콘솔 에러 0

## 주의
- 생성기(`gen_load_calc.py`)의 **픽셀 격자·보정식은 절대 수정 금지** (원본 대조 완료). 값 바인딩만.
  - 보정식: `열폭 w = (px300 + 1.6) / 23.51`, `행높이 = px × 0.24 × 1.015`
