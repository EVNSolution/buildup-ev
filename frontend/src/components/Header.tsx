import { useAuth } from '../contexts/AuthContext'
import type { CustomerInfo, Role } from '@shared/types/index'

const ROLE_LABELS: Record<Role, string> = {
  SALES: '영업 (Sales)',
  ADMIN: '관리자 (Admin)',
  MAKER: '특장사 (Conversion)',
}

interface Props {
  customer?: CustomerInfo | null
  onOpenCustomerModal?: () => void
}

export function Header({ customer, onOpenCustomerModal }: Props) {
  const { session, logout } = useAuth()
  const user = session?.user
  const org  = session?.org

  const custLabel = customer
    ? `${customer.name} · ${customer.region_code} · ${customer.is_small_business ? '소상공인' : '일반'} ▾`
    : '고객 정보 입력 ▾'

  return (
    <header style={styles.header}>
      <div style={styles.logo}>EV<b style={styles.logoBold}>&</b>Solution</div>
      {user && <span style={styles.badge}>{ROLE_LABELS[user.role]}</span>}
      <div style={{ flex: 1 }} />

      {/* 영업화면 전용: 고객 정보 칩 */}
      {onOpenCustomerModal && (
        <span style={styles.custChip} onClick={onOpenCustomerModal}>{custLabel}</span>
      )}

      {/* 로그인 사용자 표시 */}
      {user && (
        <div style={styles.userInfo}>
          <span style={styles.userName}>{user.name}</span>
          <span style={styles.userOrg}>{org?.name ?? user.org_code}</span>
        </div>
      )}

      <button style={styles.logoutBtn} onClick={logout}>로그아웃</button>
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
}
