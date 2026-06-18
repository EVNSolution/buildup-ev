# buildup-ev 데이터베이스 스키마 설계서 (v0.1 draft)

> 목적: 플래닝고/개발 논의 전, EV&가 사전 정의·구축해야 하는 **전체 DB와 구조**를 컬럼·키 수준으로 확정.
> 표기: `[확정]` 합의됨 · `[권장]` 내 제안(검토 필요) · `[결정필요]` 선택 안건 · `PK` 기본키 · `FK→` 외래키 참조
> 공통 규약:
> - 모든 테이블 `id` BIGINT PK (auto). 표의 `*_id`는 의미상 키(실제 PK/FK 컬럼).
> - 기준데이터: `active` BOOL, `updated_at`, `updated_by` 공통 부여. 거래데이터: `created_at` 공통.
> - 금액 `DECIMAL(12,2)`, 비율 `DECIMAL(6,4)`, 치수 `INT(mm)`, 코드 `VARCHAR`.
> - 타입은 표준 SQL 기준(MySQL/PostgreSQL 호환). 최종 DBMS는 개발/배포 담당과 협의.

---

## 클러스터 A — 제품·옵션 정의 (backbone)

### A1. `vehicle_model` 차종마스터 `[확정]`
차종마다 1행. 하중계산 '튜닝 전' 값 + 법규 check① 기준.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| model_id | BIGINT | PK | |
| code | VARCHAR(30) | UQ | 내부코드 (PV5_OPENBED 등) |
| name | VARCHAR(60) | | 표시명 (PV5 오픈베드) |
| drive_type | VARCHAR(10) | | 구동방식 (4x2) |
| seats_default | INT | | 기본 승차정원 |
| length_mm / width_mm / height_mm | INT | | 전장·전폭·전고 |
| wheelbase_mm | INT | | 축간거리 |
| tread_front_mm / tread_rear_mm | INT | | 윤간거리 |
| curb_weight_kg | INT | | 공차중량 |
| curb_axle_front_kg / curb_axle_rear_kg | INT | | 공차 축하중분포(전/후) |
| gvw_limit_kg | INT | | 제작허용총중량 (법규 check①) |
| max_length_mm / max_width_mm / max_height_mm | INT | | 최대허용제원 (법규 check①) |
| default_tire_front_id / default_tire_rear_id | BIGINT | FK→tire | 기본 타이어 |
| active | BOOL | | |

> `[권장]` 제원대비표 전 항목(원동기·연비·차대번호 등)이 필요하면 1:1 `vehicle_spec` 테이블로 확장. 핵심 계산값은 위로 충분.

### A2. `option_group` 옵션그룹 `[확정]`
선택의 "축" + 규칙.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| group_id | BIGINT | PK | |
| category | ENUM | | 차량옵션 / 특장 / 내부옵션 |
| name | VARCHAR(40) | | 트림·적재함유형·탑크기·도어종류·도어추가·온도기록계·격벽 |
| select_type | ENUM | | single / toggle / matrix / custom |
| required | BOOL | | 필수 선택 여부 |
| sort_order | INT | | |
| active | BOOL | | |

### A3. `option_group_model` 그룹↔차종 적용 (M:N) `[보류 — 단일 차종이라 추후 도입]`
어떤 옵션그룹이 어떤 차종에 노출되는지.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| group_id | BIGINT | FK→option_group | |
| model_id | BIGINT | FK→vehicle_model | |

### A4. `option_value` 옵션값 `[확정]`
그룹별 선택지(+가격·BOM이 참조하는 단위).

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| value_id | BIGINT | PK | |
| group_id | BIGINT | FK→option_group | |
| code | VARCHAR(30) | | |
| name | VARCHAR(40) | | 베이직·플러스 / 내장·냉동 / 저상·표준 / 여닫이·슬라이딩 / 없음·그물망·냉동격벽 / O·X |
| vivar_code | VARCHAR(40) | | 3D 매핑키 (VIVAR 연동용, 현재 비어둘 수 있음) |
| sort_order | INT | | |
| active | BOOL | | |

---

### A5. `option_rule` 옵션 제약/종속 `[확정]`
옵션 간 종속·제약을 데이터로 표현. 조건옵션값 선택 시 대상(그룹/값)을 비활성/필수/숨김.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| rule_id | BIGINT | PK | |
| when_value_id | BIGINT | FK→option_value | 조건: 이 값이 선택되면 |
| effect | ENUM | | disable(비활성) / require(필수) / hide(숨김) |
| target_type | ENUM | | group / value |
| target_id | BIGINT | FK→option_group 또는 option_value | 대상 |
| note | VARCHAR | | |

> 예: when=내장(BODY_DRY) · effect=disable · target=group TEMP → **"내장탑에서 온도기록계 불가"**. 새 종속관계 = 행 추가. 프론트는 UI 차단, 견적엔진은 위반 조합 필터.

---

## 클러스터 B — 영업 가격 (옵션베이스 견적)

### B1. `option_price` 단순 옵션가 `[확정]`
트림·탑크기·온도계·격벽 등 단일 옵션값 단가.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| model_id | BIGINT | FK→vehicle_model (NULL=공통) | 트림가는 차종 의존 |
| value_id | BIGINT | FK→option_value | |
| supply_price | DECIMAL(12,2) | | 공급가 기여분(VAT 별도) |
| memo | VARCHAR | | 비고 (effective_from은 v0.1에서 제외 — 변경 시 덮어쓰기) |
| active | BOOL | | |

### B2. `door_unit_price` 도어 단품가격 (룰베이스) `[확정]`
DB는 도어 **단품가격만** 관리. 조합가는 룰로 계산.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| model_id | BIGINT | FK→vehicle_model | |
| top_value_id | BIGINT | FK→option_value | 저상/표준 |
| doortype_value_id | BIGINT | FK→option_value | 여닫이/슬라이딩 |
| unit_price | DECIMAL(12,2) | | 단품가격 (저상여닫이 480,000 / 저상슬라이딩 760,000 / 표준여닫이 520,000 / 표준슬라이딩 820,000) |

> **계산 룰**: `도어가 = (선택종류 단품 − 기본종류 단품) + (도어추가 시 + 선택종류 단품)`. 기본 = 여닫이·1개(조수석).
> 위 4개 단품값으로 견적서 8조합 정확 재현(검증완료). 예: 저상슬라이딩+추가 = (760k−480k)+760k = 1,040k ✓

### B3. `region` 지역 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| region_id | BIGINT | PK | |
| sido | VARCHAR(20) | | 경기 |
| sigungu | VARCHAR(30) | | 남양주시 |
| name | VARCHAR(50) | | 경기 남양주시 (표시명, UQ) |

### B4. `subsidy_national` 국고보조금 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| model_id | BIGINT | FK→vehicle_model | |
| year | INT | | 연도 |
| amount | DECIMAL(12,2) | | 국고 (11,500,000) |
| sosang_rate | DECIMAL(6,4) | | 소상공인 할인율 (0.3000) |

### B5. `subsidy_local` 지방보조금 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| region_id | BIGINT | FK→region | |
| year | INT | | |
| amount | DECIMAL(12,2) | | 지방보조금 (남양주 3,450,000) |
| extra | DECIMAL(12,2) | | 추가보조(옵션DB L열, 용도 확인 필요) |
| remaining_quota | INT | NULL | `[결정필요]` 잔여물량(소진 추적). 정적 보관 vs 런타임 외부조회 |
| as_of | DATE | NULL | 잔여물량 기준일 |

### B6. `tax_config` 세율·등록비용 `[확정]`
key-value 설정 + 이력.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| param_key | VARCHAR(40) | | acq_tax_rate(0.05)·special_acq_tax_rate(0.02)·acq_tax_relief_cap(1,400,000)·stamp(2,500)·plate(25,000)·reg_agency(50,000)·delivery_fee(179,000)·etc_fee(50,000) |
| value | DECIMAL(12,4) | | |
| effective_from | DATE | | |

---

## 클러스터 C — 특장 원가 (원가기반 견적)

### C1. `material` 원자재마스터 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| material_id | BIGINT | PK | |
| code / name | VARCHAR | | 알루미늄 0.65T 판넬 등 |
| unit | ENUM | | kg / m2 / m / ea |
| unit_price | DECIMAL(12,2) | | 단위당 단가 |
| unit_weight | DECIMAL(10,3) | | 단위무게/비중 (kg/㎡ 등) |
| updated_at | DATETIME | | 시장가 변동 추적 |

### C2. `part` 부품마스터 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| part_id | BIGINT | PK | |
| code / name | VARCHAR | | 냉동기·도어·조명·격벽·온도계 |
| unit_price | DECIMAL(12,2) | | |
| weight_kg | DECIMAL(10,3) | | 부품 무게(하중계산용) |
| updated_at | DATETIME | | |

### C3. `process` 공정·인건비 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| process_id | BIGINT | PK | |
| code / name | VARCHAR | | 절단·조립·도장 |
| cost_basis | ENUM | | area / time / ea |
| unit_cost | DECIMAL(12,2) | | 기준당 비용 |
| labor_rate | DECIMAL(12,2) | | 인건비 임률 |

### C4. `margin_rule` 마진·관리비 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| scope | VARCHAR(40) | | 적용 범위(전체/차종/카테고리) |
| type | ENUM | | percent / fixed |
| value | DECIMAL(12,4) | | |

### C5. `bom_line` 구성표(레시피) `[권장 — 핵심 결정필요]`
옵션·치수 → 소요 원자재/부품/공정. **원가·무게를 동시에 산출하는 핵심 객체.**

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| bom_line_id | BIGINT | PK | |
| model_id | BIGINT | FK→vehicle_model | |
| trigger_type | ENUM | | always / option_value / option_combo |
| trigger_value_id | BIGINT | FK→option_value, NULL | 이 옵션 선택 시 적용 |
| trigger_combo | JSON | NULL | 조합 조건(다중 value_id) |
| item_type | ENUM | | material / part / process |
| item_id | BIGINT | | 위 타입의 마스터 PK 참조 |
| qty_type | ENUM | | fixed / formula |
| qty_value | DECIMAL(12,3) | NULL | 고정수량 (도어 2개) |
| qty_formula | TEXT | NULL | 치수함수 식 (아래) |
| note | VARCHAR | | |

> **`[결정필요]` 치수함수(qty_formula) 표현 방식**
> - `[확정]` **수식 문자열** + 정의된 변수셋을 계산시 안전 평가. 예: 판넬 = `2*(Ldeck_out*Hdeck_out + Wdeck_out*Hdeck_out)/1e6` (㎡).
>   변수: `Ltotal,Wtotal,Htotal`(전체 외측) · `Ldeck_out,Wdeck_out,Hdeck_out`(하대 외측) · `Ldeck_in,Wdeck_in,Hdeck_in`(하대 내측) · `offset,wheelbase` (모두 mm). ※ 상승높이(top_rise) 제외(상승탑 미판매).
> - 내측 = 외측 − 판넬두께(material)로 역산 가능 → VIVAR는 '박스 치수'만 제공.

---

## 클러스터 D — 하중·도면

### D1. `tire` 타이어DB `[확정]` (2,356행 보유)
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| tire_id | BIGINT | PK | |
| spec | VARCHAR(40) | UQ | 형식 (215/65R16) |
| allowable_load_kg | INT | | 허용하중 (750) |

### D2. `drawing` 도면 라이브러리 `[확정]`
세부설계도 사전등록 → 자동추출.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| drawing_id | BIGINT | PK | |
| model_id | BIGINT | FK→vehicle_model | |
| applies_combo | JSON | NULL | 적용 옵션조합/태그 |
| doc_type | VARCHAR(30) | | 세부설계도 등 |
| file_path | VARCHAR(255) | | |
| version | VARCHAR(20) | | |
| uploaded_at | DATETIME | | |

---

## 클러스터 E — 거래 / 워크플로우

### E1. `customer` 고객 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| customer_id | BIGINT | PK | |
| name | VARCHAR(60) | | |
| biz_type | ENUM | | 개인사업자 / 법인사업자 / 간이과세자 |
| is_sosang | BOOL | | 소상공인 |
| region_id | BIGINT | FK→region | 보조금 산정 |
| scrap_diesel | BOOL | | 경유차 폐차 여부 |
| phone | VARCHAR(20) | | |
| created_at | DATETIME | | (※ 신용정보 미보관 — 신용조회는 buildup 외부) |

### E2. `quote` 견적 `[확정]`
확정 시점 금액을 스냅샷으로 고정.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| quote_id | BIGINT | PK | |
| customer_id | BIGINT | FK→customer | |
| model_id | BIGINT | FK→vehicle_model | |
| status | ENUM | | draft / confirmed |
| supply_price | DECIMAL(12,2) | | 공급가액 |
| vat / vehicle_price | DECIMAL(12,2) | | 부가세 / VAT포함 차량가 |
| subsidy_national / subsidy_local / subsidy_sosang / subsidy_total | DECIMAL(12,2) | | |
| applied_price | DECIMAL(12,2) | | 보조금 적용가 |
| vat_refunded_price | DECIMAL(12,2) | | 부가세 환급 후 (영업 강조값) |
| reg_cost / etc_cost | DECIMAL(12,2) | | 등록비용 / 기타 |
| real_price | DECIMAL(12,2) | | **실구매가 (최종)** |
| options_snapshot | JSON | | 선택 옵션·치수 스냅샷(확정 고정) |
| created_at | DATETIME | | |

### E3. `order` 주문 `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| order_id | BIGINT | PK | |
| quote_id | BIGINT | FK→quote | |
| customer_id | BIGINT | FK→customer | |
| model_id | BIGINT | FK→vehicle_model | |
| status | ENUM | | 견적확정 / 관리자검증 / 제작착수 / 구조변경 / 튜닝신청 / 안전검사 / 튜닝승인 / 인도완료 |
| approved_by / approved_at | | | 관리자 검증 게이트 |
| created_at | DATETIME | | |

### E4. `order_option` 주문옵션 (주문↔옵션값 M:N) `[확정]`
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | BIGINT | PK | |
| order_id | BIGINT | FK→order | |
| value_id | BIGINT | FK→option_value | |
| custom_json | JSON | NULL | 커스텀 치수 등(커스텀 탑크기 → 원가기반 견적) |

### E5. `document` 문서보관함 `[확정]`
고객/주문별 서류 통합 보관. 필수서류 완결성 게이트.

| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| doc_id | BIGINT | PK | |
| order_id | BIGINT | FK→order | |
| doc_type | ENUM | | 견적서·계약서·제원대비표·외관도·하중계산서·**작업지시서**·세부도면·예비변경허가서·자동차등록증·튜닝승인서 |
| source | ENUM | | auto(자동생성) / manual(수동업로드) |
| file_path | VARCHAR(255) | | |
| is_required | BOOL | | 필수서류 여부(게이트) |
| status | ENUM | | 대기 / 완료 |
| uploaded_at | DATETIME | | |

---

## 관계 요약 (FK 맵)
- A: vehicle_model · option_group 1—N option_value · option_rule(when_value→target group/value) · (option_group_model 보류)
- B: option_price→(model, value) · door_unit_price→(model, top, doortype) · subsidy_local→region · subsidy_national→model
- C: bom_line→(model, option_value/combo, material|part|process) · 원가=Σ(bom 소요량×마스터 단가) · 무게=Σ(bom 소요량×마스터 단위무게)
- D: vehicle_model→tire(기본) · drawing→model
- E: customer 1—N quote 1—1 order 1—N order_option N—1 option_value · order 1—N document · customer/quote/order→model

## 설계 결정 (현황)
1. **도어 가격** — `[해결]` 단품가격 4값 + 룰((선택−기본)+추가시 단품). 견적서 8조합 재현 검증 → `door_unit_price`
2. **종속 옵션** — `[해결]` `option_rule`(A5)로 제어 (예: 내장탑→온도계 비활성)
3. **BOM 치수함수** — `[해결]` 수식 문자열 채택 (변수: 전체/하대 외측·내측, offset, wheelbase)
4. **지방보조금 잔여물량** — `[미정]` 공식 API 불명 → 주문 시점 ev.or.kr 확인(DB 비움)
5. **제원 상세** — `[미정]` vehicle_model 확장 vs 별도 vehicle_spec(1:1)
6. **VIVAR 수신 치수** — `[확정]` 전장·전폭·전고(특장 반영) + 하대 외측/내측 L/W/H + offset. 축간거리·윤간거리는 차종마스터 고정

## 참고
- 변동 잦아 관리 핵심: subsidy_*, material/part 단가, option_price/door_unit_price
- 마스터 갱신 → 전 견적 자동 반영(값 미저장, 키 참조)
- 출처: buildup-ev_기획서_v0.1.md §B · 견적서 엑셀 · 타이어DB · cyberts 하중계산
