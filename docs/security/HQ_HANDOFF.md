# HQ 이관 경계

이번 BUILDUP-EV 작업은 외부 API 계약을 새로 정의하지 않는다. 현재 목표는 BUILDUP-EV 자체의 배포 재현성, 운영 ENV 정합성, 내부 계정과 권한의 fail-closed 동작을 안정화하는 것이다.

WARP를 포함한 외부 시스템과의 인증 방식, MachineClient, 계정 subject, 요청 서명, 이벤트 스키마, 재전송 정책은 이 변경의 소유 범위가 아니다. 기존 연동 계약은 호환성만 유지하며 확장하거나 재설계하지 않는다.

운영 안정이 확인된 뒤 CLEVER HQ가 외부 호출의 계정, 호출자, capability, correlation, 요청과 응답 증거를 관장하도록 별도 Issue와 승인된 아키텍처 변경으로 이관한다. 그 전까지 BUILDUP-EV 배포 안정화 PR에 HQ 계약 구현을 섞지 않는다.

현재 호환 범위와 발견된 위험, 단계별 이관 순서는 `../integrations/WARP_BUILDUP_DIRECT_API.md`에 기록하고, 기계 검증 정본은 같은 디렉토리의 `WARP_BUILDUP_DIRECT_API.json`으로 유지한다. 이 manifest는 신규 계약을 승인하는 문서가 아니라 이미 병합된 직접 연동을 더 넓히지 않기 위한 변경 통제선이다.
