# buildup-ev

전기 특장차(STEGO-K / PV5 기반) 3D 컨피규레이터 + 견적 + 발주 + 구조변경 서류 자동화 웹 플랫폼. EV&Solution 자체 소유·개발.

상세 스펙은 `docs/` 참조.

---

## 폴더 구조

```
buildup-ev/
├── CLAUDE.md               # Claude Code 프로젝트 컨텍스트 (매 세션 자동 로드)
├── .env.example            # 환경변수 양식 (.env 는 커밋 금지)
├── docs/                   # 기획 문서 전체 (스키마·워크플로우·기획서·ER 다이어그램)
├── db/
│   ├── schema/             # SQL DDL 마이그레이션 파일
│   ├── seed/               # 초기 데이터 CSV (엑셀에서 변환)
│   └── templates/          # 사람 입력용 엑셀 템플릿 (정본)
├── backend/                # API 서버 (스택 미확정)
├── frontend/               # 웹 프론트엔드 (영업→관리자→특장사 순)
├── app/                    # 모바일/네이티브 앱
└── shared/                 # 공통 타입·유틸·상수
```

## 개발 순서

DB 구축 → 백엔드 API → 프론트엔드(영업 Surface 먼저) → 앱

## 브랜치 전략

- `main` — 안정 브랜치
- `feature/...` — 기능 단위 브랜치 → PR → 병합
