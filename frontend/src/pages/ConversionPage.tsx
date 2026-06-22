export function ConversionPage() {
  return (
    <div style={styles.root}>
      <h2 style={styles.title}>특장사 (Conversion)</h2>
      <p style={styles.sub}>작업지시서·승인주문 수신 → 제작 + 원가·서류 — 개발 예정</p>
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
