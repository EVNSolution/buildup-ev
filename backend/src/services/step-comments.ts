/**
 * 단계별 대화 — 특장사와 관리자가 그 단계 자리에서 주고받는다.
 *
 * **이력이 이 기능의 목적이다.** 고치지도 지우지도 않는다 — 「그때 무슨 이야기가 오갔나」가
 * 나중에 납기 지연·사양 변경의 근거가 된다. 잘못 쓴 글은 다음 글로 바로잡는다.
 * (CLAUDE.md: 뭐든 지우지 말고 남겨 두는 게 좋다)
 *
 * 빨간 점은 **사람마다 다르다** — 내가 안 읽었는지를 본다. 그래서 읽은 시각을
 * (사용자 × 주문 × 단계)로 따로 저장한다.
 */
import { prisma } from '../lib/prisma.js';
import { notify, pushAllowed } from './push.js';
import { adminRecipients } from './notify.js';

/** 한 번에 쓸 수 있는 길이 — DB 컬럼(VARCHAR 2000)과 같은 값이어야 한다 */
export const COMMENT_MAX = 2000;

export interface CommentRow {
  id: number;
  step_code: string;
  author: string;
  author_role: string;
  author_name: string | null;
  body: string;
  /** 붙인 사진(order_file.id). 없으면 null */
  image_file_id: number | null;
  created_at: Date;
}

/** 한 단계의 대화 — 오래된 것부터. 채팅이라 위에서 아래로 읽는다 */
export async function listComments(orderId: number, stepCode: string): Promise<CommentRow[]> {
  if (!prisma) return [];
  return prisma.orderStepComment.findMany({
    where: { order_id: orderId, step_code: stepCode },
    orderBy: { id: 'asc' },
    select: {
      id: true, step_code: true, author: true, author_role: true,
      author_name: true, body: true, image_file_id: true, created_at: true,
    },
  });
}

/**
 * 주문의 **모든 대화를 시간순으로** — 「대화」 탭이 쓴다.
 *
 * 단계별로 흩어 보면 전체 흐름이 안 읽힌다. 어느 단계 이야기인지는 각 글에 붙여 두고,
 * 순서는 오간 그대로 둔다 — 이력을 읽는다는 것은 시간을 따라 읽는다는 뜻이다.
 */
export async function listAllComments(orderId: number): Promise<CommentRow[]> {
  if (!prisma) return [];
  return prisma.orderStepComment.findMany({
    where: { order_id: orderId },
    orderBy: { id: 'asc' },
    select: {
      id: true, step_code: true, author: true, author_role: true,
      author_name: true, body: true, image_file_id: true, created_at: true,
    },
  });
}

/**
 * 단계마다 **안 읽은 글이 몇 개인가** — 버튼의 빨간 점을 켜는 근거.
 *
 * 내가 쓴 글은 세지 않는다. 내가 방금 쓴 글 때문에 내 화면에 빨간 점이 켜지면
 * 「누가 답했나」 하고 열어 보게 된다.
 */
export async function unreadByStep(
  orderId: number, userEmail: string,
): Promise<Record<string, number>> {
  if (!prisma) return {};
  const [comments, reads] = await Promise.all([
    prisma.orderStepComment.findMany({
      where: { order_id: orderId, author: { not: userEmail } },
      select: { step_code: true, created_at: true },
    }),
    prisma.orderStepRead.findMany({
      where: { order_id: orderId, user_email: userEmail },
      select: { step_code: true, last_read_at: true },
    }),
  ]);
  const readAt = new Map(reads.map((r) => [r.step_code, r.last_read_at]));
  const out: Record<string, number> = {};
  for (const c of comments) {
    const seen = readAt.get(c.step_code);
    // 한 번도 안 연 단계는 전부 안 읽은 것으로 본다
    if (!seen || c.created_at > seen) out[c.step_code] = (out[c.step_code] ?? 0) + 1;
  }
  return out;
}

/** 이 단계를 지금 읽었다고 표시. 열 때마다 부른다 */
export async function markRead(
  orderId: number, stepCode: string, userEmail: string,
): Promise<void> {
  if (!prisma) return;
  const now = new Date();
  await prisma.orderStepRead.upsert({
    where: { user_email_order_id_step_code: { user_email: userEmail, order_id: orderId, step_code: stepCode } },
    create: { user_email: userEmail, order_id: orderId, step_code: stepCode, last_read_at: now },
    update: { last_read_at: now },
  });
}

/**
 * 글을 남긴다. 남긴 뒤 **상대편에게** 푸시를 보낸다.
 *
 * 상대편 = 이 주문에 관여하는 사람 중 나를 뺀 사람들:
 *   · 배정된 특장사 조직의 계정
 *   · 관리자 계정 — 단, 「제작 배정 알림」 기능모듈이 켜진 계정만.
 *     모든 관리자에게 알림이 가면 안 된다는 것은 이미 정해진 규칙이다(#…).
 */
export async function addComment(args: {
  orderId: number;
  stepCode: string;
  stepLabel: string;
  author: string;
  authorRole: string;
  authorName: string | null;
  body: string;
  /** 함께 붙인 사진(order_file.id) */
  imageFileId?: number | null;
}): Promise<CommentRow> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');
  const body = args.body.trim().slice(0, COMMENT_MAX);
  const row = await prisma.orderStepComment.create({
    data: {
      order_id: args.orderId, step_code: args.stepCode,
      author: args.author, author_role: args.authorRole,
      author_name: args.authorName, body,
      image_file_id: args.imageFileId ?? null,
    },
    select: {
      id: true, step_code: true, author: true, author_role: true,
      author_name: true, body: true, image_file_id: true, created_at: true,
    },
  });
  // 쓴 사람은 그 단계를 읽은 것으로 본다 — 자기 글에 빨간 점이 켜지지 않게
  await markRead(args.orderId, args.stepCode, args.author).catch(() => {});
  void notifyOthers(args, row);
  return row;
}

/**
 * 푸시 대상 추리기 + 보내기. 실패해도 댓글 작성은 이미 끝났다.
 *
 * 받을 사람:
 *   · 배정된 **특장사 조직**의 활성 계정 — 이 주문을 실제로 만드는 사람들
 *   · 그 스레드에 **이미 글을 쓴 사람** — 답을 기다리고 있다
 *   · 「제작 배정 알림」을 켠 **관리자** — 알림 대상 판정은 메일과 같은 규칙을 쓴다
 *
 * 나 자신은 뺀다. 내가 쓴 글 때문에 내 폰이 울리면 안 된다.
 */
async function notifyOthers(
  args: { orderId: number; stepCode: string; stepLabel: string; author: string; authorName: string | null },
  row: CommentRow,
): Promise<void> {
  if (!prisma) return;
  try {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, maker_org_id: true },
    });
    if (!order) return;

    const [makers, participants, admins] = await Promise.all([
      order.maker_org_id
        ? prisma.user.findMany({
            where: { org_code: order.maker_org_id, active: true, status: 'active' },
            select: { email: true },
          })
        : Promise.resolve([] as { email: string }[]),
      prisma.orderStepComment.findMany({
        where: { order_id: args.orderId, step_code: args.stepCode },
        select: { author: true },
        distinct: ['author'],
      }),
      adminRecipients(),
    ]);

    const candidates = [...new Set([
      ...makers.map((m) => m.email),
      ...participants.map((p) => p.author),
      ...admins,
    ])].filter((e) => e !== args.author);
    // 기능모듈 「앱 알림」이 켜진 계정만 — 기기 구독은 그 다음 조건이다
    const to = await pushAllowed(candidates);
    if (to.length === 0) return;

    const who = args.authorName ?? args.author;
    notify(to, {
      title: `주문 #${order.id} · ${args.stepLabel}`,
      body: `${who}: ${row.body.slice(0, 120) || '(사진)'}`,
      /*
       * 알림을 누르면 **그 주문의 「대화」 탭**이 열린다.
       * `/` 로 보내는 이유: 받는 사람이 관리자인지 특장사인지 서버는 모른다.
       * `/` 가 각자 화면으로 보내면서 이 물음표 뒤를 그대로 들고 간다(HomeGate).
       * `step` 은 대화 탭에서 그 단계를 골라 둔 상태로 열기 위한 값이다.
       */
      url: `/?order=${order.id}&tab=chat&step=${encodeURIComponent(args.stepCode)}`,
      tag: `step-${order.id}-${args.stepCode}`,
    });
  } catch (e) {
    console.error('[step-comments] 알림 대상 조회 실패', e);
  }
}
