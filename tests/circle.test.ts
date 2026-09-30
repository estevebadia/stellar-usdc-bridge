import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import type { Hex } from 'viem';
import { circleFee, parseMessage, verifyMessage, fetchMessage } from '../src/circle';
import { message, transfer } from './message-fixture';
afterEach(()=>vi.unstubAllGlobals());
describe('attestation validation',()=>{
  it.each(['stellar-base','base-stellar'] as const)('validates the raw %s route even when API decoded address fields are null',direction=>{
    const t=transfer(direction),m=verifyMessage(message(t),t);
    expect(m.amount).toBe(1000000n);expect(m.fee).toBe(BigInt(t.maxFee));
  });
  it.each([4,8,44,76,108,140,144,152,184,216,248,280,312,376])('blocks a mismatched byte at offset %s',offset=>{
    const t=transfer('base-stellar'),data=Buffer.from(message(t).slice(2),'hex');data[offset]^=1;
    expect(()=>verifyMessage(('0x'+data.toString('hex')) as Hex,t)).toThrow();
  });
  it('does not treat attestation complete as destination execution',async()=>{
    const t=transfer();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({messages:[{cctpVersion:2,status:'complete',message:message(t),attestation:'0x1234',decodedMessage:{mintRecipient:null}}]}))));
    const m=await fetchMessage(t);
    expect(m?.status).toBe('complete');expect(t.stage).toBe('source-pending');
  });
  it('rejects an attested message for another recipient',async()=>{
    const t=transfer(),other={...t,base:'0x9999999999999999999999999999999999999999' as Hex};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({messages:[{cctpVersion:2,status:'complete',message:message(other),attestation:'0x1234'}]}))));
    await expect(fetchMessage(t)).rejects.toThrow('does not uniquely match');
  });
  it('keeps delayed attestation as a recoverable pending transfer',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:404})));
    expect(await fetchMessage(transfer())).toBe(null);
  });
});
describe('route fee quote',()=>{
  it('counts a source minimum fee once, then adds forwarding',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify([{finalityThreshold:2000,minimumFee:1,forwardFee:{high:57000}}]))));
    expect(await circleFee('stellar-base',1000000n,100n)).toBe(57100n);
    expect(await circleFee('stellar-base',1000000n,200n)).toBe(57200n);
  });
  it('selects Standard by threshold, not array position; high forwardFee is in SIX decimal units',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify([{finalityThreshold:1000,minimumFee:13,forwardFee:{high:90000}},{finalityThreshold:2000,minimumFee:0,forwardFee:{high:57000}}]))));
    expect(await circleFee('stellar-base',1000000n)).toBe(57000n);
  });
  it('blocks burns when a forwarding quote is absent',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify([{finalityThreshold:2000,minimumFee:0}]))));
    await expect(circleFee('stellar-base',1000000n)).rejects.toThrow('forwarding is unavailable');
  });
});
