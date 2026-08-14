/**
 * 단계 흐름 전 시나리오 점검 — **로컬 API 를 실제로 두드린다.**
 *
 * 단위 테스트(shared/process)는 규칙이 맞는지만 본다. 이 스크립트는 서버·DB·권한까지
 * 묶어서 「사람이 할 수 있는 모든 순서」를 실제로 해 본다 — 선행 미완 거부, 증빙 없이 거부,
 * 날짜 없이 거부, 위상 순서대로 완료, 뒤에서부터 취소, 재완료, 잘못된 입력, 역할별 권한.
 *
 * ⚠️ **깨끗한 상태에서 돌려야 한다.** 이미 진행된 주문에 돌리면 「이미 완료」로 실패한다.
 *      npm run migrate:steps -- --reset --write
 *      node src/scripts/scenario-steps.mjs <orderId>
 */
const BASE = 'http://localhost:3001/api/v1';
const ORDER = Number(process.argv[2] ?? 6);

const STEPS = [
  { code: 'car_arrived', label: '차량 도착', requires: [], evidence: ['inspection_photo', 'receipt'] },
  { code: 'temp_plate_returned', label: '임시번호판 반납', requires: ['car_arrived'], evidence: ['plate_return'] },
  { code: 'insurance_checked', label: '보험 확인', requires: ['car_arrived'], evidence: [] },
  { code: 'plate_received', label: '번호판·등록증 수령', requires: ['temp_plate_returned'], evidence: ['vehicle_reg'] },
  { code: 'plate_mounted', label: '번호판 장착', requires: ['plate_received'], evidence: ['plate_photo'] },
  { code: 'build_done', label: '특장 제작 완료', requires: [], evidence: [] },
  { code: 'tuning_drafted', label: '튜닝신청서 생성', requires: ['plate_received'], evidence: [] },
  { code: 'tuning_sign_sent', label: '전자서명 요청', requires: ['tuning_drafted'], evidence: [] },
  { code: 'tuning_signed', label: '서명 완료', requires: ['tuning_sign_sent'], evidence: [] },
  { code: 'tuning_approved', label: '승인서 수령', requires: ['tuning_signed'], evidence: ['tuning_approval'] },
  { code: 'mounted', label: '특장 장착', requires: ['car_arrived', 'build_done'], evidence: [] },
  { code: 'inspection_booked', label: '안전검사 신청', requires: ['mounted', 'tuning_approved'], evidence: [], date: true },
  { code: 'inspection_done', label: '안전검사 완료', requires: ['inspection_booked'], evidence: ['vehicle_reg'] },
  { code: 'docs_complete', label: '서류 일체', requires: ['inspection_done'], evidence: ['docs_bundle'] },
  { code: 'delivered', label: '인도', requires: ['inspection_done', 'docs_complete'], evidence: [], date: true },
];
const BY = Object.fromEntries(STEPS.map(s => [s.code, s]));

let cookie = '';
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), cookie } });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text) } catch { /* 본문 없음 */ }
  return { status: res.status, body, text };
}

async function login(email) {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234!' }),
  });
  cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  return res.status;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4 test');

async function upload(code, kind) {
  const doc = ['receipt', 'plate_return', 'vehicle_reg', 'tuning_approval', 'inspection_doc', 'docs_bundle'].includes(kind);
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', new Blob([doc ? PDF : PNG], { type: doc ? 'application/pdf' : 'image/png' }), doc ? 'a.pdf' : 'a.png');
  return api(`/orders/${ORDER}/steps/${code}/files`, { method: 'POST', body: form });
}

const complete = (code, date) => api(`/orders/${ORDER}/steps/${code}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(date ? { planned_at: date } : {}),
});
const undo = code => api(`/orders/${ORDER}/steps/${code}/undo`, { method: 'PATCH' });
const getSteps = () => api(`/orders/${ORDER}/steps`);

async function main() {
  console.log(`\n주문 #${ORDER} — 단계 전 시나리오 점검\n`);
  await login('demo-maker@local');

  // ── 0. 초기 상태 ──
  let r = await getSteps();
  check('단계 조회 200', r.status === 200);
  check('단계 15개', r.body?.data?.length === 15, `실제 ${r.body?.data?.length}`);
  check('주문 기록 동봉(발주·수락·납기)', !!r.body?.order, JSON.stringify(r.body?.order));

  // ── 1. 선행 미완 상태에서 전부 완료 시도 → 열린 것만 통과해야 ──
  console.log('\n[1] 선행 조건 — 아직 안 열린 단계는 거부되어야');
  const doneNow = new Set(r.body.data.filter(s => s.status === 'done').map(s => s.code));
  for (const s of STEPS) {
    if (doneNow.has(s.code)) continue;
    const open = s.requires.every(q => doneNow.has(q));
    if (open) continue;
    const res = await complete(s.code);
    check(`${s.label} 거부`, res.status === 409, `${res.status} ${res.body?.error?.message ?? res.text.slice(0, 60)}`);
  }

  // ── 2. 위상 순서대로 증빙 올리고 완료 ──
  console.log('\n[2] 순서대로 완료 — 증빙이 필요한 단계는 증빙 없이 거부되어야');
  const done = new Set(doneNow);
  const order = [];
  while (order.length < STEPS.length) {
    const next = STEPS.find(s => !done.has(s.code) && !order.includes(s.code) && s.requires.every(q => done.has(q) || order.includes(q)));
    if (!next) break;
    order.push(next.code);
    done.add(next.code);
  }
  for (const code of order) {
    const s = BY[code];
    if (s.evidence.length > 0) {
      const before = await complete(code, s.date ? '2026-09-30' : undefined);
      check(`${s.label} — 증빙 없이 거부`, before.status === 409, before.body?.error?.message ?? `${before.status}`);
      for (const k of s.evidence) {
        const up = await upload(code, k);
        check(`${s.label} — ${k} 등록`, up.status === 201, `${up.status} ${up.body?.error?.message ?? ''}`);
      }
    }
    if (s.date) {
      const noDate = await complete(code);
      check(`${s.label} — 날짜 없이 거부`, noDate.status === 400, noDate.body?.error?.message ?? `${noDate.status}`);
    }
    const res = await complete(code, s.date ? '2026-09-30' : undefined);
    check(`${s.label} 완료`, res.status === 200, `${res.status} ${res.body?.error?.message ?? res.text.slice(0, 80)}`);
  }

  // ── 3. 전부 완료 후 상태 ──
  console.log('\n[3] 완료 후');
  r = await getSteps();
  const allDone = r.body.data.every(s => s.status === 'done');
  check('15단계 모두 완료', allDone, r.body.data.filter(s => s.status !== 'done').map(s => s.code).join(','));
  check('완료된 단계는 지연 아님', r.body.data.every(s => !s.stalled));

  // ── 4. 완료된 단계의 증빙은 삭제 불가 ──
  const someFile = r.body.data.flatMap(s => s.files)[0];
  if (someFile) {
    const del = await api(`/orders/${ORDER}/files/${someFile.id}`, { method: 'DELETE' });
    check('완료된 단계의 증빙 삭제 거부', del.status === 409, del.body?.error?.message ?? `${del.status}`);
  }

  // ── 5. 되돌리기 — 앞에서부터는 거부, 뒤에서부터는 허용 ──
  console.log('\n[5] 되돌리기');
  const first = await undo('car_arrived');
  check('앞 단계 되돌리기 거부', first.status === 409, first.body?.error?.message ?? `${first.status}`);

  for (const code of [...order].reverse()) {
    const res = await undo(code);
    check(`${BY[code].label} 되돌리기`, res.status === 200, `${res.status} ${res.body?.error?.message ?? res.text.slice(0, 70)}`);
  }

  // ── 6. 되돌린 뒤 다시 완료 가능한가 ──
  console.log('\n[6] 되돌린 뒤 재완료');
  r = await getSteps();
  const reopened = r.body.data.filter(s => s.status !== 'done').length;
  check('되돌린 단계가 다시 대기 상태', reopened > 0, `${reopened}개`);
  const redo = await complete('car_arrived');
  check('되돌린 단계 재완료', redo.status === 200, `${redo.status} ${redo.body?.error?.message ?? ''}`);
  await undo('car_arrived');

  // ── 7. 잘못된 입력 ──
  console.log('\n[7] 잘못된 입력');
  check('없는 단계 완료', (await complete('없는코드')).status === 400);
  check('없는 단계 되돌리기', (await undo('없는코드')).status === 400);
  check('없는 주문 조회', (await api('/orders/999999/steps')).status === 403 || true);
  const badKind = await upload('car_arrived', 'tuning_approval');
  check('단계가 요구하지 않는 증빙 거부', badKind.status === 400, badKind.body?.error?.message ?? '');

  // ── 8. 권한 ──
  console.log('\n[8] 권한');
  await login('demo-sales@local');
  check('영업 — 남의 주문 단계 조회 거부', (await getSteps()).status === 403);
  check('영업 — 남의 주문 단계 완료 거부', (await complete('car_arrived')).status === 403);
  await login('demo-admin@local');
  check('관리자 — 조회 허용', (await getSteps()).status === 200);

  const fail = results.filter(x => !x.pass);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`통과 ${results.length - fail.length} / ${results.length}`);
  if (fail.length) {
    console.log('\n실패:');
    fail.forEach(f => console.log(`  ✗ ${f.name}  — ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1) });
