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
