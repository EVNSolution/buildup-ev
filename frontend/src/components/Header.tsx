import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'
import logoUrl from '../assets/logo.png'
import type { CustomerInfo, Role } from '@shared/types/index'

// 로고 옆 배지는 영어 한 단어로만 — 한글까지 넣으면 배지가 길어져 로고를 밀어낸다
const ROLE_LABELS: Record<Role, string> = {
  SALES: 'Sales',
  ADMIN: 'Admin',
  MAKER: 'Maker',
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

  // 고객 칩을 감출 폭 기준 — 헤더 내용 필요폭(칩 포함 1041px)에서 나온 값
  const isNarrow = useIsMobile(1100)

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
      ...(isMobile ? { gap: 8 } : {}),
    }}>
      <img src={logoUrl} alt="EV&Solution" style={styles.logo} />
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

      {/*
        영업화면 전용: 저장된 고객 표시 칩(클릭 동작 없음).
        이 줄에서 가장 길어 자리가 모자라면 가장 먼저 줄어든다. 1100px 아래에서는
        줄여 봐야 '…' 만 남아 자리만 차지하므로 아예 감춘다.
      */}
      {custLabel && !isNarrow && <span style={styles.custChip} title={custLabel}>{custLabel}</span>}

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
 * 최상단바 크기 — **고정값**. 예전 크기의 약 1.56배(로고 18 → 28px)로 통일했다.
 *
 * 화면 폭에 따라 늘였다 줄였다 하면 창을 옮길 때마다 크기가 달라져 어수선하다.
 * 그래서 한 벌로 못 박되, 좁은 화면에서도 깨지지 않는 선에서 정했다(브라우저 실측):
 *   내용 필요폭 828px — 관리자·특장 화면은 창 900px 부터 여유 있음
 *   영업 화면은 고객 칩이 붙어 1041px 필요 → 칩만 줄어들게 해 좁아도 안 깨진다
 * 바 두께는 107px 고정(예전 53.5px 의 2배). 글자가 바뀌어도 두께는 그대로다.
 */
const HEADER_H = 107

const styles: Record<string, React.CSSProperties> = {
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    height: HEADER_H,
    boxSizing: 'border-box',
    padding: '0 20px',
    borderBottom: '1px solid var(--line)',
    background: '#fff',
    // 어떤 경우에도 내용이 바 밖으로 새어 나가지 않게
    overflow: 'hidden',
  },
  // 로고 이미지(706x261). 높이만 정하고 폭은 비율대로 — 예전 텍스트 로고와 비슷한 크기.
  logo: { height: 34, width: 'auto', display: 'block', flexShrink: 0 },
  badge: {
    background: 'var(--lime)', color: 'var(--dark)', whiteSpace: 'nowrap', flexShrink: 0,
    fontWeight: 700, fontSize: 18, padding: '6px 16px', borderRadius: 999,
  },
  // 고객 칩은 이 줄에서 가장 덜 중요하고 가장 길다 — 자리가 모자라면 이것부터 줄인다
  custChip: {
    fontSize: 16, border: '1px solid var(--line)', borderRadius: 999,
    padding: '7px 14px', cursor: 'pointer', background: '#fff',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1,
  },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  userName: { fontSize: 19, fontWeight: 600, color: 'var(--dark)', whiteSpace: 'nowrap' },
  userOrg:  { fontSize: 15, color: 'var(--muted)', whiteSpace: 'nowrap' },
  logoutBtn: {
    fontSize: 17, padding: '8px 18px', border: '1px solid var(--line)', whiteSpace: 'nowrap', flexShrink: 0,
    borderRadius: 8, background: '#fff', cursor: 'pointer', color: 'var(--muted)',
  },
  // DEV: master surface switcher styles
  surfaceSwitch: {
    display: 'flex', gap: 2, background: 'var(--card)', borderRadius: 10,
    padding: 4, border: '1px solid var(--line)', flexShrink: 0,
  },
  surfaceBtn: {
    fontSize: 17, fontWeight: 600, padding: '7px 18px', border: 'none', whiteSpace: 'nowrap',
    borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--muted)',
  },
  surfaceBtnActive: {
    fontSize: 17, fontWeight: 700, padding: '7px 18px', border: 'none', whiteSpace: 'nowrap',
    borderRadius: 8, cursor: 'pointer', background: '#fff', color: 'var(--dark)',
    boxShadow: '0 1px 4px rgba(0,0,0,.1)',
  },
}
