# 견적서 양식(quote-template.html) 데이터 계약

> buildup-ev가 이 표를 보고 각 플레이스홀더에 값을 채운다.
> 계산값 출처 = `shared/pricing` 엔진(견적서자동생성_현행정합_설계.md 참조).
> 렌더 = quote-pdf.ts(puppeteer) → PDF. **1페이지(A4 가로) 확인을 검증 필수 항목으로.**

## 치환 규칙
- `{{ token }}` 스칼라 · `<!-- each:NAME -->…<!-- /each:NAME -->` 반복 · `<!-- if:FLAG -->…` 조건 · `<!-- pad:COL -->` 정렬용 빈행.
- **숫자 포맷**: 천단위 콤마 + " 원". 0도 "0 원". 음수 표기는 견적서 관례대로(예: 구매혜택/보조금은 "(-) 1,189,500 원").
- **정렬**: 렌더 시 세 열의 콘텐츠 행 수를 세고, 부족한 열의 `<!-- pad:COL -->` 위치에 `.blank` 행을 채워 세 열 총행수를 max로 맞춘 뒤 `.final` 행을 출력 → 초기납부금액/부가세환급 줄이 같은 가로선에 정렬.

## 헤더/상단
| 토큰 | 내용 | 출처 |
|---|---|---|
| (로고) | 헤더 로고 | `98. LOGO/LOGO.png`를 **템플릿에 base64 임베드(고정)**. 토큰 아님. 교체 시 img src만 변경 |
| `vehicleModel` | 제목의 차종 부분 | 선택 차종명(예 STEGO-K1). 제목은 `{{ vehicleModel }} 견적서` — "견적서"는 고정 |
| `workDate` | 작성일자 | 입력값(견적 작성일) |
| `salesRep` | 견적 담당 | 로그인 영업담당 or 빈칸 |
| `customerName` | 고객명 | customer.name |
| `modelSubtitle` | 모델 부제 | 예 "STEGO-K1 : PV5 {트림} {탑종류}탑차 – {탑높이}" (옵션 선택 조합) |
| `optionSummary` | 특장 옵션 요약 | 선택 옵션 라벨 나열 |

## 차량 정보 (car.*) — 출처: pricing 엔진
| 토큰 | 의미 |
|---|---|
| `car.price` | ① 차량 가격(트림가, VAT 포함) |
| `car.deliveryFee` | ② 탁송료 |
| **each:benefitRows** | 구매혜택 상세(현대커머셜 할인·공식 파트너십 할인 등). item.label / item.amount |
| `car.benefitTotal` | ③ 구매 혜택 합계 |
| **each:subsidyRows** | 보조금 상세(국고·지방(지역명)·소상공인·택배·경유차전환 중 적용분만). item.label / item.amount |
| `car.subsidyTotal` | ④ EV보조금 합계 |
| `car.paymentAmount` | 차량 결제 금액 (①+②-③-④) |
| `car.downPayment` | 계약금(차량, DB 상수) |
| `car.advancePayment` | 선수금(선수금비율 반영) |
| `car.deliveryPayment` | ⑤ 인도금(차량) |
| `car.acqTax` | 차량 취득세(EV감면 반영) |
| `car.bondDiscount` | 공채할인액(서울+일반인만, 그 외 0) |
| `car.plateFee` / `car.stampFee` / `car.insuranceFee` / `car.regAgencyFee` | 번호판·증지대·의무보험료·등록대행료(DB) |
| `car.regCost` | ⑥ 등록/부대비용 |
| `car.initialPayment` | 차량 초기 납부 금액 (⑤+⑥) |

## 특장 정보 (top.*)
| 토큰 | 의미 |
|---|---|
| **each:topOptions** | 선택된 특장 옵션 행(탑종류·스포일러·도어옵션·도어추가·온도기록계·격벽 등). item.label(예 "도어옵션 : 슬라이딩") / item.amount |
| `top.priceTotal` | ⑦ 특장 가격(VAT 포함) |
| `top.promoAmount` / `top.promoTotal` | 프로모션 / ⑧ 프로모션 합계 |
| `top.paymentAmount` | 특장 결제 금액 (⑦-⑧) |
| `top.downPayment` | 계약금(특장, DB 상수) |
| `top.deliveryPayment` | ⑨ 인도금(특장) |
| `top.acqTax` | 특장 취득세(2.0%) |
| `top.etcRegFee` | 등록부가수수료 |
| `top.regCost` | ⑩ 등록/부대비용 |
| `top.initialPayment` | 특장 초기 납부 금액 (⑨+⑩) |

## 고객 정보 (cust.*) / 할부 (inst.*)
| 토큰 | 의미 | 출처 |
|---|---|---|
| `cust.name` `cust.bizType` `cust.region` | 고객명·구분·지역 | 입력값 |
| `cust.isSosang` `cust.hasTransportLicense` `cust.dieselStatus` `cust.hasCommercialPlate` | O/X·상태 | 입력값 |
| `cust.advanceRate` | 선수금 비율(예 30%) | 입력값 |
| `inst.car` / `inst.top` | 할부금(차량/특장) | 할부 계산 |
| `inst.total` | 총할부금 | inst.car+inst.top |
| `inst.productName` | 상품명(예 일반형 오토론할부) | DB/설정 |
| `inst.interestRate` | 이율(할부개월수별) | InstallmentRate 테이블 |
| `inst.interest` | 할부이자 | 월납입금×개월−원금 |
| `inst.termMonths` | 이용기간(개월) | 입력값 |
| `inst.monthlyPayment` | 월 납입금 | PMT 계산 |
| `cust.vatRefundPrice` | 부가세 환급 시 가격 | 계산 |

## 메모/하단
| 토큰 | 내용 |
|---|---|
| (고정문구) | 좌측 "고객님께서 꼭 알아두셔야 할 사항"은 2줄 고정("탁송료 및 보조금 등은…", "당사의 프로모션은 매달…"). **템플릿에 하드코딩**, 변동 항목 없음. 수정 시 quote-template.html에서 직접 변경 |
| `memoText` | 우측 메모/안내문 작성 내용(자유 입력, 비어도 됨) |
| `footerNote` | 하단 각주(예: 참고용 문구) |

## 확장 가이드
- 라벨·행 추가/삭제: quote-template.html만 수정. 새 값=`{{ }}`, 새 반복행=`each` 블록.
- 표시 항목 on/off: `<!-- if:FLAG -->` 로 감싸 조건부 처리.
- 양식 개정 시에도 이 데이터계약의 토큰명을 유지하면 렌더 코드 변경 불필요(양식만 교체).
- 스타일(가로선 굵기·폰트·A4가로·행높이 4.5mm)은 `<style>`에서 일괄 관리.
