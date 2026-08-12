// 기존 견적에 quote_no(YY-NNNN)를 created_at 순서로 일괄 부여하는 1회성 스크립트
// 채번은 운영 경로와 같은 채번대장(quote_no_counter)을 쓴다 — 여기서만 따로 세면
// 이 스크립트가 준 번호가 나중에 신규 견적에 다시 나갈 수 있다.
import { PrismaClient } from '@prisma/client'
import { nextQuoteNo } from '../src/services/quote-no.js'

const prisma = new PrismaClient()

async function main() {
  const quotes = await prisma.quote.findMany({
    where: { quote_no: null },
    orderBy: { created_at: 'asc' },
    select: { id: true, created_at: true },
  })

  if (quotes.length === 0) {
    console.log('모든 견적에 번호가 이미 부여되어 있습니다.')
    return
  }

  const byYear = new Map<number, { id: number; created_at: Date }[]>()
  for (const q of quotes) {
    const year = q.created_at.getFullYear()
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(q)
  }

  let total = 0
  for (const [year, yearQuotes] of Array.from(byYear.entries()).sort(([a], [b]) => a - b)) {
    for (const q of yearQuotes) {
      const quote_no = await nextQuoteNo(prisma, year)
      await prisma.quote.update({ where: { id: q.id }, data: { quote_no } })
      console.log(`견적 #${q.id} → ${quote_no}`)
      total++
    }
  }

  console.log(`완료: ${total}개 견적에 번호 부여`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
