import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'
import type { CustomerInfo, Role } from '@shared/types/index'

const ROLE_LABELS: Record<Role, string> = {
  SALES: '영업 (Sales)',
  ADMIN: '관리자 (Admin)',
  MAKER: '특장사 (Conversion)',
}

interface Props {
  customer?: CustomerInfo | null
}

// DEV: master surface switcher — surface별 경로·레이블 정의
const SURFACES: { path: string; label: string }[] = [
  { path: '/sales', label: '영업' },
  { path: '/admin', label: '관리' },
  { path: '/maker', label: '특장' },
]

export function Header({ customer }: Props) {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const user = session?.user
  const org  = session?.org

  // 저장된 고객 표시 전용. 예전엔 눌러서 진입 팝업을 다시 열었지만, 고객정보 입력이
  // 견적 저장 단계로 옮겨가면서 여는 대상이 사라졌다(보조금 조건은 가격바에서 고친다).
  const custLabel = customer
    ? `${customer.name} · ${customer.region_code} · ${customer.is_small_business ? '소상공인' : '일반'}`
    : null

  return (
    <header style={{
      ...styles.header,
      // 모바일은 줄바꿈으로 높이가 달라지므로 고정 높이를 풀고 예전 여백을 쓴다
      ...(isMobile ? { height: 'auto', padding: '10px 14px' } : {}),
      flexWrap: isMobile ? 'wrap' : 'nowrap',
      gap: isMobile ? 8 : 12,
    }}>
      <div style={styles.logo}>EV<b style={styles.logoBold}>&</b>Solution</div>
      {user && !isMobile && <span style={styles.badge}>{ROLE_LABELS[user.role]}</span>}
      <div style={{ flex: 1 }} />

      {/* DEV: master surface switcher — is_master 계정에만 표시 */}
      {user?.is_master && (
        <div style={{
          ...styles.surfaceSwitch,
          ...(isMobile ? { order: 10, width: '100%', justifyContent: 'center' } : {}),
        }}>
          {SURFACES.map(s => (
            <button
              key={s.path}
              style={location.pathname === s.path ? styles.surfaceBtnActive : styles.surfaceBtn}
              onClick={() => navigate(s.path)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* 영업화면 전용: 저장된 고객 표시 칩(클릭 동작 없음) */}
      {custLabel && <span style={styles.custChip}>{custLabel}</span>}

      {/* 로그인 사용자 표시 */}
      {user && (
        <div style={styles.userInfo}>
          <span style={styles.userName}>{user.name}</span>
          {!isMobile && <span style={styles.userOrg}>{org?.name ?? user.org_code}</span>}
        </div>
      )}

      <button
        style={{
          ...styles.logoutBtn,
          ...(isMobile ? { minHeight: 44, padding: '10px 14px' } : {}),
        }}
        onClick={logout}
      >
        로그아웃
      </button>
    </header>
  )
}

/**
 * 최상단바 크기 — 바 두께는 **원래의 2배로 고정**(53.5px → 107px), 안의 글자·로고는
 * 화면 폭에 따라 최대 2배까지 커진다.
 *
 * 전부 2배로 못 박으면 내용 필요폭이 1457px 이 되어 1280·1366 노트북에서 넘친다(실측).
 * 그래서 1920 에서 2배가 되도록 폭에 비례시키고, 좁아지면 원래 크기까지 되돌아온다.
 * `x(기본값)` = 그 값의 clamp(기본, 화면폭 비례, 기본×2).
 */
const HEADER_H = 107
/** 기본값 n → 넓은 화면에서 2n 까지. 계수는 1920px 에서 2배가 되도록 뽑았다(2n/1920×100). */
const x = (n: number) => `clamp(${n}px, ${(n / 9.6).toFixed(3)}vw, ${n * 2}px)`

const styles: Record<string, React.CSSProperties> = {
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: x(12),
    // 높이를 고정해 두면 안의 글자가 커져도 바 두께는 그대로다
    height: HEADER_H,
    boxSizing: 'border-box',
    padding: '0 20px',
    borderBottom: '1px solid var(--line)',
    background: '#fff',
  },
  logo: { fontWeight: 800, fontSize: x(18), color: 'var(--dark)', whiteSpace: 'nowrap' },
  logoBold: { color: 'var(--lime)' },
  badge: {
    background: 'var(--lime)', color: 'var(--dark)', whiteSpace: 'nowrap',
    fontWeight: 700, fontSize: x(12), padding: `${x(4)} ${x(10)}`, borderRadius: 999,
  },
  custChip: {
    fontSize: x(12), border: '1px solid var(--line)', borderRadius: 999, whiteSpace: 'nowrap',
    padding: `${x(5)} ${x(12)}`, cursor: 'pointer', background: '#fff',
  },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  userName: { fontSize: x(13), fontWeight: 600, color: 'var(--dark)', whiteSpace: 'nowrap' },
  userOrg:  { fontSize: x(11), color: 'var(--muted)', whiteSpace: 'nowrap' },
  logoutBtn: {
    fontSize: x(12), padding: `${x(5)} ${x(12)}`, border: '1px solid var(--line)', whiteSpace: 'nowrap',
    borderRadius: x(6), background: '#fff', cursor: 'pointer', color: 'var(--muted)',
  },
  // DEV: master surface switcher styles
  surfaceSwitch: {
    display: 'flex', gap: 2, background: 'var(--card)', borderRadius: x(8),
    padding: x(3), border: '1px solid var(--line)',
  },
  surfaceBtn: {
    fontSize: x(12), fontWeight: 600, padding: `${x(4)} ${x(12)}`, border: 'none', whiteSpace: 'nowrap',
    borderRadius: x(6), cursor: 'pointer', background: 'transparent', color: 'var(--muted)',
  },
  surfaceBtnActive: {
    fontSize: x(12), fontWeight: 700, padding: `${x(4)} ${x(12)}`, border: 'none', whiteSpace: 'nowrap',
    borderRadius: x(6), cursor: 'pointer', background: '#fff', color: 'var(--dark)',
    boxShadow: '0 1px 4px rgba(0,0,0,.1)',
  },
}
