# CLAUDE.md — buildup-ev

> Claude Code가 **매 세션 읽는 프로젝트 컨텍스트**다. 이 파일을 repo 루트에 둘 것. 상세 스펙은 `docs/` 참조.

## 작업 주체와 실행 규칙

- 실제 작업자와 최종 결정권자는 `OziinG`다. Issue, PR, Commit 등 공개 증거에는 이 이름만 남긴다.
- OziinG의 현재 지시와 미커밋 작업을 가장 높은 우선순위로 보존한다.
- 읽기 전용 조사, fetch, 깨끗한 main의 fast-forward, 최신 origin/main 기준 브랜치 생성, 로컬 구현·테스트·문서화는 반복 질문 없이 진행한다.
- 운영 직접 변경, 비밀값 노출, 운영 데이터 변경, OziinG의 미커밋 작업을 덮어쓸 위험이 있을 때만 멈춘다.
- 상세 변경 통제는 `docs/operations/CHANGE_CONTROL.md`, 보안 기준은 `docs/security/SECURITY_MODEL.md`, 외부 연동의 HQ 이관 경계는 `docs/security/HQ_HANDOFF.md`를 따른다.

## 프로젝트
buildup-ev = 전기 특장차(STEGO-K / PV5 기반 등)의 **3D 컨피규레이터 + 견적 + 발주 + 구조변경 서류 자동화** 웹 플랫폼. EV&Solution 자체 소유·개발.
배포 인프라는 배포 담당이 세팅·지원하고, **일상적인 변경 배포는 `main` push(자동배포)로 직접 수행**한다. 상세는 아래 `## 배포·운영` 참조.

## 아키텍처 절대원칙 (어기지 말 것)
1. **VIVAR = 3D 시각화 전용(iframe).** 견적·가격·보조금·세율·서류·권한·하중계산 로직은 **100% EV& 소유**, VIVAR로 넘기지 않음.
2. 자주 바뀌는 값(가격·보조금·세율·원자재단가)은 **코드 하드코딩 금지** → DB로 분리, 관리자페이지에서 갱신.
3. **계산은 전부 EV&.** VIVAR에선 치수·도면만 받음(향후 연동, 지금은 수동/placeholder).

## 화면(3-Surface) + RBAC
- **영업(Sales)**: 옵션선택 → 실구매가 견적 → 주문 전환
- **관리자(Admin, 중앙)**: 주문 검증·승인(게이트) + 기준데이터 CRUD + 관제
- **특장사(Conversion)**: 작업지시서·승인주문 수신 → 제작 + 원가·서류
- 주문 흐름: 상담·견적 → 보조금조회 → 견적확정/주문전환(영업) → **관리자 검증** → 특장사 제작 → 구조변경 → 튜닝신청 → 안전검사 → 튜닝승인 → 인도

## 저장소(모노레포)
`docs/  db/{schema,seed,templates}  backend/  frontend/  app/  shared/`

## 데이터 모델 (요약 · 상세=docs/DB스키마)
- **제품·옵션**: vehicle_model · option_group · option_value · option_group_model · option_rule(종속제약)
- **가격(영업)**: option_price · door_unit_price(룰) · region · subsidy_national · subsidy_local · tax_config
- **원가(특장)**: material · part · process · margin_rule · bom_line(치수함수)
- **하중·도면**: tire(2,356종) · drawing
- **거래**: customer · quote · order · order_option · document
- 핵심: 마스터=단가/무게(사전), BOM=소요량(레시피) → `원가=Σ(BOM×마스터단가)`, `무게=Σ(BOM×마스터단위무게)`. 옵션그룹=문항/규칙, 옵션값=보기(+가격·코드, FK 참조 단위).

## 핵심 계산 (검증 완료)
- **영업 견적**: 공급가액(트림+적재함+탑+도어+온도계+격벽) → 부가세 → 차량가 → 보조금(국고+지방+소상공인) → 부가세환급후 → +등록비+기타 = **실구매가**. 회귀검증: 범석환 케이스 = **₩46,471,818**.
- **도어가** = (선택종류 단품 − 기본종류[여닫이] 단품) + (도어추가 시 +선택종류 단품). DB는 단품 4값만.
- **하중계산**: 전축=ΣW·a/L, 후축=ΣW·(L−a)/L (a=후축까지거리, L=축간거리), 전축 추가하중 **5kg 올림**. 타이어부하율=축하중/(허용하중×바퀴수)×100. 조향륜분포율=적차전축/총중량×100. (cyberts 서버 검증)
- **VIVAR 수신 치수**: 전장·전폭·전고(외측, 특장반영) + 하대 외측/내측 L/W/H + offset. 축간거리·윤간거리=차종마스터 고정.

## 견적 분기
표준(프리셋) → **옵션베이스 견적** / 커스텀(비표준 치수) → **원가기반 견적**.

## DB 운영
`db/templates`의 엑셀 = 사람 입력용 → **시트별 CSV(`db/seed`)로 변환해 커밋**(엑셀은 git diff 안 됨). 스키마=SQL(`db/schema`).

## git/개발 규칙
- ⚠️ **공동개발 중이다.** 여러 사람이 같은 저장소에 동시에 올린다. 반드시 이 순서를 지킬 것:
  1. **작업 시작 전 최신 `origin/main` 으로 맞춘다** — `git fetch origin && git checkout -B <새브랜치> origin/main`.
     오래된 로컬 브랜치를 이어 쓰지 말 것(squash 병합본과 충돌한다. 실제로 두 번 났다).
  2. 개발
  3. **GitHub 에 issue 를 만들고 PR 을 만든 뒤** 병합·배포. PR 본문에 `Closes #N` 으로 잇는다.
- 장수 브랜치를 만들지 않는다. 기능 단위로 짧게 작업하고 검증 후 하나의 의사결정 단위로 커밋한다.
- `main`=안정. 기능 브랜치 → Issue 연결 → Draft PR → 검토 → squash merge 순서를 지킨다.
- `.env`(키·비번) **커밋 금지**(`.env.example`만). node_modules/dist 등 `.gitignore`.
- 컴포넌트 기반 + RBAC 라우팅 + 데이터레이어 분리(추후 API 교체 가능 구조).
- 세부 절차와 릴리스 증거 규칙은 `docs/operations/CHANGE_CONTROL.md`가 정본이다.

## 배포·운영 (반드시 준수 — 여기서 사고 많이 남)
- 배포 구조와 명령의 정본은 `deploy/README.md`, `deploy/RUN.md`다. 보안 판단은 `docs/security/SECURITY_MODEL.md`를 따른다.
- **배포 = `origin/main`에 push하면 GitHub Actions가 자동 배포.** 수동 rsync·서버 직접 빌드로 배포하지 말 것.
- ⚠️ **`main` push = 프로덕션 즉시 반영.** 검증 끝난 것만 push. 데모·운영 중엔 특히 신중히(불안하면 배포 담당과 함께).
- ⚠️ **git 밖 변경(rsync·서버 직접 수정)은 다음 자동배포가 git 기준으로 덮어써 소실됨.** 모든 변경은 반드시 **커밋 → push**로 git에 남길 것.
- **인프라는 추측 금지 — 만지기 전 `sudo pm2 list`·`sudo docker ps`·`systemctl`로 재확인**(non-sudo 결과로 "Docker 안 씀" 같은 결론 내지 말 것). 현재 구성(2026-08-10 서버에서 직접 확인):
  - **공개 주소 = `https://buildup-ev.cleversystem.ai`** · EC2 `i-007f16861a396a936` (ap-northeast-2)
  - **백엔드 = pm2 2슬롯 blue/green** — `buildup-ev-blue`(:3101) · `buildup-ev-green`(:3102), tsx 로 `backend/src/server.ts` 직접 실행
  - **릴리스 = `/opt/buildup-ev/releases/{blue,green}`** (배포마다 반대 슬롯에 받아 띄우고 Caddy 업스트림을 바꾼다) · 문서 저장소는 슬롯 밖 `/opt/buildup-ev/shared/documents`
  - **프론트 = Caddy 가 활성 슬롯의 `frontend/dist` 를 정적 서빙**
  - **리버스프록시 = 호스트 systemd `caddy`** (도커 아님). 설정 = `/etc/caddy/Caddyfile.d/buildup-ev.caddy` — **배포 스크립트가 매번 새로 쓴다. 손으로 고치면 다음 배포에 사라짐**
  - **Postgres = Docker `buildup-ev-postgres`** (127.0.0.1:5432) — 도커 컨테이너는 이것 **하나뿐**
  - ⚠️ `/etc/systemd/system/buildup-ev.service` 유닛 파일이 남아 있지만 **inactive(미사용)**. 이걸 재시작해도 아무 일도 일어나지 않는다
  - 어느 슬롯이 서비스 중인지: `sudo cat /etc/caddy/Caddyfile.d/buildup-ev.caddy` 의 `reverse_proxy` 포트
  - 수동 재시작이 필요하면: `sudo pm2 restart buildup-ev-<활성슬롯>` · Caddy 는 `sudo systemctl reload caddy` (컨테이너·유닛 이름 추측 금지)
- **비밀정보 커밋·출력 절대 금지**: `.env`, `*.pem`(BUILDUP-EV-key.pem), `JWT_SECRET`, `DATABASE_URL`. **서버 `.env`는 건드리지 말 것**(JWT_SECRET 불일치 사고 원인).
- **DB 스키마 변경은 Prisma migration으로만**: `schema.prisma`와 `backend/prisma/migrations/` SQL을 함께 커밋한다. 배포가 미적용 migration 전에 검증된 `pg_dump`를 만든다. seed는 **참조 테이블만 upsert**인지 확인 — 주문·견적 등 트랜잭션 테이블에 `delete/truncate` 금지.
- 🔴 **`schema.prisma` 를 고쳤으면 운영 DB 에도 반드시 반영하고 배포할 것.**
  Prisma 는 모델의 **모든 컬럼을 SELECT** 한다. 컬럼 하나가 DB 에 없으면 그 테이블을 읽는
  기능이 **전부** `P2022` 로 죽는다. 2026-08-18 에 `customer.warp_customer_id`·`updated_at`
  누락으로 견적서·계약서·메일 발송이 며칠간 막혔다 — 당시 배포 헬스체크(`/auth/me`)는 그 테이블을
  건드리지 않아 **매번 초록불이었다.**
  · 대조: `npm run --workspace=backend db:drift` (배포 스크립트가 새 슬롯 띄우기 **전에** 자동 실행)
  · 반영은 검토된 forward-only migration SQL과 `prisma migrate deploy`로 한다. 전체 `prisma db push`는 운영에서 금지한다.
- **프론트/백 반영 경로 다름**: 브라우저에서 도는 로직(예 LoadCalcTab의 `calcBom`) 변경 → **프론트 재빌드** 필요. 백엔드 템플릿·라우트는 런타임 로드 → **백엔드 재시작**. (PDF는 되는데 화면 탭은 옛값이면 프론트 빌드 안 된 것.)
- **배포 반영 확인은 활성 슬롯에서**: 새 라우트가 떴는지 보려면 `curl -o /dev/null -w %{http_code} http://localhost:<활성포트>/api/v1/<경로>` — **404 면 옛 릴리스, 403(인증필요) 이면 반영된 것**. 비활성 슬롯은 이전 코드라 404 가 정상이다.
- **서버 `.env` 는 릴리스마다 새로 쓰인다** — 배포가 SSM SecureString `/buildup-ev/app-env` 로 덮어쓴다. 서버 파일을 직접 고치면 다음 배포에 사라지므로, 키 추가는 **반드시 SSM 파라미터에** 해야 한다.

## 🔴 운영 데이터는 건드리지 않는다 (2026-08-18, 실계약 진행 중 확정)

**이미 구축된 DB 를 건드리지 말 것.** 실거래가 돌고 있고, 서명이 끝난 계약은 되돌릴 수 없다.

- **기존 테이블·컬럼을 지우거나 이름을 바꾸지 않는다.** 타입도 바꾸지 않는다. 필요하면 **새로 더한다**(추가만 허용).
- **행을 지우지 않는다.** 잘못 들어간 데이터도 지우지 말고 **상태로 관리**한다(만료·취소·비활성).
- **`prisma db push`·`migrate dev`·`migrate reset`·`accept-data-loss` 운영 금지.** 반영은 검토된 migration SQL을 배포의 `migrate deploy`로만 수행한다.
- 스키마를 고쳤으면 migration 파일도 같은 PR에 넣는다. 배포는 migration status, 전체 Prisma diff, `db:drift`를 모두 확인한다.

**삭제 기능은 제품에 없다.** 되살리지 말 것 — `backend/src/__tests__/permission-modules.test.ts` 의
「삭제 기능은 되살아나지 않는다」가 지킨다.
- 견적 삭제(`DELETE /quotes/:id`) → 언제나 405. 연결된 **계약·서명본 PDF·주문·서류까지 연쇄로** 지웠다.
- 계정 강제삭제(`DELETE /users/:email?cascade`) → 언제나 405. 그 영업의 견적을 통째로 지우면서 **계약 상태를 보지도 않았다.**
- 계정을 못 쓰게 하려면 **정지(비활성화)** 를 쓴다. 기록은 남기고 접근만 막는다.

## 작업 안전 가드레일 (이번 세션 사고들에서 도출)
- **검증 없이 단정하지 말 것.** "테스트 실패는 무관", "Docker 안 씀", "커밋했다" 등은 실제 확인(`git stash` 후 재실행, `sudo docker ps`, `git status`) 뒤에만 말할 것.
- **테스트를 코드 출력에 맞춰 바꿔 무력화하지 말 것.** 테스트는 **정답지(공식 하중계산)·제원표(별지 서식)** 를 지키는 파수꾼 = ground truth. 코드가 정답지/제원표를 재현하도록 고칠 것.
- **구조변경 서류(제원대비표·하중계산서·작업지시서)는 예시 PDF 양식을 충실 재현.** 셀 구조 그대로 두고 **숫자칸만 바인딩**. **흑백 전용(색 금지).** 위치 기준=**후축까지**. **탈거/설치만 가변행.** 렌더 스크린샷을 예시 PDF와 시각 대조해 마무리.
- **옵션→서류/하중은 전부 옵션 선택값에서 자동 산출**(하드코딩 금지). 무게·CG는 실측 BOM(`doc-templates/option-weights-real.json`) 단일 소스.

## 개발 순서
DB 구축 → 백엔드 API(옵션→견적→하중계산→주문/서류) → 프론트(영업 Surface 먼저, Phase 1) → 앱.

## 미정 / 범위 밖
- 미정(구조만 있음): 견적 산정 세부 로직 · 원가/BOM 값 · 제원 상세 보관방식.
- 범위 밖(non-goal/추후): 결제 · 신용조회(buildup 외부) · 다축(3축↑) 하중계산 · 상승탑 · 중고 구조변경 · 보조금 잔여물량 자동조회(주문 시 ev.or.kr 수동).
- **모든 수치·공식의 정답은 `docs/` 자산**(기획서·DB스키마·견적서 엑셀·하중계산기). 추측 말고 문서 확인.
