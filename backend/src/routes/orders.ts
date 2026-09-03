import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission, isAdmin, ownOrgOnly, canSeeQuotePrices, scopedToMine } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { setQuoteStatus } from '../services/quote-status.js';
import type { Prisma } from '@prisma/client';
import { checkDeliveryDue, fromDateInput, toDateInput, toDbDate } from '@buildup-ev/shared/schedule';
import { stepsFor, BODY_ONLY_SKIPPED, isOverdue } from '@buildup-ev/shared/process';

export const ordersRouter = Router();

// ── GET /orders — 목록 (ADMIN=전체, MAKER=자기 배정, SALES=자기 견적) ─────

ordersRouter.get('/', rbac('ADMIN', 'SALES', 'MAKER'), requirePermission('order.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const auth = req.auth!;
  const { status, from, to, scope } = req.query as Record<string, string | undefined>;

  /*
   * 치운 주문은 목록에서 뺀다 — **행은 남아 있지만 일감이 아니다.**
   * 여기서 거르지 않으면 「삭제」를 눌러도 그대로 보여, 치운 뜻이 없어진다.
   */
  const where: Prisma.OrderWhereInput = { canceled_at: null };
  /*
   * 범위는 **가진 역할 전부**로 정한다. 관리자면 전체, 아니면 겸직한 역할만큼 넓힌다
   * (영업+특장 겸직이면 자기 견적의 주문 ∪ 자기 조직에 배정된 주문).
   *
   * 단 영업 화면(`scope=mine`)에서는 **겸직 계정이라도 자기 견적의 주문만** 본다 —
   * 견적 목록과 같은 규칙이다(마스터는 제외).
   */
  if (scopedToMine(auth, scope)) {
    where.quote = { sales_user_id: auth.email };
  } else if (!isAdmin(auth)) {
    const scopes: Prisma.OrderWhereInput[] = [];
    if (auth.roles.includes('MAKER')) scopes.push({ maker_org_id: auth.org_code });
    if (auth.roles.includes('SALES')) scopes.push({ quote: { sales_user_id: auth.email } });
    if (scopes.length === 1) Object.assign(where, scopes[0]);
    else if (scopes.length > 1) where.OR = scopes;
  }
  // status 필터는 없앴다 — 옛 6단계 값이다. 진행은 단계 표가 갖는다

  if (from || to) {
    where.created_at = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  /*
   * ⚠️ **어느 행을 볼지(where)와 어느 칸을 볼지(select)는 다른 문제다.**
   *    여기는 오래도록 where 만 좁혀 두어, 특장사에게도 공급가·실구매가가 그대로 나갔다.
   *    상세(GET /orders/:id)는 처음부터 금액을 빼고 있었으므로 목록만 어긋나 있던 것이다.
   *    화면이 그 값을 그리지 않아 눈에 띄지 않았을 뿐, 응답에는 실려 브라우저까지 갔다.
   *
   *    자격 판정은 rbac 의 canSeeQuotePrices 하나만 본다(라우트마다 손으로 적지 않는다).
   */
  const showPrice = canSeeQuotePrices(auth);

  try {
    const orders = await prisma.order.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        quote: {
          select: {
            model_code: true,
            // 금액은 자격이 있을 때만 **조회 자체를 하지 않는다**(응답에서 지우는 방식은
            // 지우는 곳을 하나 빠뜨리면 그대로 새어 나간다)
            supply_price: showPrice,
            final_price: showPrice,
            status: true, customer_id: true,
            customer: { select: { id: true, name: true } },
          },
        },
        maker_org: { select: { code: true, name: true } },
        // 목록에서도 「지금 뭘 해야 하나」가 보여야 한다 — 상세를 열어야 알 수 있으면
        // 여러 건을 훑는 화면(칸반 자리)이 쓸모없어진다
        // done_at 도 싣는다 — 요약에 「무엇을 마지막으로 끝냈나」를 적으려면 시각이 필요하다
        steps: { select: { code: true, status: true, planned_at: true, done_at: true } },
      },
    });

    const now = new Date();
    /** 그 단계를 끝낸 시각(밀리초). 끝나지 않았거나 시각이 없으면 undefined. */
    const byCodeDoneAt = (rows: { code: string; done_at: Date | null }[], code: string): number | undefined =>
      rows.find(r => r.code === code)?.done_at?.getTime();

    const data = orders.map(({ steps, ...o }) => {
      const doneAll = new Set(steps.filter(s => s.status === 'done').map(s => s.code));
      /*
       * **해당 없는 단계는 세지도, 할 일로 띄우지도 않는다.**
       * 특장만 주문은 차량 트랙이 「차량 도착」 하나로 줄어, 나머지 넷은 skipped 로 남는다.
       * 그걸 빼지 않으면 진행률이 영원히 12/16 에서 멈추고, 아무도 누를 수 없는
       * 「임시번호판 반납」이 「지금 할 일」로 뜬다.
       */
      const bodyOnly = steps.some(s => s.status === 'skipped' && BODY_ONLY_SKIPPED.includes(s.code));
      const defs = stepsFor(bodyOnly);
      const applicable = new Set(defs.map(d => d.code));
      /*
       * ⚠️ **카탈로그에서 빠진 단계는 세지 않는다.**
       * 단계를 걷어내도(전자서명 요청처럼) 진행 중이던 주문에는 그 코드의 행이 남아 있다.
       * 그대로 세면 완료 수가 전체 수를 넘어 「15/14」 같은 진행률이 나온다.
       */
      const done = new Set([...doneAll].filter(c => applicable.has(c)));
      // 지금 손댈 수 있는 것 = 선행이 다 끝났고 아직 안 끝난 것
      const openDefs = defs.filter(d => !done.has(d.code) && d.requires.every(q => done.has(q)));
      const byCode = new Map(steps.map(s => [s.code, s]));

      /*
       * **끝낸 단계** — 요약 문구는 이것으로만 적는다.
       *
       * ⚠️ 예전엔 목록 줄에 「지금 할 수 있는 단계」(open)를 그냥 적어 두었다. 그러면
       *    아무것도 완료 안 된 주문에 「차량 도착 · 특장 제작 완료」가 뜬다 — 읽는 사람은
       *    그 단계를 **끝냈다**고 읽는다(실제 제보). 할 일과 끝낸 일은 반대 뜻이라
       *    한 자리에 같은 모양으로 적으면 안 된다.
       *
       * 목록은 카탈로그 순서로 준다(진행 흐름 그대로 읽힌다).
       * 마지막 하나는 **실제로 가장 나중에 끝낸 것**을 따로 고른다 — 순서를 건너뛰고
       * 완료할 수 있어서(특장 제작을 차량 도착보다 먼저 끝내는 식) 카탈로그 끝 = 최신이 아니다.
       */
      const doneDefs = defs.filter(d => done.has(d.code));
      /*
       * ⚠️ **오름차순으로 세워 맨 뒤를 집는다.** 내림차순으로 첫 개를 집으면, 완료 시각이
       *    없는 옛 기록(이관된 주문 등)에서 비교가 전부 0 이 되어 **카탈로그 첫 단계**가
       *    「가장 나중」으로 뽑힌다 — 넷을 끝냈는데 「차량 도착」이 최근으로 떴다.
       *    오름차순+맨 뒤면 시각이 없을 때 카탈로그 마지막(가장 앞선 단계)으로 떨어진다.
       */
      const lastDone = [...doneDefs]
        .sort((a, b) => (byCodeDoneAt(steps, a.code) ?? 0) - (byCodeDoneAt(steps, b.code) ?? 0))
        .pop();

      return {
        ...o,
        steps: {
          done: done.size,
          total: applicable.size,
          /** 끝낸 단계 이름들(카탈로그 순서) — 요약에 적는 것은 이것뿐이다 */
          done_labels: doneDefs.map(d => d.label),
          /** 가장 나중에 끝낸 단계. 하나도 없으면 null */
          last_done: lastDone?.label ?? null,
          /** 지금 손댈 수 있는 단계 — **정렬·지연 판정에만** 쓴다(요약 문구로 쓰지 않는다) */
          open: openDefs.map(d => d.label),
          // 하나라도 오래 멈춰 있으면 목록에서 바로 드러나야 한다
          // 지연 = **약속한 날을 넘긴 것**. 납기는 주문에서, 검사 마감은 신청 단계에서 온다
        stalled: openDefs.some(d => {
          if (!d.dueFrom) return false;
          const due = d.dueFrom.from === 'order'
            ? (o.delivery_due ? o.delivery_due.toISOString().slice(0, 10) : null)
            : (byCode.get(d.dueFrom.code)?.planned_at?.toISOString().slice(0, 10) ?? null);
          return isOverdue(d.code, { code: d.code, status: 'pending' }, due, now, done, defs);
        }),
        },
      };
    });
    res.json({ data });
  } catch (e) {
    console.error('[GET /orders]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 목록을 불러오는 중 오류가 발생했습니다.' } });
  }
});

// ── GET /orders/:id ───────────────────────────────────────────────────────
// MAKER: 자기 org 스코프 강제 + 가격·영업 필드 제외, 사양·서류만 반환

ordersRouter.get('/:id', rbac('SALES', 'ADMIN', 'MAKER'), requirePermission('order.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  try {
    const auth = req.auth!;

    if (ownOrgOnly(auth)) {
      // MAKER: 사양·서류만 — 가격·영업 필드 제외
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          quote: { select: { model_code: true, selections: true, customer: { select: { name: true } } } },
          maker_org: { select: { name: true } },
          documents: { orderBy: { id: 'asc' } },
          options: { include: { value: { include: { group: { select: { code: true, name: true } } } } } },
        },
      });
      if (!order) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
        return;
      }
      if (order.maker_org_id !== auth.org_code) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 조회할 수 있습니다' } });
        return;
      }

      // 옵션 사양 해석: OrderOption 있으면 우선, 없으면 quote.selections JSON 파싱
      type ResolvedOpt = { id: number; group_code: string; group_name: string; value_code: string; value_name: string };
      let options: ResolvedOpt[] = [];
      if (order.options.length > 0) {
        options = order.options.map(o => ({
          id: o.id,
          group_code: o.group_code,
          group_name: o.value.group.name,
          value_code: o.value_code,
          value_name: o.value.name,
        }));
      } else {
        const selections = (order.quote.selections ?? {}) as Record<string, string>;
        const valueCodes = Object.values(selections).filter(Boolean);
        if (valueCodes.length > 0) {
          const values = await prisma.optionValue.findMany({
            where: { code: { in: valueCodes } },
            include: { group: { select: { code: true, name: true } } },
          });
          const vMap = new Map(values.map(v => [v.code, v]));
          options = Object.entries(selections)
            .filter(([, vCode]) => vMap.has(vCode))
            .map(([gCode, vCode], idx) => {
              const v = vMap.get(vCode)!;
              return { id: idx, group_code: gCode, group_name: v.group.name, value_code: vCode, value_name: v.name };
            });
        }
      }

      res.json({
        data: {
          id: order.id,
          quote_id: order.quote_id,
          maker_org_id: order.maker_org_id,
          assigned_at: order.assigned_at,
          created_at: order.created_at,
          model_code: order.quote.model_code,
          customer_name: order.quote.customer?.name ?? null,
          options,
          documents: order.documents,
          vehicle_info: (order as unknown as { vehicle_info?: unknown }).vehicle_info ?? null,
          // 발주서를 상세에서도 다시 그릴 수 있게 — 수락한 뒤에 확인할 방법이 없었다
          remark: order.remark,
          custom_badge: order.custom_badge,
          maker_org_name: order.maker_org?.name ?? null,
          delivery_due: order.delivery_due,
        },
      });
      return;
    }

    // ADMIN / SALES: 전체 응답 + options·documents
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        quote: { include: { customer: true } },
        maker_org: true,
        documents: { orderBy: { id: 'asc' } },
        options: { include: { value: { include: { group: { select: { code: true, name: true } } } } } },
      },
    });
    if (!order) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
      return;
    }

    // options: order_option 우선, 비면 quote.selections 보강
    type AdminResolvedOpt = { id: number; group_code: string; group_name: string; value_code: string; value_name: string };
    let resolvedOptions: AdminResolvedOpt[] = [];
    if (order.options.length > 0) {
      resolvedOptions = order.options.map(o => ({
        id: o.id,
        group_code: o.group_code,
        group_name: o.value.group.name,
        value_code: o.value_code,
        value_name: o.value.name,
      }));
    } else {
      const selections = (order.quote.selections ?? {}) as Record<string, string>;
      const valueCodes = Object.values(selections).filter(Boolean);
      if (valueCodes.length > 0) {
        const values = await prisma.optionValue.findMany({
          where: { code: { in: valueCodes } },
          include: { group: { select: { code: true, name: true } } },
        });
        const vMap = new Map(values.map(v => [v.code, v]));
        resolvedOptions = Object.entries(selections)
          .filter(([, vCode]) => vMap.has(vCode))
          .map(([gCode, vCode], idx) => {
            const v = vMap.get(vCode)!;
            return { id: idx, group_code: gCode, group_name: v.group.name, value_code: vCode, value_name: v.name };
          });
      }
    }

    res.json({ data: { ...order, model_code: order.quote.model_code, customer_name: order.quote.customer?.name ?? null, options: resolvedOptions } });
  } catch (e) {
    console.error('[GET /orders/:id]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 조회 중 오류가 발생했습니다.' } });
  }
});

/*
 * ⚠️ 옛 `PATCH /orders/:id/status` 를 걷어냈다.
 *
 * 주문 진행은 이제 단계 표(`order_step`)가 갖는다 — 6단계 직선은 확정된 적도 없고
 * 차량·특장이 따로 도는 실제 흐름을 담지 못했다. 진행을 바꾸는 길은
 * `PATCH /orders/:id/steps/:code` 하나뿐이다(선행 단계·필수 증빙을 서버가 지킨다).
 * 두 길을 열어 두면 증빙 없이 상태만 올리는 우회로가 남는다.
 */

/** 사유를 읽어 다듬는다 — 없으면 null. 너무 긴 것은 자른다(칼럼 폭). */
function readReason(body: unknown): string | null {
  const raw = (body as { reason?: unknown } | undefined)?.reason;
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t ? t.slice(0, 500) : null;
}

// ── PATCH /orders/:id/reject — 특장사 주문 거부 (배정 해제, 재배정 가능) ──────
/**
 * 특장사가 **못 받겠다**고 하는 문.
 *
 * 예전에는 수락밖에 없어서, 못 받는 주문을 붙들고 있거나 전화로 알리고 관리자가
 * 손으로 되돌려야 했다. 그 사이 그 주문은 **배정된 것처럼 보인다.**
 *
 * 거부하면 배정이 풀려 **다른 특장사에 다시 맡길 수 있다.** 견적은 계약완료로 돌아간다 —
 * 계약이 깨진 것이 아니라 만들 곳을 다시 찾는 것이다.
 *
 * ⚠️ **사유가 필수다.** 「왜 안 받았는지」가 없으면 다시 배정할 수도, 고칠 수도 없다
 *    (납기가 안 되는 것인지, 사양을 못 만드는 것인지에 따라 다음 수가 다르다).
 */
ordersRouter.patch('/:id/reject', rbac('ADMIN', 'MAKER'), requirePermission('order.control'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (isNaN(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } }); return; }

  const reason = readReason(req.body);
  if (!reason) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '거부 사유를 적어야 합니다' } });
    return;
  }

  try {
    const order = await prisma.order.findUnique({ where: { id }, include: { quote: { select: { id: true, status: true } } } });
    if (!order) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    if (ownOrgOnly(req.auth!) && order.maker_org_id !== req.auth!.org_code) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 거부할 수 있습니다' } });
      return;
    }
    /*
     * **수락 전에만** 거부할 수 있다. 이미 수락해 제작이 도는 건은 거부가 아니라
     * 별도의 사정(중단·재배정)이고, 그때는 관리자가 판단할 일이다.
     */
    if (order.quote.status !== 'assigned') {
      res.status(409).json({ error: { code: 'CONFLICT', message: `배정 상태에서만 거부할 수 있습니다 (현재 ${order.quote.status})` } });
      return;
    }

    await prisma.order.update({
      where: { id },
      data: {
        rejected_at: new Date(), rejected_by: req.auth?.email ?? 'unknown', reject_reason: reason,
        // 배정을 푼다 — 다른 특장사에 다시 맡길 수 있어야 한다
        maker_org_id: null, assigned_at: null, delivery_due: null,
      },
    });
    // 계약이 깨진 것이 아니라 만들 곳을 다시 찾는 것이다
    await setQuoteStatus(order.quote.id, 'contracted', req.auth?.email ?? 'unknown');
    const updated = await prisma.quote.findUnique({ where: { id: order.quote.id } });
    res.json({ data: { quote: updated, reason } });
  } catch (e) {
    console.error('[PATCH /orders/:id/reject]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 거부 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /orders/:id/cancel — 관리자가 주문을 치운다 (행은 남는다) ──────────
/**
 * 잘못 만든 주문을 **목록에서 치운다.**
 *
 * ⚠️ **행을 지우지 않는다.** 「삭제」라고 부르지만 상태로 남긴다 —
 *    누가 언제 왜 치웠는지가 사라지면 나중에 아무도 설명하지 못한다.
 *    (견적 삭제가 서명된 계약까지 연쇄로 지운 사고 이후의 규칙 — CLAUDE.md)
 *
 * ⚠️ **수락 대기·진행중까지만.** 인도가 끝난 건은 치우지 않는다 — 이미 일어난 거래다.
 *
 * 권한은 `order.remove` 로 **계정별로** 켠다. 관리자라고 다 되면 안 되는 일이다.
 */
ordersRouter.patch('/:id/cancel', rbac('ADMIN'), requirePermission('order.remove'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (isNaN(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } }); return; }

  const reason = readReason(req.body);
  if (!reason) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '치우는 사유를 적어야 합니다' } });
    return;
  }

  try {
    const order = await prisma.order.findUnique({ where: { id }, include: { quote: { select: { id: true, status: true } } } });
    if (!order) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    if (order.canceled_at) { res.status(409).json({ error: { code: 'CONFLICT', message: '이미 치운 주문입니다' } }); return; }

    // 수락 대기(assigned) · 진행중(ordered) 까지만
    if (order.quote.status !== 'assigned' && order.quote.status !== 'ordered') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: `수락 대기·진행중 주문만 치울 수 있습니다 (현재 ${order.quote.status})` },
      });
      return;
    }

    await prisma.order.update({
      where: { id },
      data: { canceled_at: new Date(), canceled_by: req.auth?.email ?? 'unknown', cancel_reason: reason },
    });
    // 견적은 계약완료로 되돌린다 — 계약은 그대로고 만들 곳만 없어진 것이다
    await setQuoteStatus(order.quote.id, 'contracted', req.auth?.email ?? 'unknown');
    const updated = await prisma.quote.findUnique({ where: { id: order.quote.id } });
    res.json({ data: { quote: updated, reason } });
  } catch (e) {
    console.error('[PATCH /orders/:id/cancel]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문을 치우는 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /orders/:id/accept — 특장사 주문 수락 (배정→주문, 제작 착수) ──────
// 배정된 특장사가 주문을 수락하면 견적 상태 assigned→ordered. 이후 진행은 단계 표가 갖는다.

ordersRouter.patch('/:id/accept', rbac('ADMIN', 'MAKER'), requirePermission('order.control'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  try {
    const order = await prisma.order.findUnique({ where: { id }, include: { quote: { select: { id: true, status: true } } } });
    if (!order) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
      return;
    }
    if (ownOrgOnly(req.auth!) && order.maker_org_id !== req.auth!.org_code) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 수락할 수 있습니다' } });
      return;
    }
    if (order.quote.status !== 'assigned') {
      res.status(409).json({ error: { code: 'CONFLICT', message: `배정 상태에서만 수락할 수 있습니다 (현재 ${order.quote.status})` } });
      return;
    }

    /*
     * 납기일은 **수락과 같은 동작으로 받는다.**
     * 나중에 따로 입력하게 두면 납기 없는 주문이 생기고, 그 순간 「언제 오냐」를
     * 시스템이 답할 수 없게 된다. 한도(발주일로부터 15영업일)는 발주서 특이사항이고,
     * 화면과 서버가 **같은 함수**로 판정한다(shared/schedule) — 화면에서 고를 수 있는데
     * 서버가 거부하는 상황을 만들지 않기 위해서다.
     */
    const dueRaw = typeof (req.body as { delivery_due?: unknown })?.delivery_due === 'string'
      ? (req.body as { delivery_due: string }).delivery_due : '';
    const due = fromDateInput(dueRaw);
    if (!due) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '납기일(delivery_due)을 YYYY-MM-DD 로 보내야 합니다' } });
      return;
    }
    // 기산점은 **배정일**(= 발주일). 없으면 주문 생성일로 대신한다.
    const orderedAt = order.assigned_at ?? order.created_at;
    const check = checkDeliveryDue(due, orderedAt);
    if (!check.ok) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: check.reason } });
      return;
    }

    const now = new Date();
    await prisma.order.update({ where: { id }, data: { delivery_due: toDbDate(due), accepted_at: now } });
    await setQuoteStatus(order.quote.id, 'ordered', req.auth?.email ?? 'unknown');
    const updated = await prisma.quote.findUnique({ where: { id: order.quote.id } });
    res.json({ data: { quote: updated, delivery_due: toDateInput(due) } });
  } catch (e) {
    console.error('[PATCH /orders/:id/accept]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 수락 중 오류가 발생했습니다.' } });
  }
});

// ── GET /orders/:orderId/documents ────────────────────────────────────────

ordersRouter.get('/:orderId/documents', rbac('ADMIN', 'MAKER'), requirePermission('doc.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const orderId = Number(req.params['orderId']);
  if (isNaN(orderId)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  try {
    // MAKER: 자기 org 주문만
    if (ownOrgOnly(req.auth!)) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { maker_org_id: true } });
      if (!order || order.maker_org_id !== req.auth!.org_code) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 조회할 수 있습니다' } });
        return;
      }
    }
    const docs = await prisma.document.findMany({ where: { order_id: orderId }, orderBy: { id: 'asc' } });
    res.json({ data: docs });
  } catch (e) {
    console.error('[GET /orders/:orderId/documents]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '문서 조회 중 오류가 발생했습니다.' } });
  }
});
