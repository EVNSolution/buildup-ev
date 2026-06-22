import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { CustomerInfo, UserRole } from '@shared/types/index'

interface Props {
  customer: CustomerInfo | null
  onOpenCustomerModal: () => void
}

const ROLE_LABELS: Record<UserRole, string> = {
  sales: '영업 (Sales)',
  admin: '관리자 (Admin)',
  conversion: '특장사 (Conversion)',
}

const ROLE_ROUTES: Record<UserRole, string> = {
  sales: '/sales',
  admin: '/admin',
  conversion: '/conversion',
}

export function Header({ customer, onOpenCustomerModal }: Props) {
  const { user, setRole } = useAuth()
  const navigate = useNavigate()

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const role = e.target.value as UserRole
    setRole(role)
    navigate(ROLE_ROUTES[role])
  }

  const custLabel = customer
    ? `${customer.name} · ${customer.region_code} · ${customer.is_small_business ? '소상공인' : '일반'} ▾`
    : '고객 정보 입력 ▾'

  return (
    <header style={styles.header}>
      <div style={styles.logo}>EV<b style={styles.logoBold}>&</b>Solution</div>
      <span style={styles.badge}>{ROLE_LABELS[user.role]}</span>
      <div style={{ flex: 1 }} />
      <span style={styles.custChip} onClick={onOpenCustomerModal}>{custLabel}</span>

      {/* mock 역할 전환 */}
      <select value={user.role} onChange={handleRoleChange} style={styles.roleSwitch}>
        <option value="sales">영업</option>
        <option value="admin">관리자</option>
        <option value="conversion">특장사</option>
      </select>

      <div style={styles.userLabel}>담당자: {user.name}</div>
    </header>
  )
}

const styles = {
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '11px 20px',
    borderBottom: '1px solid var(--line)',
  },
  logo: { fontWeight: 800, fontSize: 18, color: 'var(--dark)' },
  logoBold: { color: 'var(--lime)' },
  badge: {
    background: 'var(--lime)',
    color: 'var(--dark)',
    fontWeight: 700,
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 20,
  },
  custChip: {
    fontSize: 12,
    border: '1px solid var(--line)',
    borderRadius: 20,
    padding: '5px 12px',
    cursor: 'pointer',
    background: '#fff',
  },
  roleSwitch: {
    fontSize: 12,
    padding: '4px 8px',
    border: '1px solid var(--line)',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    color: 'var(--muted)',
  },
  userLabel: { fontSize: 13, color: 'var(--muted)' },
}
