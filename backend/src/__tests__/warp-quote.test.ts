import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findFirst:vi.fn(), findMany:vi.fn(), render:vi.fn(), read:vi.fn() }));
vi.mock('../lib/prisma.js',()=>({prisma:{quote:{findFirst:mocks.findFirst,findMany:mocks.findMany}}}));
vi.mock('../services/quote-pdf.js',()=>({generateQuotePdf:mocks.render}));
vi.mock('node:fs/promises',()=>({readFile:mocks.read}));
import { exportWarpQuote, listWarpQuotes, readFrozenFacts, validFacts, validWarpCustomerId } from '../services/warp-quote.js';
const pdf=Buffer.from('%PDF-synthetic');
const facts={model:'PV5',spec:'냉동 저상 · 추가 사양',grossAmountWon:56000000,amountWon:43000000};
const quote={id:7,quote_no:'26-1234',updated_at:new Date('2026-10-16T00:00:00Z'),docs_frozen_at:null};
beforeEach(()=>{vi.resetAllMocks();mocks.findFirst.mockResolvedValue(quote);mocks.render.mockResolvedValue({pdf,warpFacts:facts});});
describe('WARP linked quote export',()=>{
  it('only queries explicitly linked visible customers and visible quotes',async()=>{
    mocks.findMany.mockResolvedValue([]);
    expect(await listWarpQuotes('warp-one')).toEqual({quotes:[],hasMore:false});
    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({hidden_at:null,customer:{hidden_at:null,warp_customer_id:'warp-one'}});
    mocks.findFirst.mockResolvedValue(null);
    await expect(exportWarpQuote('warp-other',7)).rejects.toMatchObject({status:404});
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('exports both amounts from the same PDF calculation without customer PII',async()=>{
    const result=await exportWarpQuote('warp-one',7);
    expect(mocks.render).toHaveBeenCalledWith(7,{archive:false});
    expect(result).toMatchObject({...facts,quoteId:7,warpCustomerId:'warp-one',pdfBase64:pdf.toString('base64')});
    expect(result).not.toHaveProperty('customer');
    expect(result.pdfSha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect((await exportWarpQuote('warp-one',7)).version).toBe(result.version);
    mocks.render.mockResolvedValue({pdf,warpFacts:{...facts,amountWon:44000000}});
    expect((await exportWarpQuote('warp-one',7)).version).not.toBe(result.version);
  });
  it('rejects ownership/revision changes while rendering',async()=>{
    mocks.findFirst.mockResolvedValueOnce(quote).mockResolvedValueOnce(null);
    await expect(exportWarpQuote('warp-one',7)).rejects.toMatchObject({status:409});
  });
  it('never recalculates missing historical frozen facts',async()=>{
    mocks.findFirst.mockResolvedValue({...quote,docs_frozen_at:new Date(),docs_frozen_quote_path:'/synthetic.pdf'});
    mocks.read.mockRejectedValue(new Error('missing'));
    await expect(exportWarpQuote('warp-one',7)).rejects.toMatchObject({status:409});
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('uses matching frozen PDF facts and rejects a different PDF or invalid money',()=>{
    const raw=JSON.stringify({version:1,pdfSha256:createHash('sha256').update(pdf).digest('hex'),facts});
    expect(readFrozenFacts(raw,pdf)).toEqual(facts);
    expect(()=>readFrozenFacts(raw,Buffer.from('%PDF-other'))).toThrow();
    expect(validFacts({...facts,grossAmountWon:0.5})).toBe(false);
    expect(validWarpCustomerId('../other')).toBe(false);
  });
});
