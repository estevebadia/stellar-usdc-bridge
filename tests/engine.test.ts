import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './memory-storage';
import { transfer, message, G, E } from './message-fixture';
import type { Quote } from '../src/quote';
import { readTransfer, saveTransfer, canStartNew } from '../src/storage';
const m=vi.hoisted(()=>({
  send:vi.fn(),check:vi.fn(),receipt:vi.fn(),tx:vi.fn(),read:vi.fn(),stellarTx:vi.fn(),stellarSend:vi.fn(),sign:vi.fn(),fetchMessage:vi.fn(),
  getBlockNumber:vi.fn(),getCount:vi.fn(),getBlock:vi.fn(),
}));
vi.mock('../src/wallets',()=>({baseProvider:{request:m.send},checkBaseWallet:m.check,signStellar:m.sign}));
vi.mock('../src/clients',()=>({checkNetworks:vi.fn(),baseClient:{getBlockNumber:m.getBlockNumber,getTransactionCount:m.getCount,getBlock:m.getBlock,getTransactionReceipt:m.receipt,getTransaction:m.tx,readContract:m.read},stellarClient:{getTransaction:m.stellarTx,sendTransaction:m.stellarSend},stellarRead:vi.fn(),estimateBase:vi.fn(),prepareStellar:vi.fn()}));
vi.mock('../src/circle',async original=>({...await original<typeof import('../src/circle')>(),fetchMessage:m.fetchMessage}));
import { newTransfer, reconcile, submitSource } from '../src/engine';
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('localStorage',memoryStorage());
  m.getBlockNumber.mockResolvedValue(100n);m.getCount.mockResolvedValue(0);m.fetchMessage.mockResolvedValue(null);
  m.tx.mockImplementation(async({hash})=>({hash,from:E,nonce:0,to:'0x1234',input:'0xabcd'}));
  m.receipt.mockRejectedValue(Object.assign(new Error('pending'),{name:'TransactionReceiptNotFoundError'}));
});
const update=vi.fn();
function q():Quote {
  return {input:{direction:'base-stellar',stellar:G,base:E,amount:1000000n},expiresAt:Date.now()+60000,
    fee:0n,receive:1000000n,balance:2000000n,allowance:2000000n,needsApproval:false,sourceCost:100n,
    destinationCost:100n,stellarXlm:1000000n,baseEth:1000000n,action:'burn',basePrepared:{to:'0x1234',data:'0xabcd',gas:100000n}};
}
describe('burn lifecycle and recovery',()=>{
  it('persists the request BEFORE asking the wallet, and keeps an uncertain burn locked across reload',async()=>{
    const quote=q(),t=newTransfer(quote);
    m.send.mockImplementation(async()=>{expect(readTransfer()?.sourceRequest?.nonce).toBe(0);throw new Error('Disconnected after submission');});
    await expect(submitSource(quote,t,update)).rejects.toThrow('Disconnected');
    expect(readTransfer()?.stage).toBe('source-pending');expect(readTransfer()?.sourceHash).toBeUndefined();
    expect(canStartNew(readTransfer())).toBe(false);
  });
  it('allows recovery review after an explicit EVM user rejection',async()=>{
    const quote=q(),t=newTransfer(quote);m.send.mockRejectedValue({code:4001});
    await expect(submitSource(quote,t,update)).rejects.toEqual({code:4001});
    expect(readTransfer()?.stage).toBe('review');expect(readTransfer()?.sourceRequest).toBeUndefined();
  });
  it('blocks a stale second burn even if caller has an old review object',async()=>{
    const quote=q(),t=newTransfer(quote);saveTransfer({...t,stage:'source-pending'});
    await expect(submitSource(quote,t,update)).rejects.toThrow('Reconcile');expect(m.send).not.toHaveBeenCalled();
  });
  it('persists a returned source hash even if the next receipt check is interrupted',async()=>{
    const quote=q(),t=newTransfer(quote);m.send.mockResolvedValue('0x'+'a'.repeat(64));
    await submitSource(quote,t,update);
    expect(readTransfer()?.sourceHash).toBe('0x'+'a'.repeat(64));expect(readTransfer()?.stage).toBe('source-pending');
  });
  it('waits through delayed attestations without allowing another burn',async()=>{
    const t={...transfer('base-stellar'),stage:'attestation' as const};saveTransfer(t);
    await reconcile(t,update);expect(readTransfer()?.stage).toBe('attestation');expect(canStartNew(readTransfer())).toBe(false);
  });
  it('never reports completion solely because Circle attestation is complete',async()=>{
    const t={...transfer(),stage:'attestation' as const};saveTransfer(t);
    m.fetchMessage.mockResolvedValue({status:'complete',message:message(t),attestation:'0x1234'});m.read.mockResolvedValue(0n);
    await reconcile(t,update);expect(readTransfer()?.stage).toBe('destination-ready');expect(canStartNew(readTransfer())).toBe(false);
  });
  it('verifies destination nonce execution before completing an already delivered transfer',async()=>{
    const t={...transfer(),stage:'attestation' as const};saveTransfer(t);
    m.fetchMessage.mockResolvedValue({status:'complete',message:message(t),attestation:'0x1234'});m.read.mockResolvedValue(1n);
    await reconcile(t,update);expect(readTransfer()?.stage).toBe('complete');expect(readTransfer()?.received).toBe('943000');
  });
  it('uses the saved attestation if Circle is unavailable after a refresh',async()=>{
    const t={...transfer(),stage:'destination-ready' as const,message:message(transfer()),attestation:'0x1234' as const};saveTransfer(t);
    m.fetchMessage.mockRejectedValue(new Error('Circle unavailable'));m.read.mockResolvedValue(1n);
    await reconcile(t,update);expect(readTransfer()?.stage).toBe('complete');
  });
  it('a reverted destination transaction offers the same claim; it never unlocks a new burn',async()=>{
    const t={...transfer(),stage:'destination-pending' as const,destinationHash:'0x'+'b'.repeat(64)};saveTransfer(t);
    m.fetchMessage.mockResolvedValue({status:'complete',message:message(t),attestation:'0x1234'});m.read.mockResolvedValue(0n);m.receipt.mockResolvedValue({status:'reverted'});
    await reconcile(t,update);expect(readTransfer()?.stage).toBe('destination-ready');expect(readTransfer()?.sourceHash).toBe(t.sourceHash);expect(canStartNew(readTransfer())).toBe(false);
  });
});
