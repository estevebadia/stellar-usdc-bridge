import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type SignClient from '@walletconnect/sign-client';
import { connecting, StellarWalletConnect, WC_TOPIC_KEY } from '../src/stellar-walletconnect';
import { stellarProposal } from '../src/wallet-protocol';
import { memoryStorage } from './memory-storage';
import { G, transfer } from './message-fixture';
import { saveTransfer, readTransfer, canStartNew } from '../src/storage';
import { walletSession as session } from './wallet-session-fixture';
function fakeClient() {
  const events=new Map<string,(event:any)=>void>();let current=session();
  const client={connect:vi.fn(),request:vi.fn(),disconnect:vi.fn().mockResolvedValue(undefined),
    session:{get:vi.fn(()=>current)},core:{pairing:{disconnect:vi.fn().mockResolvedValue(undefined)}},
    on:vi.fn((event,fn)=>{events.set(event,fn);})};
  return {client,events,update:(s:ReturnType<typeof session>)=>{current=s;},
    adapter:new StellarWalletConnect(client as unknown as SignClient,vi.fn())};
}
beforeEach(()=>{vi.stubGlobal('localStorage',memoryStorage());});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('Stellar WalletConnect lifecycle',()=>{
  it('pairs, restores after reload, and requests sign-only on the selected mainnet topic',async()=>{
    const {client,adapter}=fakeClient();client.connect.mockResolvedValue({uri:'wc:pair@2?relay-protocol=irn',approval:async()=>session()});
    const uri=vi.fn();expect(await adapter.connect(uri,new AbortController().signal)).toBe(G);
    expect(client.connect).toHaveBeenCalledWith(stellarProposal);expect(uri).toHaveBeenCalled();
    expect(localStorage.getItem(WC_TOPIC_KEY)).toBe('session-topic');
    const restored=new StellarWalletConnect(client as unknown as SignClient,vi.fn());
    expect(await restored.connect(uri,new AbortController().signal)).toBe(G);expect(client.connect).toHaveBeenCalledTimes(1);
    client.request.mockResolvedValue({signedXDR:'signed'});expect(await restored.sign('prepared',G)).toBe('signed');
    expect(client.request).toHaveBeenCalledWith({topic:'session-topic',chainId:'stellar:pubnet',request:{method:'stellar_signXDR',params:{xdr:'prepared'}},expiry:300});
  });
  it('blocks signing after expiry or account changes',async()=>{
    const {adapter,client,update}=fakeClient();localStorage.setItem(WC_TOPIC_KEY,'session-topic');
    const expired=session();expired.expiry=1;update(expired);await expect(adapter.sign('xdr',G)).rejects.toThrow('expired');
    const changed=session();changed.namespaces.stellar.accounts=[];update(changed);await expect(adapter.sign('xdr',G)).rejects.toThrow('Reconnect');
    expect(client.request).not.toHaveBeenCalled();
  });
  it('cancels pairing and discards a late wallet approval',async()=>{
    const {adapter,client}=fakeClient();let approve!:(s:ReturnType<typeof session>)=>void;
    const pending=new Promise<ReturnType<typeof session>>(resolve=>{approve=resolve;});
    client.connect.mockResolvedValue({uri:'wc:pair@2?relay-protocol=irn',approval:()=>pending});
    const controller=new AbortController(),shown=vi.fn();const connecting=adapter.connect(shown,controller.signal);
    await vi.waitFor(()=>expect(shown).toHaveBeenCalled());controller.abort();
    await expect(connecting).rejects.toMatchObject({code:4001});approve(session());
    await vi.waitFor(()=>expect(client.disconnect).toHaveBeenCalled());
    expect(client.core.pairing.disconnect).toHaveBeenCalledWith({topic:'pair'});expect(localStorage.getItem(WC_TOPIC_KEY)).toBeNull();
  });
  it('disconnect/session deletion preserves the saved burn and its recovery lock',async()=>{
    const {adapter,client,events}=fakeClient();saveTransfer(transfer());localStorage.setItem(WC_TOPIC_KEY,'session-topic');
    await adapter.disconnect();expect(readTransfer()?.sourceHash).toBe('a'.repeat(64));expect(canStartNew(readTransfer())).toBe(false);
    expect(client.disconnect).toHaveBeenCalled();localStorage.setItem(WC_TOPIC_KEY,'session-topic');
    events.get('session_delete')!({topic:'session-topic'});expect(localStorage.getItem(WC_TOPIC_KEY)).toBeNull();expect(canStartNew(readTransfer())).toBe(false);
  });
  it('bounds a stuck connection and handles a late response without selecting it',async()=>{
    vi.useFakeTimers();const late=vi.fn();let resolve!:(s:string)=>void;
    const operation=connecting(new Promise<string>(r=>{resolve=r;}),new AbortController().signal,late);
    const rejected=expect(operation).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(120000);await rejected;
    resolve('late');await Promise.resolve();expect(late).toHaveBeenCalledWith('late');
  });
});
