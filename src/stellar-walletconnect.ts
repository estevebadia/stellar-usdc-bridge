import type SignClient from '@walletconnect/sign-client';
import type { SessionTypes } from '@walletconnect/types';
import { STELLAR_CHAIN, STELLAR_SIGN, stellarProposal, stellarSessionAccount } from './wallet-protocol';

export const WC_TOPIC_KEY = 'bridge-stellar-wc-topic-v1';
export const walletConnectConfigured = /^[a-f\d]{32}$/i.test(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '');
type Client = Pick<SignClient, 'connect' | 'request' | 'disconnect' | 'session' | 'core' | 'on'>;
const cancelled = () => Object.assign(new Error('Wallet connection cancelled. No transaction was requested.'), {code:4001});

/** Connect timeouts only. Transaction requests keep the engine's uncertain-outcome lock. */
export async function connecting<T>(promise: Promise<T>, signal: AbortSignal, cleanup?: (late:T)=>void): Promise<T> {
  let abandoned = false;
  let reject!: (reason:unknown)=>void;
  const abortPromise = new Promise<never>((_,r)=>{reject=r;});
  const abort = ()=>{abandoned=true;reject(cancelled());};
  signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{abandoned=true;reject(new Error('Wallet connection timed out. Open the wallet, remove the old connection, and try again.'));},120000);
  const result=promise.then(value=>{if(abandoned)cleanup?.(value);return value;});
  if(signal.aborted)abort();
  try{return await Promise.race([result,abortPromise]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

export class StellarWalletConnect {
  constructor(private client:Client, private changed:(address:string)=>void) {
    for(const event of ['session_delete','session_expire'] as const)client.on(event,({topic})=>{
      if(localStorage.getItem(WC_TOPIC_KEY)===topic){localStorage.removeItem(WC_TOPIC_KEY);changed('');}
    });
    client.on('session_update',({topic,params})=>{
      if(localStorage.getItem(WC_TOPIC_KEY)!==topic)return;
      try{changed(stellarSessionAccount({...client.session.get(topic),namespaces:params.namespaces}));}
      catch{changed('');}
    });
  }
  private session(expected?:string) {
    const topic=localStorage.getItem(WC_TOPIC_KEY);
    if(!topic)throw new Error('Connect your Stellar wallet again.');
    const session=this.client.session.get(topic);stellarSessionAccount(session,expected);return session;
  }
  async connect(onUri:(uri:string)=>void, signal:AbortSignal) {
    try{return stellarSessionAccount(this.session());}catch{localStorage.removeItem(WC_TOPIC_KEY);}
    if(signal.aborted)throw cancelled();
    const discard=(s:SessionTypes.Struct)=>{void this.client.disconnect({topic:s.topic,reason:{code:6000,message:'Connection cancelled'}}).catch(()=>{});};
    const {uri,approval}=await connecting(this.client.connect(stellarProposal),signal,late=>{
      void late.approval().then(discard).catch(()=>{});
      if(late.uri)void this.client.core.pairing.disconnect({topic:late.uri.slice(3).split('@')[0]}).catch(()=>{});
    });
    const pending=approval();
    try{
      if(uri)onUri(uri);
      const session=await connecting(pending,signal,discard);
      let address:string;
      try{address=stellarSessionAccount(session);}catch(e){discard(session);throw e;}
      localStorage.setItem(WC_TOPIC_KEY,session.topic);return address;
    }catch(e){
      if(uri){const topic=uri.slice(3).split('@')[0];void this.client.core.pairing.disconnect({topic}).catch(()=>{});}
      throw e;
    }
  }
  async sign(xdr:string, expected:string) {
    const session=this.session(expected);
    const result=await this.client.request<{signedXDR:string}>({topic:session.topic,chainId:STELLAR_CHAIN,
      request:{method:STELLAR_SIGN,params:{xdr}},expiry:300});
    if(!result||typeof result.signedXDR!=='string')throw new Error('Wallet returned no signed transaction. Nothing was submitted.');
    return result.signedXDR;
  }
  async disconnect() {
    const topic=localStorage.getItem(WC_TOPIC_KEY);localStorage.removeItem(WC_TOPIC_KEY);this.changed('');
    if(topic)await this.client.disconnect({topic,reason:{code:6000,message:'User disconnected'}}).catch(()=>{});
  }
}

let adapter:Promise<StellarWalletConnect>|undefined;
export function stellarWalletConnect(changed:(address:string)=>void) {
  if(!walletConnectConfigured)throw new Error('Mobile wallet connection is awaiting the site owner’s WalletConnect project setup. The desktop LOBSTR signer still works.');
  return adapter??=import('@walletconnect/sign-client').then(({default:SignClient})=>SignClient.init({projectId:import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
    metadata:{name:'Stellar USDC Bridge',description:'Native USDC between Stellar and Base using Circle CCTP',
      url:window.location.origin,icons:[new URL('/favicon.svg',window.location.origin).href]},logger:'error',
  })).then(client=>new StellarWalletConnect(client,changed)).catch(e=>{adapter=undefined;throw e;});
}
