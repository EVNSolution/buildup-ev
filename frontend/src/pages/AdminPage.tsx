import { useEffect, useState } from 'react'
import type { FeatureModule, AccessControl, Role } from '@shared/types/index'
import { fetchFeatureModules, fetchAccessControl, upsertAccessControl } from '../api/auth'
import { Header } from '../components/Header'

const ROLES: Role[] = ['SALES', 'ADMIN', 'MAKER']
const ROLE_KO: Record<Role, string> = { SALES: '영업', ADMIN: '관리자', MAKER: '특장사' }

function getSurfaces(modules: FeatureModule[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of modules) {
    for (const s of m.surface.split(',').map(x => x.trim())) {
      if (!seen.has(s)) { seen.add(s); result.push(s) }
    }
  }
  return result
}

function isEnabled(ac: AccessControl[], type: 'role' | 'user', ref: string, code: string): boolean {
  const entry = ac.find(a => a.subject_type === type && a.subject_ref === ref && a.module_code === code)
  return entry?.enabled ?? false
}

export function AdminPage() {
  const [modules, setModules] = useState<FeatureModule[]>([])
  const [ac, setAc] = useState<AccessControl[]>([])
  const [activeTab, setActiveTab] = useState<'toggles' | 'override'>('toggles')
  const [overrideEmail, setOverrideEmail] = useState('')
  const [overrideCode, setOverrideCode] = useState('')
  const [overrideEnabled, setOverrideEnabled] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchFeatureModules(), fetchAccessControl()]).then(([mods, ctrl]) => {
      setModules(mods)
      setAc(ctrl)
    })
  }, [])

  async function handleRoleToggle(role: Role, code: string, current: boolean) {
    const key = `${role}:${code}`
    setSaving(key)
    const entry: AccessControl = { subject_type: 'role', subject_ref: role, module_code: code, enabled: !current }
    await upsertAccessControl(entry)
    setAc(prev => {
      const idx = prev.findIndex(a => a.subject_type === 'role' && a.subject_ref === role && a.module_code === code)
      if (idx >= 0) return prev.map((a, i) => i === idx ? entry : a)
      return [...prev, entry]
    })
    setSaving(null)
  }

  async function handleOverrideSave(e: React.FormEvent) {
    e.preventDefault()
    if (!overrideEmail || !overrideCode) return
    const entry: AccessControl = {
      subject_type: 'user', subject_ref: overrideEmail,
      module_code: overrideCode, enabled: overrideEnabled,
    }
    setSaving('override')
    await upsertAccessControl(entry)
    setAc(prev => {
      const idx = prev.findIndex(a => a.subject_type === 'user' && a.subject_ref === overrideEmail && a.module_code === overrideCode)
      if (idx >= 0) return prev.map((a, i) => i === idx ? entry : a)
      return [...prev, entry]
    })
    setSaving(null)
    setOverrideEmail('')
    setOverrideCode('')
  }

  const surfaces = getSurfaces(modules)

  return (
    <div style={styles.root}>
      <Header />

      <div style={styles.body}>
        <div style={styles.titleBar}>
          <h1 style={styles.h1}>관리자 (Admin)</h1>
          <div style={styles.tabs}>
            <button style={activeTab === 'toggles' ? styles.tabOn : styles.tab} onClick={() => setActiveTab('toggles')}>기능모듈 토글</button>
            <button style={activeTab === 'override' ? styles.tabOn : styles.tab} onClick={() => setActiveTab('override')}>계정 Override</button>
          </div>
        </div>

        {activeTab === 'toggles' && (
          <div style={styles.content}>
            {surfaces.map(surface => {
              const surfaceMods = modules.filter(m => m.surface.split(',').map(s => s.trim()).includes(surface))
              return (
                <div key={surface} style={styles.surfaceGroup}>
                  <div style={styles.surfaceLabel}>{surface}</div>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.thModule}>모듈</th>
                        {ROLES.map(r => <th key={r} style={styles.thRole}>{ROLE_KO[r]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {surfaceMods.map(mod => (
                        <tr key={mod.code}>
                          <td style={styles.tdModule}>
                            <div style={styles.modName}>{mod.name}</div>
                            <div style={styles.modCode}>{mod.code}</div>
                          </td>
                          {ROLES.map(role => {
                            const enabled = isEnabled(ac, 'role', role, mod.code)
                            const key = `${role}:${mod.code}`
                            return (
                              <td key={role} style={styles.tdToggle}>
                                <button
                                  style={enabled ? styles.toggleOn : styles.toggleOff}
                                  onClick={() => handleRoleToggle(role, mod.code, enabled)}
                                  disabled={saving === key}
                                >
                                  {enabled ? 'ON' : 'OFF'}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'override' && (
          <div style={styles.content}>
            <p style={styles.overrideDesc}>계정 단위 권한 override. 역할 기본값보다 우선 적용됩니다.</p>
            <form onSubmit={handleOverrideSave} style={styles.overrideForm}>
              <div style={styles.overrideRow}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>이메일</label>
                  <input type="text" value={overrideEmail} onChange={e => setOverrideEmail(e.target.value)} placeholder="user@example.com" style={styles.inputField} />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>모듈 코드</label>
                  <select value={overrideCode} onChange={e => setOverrideCode(e.target.value)} style={styles.inputField}>
                    <option value="">선택</option>
                    {modules.map(m => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
                  </select>
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>활성</label>
                  <select value={overrideEnabled ? 'Y' : 'N'} onChange={e => setOverrideEnabled(e.target.value === 'Y')} style={styles.inputField}>
                    <option value="Y">ON</option>
                    <option value="N">OFF</option>
                  </select>
                </div>
                <button type="submit" style={styles.saveBtn} disabled={saving === 'override'}>저장</button>
              </div>
            </form>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.thModule}>이메일</th>
                  <th style={styles.thModule}>모듈</th>
                  <th style={styles.thRole}>활성</th>
                  <th style={styles.thModule}>메모</th>
                </tr>
              </thead>
              <tbody>
                {ac.filter(a => a.subject_type === 'user').map((a, i) => (
                  <tr key={i}>
                    <td style={styles.tdModule}>{a.subject_ref}</td>
                    <td style={styles.tdModule}><span style={styles.modCode}>{a.module_code}</span></td>
                    <td style={styles.tdToggle}>
                      <span style={a.enabled ? styles.toggleOn : styles.toggleOff}>{a.enabled ? 'ON' : 'OFF'}</span>
                    </td>
                    <td style={styles.tdModule}><span style={styles.modCode}>{a.memo ?? ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={styles.placeholderNote}>
        주문 검증·승인 + 기준데이터 CRUD + 관제 — 개발 예정
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  titleBar: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 20, color: 'var(--dark)' },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 8,
    background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)',
  },
  tabOn: {
    padding: '6px 14px', border: '1px solid var(--dark)', borderRadius: 8,
    background: 'var(--dark)', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600,
  },
  content: {},
  surfaceGroup: { marginBottom: 28 },
  surfaceLabel: {
    fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  thModule: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  thRole: { textAlign: 'center', padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, width: 80 },
  tdModule: { padding: '10px 12px', borderBottom: '1px solid var(--line)' },
  tdToggle: { textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--line)' },
  modName: { fontSize: 13, color: 'var(--dark)' },
  modCode: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },
  toggleOn: {
    padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
    background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 12,
  },
  toggleOff: {
    padding: '4px 12px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer',
    background: '#fff', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
  },
  overrideDesc: { fontSize: 13, color: 'var(--muted)', marginBottom: 16 },
  overrideForm: { marginBottom: 24 },
  overrideRow: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 160 },
  label: { fontSize: 11.5, color: 'var(--muted)' },
  inputField: { fontSize: 13, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  saveBtn: {
    padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer',
    background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13, alignSelf: 'flex-end',
  },
  placeholderNote: {
    flexShrink: 0, padding: '10px 24px', borderTop: '1px solid var(--line)',
    fontSize: 12, color: 'var(--muted)', background: 'var(--card)',
  },
}
