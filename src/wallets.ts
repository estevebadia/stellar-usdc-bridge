import * as lobstr from '@lobstrco/signer-extension-api';
import { createCoinbaseWalletSDK } from '@coinbase/wallet-sdk';
import { getAddress, type Address } from 'viem';
import { stellarAccount } from './encoding';
import { connecting, stellarWalletConnect } from './stellar-walletconnect';
import { verifiedStellarSignature } from './wallet-protocol';

export type StellarMethod = 'walletconnect' | 'extension';
type Request = {method:string; params?:readonly unknown[] | object};
type Listener = (...args:any[]) => void;
type Provider = {request:(args:Request)=>Promise<any>; on?:(event:'accountsChanged'|'chainChanged'|'disconnect',listener:Listener)=>unknown;
  removeListener?:(event:'accountsChanged'|'chainChanged'|'disconnect',listener:Listener)=>unknown; disconnect?:()=>Promise<void>;
  isCoinbaseWallet?:boolean; isCoinbaseBrowser?:boolean; providers?:Provider[]};
type WalletEvent = {chain:'stellar'|'base'; address?:string;action?:'signing'|'idle'};
const listeners = new Set<(event:WalletEvent)=>void>();
const emit = (event:WalletEvent) => listeners.forEach(fn=>fn(event));
export function subscribeWallets(fn:(event:WalletEvent)=>void) {listeners.add(fn);return ()=>{listeners.delete(fn);};}
const stellarChanged = (address:string) => {if(stellarMethod==='walletconnect')emit({chain:'stellar',address});};
let stellarMethod:StellarMethod|undefined;
let provider:Provider|undefined;
let detach = () => {};
let baseAttempt=0;

export function injectedCoinbase():Provider|undefined {
  const w=window as unknown as {coinbaseWalletExtension?:Provider;ethereum?:Provider};
  return w.coinbaseWalletExtension??w.ethereum?.providers?.find(p=>p.isCoinbaseWallet||p.isCoinbaseBrowser)
    ??(w.ethereum?.isCoinbaseWallet||w.ethereum?.isCoinbaseBrowser?w.ethereum:undefined);
}
function selectProvider(next:Provider) {
  detach();provider=next;
  const accounts:Listener=(a:string[])=>emit({chain:'base',address:a[0]?getAddress(a[0]):''});
  const chain:Listener=()=>emit({chain:'base'});
  const disconnect:Listener=()=>emit({chain:'base',address:''});
  next.on?.('accountsChanged',accounts);next.on?.('chainChanged',chain);next.on?.('disconnect',disconnect);
  detach=()=>{next.removeListener?.('accountsChanged',accounts);next.removeListener?.('chainChanged',chain);next.removeListener?.('disconnect',disconnect);};
}
// Every transaction uses the provider selected at connection time.
export const baseProvider={request:async(args:Request)=>{
  if(!provider)throw new Error('Connect Coinbase Wallet again.');
  if(args.method!=='eth_sendTransaction')return provider.request(args);
  emit({chain:'base',action:'signing'});
  try{return await provider.request(args);}finally{emit({chain:'base',action:'idle'});}
}};
export async function connectStellar(method:StellarMethod,onUri:(uri:string)=>void,signal:AbortSignal) {
  let address:string;
  if(method==='walletconnect'){
    const wc=await connecting(stellarWalletConnect(stellarChanged),signal);address=await wc.connect(onUri,signal);
  }else{
    address=await connecting((async()=>{
      if(!await lobstr.isConnected())throw new Error('Install the desktop LOBSTR signer extension, or choose WalletConnect to use your phone.');
      return stellarAccount(await lobstr.getPublicKey());
    })(),signal);
  }
  if(signal.aborted)throw Object.assign(new Error('Connection cancelled.'),{code:4001});
  stellarMethod=method;emit({chain:'stellar',address});return address;
}
export async function connectBase(signal:AbortSignal):Promise<Address> {
  // Select lazily, after the wallet browser has injected its provider. No silent app launch.
  if(!provider)selectProvider(injectedCoinbase()??createCoinbaseWalletSDK({
    appName:'Stellar USDC Bridge',appLogoUrl:new URL('/favicon.svg',window.location.origin).href,
    appChainIds:[8453],preference:{options:'eoaOnly'},
  }).getProvider());
  const active=provider!;const attempt=++baseAttempt;
  let accounts:string[];
  try{accounts=await connecting(active.request({method:'eth_requestAccounts'}),signal,
    ()=>{if(provider===active&&attempt===baseAttempt)void disconnectWallet('base');}) as string[];}
  catch(e){if(provider===active&&attempt===baseAttempt)await disconnectWallet('base');throw e;}
  if(!accounts[0])throw new Error('Choose an account in Coinbase Wallet.');
  const address=getAddress(accounts[0]);
  try{await connecting(checkBaseWallet(address),signal);}catch(e){if(provider===active&&attempt===baseAttempt)await disconnectWallet('base');throw e;}
  if(signal.aborted||attempt!==baseAttempt)throw new Error('Connection cancelled.');
  emit({chain:'base',address});return address;
}
export async function disconnectWallet(chain:'stellar'|'base') {
  if(chain==='stellar'){
    if(stellarMethod==='walletconnect')await(await stellarWalletConnect(stellarChanged)).disconnect();
    stellarMethod=undefined;emit({chain:'stellar',address:''});
  }else{
    ++baseAttempt;const old=provider;detach();provider=undefined;emit({chain:'base',address:''});await old?.disconnect?.().catch(()=>{});
  }
}
export async function checkBaseWallet(expected:string,switchNetwork=true) {
  let chain=await baseProvider.request({method:'eth_chainId'});
  if(chain!=='0x2105'&&switchNetwork){
    await baseProvider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x2105'}]});
    chain=await baseProvider.request({method:'eth_chainId'});
  }
  if(chain!=='0x2105')throw new Error('Select Base mainnet in Coinbase Wallet.');
  const accounts=await baseProvider.request({method:'eth_accounts'}) as string[];
  if(accounts[0]?.toLowerCase()!==expected.toLowerCase())throw new Error('Reconnect the Coinbase Wallet account used for this transfer.');
}
export const stellarUsesWalletConnect=()=>stellarMethod==='walletconnect';
export async function signStellar(xdr:string,expected:string) {
  let signedXdr:string;
  if(stellarMethod==='walletconnect'){
    emit({chain:'stellar',action:'signing'});
    try{signedXdr=await(await stellarWalletConnect(stellarChanged)).sign(xdr,expected);}
    finally{emit({chain:'stellar',action:'idle'});}
  }
  else if(stellarMethod==='extension'){
    if((await lobstr.getPublicKey())!==expected)throw new Error('Reconnect the LOBSTR account used for this transfer.');
    signedXdr=await lobstr.signTransaction(xdr);
  }else throw new Error('Connect the Stellar account used for this transfer.');
  return verifiedStellarSignature(xdr,signedXdr,expected);
}
