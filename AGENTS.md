# BUILDUP-EV 작업 규칙

## 권한과 우선순위

- 실제 작업자와 최종 결정권자는 `OziinG`다.
- OziinG의 현재 지시, Issue, PR, 미커밋 변경을 가장 높은 우선순위로 보존한다.
- 공개 Issue, PR, Commit에는 실제 작업자 `OziinG`만 남긴다.

## 자동 진행

다음 작업은 묻지 말고 끝까지 수행한다.

- 읽기 전용 조사와 상태 확인
- `git fetch`
- 깨끗한 `main`의 fast-forward 갱신
- 최신 `origin/main` 기준 작업 브랜치 생성
- 요청 범위의 로컬 구현, 테스트, 문서 갱신
- Issue와 Draft PR 작성, 검증 증거 보강

다음 경우에만 멈추고 OziinG에게 알린다.

- 운영 직접 변경 또는 운영 배포
- 비밀값 조회, 출력, 교체
- 운영 데이터나 외부 상태의 삭제
- OziinG의 미커밋 작업을 덮어쓸 위험
- 요청 범위를 실질적으로 바꾸는 결정

## 정본 문서

- 변경 통제: `docs/operations/CHANGE_CONTROL.md`
- 운영 보안: `docs/security/SECURITY_MODEL.md`
- 배포 구조: `deploy/README.md`
- 운영 명령: `deploy/RUN.md`
- 외부 API 계약의 HQ 이관 경계: `docs/security/HQ_HANDOFF.md`

외부 API 계약은 현재 작업 소유 범위가 아니다. BUILDUP-EV 운영 안정화가 끝나기 전에는 새 인증 계약, MachineClient, 계정 subject, 이벤트 스키마를 이 저장소에서 임의로 설계하지 않는다.
