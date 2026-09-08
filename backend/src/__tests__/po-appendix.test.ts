import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 발주서 **커스텀 요청사항** — 커스텀 주문의 상세 요청.
 *
 * 비고는 양식의 한 칸이라 4줄·40자로 묶여 있다. 커스텀 건은 설명할 것이 많아
 * 그 칸에 우겨넣으면 **뜻이 전달되지 않았다**(제보). 그래서 서류 **맨 아래**에
 * 따로 칸을 두고, 비고에는 「아래를 보라」고만 적는다.
 *
 * ⚠️ 예전엔 이걸 「별지(2페이지)」로 뺐다. 발주서를 A4 한 장에 가두고 있었기 때문인데,
 *    그러다 보니 별지도 한 장을 넘기면 안 돼 30줄·40자로 다시 묶어야 했고
 *    **분량이 계속 골칫거리**가 됐다(제보). 지금 발주서는 아래로 이어진다 —
 *    장을 나눌 이유도, 줄 수를 정할 이유도 없다.
 *
 * 이 검사가 지키는 것은 **강제가 새지 않는 것**이다. 칸을 만들어 놓고 특장사가
 * 안 읽고 수락하면 아무것도 달라지지 않는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const ORDERS = read('backend/src/routes/orders.ts');
const QUOTES = read('backend/src/routes/quotes.ts');
const ADMIN = read('frontend/src/pages/AdminPage.tsx');
const ACCEPT = read('frontend/src/components/AcceptOrderModal.tsx');
const SHEET = read('frontend/src/components/PurchaseOrderSheet.tsx');
const DETAIL = read('frontend/src/components/OrderDetail.tsx');

describe('발주서 커스텀 요청사항', () => {
  it('소스를 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(ORDERS.length).toBeGreaterThan(1000);
    expect(ADMIN.length).toBeGreaterThan(1000);
  });

  it('🔴 커스텀 요청사항을 확인하지 않으면 수락할 수 없다 — 서버가 막는다', () => {
    /*
     * 화면에서만 막으면 이 API 를 직접 불러 우회된다. 「읽었다」는 표시가 없으면
     * 서버가 거절해야 강제가 성립한다.
     */
    expect(ORDERS, '수락 라우트가 별지 확인을 보지 않는다')
      .toMatch(/hasAppendix\(order\.appendix\) && !order\.appendix_ack_at/);
    expect(ORDERS).toMatch(/APPENDIX_UNREAD/);
    // 확인을 남기는 라우트도 있어야 한다
    expect(ORDERS).toMatch(/ordersRouter\.patch\('\/:id\/appendix-ack'/);
  });

  it('🔴 요청사항이 비어 있으면 막지 않는다 — 기존 주문이 갇히면 안 된다', () => {
    /*
     * 이 기능이 생기기 전에 배정된 커스텀 주문은 별지가 없다. 커스텀 배지만 보고 막으면
     * 그 주문들을 특장사가 **영영 수락하지 못한다.** 조건은 배지가 아니라 별지의 유무다.
     */
    expect(ORDERS, '배지로 막으면 기존 주문이 갇힌다')
      .not.toMatch(/custom_badge[\s\S]{0,60}APPENDIX_UNREAD/);
    expect(ACCEPT, '화면도 별지 유무로 판단해야 한다')
      .toMatch(/const appendixOk = !hasAppendix\(appendix\) \|\| acked/);
  });

  it('🔴 커스텀이면 1페이지 비고는 서버가 정한다', () => {
    /*
     * 비고와 별지 두 곳에 나눠 적게 하면 특장사가 어디를 봐야 할지 모른다.
     * 화면이 보낸 값을 믿으면 API 를 직접 불러 딴 글을 넣을 수 있으므로 **서버가 고정**한다.
     */
    expect(QUOTES).toMatch(/remark: withAppendix \? APPENDIX_REMARK :/);
    /*
     * 문구는 **한 곳(shared)** 에만 적는다. 서버와 화면이 각자 적으면 한쪽만 고쳤을 때
     * 화면이 그 문장을 못 알아보고, 영어로 보는 특장사에게 한국어 안내가 그대로 나간다.
     */
    const shared = read('shared/docs/appendix.ts');
    expect(shared).toMatch(/export const APPENDIX_REMARK = '커스텀 주문 건입니다\. 아래 커스텀 요청사항을 확인하세요\.'/);
    /*
     * 가리킬 수 없는 곳을 가리키지 않는다 — 2페이지는 이제 없다.
     * (주석에는 「예전엔 2페이지였다」가 남아 있으므로 **문구 자체**만 본다)
     */
    const remark = shared.slice(shared.indexOf('export const APPENDIX_REMARK'));
    expect(remark.split('\n')[0], '없는 페이지를 가리킨다').not.toMatch(/페이지/);
    expect(QUOTES, '서버가 문구를 따로 적었다').not.toMatch(/remark: [^\n]*'커스텀 주문 건입니다/);
    expect(SHEET, '화면이 문구를 따로 적었다').not.toMatch(/'커스텀 주문 건입니다/);
    // 화면은 **그 상수와 견주어** 알아본다 — 비고 전체를 옮기면 사람이 적은 글까지 건드린다
    expect(SHEET).toMatch(/remark\.trim\(\) === APPENDIX_REMARK \? t\(APPENDIX_REMARK\) : remark/);
  });

  it('🔴 안내 문구와 2페이지는 **같은 답**을 본다', () => {
    /*
     * 「2페이지를 확인하세요」와 실제 2페이지의 유무를 따로 판단하면 어긋난다.
     * 실제로 어긋났다 — 공백만 적힌 별지(`'   '`)가 참이라 값으로 저장됐고, 화면은
     * `hasAppendix`(공백은 빈 것)로 2페이지를 닫아 두는데 1페이지는 그리로 가리켰다.
     * 특장사에게는 **넘길 장이 없는 안내**만 남는다.
     */
    expect(QUOTES, '판단이 한 곳으로 모이지 않았다')
      .toMatch(/const withAppendix = custom_badge === true && hasAppendix\(appendix\)/);
    // 비고와 별지가 **같은 변수**를 본다
    expect(QUOTES).toMatch(/appendix: withAppendix \? clampAppendix\(appendix!\) : null/);
    /*
     * 두 곳 중 한 곳이라도 배지를 **직접 다시 보면** 어긋날 길이 열린다.
     * 배정 라우트만 본다 — 임시저장은 아직 아무에게도 안 나가는 초안이라
     * 「가리키는 문구」 자체가 없고, 판단도 한 줄에 모여 있다.
     */
    const assign = QUOTES.slice(QUOTES.indexOf("quotesRouter.patch('/:id/assign'"));
    expect(assign, '비고가 배지를 다시 본다').not.toMatch(/remark: custom_badge === true/);
    expect(assign, '별지가 배지를 다시 본다').not.toMatch(/appendix: custom_badge === true/);
  });

  it('🔴 추가한 것은 **삭제**할 수 있다', () => {
    /*
     * 추가만 있고 되돌릴 길이 없으면 잘못 연 사람이 갇힌다(제보).
     *
     * ⚠️ 삭제하면 **작성한 내용도 함께 지운다.** 칸만 접고 값을 남기면 화면에는 없는데
     *    발주서에는 실리는 글이 된다 — 아무도 그걸 모른 채 특장사에게 나간다.
     *    그래서 작성한 것이 있으면 한 번 묻는다.
     */
    expect(ADMIN, '추가하는 길이 없다').toMatch(/setAppendixOpen\(true\)/);
    expect(ADMIN, '삭제하는 길이 없다').toMatch(/setAppendix\(''\); setAppendixOpen\(false\)/);
    expect(ADMIN).toMatch(/if \(appendix\.trim\(\)\) \{ setAppendixAsking\(true\); return \}/);
  });

  it('🔴 같은 조작에는 **같은 말**을 쓴다', () => {
    /*
     * 숨긴 것을 도로 꺼내는 조작이 견적에서는 「다시 보이기」, 고객에서는 또 「다시 보이기」였다.
     * 둘 다 **되돌리기**로 모은다 — 같은 일에 이름이 둘이면 다른 기능처럼 읽힌다.
     */
    expect(ADMIN, '옛 이름이 남아 있다').not.toMatch(/'다시 보이기'/);
    expect(ADMIN).toMatch(/tc\('되돌리기', 'btn'\)/);
    // 「빼기」 같은 임시어 대신 삭제를 쓴다
    expect(ADMIN, '「빼기」가 남아 있다').not.toMatch(/'빼기'|빼기'\)/);
  });

  it('🔴 커스텀인데 요청사항이 비면 배정할 수 없다', () => {
    // 배지만 달고 설명이 없으면 특장사는 「무엇이 다른지」를 알 길이 없다
    expect(ADMIN).toMatch(/const needsAppendix = customBadge && !hasAppendix\(appendix\)/);
    expect(ADMIN).toMatch(/const canAssign = !!selected && !loading && !needsAppendix/);
  });

  it('🔴 확인 체크는 **그 칸 아래**에 붙는다', () => {
    /*
     * 읽어야 할 글과 「읽었다」는 표시가 떨어져 있으면, 글을 안 보고 체크하게 된다.
     * 서류 안, 커스텀 요청사항 바로 아래에 둔다 — 읽고 나서 누르는 순서가 자리로 드러난다.
     */
    expect(ACCEPT).toMatch(/appendixFooter=\{!readOnly && hasAppendix\(appendix\) &&/);
    // 조회 전용에는 체크가 없다 — 관리자가 대신 「읽었다」고 해 줄 수는 없다
    expect(ACCEPT).toMatch(/!readOnly && hasAppendix/);
  });

  it('🔴 발주서는 **아래로 이어진다** — 한 장에 가두지 않는다', () => {
    /*
     * 예전엔 A4 한 장에 가두고 넘치면 통째로 축소해 담았다. 그래서 내용이 길수록
     * 글씨가 작아졌고, 적을 수 있는 분량을 곳곳에서 막아야 했다.
     *
     * ⚠️ 그렇다고 **양식을 흘려보내지는 않는다.** 폭은 늘 `BASE_W` 로 조판하고 화면 폭에
     *    맞춰 축소한다 — 폭까지 풀면 좁은 화면에서 표 머리글이 겹치고 값이 잘린다(제보).
     *    푸는 것은 **높이뿐**이다.
     */
    expect(SHEET, '페이지 개념이 되살아났다').not.toMatch(/page\?: 1 \| 2/);
    expect(SHEET, '높이를 다시 가뒀다').not.toMatch(/const BASE_H/);
    // 폭 조판과 축소는 그대로다
    expect(SHEET).toMatch(/const BASE_W = \d+/);
    expect(SHEET).toMatch(/frame\.clientWidth \/ BASE_W/);
    expect(SHEET).toMatch(/transform: `scale\(\$\{scale\}\)`/);
  });

  it('🔴 1페이지 비고가 특장사에게 **실제로** 닿는다', () => {
    /*
     * 별지로 가는 길은 1페이지 비고의 「2페이지(별지)를 확인하세요」 한 줄뿐이다.
     *
     * ⚠️ 그 칸이 비어 있었다. 비고가 부모가 넘기는 값(`remark` prop)이었는데
     *    **두 호출부(AdminPage·MakerPage) 어디도 넘기지 않아** 언제나 빈 값이었고,
     *    발주서는 늘 「특별 요청사항 없음」을 그렸다. 커스텀 건에서는 그게 곧
     *    **별지로 가는 안내가 사라진 것**이다.
     *    사양·별지와 같은 응답에서 함께 꺼내 쓴다 — 받아 오는 곳이 하나면 어긋나지 않는다.
     */
    expect(ACCEPT, '비고를 받아 오지 않는다').toMatch(/setRemark\(d\.remark \?\? ''\)/);
    // prop 으로 되돌리면 또 아무도 넘기지 않는 값이 된다
    expect(ACCEPT, '비고가 다시 prop 이 됐다').not.toMatch(/\bremark\?: string\b/);
  });

  it('사양 탭은 별지 내용을 그대로 보여 준다', () => {
    /*
     * 1페이지 비고에는 「별지를 보라」는 안내만 들어간다. 사양 탭까지 그 안내를 옮기면
     * **아무 데서도 내용을 못 읽는다.** 제목도 무엇인지 그대로 적는다.
     */
    expect(DETAIL).toMatch(/hasAppendix\(detail\.appendix\) \? t\('커스텀 요청사항'\) : t\('비고'\)/);
    expect(DETAIL).toMatch(/\? <div style=\{det\.remarkBody\}>\{detail\.appendix\}<\/div>/);
  });

  it('🔴 배정 전에는 문서번호를 지어내지 않는다', () => {
    /*
     * 배정 전 미리보기에는 주문이 아직 없어 `orderId=0` 이 들어온다. 그대로 찍으면
     * 「주문 #0」이 되어 **0번이라는 문서가 있는 것처럼** 읽힌다(제보).
     * 번호는 배정하는 순간 붙는다 — 그때까지는 없다고 말한다.
     */
    expect(SHEET).toMatch(/orderId > 0 \? `\$\{t\('주문'\)\} #\$\{orderId\}` : t\('\(배정 시 발급\)'\)/);
    expect(SHEET, '문서번호를 두 장이 따로 만들고 있다')
      .not.toMatch(/label="문서번호" value=\{`주문 #/);
  });

  it('🔴 분량을 양식으로 묶지 않는다 — 사고만 막는다', () => {
    /*
     * 줄 수·글자 수 제한은 **A4 한 장에 맞추려고** 있던 것이다. 그 제약이 사라졌으니
     * 사람이 적는 글의 길이를 우리가 정할 이유가 없다.
     * 남는 상한 하나는 양식 때문이 아니라 **파일을 통째로 밀어 넣는 경우**를 막으려는 것이다.
     */
    const shared = read('shared/docs/appendix.ts');
    expect(shared, '줄 수 제한이 되살아났다').not.toMatch(/APPENDIX_MAX_LINES/);
    expect(shared, '한 줄 글자 수 제한이 되살아났다').not.toMatch(/APPENDIX_MAX_LINE_CHARS/);
    expect(shared).toMatch(/APPENDIX_MAX_CHARS = 20_000/);
    expect(shared).toMatch(/export function clampAppendix/);
    // 서버는 여전히 상한을 본다 — 화면만 막으면 API 로 우회된다
    expect(QUOTES).toMatch(/clampAppendix\(appendix!\)/);
  });
});
