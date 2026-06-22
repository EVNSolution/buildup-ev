export function AdminPage() {
  return (
    <div style={styles.root}>
      <h2 style={styles.title}>관리자 (Admin)</h2>
      <p style={styles.sub}>주문 검증·승인 + 기준데이터 CRUD + 관제 — 개발 예정</p>
    </div>
  )
}

const styles = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: { margin: 0, fontSize: 22, color: 'var(--dark)' },
  sub: { margin: 0, fontSize: 14, color: 'var(--muted)' },
}
