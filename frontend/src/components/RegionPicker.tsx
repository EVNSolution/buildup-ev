import { useEffect, useRef, useState } from 'react'

/**
 * 지역 검색 선택 — 161개 목록이라 입력으로 좁혀서 고른다. **목록에 있는 값만** 선택된다.
 * 지방보조금이 지역 문자열로 조회되므로 자유입력을 허용하면 안 된다.
 *
 * 가격바 「보조금」 팝업과 견적 저장 모달이 함께 쓴다(예전엔 고객정보 모달 안에만 있었다).
 */
export function RegionPicker({ regions, value, onChange }: {
  regions: string[]
  value: string
  onChange: (v: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭 시 닫기
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const q = query.trim().replace(/\s+/g, '')
  const list = q
    ? regions.filter(r => r.replace(/\s+/g, '').includes(q)).slice(0, 50)
    : regions.slice(0, 50)

  function pick(r: string) {
    onChange(r)
    setQuery('')
    setOpen(false)
  }

  if (regions.length === 0) {
    return <input style={rp.input} value="지역 목록 로딩 중…" disabled readOnly />
  }

  return (
    <div ref={boxRef} style={rp.wrap}>
      <input
        style={rp.input}
        placeholder="지역을 검색해 선택하세요"
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0) }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={e => {
          if (!open) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, list.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (list[active]) pick(list[active]) }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
      />
      {open && (
        <div style={rp.list}>
          {list.length === 0
            ? <div style={rp.empty}>검색 결과가 없습니다</div>
            : list.map((r, i) => (
              <div
                key={r}
                style={i === active ? rp.itemOn : rp.item}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); pick(r) }}
              >
                {r}
              </div>
            ))
          }
          {!q && regions.length > list.length && (
            <div style={rp.more}>… 전체 {regions.length}개 — 검색어를 입력하세요</div>
          )}
        </div>
      )}
    </div>
  )
}

const rp: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative' },
  // 높이는 공통 토큰 — 옆 칸(사업자 구분 select 등)과 나란히 놓이므로 어긋나면 바로 보인다
  input: { width: '100%', boxSizing: 'border-box', minHeight: 'var(--h-control)', padding: '0 10px', fontSize: 14, fontFamily: 'inherit', color: 'var(--dark)', border: '1px solid var(--line)', borderRadius: 8, background: '#fff', outline: 'none' },
  list: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 3,
    background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
    maxHeight: 210, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.14)',
  },
  item: { padding: '7px 10px', fontSize: 13, cursor: 'pointer' },
  itemOn: { padding: '7px 10px', fontSize: 13, cursor: 'pointer', background: '#f2f6e8' },
  empty: { padding: '10px', fontSize: 12.5, color: 'var(--muted)' },
  more: { padding: '6px 10px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--line)' },
}
