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
      padding: isMobile ? '10px 14px' : '11px 20px',
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

const styles: Record<string, React.CSSProperties> = {
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '11px 20px',
    borderBottom: '1px solid var(--line)',
    background: '#fff',
  },
  logo: { fontWeight: 800, fontSize: 18, color: 'var(--dark)' },
  logoBold: { color: 'var(--lime)' },
  badge: {
    background: 'var(--lime)', color: 'var(--dark)',
    fontWeight: 700, fontSize: 12, padding: '4px 10px', borderRadius: 20,
  },
  custChip: {
    fontSize: 12, border: '1px solid var(--line)', borderRadius: 20,
    padding: '5px 12px', cursor: 'pointer', background: '#fff',
  },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  userName: { fontSize: 13, fontWeight: 600, color: 'var(--dark)' },
  userOrg:  { fontSize: 11, color: 'var(--muted)' },
  logoutBtn: {
    fontSize: 12, padding: '5px 12px', border: '1px solid var(--line)',
    borderRadius: 6, background: '#fff', cursor: 'pointer', color: 'var(--muted)',
  },
  // DEV: master surface switcher styles
  surfaceSwitch: {
    display: 'flex', gap: 2, background: 'var(--card)', borderRadius: 8,
    padding: 3, border: '1px solid var(--line)',
  },
  surfaceBtn: {
    fontSize: 12, fontWeight: 600, padding: '4px 12px', border: 'none',
    borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--muted)',
  },
  surfaceBtnActive: {
    fontSize: 12, fontWeight: 700, padding: '4px 12px', border: 'none',
    borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--dark)',
    boxShadow: '0 1px 4px rgba(0,0,0,.1)',
  },
}
