import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './memory-storage';
import { E, G, transfer } from './message-fixture';
import { saveTransfer, readTransfer, canStartNew } from '../src/storage';
const m=vi.hoisted(()=>({create:vi.fn(),wc:vi.fn(),isConnected:vi.fn(),getPublicKey:vi.fn(),sign:vi.fn()}));
vi.mock('@coinbase/wallet-sdk',()=>({createCoinbaseWalletSDK:m.create}));
vi.mock('@lobstrco/signer-extension-api',()=>({isConnected:m.isConnected,getPublicKey:m.getPublicKey,signTransaction:m.sign}));
vi.mock('../src/stellar-walletconnect',async original=>({...await original<typeof import('../src/stellar-walletconnect')>(),stellarWalletConnect:m.wc}));
function provider() {
  let chain='0x1';
  const p={request:vi.fn(async({method}:{method:string})=>{
    if(method==='eth_requestAccounts'||method==='eth_accounts')return [E];
    if(method==='eth_chainId')return chain;
    if(method==='wallet_switchEthereumChain'){chain='0x2105';return null;}
    if(method==='eth_sendTransaction')return '0xhash';
  }),on:vi.fn(),removeListener:vi.fn(),disconnect:vi.fn().mockResolvedValue(undefined),isCoinbaseWallet:true};
  return p;
}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();vi.stubGlobal('localStorage',memoryStorage());vi.stubGlobal('window',{location:{origin:'https://bridge.example'}});});
describe('Coinbase provider selection and recovery',()=>{
  it('selects the provider lazily and uses the injected wallet browser instead of launching a relay',async()=>{
    const wallets=await import('../src/wallets');expect(m.create).not.toHaveBeenCalled();
    const p=provider();(window as any).ethereum=p;
    expect(await wallets.connectBase(new AbortController().signal)).toBe(E);
    expect(m.create).not.toHaveBeenCalled();expect(p.request).toHaveBeenCalledWith({method:'wallet_switchEthereumChain',params:[{chainId:'0x2105'}]});
    expect(await wallets.baseProvider.request({method:'eth_sendTransaction',params:[{to:E}]})).toBe('0xhash');
  });
  it('requires the same account before sending a Base transaction',async()=>{
    const wallets=await import('../src/wallets');const p=provider();(window as any).coinbaseWalletExtension=p;
    await wallets.connectBase(new AbortController().signal);
    await expect(wallets.checkBaseWallet('0x0000000000000000000000000000000000000001')).rejects.toThrow('Reconnect');
  });
  it('can reset a stuck connection and reconnect without deleting transfer state',async()=>{
    const wallets=await import('../src/wallets');const p=provider();saveTransfer(transfer());
    m.create.mockReturnValue({getProvider:()=>p});const original=p.request.getMockImplementation()!;
    p.request.mockImplementation(args=>args.method==='eth_requestAccounts'?new Promise(()=>{}):original(args));
    const controller=new AbortController(),pending=wallets.connectBase(controller.signal);controller.abort();
    await expect(pending).rejects.toMatchObject({code:4001});expect(p.disconnect).toHaveBeenCalled();
    expect(canStartNew(readTransfer())).toBe(false);
    p.request.mockImplementation(original);expect(await wallets.connectBase(new AbortController().signal)).toBe(E);expect(m.create).toHaveBeenCalledTimes(2);
    await wallets.disconnectWallet('base');expect(p.removeListener).toHaveBeenCalled();expect(readTransfer()?.stellar).toBe(G);
  });
});
