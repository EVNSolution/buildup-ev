# WARP–BUILDUP-EV 직접 연동 계약

- Owner: `OziinG`
- 상태: `compatibility-frozen`
- 추적: [WARP #38](https://github.com/EVNSolution/EVN-WARP/issues/38), [BUILDUP-EV #241](https://github.com/EVNSolution/buildup-ev/issues/241)

## 목적

두 시스템의 직접 API는 업무 Data Plane으로 유지한다. CLEVER HQ는 모든 호출을 대신 처리하는 중앙 프록시가 아니라, 승인된 Account와 MachineClient, capability, correlation, Operation 결과를 증명하는 Control Plane이다.

이 문서는 이미 운영 코드에 들어온 직접 연동의 현재 범위를 고정한다. 신규 인증 체계나 endpoint를 설계하지 않으며, 현재 동작을 바꾸지 않는다.

## 현재 계약

| 제공 시스템 | 호출 시스템 | Method | Path | Capability |
| --- | --- | --- | --- | --- |
| WARP | BUILDUP-EV | GET | `/api/external/customer-lookup` | 정확 일치 고객 조회 |
| WARP | BUILDUP-EV | POST | `/api/external/deal-events` | 딜 이벤트 적재 |
| BUILDUP-EV | WARP | GET | `/api/external/customers` | 고객 export |
| BUILDUP-EV | WARP | POST | `/api/external/customers/link` | 승인된 고객 연결 write-back |
| BUILDUP-EV | WARP | GET | `/api/external/quotes/:id/quote-pdf` | 견적서 조회 |
| BUILDUP-EV | WARP | GET | `/api/external/quotes/:id/contract-pdf` | 계약서 조회 |

기계 판독 정본은 `WARP_BUILDUP_DIRECT_API.json`이다. `npm run test:integration-contract`는 실제 route와 caller가 이 목록을 벗어나면 실패한다.

## 현재 보호와 남은 위험

- 공유 key는 코드·로그가 아닌 운영 Secret에 있고 상수 시간 비교를 사용한다.
- 고객 조회는 이름과 전화번호 완전 일치, 응답 DTO 화이트리스트, `no-store`를 적용한다.
- WARP의 BUILDUP 고객 가져오기는 사용자 승인 후 write-back한다.
- 하나의 key가 여러 방향과 capability를 함께 보호하므로 유출 영향 범위가 넓다.
- BUILDUP-EV의 딜 이벤트 발신은 durable Outbox가 아니므로 장애가 길어지면 전달 증거가 유실될 수 있다.
- 현재 직접 호출만으로는 Account, 승인 revision, 요청·응답, 업무 commit 결과를 HQ에서 시간축으로 재구성할 수 없다.

## 변경 규칙

1. endpoint, method, path, caller 또는 capability 변경은 두 저장소 manifest를 함께 갱신한다.
2. 양쪽 Owner Issue와 PR을 상호 링크하고 `OziinG` 검토 근거를 남긴다.
3. 응답 DTO 확대, 쓰기 범위 확대, key 재사용 확대는 호환 수정으로 취급하지 않는다.
4. secret 값, header 원문, 고객 payload는 Issue, PR, Commit 또는 HQ evidence에 기록하지 않는다.

## HQ 이관 순서

1. 방향별 MachineClient와 최소 capability를 분리한다.
2. BUILDUP-EV 이벤트 발신을 transactional Outbox로 바꾸고 재전송을 검증한다.
3. correlation과 idempotency를 WARP 결과, HQ Gateway, Operation evidence에 연결한다.
4. 병행 운영과 장애 복구를 확인한 뒤 기존 shared key를 회전하고 폐기한다.

HQ 장애 중에도 마지막 승인 정책 아래 직접 Data Plane은 계속 동작해야 한다. HQ 연결 실패를 업무 성공으로 기록하거나, 반대로 HQ 장애 때문에 정본 업무 transaction을 중단해서는 안 된다.

## 롤백

이번 변경은 문서, manifest, CI 검증만 추가한다. 문제가 생기면 검증 wiring을 되돌릴 수 있지만, 기존 endpoint와 secret은 변경하거나 삭제하지 않는다. manifest 삭제는 계약 해제가 아니며 별도 Owner 승인 없이 허용하지 않는다.


## 제안: 연결 고객의 최종 견적 선택 (2026-10-16)

상태: **사용자 명시 승인 / 배포 전 검증 완료**. [WARP #166](https://github.com/EVNSolution/EVN-WARP/issues/166), [BuildUP EV #483](https://github.com/EVNSolution/buildup-ev/issues/483).
검토 PR: [WARP #167](https://github.com/EVNSolution/EVN-WARP/pull/167), [BuildUP EV #484](https://github.com/EVNSolution/buildup-ev/pull/484).
기존 계약 고정 범위와 별도로 아래 두 GET을 확장하는 제안이며, 양쪽 manifest를 같은 내용으로 검토한다. 공유키 보호를 사용하지만 이번 연결 고객 견적 조회·금액 보관·WARP 반영과 배포 범위에 한해 2026-10-16 사용자 명시 승인이 확인되었다. 실제 GitHub 실행 계정은 SUMZ711이며 OziinG가 실행한 것으로 기록하지 않는다.

| Method | 제공 경로 | 용도 |
| --- | --- | --- |
| GET | `/api/external/customers/:warpCustomerId/quotes` | 명시적으로 연결된 고객의 공개 견적 목록, 최신 100건 + hasMore |
| GET | `/api/external/customers/:warpCustomerId/quotes/:quoteId` | 같은 고객 소유 견적의 수치와 PDF 스냅샷 |

### 수치와 원본

- 목록 DTO: `id, quoteNo, status, model, updatedAt, sentAt, frozenAt`. 저장·이메일 발송·서류 고정을 구분하며 고객 수락을 추정하지 않는다.
- 스냅샷 DTO: `quoteId, quoteNo, warpCustomerId, updatedAt, frozen, model, spec, grossAmountWon, amountWon, version, pdfBase64, pdfSha256`.
- `grossAmountWon`: 같은 PDF 생성에 사용한 `car_price + body_price`의 원 단위 값. VAT 포함, 탁송료 제외. 무상옵션·단가 입력 등 원본 계산 조건을 따른다. PDF의 특장 결제금액(body_payment)이나 컨피규레이터의 탁송료 포함 시작금액과 혼동하지 않는다.
- `amountWon`: 같은 계산의 `real_price`. BuildUP 견적 목록의 **실구매가(기타 포함)**와 같은 기준으로 등록비·부대비용을 포함한다. 컨피규레이터의 별도비용 제외 실구매가(netPrice)와 구분한다.
- 수치와 PDF는 한 번의 원본 계산 결과에서 얻는다. WARP는 계산식을 복제하지 않는다. 조회 렌더는 고객 보관함 기록을 생성하지 않는다.
- 향후 서류 고정 시 PDF 해시와 당시 수치를 `.warp.json`으로 함께 보관하며 기존 서류 정리 대상에도 포함한다. 기존 고정 PDF에 수치 원본이 없거나 해시가 다르면 409를 반환하여 수기 입력을 안내한다. 과거 금액을 현재 단가로 추정하거나 역산하지 않는다.
- 원본 버전은 고객 연결·견적 revision·수치의 해시로 비교하고 PDF 바이트 해시는 별도로 보존한다. PDF 생성시각 차이로 동일 업무 수치의 적용을 막지 않는다.

### WARP 저장 흐름

1. 로그인한 담당자 또는 전체 리드 권한자가 B2C 성숙리드에서 조회한다. 고객 alias가 아닌 정본 ID를 사용한다. 연락처·이름으로 자동 연결하지 않는다.
2. 견적을 골라 모델·사양·두 금액을 확인하고 적용한다. 기존 값이 있으면 교체 사유가 필요하다. 미저장 화면은 먼저 저장한다.
3. 서버가 같은 원본을 다시 조회해 미리보기 버전을 확인한다. 클라이언트가 보낸 금액은 사용하지 않는다. 현재 리드 revision과 고객 연결을 트랜잭션 안에서 재검증한다.
4. PDF 첨부와 수치를 함께 저장하고 원본 ID·버전·PDF 해시를 기존 변경기록에 남긴다. 실패한 저장의 새 파일은 정리한다. 기존 첨부와 계약금은 유지한다.
5. 고객과 합의한 확정일과 최종 확정 체크는 비운다. 사용자가 날짜를 확인해 저장하고 기존 전환 조건을 만족해야 다음 단계로 간다. 견적 작성일을 합의일로 대입하지 않는다.
6. 기존 수기 금액·누락된 총액은 변환하지 않는다. 새 총액은 선택 필드이며 schema migration이나 일괄 데이터 변경이 없다.

### 검증 및 배포 전제

- 로컬: WARP 영업 절차 30건, BuildUP 가져오기 21건, BuildUP 견적 관련 19건 통과. 양쪽 타입 검사와 계약 검사 통과.
- 합성 고객으로 PC·390px 모바일에서 선택·저장·새로고침 후 유지, 두 금액, PDF 첨부, 확정일 공란 및 단계 유지 확인.
- LeadDetailClient 기존 lint 2 오류·14 경고가 기준 revision에도 동일하게 존재한다. 새 독립 파일과 수정 영업절차 모듈 lint는 통과. 전체 lint 성공으로 보고하지 않는다.
- 운영 데이터/실제 고객/실제 BuildUP 인증으로 연결한 통합 검증은 미실시. 합성 원본 서버를 사용한 로컬 UI 검증이다.
- 이번 범위 사용자 명시 승인 확인 → BuildUP 제공 기능 배포 → WARP 소비 기능 배포 → 권한 있는 검증 고객의 원본/PDF/두 금액 대조 순서다. 기존 고객·견적 입력값의 일괄 변경과 별도 권한 확대는 승인 범위에 포함하지 않는다.
- 롤백 시 두 GET 소비·제공 기능을 함께 비활성화한다. 추가한 총액 JSON 필드와 PDF/수치 보관 파일을 삭제하거나 고객을 병합하지 않는다. 기존 수기 입력은 유지한다.
