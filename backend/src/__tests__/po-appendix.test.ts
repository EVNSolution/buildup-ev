import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 발주서 **별지**(2페이지) — 커스텀 주문의 상세 요청사항.
 *
 * 비고(1페이지)는 양식에 맞춰 4줄·40자로 묶여 있다. 커스텀 건은 설명할 것이 많아
 * 그 칸에 우겨넣으면 **뜻이 전달되지 않았다**(제보). 한 장을 통째로 내주고,
 * 1페이지에는 「별지를 보라」고만 적는다.
 *
 * 이 검사가 지키는 것은 **강제가 새지 않는 것**이다. 별지를 만들어 놓고 특장사가
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

describe('발주서 별지', () => {
  it('소스를 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(ORDERS.length).toBeGreaterThan(1000);
    expect(ADMIN.length).toBeGreaterThan(1000);
  });

  it('🔴 별지를 확인하지 않으면 수락할 수 없다 — 서버가 막는다', () => {
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

  it('🔴 별지가 비어 있으면 막지 않는다 — 기존 주문이 갇히면 안 된다', () => {
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
    expect(shared).toMatch(/export const APPENDIX_REMARK = '커스텀 주문 건입니다\. 2페이지\(별지\)를 확인하세요\.'/);
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

  it('🔴 커스텀인데 별지가 비면 배정할 수 없다', () => {
    // 배지만 달고 설명이 없으면 특장사는 「무엇이 다른지」를 알 길이 없다
    expect(ADMIN).toMatch(/const needsAppendix = customBadge && !hasAppendix\(appendix\)/);
    expect(ADMIN).toMatch(/const canAssign = !!selected && !loading && !needsAppendix/);
  });

  it('🔴 확인 체크는 2페이지를 열어야 나온다', () => {
    /*
     * 1페이지만 보고 체크할 수 있으면 「읽었다」가 거짓이 된다.
     * 열어 본 것만으로 통과시키지 않는 이유도 같다 — 열자마자 닫아도 통과가 된다.
     */
    expect(ACCEPT).toMatch(/hasAppendix\(appendix\) && page === 2 && \(/);
  });

  it('🔴 한 장은 한 장이다 — 두 페이지를 함께 그리지 않는다', () => {
    /*
     * 발주서는 「특장사가 보는 그대로」가 전부다. 스크롤로 이어 붙이면 장 구분이 사라져
     * 무엇이 별지인지 알 수 없다. `page` 로 **바꿔 끼운다.**
     */
    expect(SHEET).toMatch(/page\?: 1 \| 2/);
    expect(SHEET).toMatch(/\{page === 2 \? \(/);
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

  it('별지는 한 장을 넘기지 않는다', () => {
    // 넘치면 발주서가 축소돼 글씨가 작아지고 결국 못 읽는다 — 받을 때 막는다
    const shared = read('shared/docs/appendix.ts');
    expect(shared).toMatch(/APPENDIX_MAX_LINES/);
    expect(shared).toMatch(/export function clampAppendix/);
    // 화면과 서버가 **같은 함수**를 쓴다
    expect(ADMIN).toMatch(/clampAppendix\(e\.target\.value\)/);
    expect(QUOTES).toMatch(/clampAppendix\(appendix!\)/);
  });
});
