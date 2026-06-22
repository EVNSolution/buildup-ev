-- ============================================================
-- 클러스터 F — 인증·권한 (RBAC)
-- 정답 소스: docs/DB스키마 v0.1 클러스터 F + DB구축템플릿 v0.4 F1~F4
-- ============================================================

-- F1. org — 조직/소속 (데이터 격리 기준)
CREATE TABLE IF NOT EXISTS org (
  code    VARCHAR(30)                     PRIMARY KEY,
  type    ENUM('HQ', 'DEALER', 'MAKER')  NOT NULL,
  name    VARCHAR(60)                     NOT NULL,
  biz_no  VARCHAR(20),
  active  BOOL                            NOT NULL DEFAULT TRUE
);

-- F2. user — 사용자/계정 (관리자 발급; self-signup 없음)
-- 비밀번호 평문 저장 금지. pw_hash 컬럼 없음 — 실인증 방식 미정, 구현 시 추가.
CREATE TABLE IF NOT EXISTS user (
  email           VARCHAR(120)                          PRIMARY KEY,
  org_code        VARCHAR(30)                           NOT NULL REFERENCES org(code),
  role            ENUM('SALES', 'ADMIN', 'MAKER')       NOT NULL,
  name            VARCHAR(60)                           NOT NULL,
  phone           VARCHAR(20),
  status          ENUM('active', 'invited', 'suspended') NOT NULL DEFAULT 'invited',
  must_change_pw  BOOL                                  NOT NULL DEFAULT TRUE,
  invited_by      VARCHAR(120)                          REFERENCES user(email),
  active          BOOL                                  NOT NULL DEFAULT TRUE,
  created_at      DATETIME                              NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- F3. feature_module — 기능 모듈 카탈로그 (권한 토글 단위)
-- surface: 노출 분류, 복수 시 콤마 구분 (예: '영업,관리자')
CREATE TABLE IF NOT EXISTS feature_module (
  code        VARCHAR(40)  PRIMARY KEY,
  name        VARCHAR(60)  NOT NULL,
  surface     VARCHAR(60)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  active      BOOL         NOT NULL DEFAULT TRUE
);

-- F4. access_control — 역할 기본값 + 계정 override
-- 조회 우선순위: 계정 override → 없으면 역할 기본값
CREATE TABLE IF NOT EXISTS access_control (
  id            BIGINT       AUTO_INCREMENT PRIMARY KEY,
  subject_type  ENUM('role', 'user')  NOT NULL,
  subject_ref   VARCHAR(120) NOT NULL,   -- role: SALES/ADMIN/MAKER | user: email
  module_code   VARCHAR(40)  NOT NULL REFERENCES feature_module(code),
  enabled       BOOL         NOT NULL DEFAULT TRUE,
  memo          TEXT,
  UNIQUE KEY uq_subject_module (subject_type, subject_ref, module_code)
);

-- ── 기존 테이블 격리 컬럼 추가 ──────────────────────────────────

-- E1. customer — 작성자 추적
ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(120) REFERENCES user(email);

-- E2. quote — 영업담당·소속조직 (격리: SALES=자기 견적만)
ALTER TABLE quote
  ADD COLUMN IF NOT EXISTS sales_user_id VARCHAR(120) REFERENCES user(email),
  ADD COLUMN IF NOT EXISTS org_id        VARCHAR(30)  REFERENCES org(code);

-- E3. order — 배정 특장사 (격리: MAKER=자기 주문만)
ALTER TABLE `order`
  ADD COLUMN IF NOT EXISTS maker_org_id VARCHAR(30) REFERENCES org(code);
