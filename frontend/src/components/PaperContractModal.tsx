import { useState } from 'react'
import { BTN } from '../styles/buttons'

/**
 * 종이로 체결한 계약의 **서명본을 올려** 계약완료로 만든다 — 그래야 제작 배정이 열린다.
 *
 * 전자서명을 건너뛰는 문이라 화면에서도 그렇게 보이게 한다:
 * 무엇을 하는 것인지 먼저 적고, 스캔본 없이는 버튼이 눌리지 않는다.
 * 나중에 「이 건은 왜 서명이 없나」를 반드시 묻게 되는데, 그때 답이 시스템 안에 있어야 한다.
 *
 * ⚠️ **영업 화면에 있다.** 계약을 맺은 사람이 그 자리에서 올리는 것이 맞고,
 *    관리자 화면은 조회만 한다(견적서·계약서 흐름은 전부 영업이 실행한다).
 */
export function PaperContractModal({ label, loading, error, onSubmit, onClose }: {
  /** 어느 건인지 — 견적번호가 있으면 그것, 없으면 `#id` */
  label: string
  loading: boolean
  error: string
  onSubmit: (file: File) => void
  onClose: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.title}>{label} — 서명본 등록</div>
        <div style={s.desc}>
          종이로 체결한 계약서를 올립니다. 등록하면 전자서명 없이 <b>계약완료</b>가 되어 제작 배정을 할 수 있습니다.
          견적서·계약서는 이 시점의 내용으로 고정되어 더 이상 고칠 수 없습니다.
        </div>
        <label style={s.label}>계약서 스캔본<span style={s.req}> · 필수</span></label>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          style={s.file}
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <div style={s.hint}>PDF 또는 사진 · 20MB 이하 · 고객이 서명·날인한 계약서 전체</div>
        {error && <div style={s.error}>{error}</div>}
        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose} disabled={loading}>취소</button>
          <button
            style={!file || loading ? s.confirmBtnDisabled : s.confirmBtn}
            disabled={!file || loading}
            onClick={() => file && onSubmit(file)}
          >
            {loading ? '등록 중…' : '서명본 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: '#fff', borderRadius: 14, padding: '28px 32px', width: 400, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 13, color: 'var(--muted)' },
  // 「필수」는 목록 안 안내문이 아니라 **라벨 옆 빨간 글씨** — 앱 전체가 같은 규칙이다
  label: { fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'calc(var(--sp-2) * -1)' },
  req: { color: 'var(--req)', fontWeight: 700 },
  error: { fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', padding: '7px 10px', borderRadius: 7 },
  file: { width: '100%', fontSize: 'var(--fs-label)', color: 'var(--dark)', padding: 'var(--sp-2) 0' },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 'var(--sp-1)' },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  // 나란히 서는 버튼은 **같은 크기** — 공통 BTN 을 쓰고 최소폭만 맞춘다
  cancelBtn: { ...BTN.secondary, minWidth: 108, color: 'var(--muted)' },
  confirmBtn: { ...BTN.primary, minWidth: 108 },
  confirmBtnDisabled: { ...BTN.disabled, minWidth: 108 },
}
