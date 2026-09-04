import { useEffect, useRef } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { BTN } from '../styles/buttons'
import { safeBottom } from '../styles/safeArea'
import { shrinkImage } from '../lib/imageResize'

/**
 * 대화 입력줄 — **단계별 서랍과 「대화」 탭이 같은 것을 쓴다.**
 *
 * 두 곳에 따로 두었더니 한쪽만 고쳐지는 자리가 생겼다(첨부 버튼 모양이 그랬다).
 *
 * ## 카카오톡과 같은 모양
 * 테두리는 **바깥 상자 하나**뿐이고, 첨부(📎)·입력칸·보내기가 그 안에 나란히 선다.
 * 예전엔 첨부 버튼만 따로 작은 네모라 입력칸과 높이가 안 맞아 혼자 떠 보였다(제보).
 *
 * 글이 길어지면 **입력칸만 위로 자란다.** 첨부·보내기는 `flex-end` 라 바닥에 남는다 —
 * 가운데 정렬이면 줄이 늘 때마다 버튼이 같이 떠올라 자리가 흔들린다.
 */
export function ChatComposer({
  text, onTextChange, image, onImageChange, onSend, busy, placeholder = '내용을 입력하세요', above,
}: {
  text: string
  onTextChange: (v: string) => void
  image: File | null
  onImageChange: (f: File | null) => void
  onSend: () => void
  busy: boolean
  placeholder?: string
  /**
   * 입력 상자 **바로 위**에 들어갈 것(「대화」 탭의 단계 고르기).
   *
   * 바깥에 따로 두면 그 사이에 구분선이 하나 더 생겨 칸이 둘로 갈라져 보였다(제보).
   * 구분선은 이 묶음 **위에 한 번만** 긋는다 — 대화 목록과 입력 영역을 가르는 선이다.
   */
  above?: React.ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const isMobile = useIsMobile()
  const empty = text.trim() === '' && !image

  /**
   * 내용만큼 자란다 — 한 줄에서 시작해 **모바일 4.5줄 · PC 8.5줄**까지.
   * 그보다 길어지면 더 자라지 않고 안에서 스크롤된다(대화 목록을 다 덮으면 안 된다).
   *
   * **반 줄을 남기는 것이 핵심이다.** 딱 떨어지게 4줄만 보이면 그게 전부인지
   * 위에 더 있는지 알 수 없다. 맨 윗줄이 반쯤 걸쳐 보이면 「위에 더 있다」가
   * 글로 설명하지 않아도 읽힌다.
   *
   * 최대 높이를 픽셀로 못 박지 않고 **그때의 줄 높이를 재서** 계산한다 —
   * 손가락 기기에서는 글꼴이 18.5px(확대 방지), PC 에서는 14px 이라 줄 높이가 다르다.
   * 숫자로 적어 두면 한쪽에서만 맞는다.
   *
   * `height: auto` 로 한 번 되돌려야 **줄어들 때도** 따라 줄어든다.
   */
  const grow = () => {
    const el = areaRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const max = line * (isMobile ? MAX_LINES_MOBILE : MAX_LINES_DESKTOP) + pad
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    // 한도에 닿았을 때만 스크롤을 켠다 — 늘 켜 두면 짧은 글에서도 막대 자리가 생긴다
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }

  /*
   * 글을 보내 비워지면 **다시 한 줄로 줄어들어야 한다.** 화면에서 값이 바뀌는 경로가
   * `onChange` 만은 아니라(전송 후 초기화) 여기서도 맞춘다.
   */
  useEffect(grow, [text, isMobile])

  return (
    <div style={s.wrap}>
      {above}

      {image && (
        <div style={s.preview}>
          <img src={URL.createObjectURL(image)} alt="첨부할 사진" style={s.previewImg} />
          <span style={s.previewName}>{image.name}</span>
          <button style={s.previewX} onClick={() => onImageChange(null)} aria-label="첨부 취소">✕</button>
        </div>
      )}

      {/* 테두리는 이 상자 하나 — 안의 것들은 테두리를 갖지 않는다 */}
      <div style={s.box}>
        {/*
          사진 첨부 — 올리기 전에 줄인다(`shrinkImage`). 현장에서 찍은 사진이
          그대로 쌓이면 목록을 여는 것만으로 데이터를 다 쓴다.
        */}
        <button
          style={image ? s.clipOn : s.clip}
          onClick={() => fileRef.current?.click()}
          title="사진 첨부"
          aria-label="사진 첨부"
        >📎</button>
        <input
          ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={async e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try { onImageChange((await shrinkImage(f)).file) }
            catch { onImageChange(f) }   // 못 줄여도 원본으로 보낸다 — 못 보내는 것보다 낫다
          }}
        />

        <textarea
          ref={areaRef}
          style={s.area}
          rows={1}
          placeholder={placeholder}
          value={text}
          maxLength={2000}
          onChange={e => { onTextChange(e.target.value); grow() }}
          onKeyDown={e => {
            // ⌘/Ctrl + Enter 로 보낸다. 그냥 Enter 는 줄바꿈 — 여러 줄로 적는 일이 많다
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend() }
          }}
        />

        <button
          style={busy || empty ? s.sendOff : s.send}
          disabled={busy || empty}
          onClick={onSend}
        >{busy ? '전송 중…' : '남기기'}</button>
      </div>
    </div>
  )
}

/**
 * 입력칸이 자랄 수 있는 최대 줄 수 — 그 뒤로는 안에서 스크롤된다.
 * **`.5` 는 일부러다.** 맨 윗줄이 반쯤 걸쳐 보여야 위에 더 있다는 것이 눈에 읽힌다.
 */
const MAX_LINES_MOBILE = 4.5
const MAX_LINES_DESKTOP = 8.5

const s: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 'none', borderTop: 'var(--hairline)',
    padding: 'var(--sp-3)', paddingBottom: safeBottom('var(--sp-3)'),
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
  },
  /** 테두리를 가진 **하나의 상자** — 카카오톡처럼 안에 다 들어간다 */
  box: {
    display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)',
    border: 'var(--hairline)', borderRadius: 12, background: '#fff',
    padding: 'var(--sp-2)',
  },
  /*
   * 첨부·보내기는 `alignItems: flex-end` 를 받아 **바닥에 붙는다.**
   * 글이 길어져 입력칸이 자라도 자리가 흔들리지 않는다.
   */
  clip: {
    flex: 'none', width: 34, height: 34, padding: 0,
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 17, lineHeight: 1, color: 'var(--muted)',
    borderRadius: 8,
  },
  /** 붙인 게 있으면 눈에 띄게 — 무엇이 함께 나가는지 알아야 한다 */
  clipOn: {
    flex: 'none', width: 34, height: 34, padding: 0,
    border: 'none', background: 'var(--lime-bg)', cursor: 'pointer',
    fontSize: 17, lineHeight: 1, color: 'var(--lime-ink)',
    borderRadius: 8,
  },
  /** 테두리·배경 없음 — 바깥 상자가 입력칸처럼 보이는 역할을 한다 */
  area: {
    flex: 1, minWidth: 0, resize: 'none', fontFamily: 'inherit',
    border: 'none', outline: 'none', background: 'transparent',
    padding: '7px 0', margin: 0,
    lineHeight: 1.4, boxSizing: 'border-box',
    // 처음 그릴 때 한 줄로 — 그 뒤 높이는 grow() 가 잡는다
    overflowY: 'hidden',
  },
  send: { ...BTN.smPrimary, flex: 'none', width: 'auto', minWidth: 0, padding: '0 var(--sp-3)', height: 34, minHeight: 34 },
  sendOff: { ...BTN.smPrimary, flex: 'none', width: 'auto', minWidth: 0, padding: '0 var(--sp-3)', height: 34, minHeight: 34, opacity: 0.45 },
  preview: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  previewImg: { width: 36, height: 36, objectFit: 'cover' as const, borderRadius: 6, border: 'var(--hairline)' },
  previewName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  previewX: { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 14 },
}
