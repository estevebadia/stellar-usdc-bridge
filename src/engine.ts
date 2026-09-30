import { TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { toHex, type Hex } from 'viem';
import { MAINNET } from './config';
import { readTransfer, saveTransfer, type EvmRequest, type Transfer } from './storage';
import { baseClient, checkNetworks, estimateBase, prepareStellar, stellarClient, stellarRead } from './clients';
import { baseProvider, checkBaseWallet, signStellar } from './wallets';
import { bytesVal, baseClaimData, TRANSMITTER_ABI } from './transactions';
import { fetchMessage, verifyMessage } from './circle';
import type { Quote } from './quote';
import { netAmount } from './amount';
import { loadStellarAccount, receivingCapacity } from './accounts';

export type Update=(t:Transfer)=>void;
function persist(t:Transfer,update:Update) {saveTransfer(t);update({...t});}
const rejected=(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&(e as {code:unknown}).code===4001;
export function newTransfer(q:Quote):Transfer {
  return {version:1,id:crypto.randomUUID(),direction:q.input.direction,stellar:q.input.stellar,base:q.input.base,
    amount:q.input.amount.toString(),maxFee:q.fee.toString(),createdAt:Date.now(),stage:'review'};
}
export async function submitSource(q:Quote,t:Transfer,update:Update) {
  const saved=readTransfer();
  if(saved && saved.id!==t.id && !['complete','failed'].includes(saved.stage)) throw new Error('Another transfer must be reconciled first.');
  if(t.stage!=='review'||t.auxiliary||(saved?.id===t.id&&(saved.stage!=='review'||saved.auxiliary))) throw new Error('Reconcile the existing transaction first.');
  if(q.expiresAt<Date.now()||q.input.amount.toString()!==t.amount||q.input.stellar!==t.stellar||q.input.base.toLowerCase()!==t.base.toLowerCase()||q.input.direction!==t.direction||q.fee.toString()!==t.maxFee)
    throw new Error('Quote changed or expired. Refresh and review the latest amounts.');
  await checkNetworks();
  if(q.action!=='burn') {
    t.auxiliary={kind:q.action==='restore'?'restore':'approval',chain:t.direction==='stellar-base'?'stellar':'base',side:'source'};
  } else t.stage='source-signing';
  persist(t,update); // Persist before any wallet action.
  if(t.direction==='stellar-base') {
    if(!q.stellarPrepared) throw new Error('Missing simulated transaction.');
    const prepared=q.stellarPrepared.tx;
    const hash=Buffer.from(prepared.hash()).toString('hex');
    if(t.auxiliary) t.auxiliary.hash=hash;
    else {t.sourceHash=hash;t.sourceUnsignedXdr=prepared.toXDR();t.destinationStartBlock=(await baseClient.getBlockNumber()).toString();}
    persist(t,update);
    let signed;
    try {signed=await signStellar(prepared.toXDR(),t.stellar);} catch(e) {
      // LOBSTR API signs only; this app has not submitted anything yet.
      t.auxiliary=undefined;t.sourceHash=undefined;t.sourceUnsignedXdr=undefined;t.stage='review';persist(t,update);throw e;
    }
    if(t.auxiliary)t.auxiliary.signedXdr=signed.toXDR();
    else {t.sourceSignedXdr=signed.toXDR();t.stage='source-pending';}
    persist(t,update);
    await stellarClient.sendTransaction(signed); // Even ERROR is reconciled by hash before unlocking.
  } else {
    if(!q.basePrepared) throw new Error('Missing simulated Base transaction.');
    try {await checkBaseWallet(t.base);}catch(e){t.auxiliary=undefined;t.stage='review';persist(t,update);throw e;}
    const request:EvmRequest={nonce:await baseClient.getTransactionCount({address:t.base,blockTag:'pending'}),to:q.basePrepared.to,
      data:q.basePrepared.data,startBlock:(await baseClient.getBlockNumber()).toString()};
    if(t.auxiliary)t.auxiliary.request=request;else t.sourceRequest=request;
    persist(t,update);
    try {
      const hash=await baseProvider.request({method:'eth_sendTransaction',params:[{from:t.base,to:request.to,data:request.data,
        chainId:'0x2105',nonce:toHex(request.nonce),gas:toHex(q.basePrepared.gas),value:'0x0'}]}) as Hex;
      if(t.auxiliary)t.auxiliary.hash=hash;
      else {t.sourceHash=hash;t.stage='source-pending';}
      persist(t,update);
    }catch(e){
      if(rejected(e)) {t.auxiliary=undefined;t.sourceRequest=undefined;t.stage='review';persist(t,update);}
      else {if(!t.auxiliary)t.stage='source-pending';t.note='Wallet submission outcome is uncertain. Reconcile the existing transaction; do not send again.';persist(t,update);}
      throw e;
    }
  }
}
// An uncertain EVM submission is reconciled by its nonce and exact calldata.
// Replacements/cancellations are allowed only after their mined receipt proves
// that the original burn did not execute. Hash import avoids unbounded RPC scans.
export async function matchEvmHash(hash:Hex,request:EvmRequest,from:Hex) {
  const tx=await baseClient.getTransaction({hash});
  if(tx.from.toLowerCase()!==from.toLowerCase()||tx.nonce!==request.nonce||tx.to?.toLowerCase()!==request.to.toLowerCase()||tx.input.toLowerCase()!==request.data.toLowerCase())
    throw new Error('Transaction does not match the saved wallet, nonce, contract, and calldata.');
  return tx;
}
const scanCursors=new Map<string,bigint>();
async function discoverHash(r:EvmRequest,from:Hex):Promise<{hash:Hex;matches:boolean}|null> {
  const latest=await baseClient.getBlockNumber();
  const start=BigInt(r.startBlock);
  if(latest-start>500n)return null; // Keep the recovery hash field available for old transfers.
  const count=await baseClient.getTransactionCount({address:from});
  if(count<=r.nonce)return null;
  const key=`${from}:${r.nonce}:${r.startBlock}`;
  let cursor=scanCursors.get(key)??latest;
  // Bounded work per poll, with the exact-hash recovery field for older requests.
  for(let i=0;i<20&&cursor>=start;i++,cursor--) {
    const b=await baseClient.getBlock({blockNumber:cursor,includeTransactions:true});
    const tx=b.transactions.find(tx=>typeof tx!=='string'&&tx.from.toLowerCase()===from.toLowerCase()&&tx.nonce===r.nonce);
    if(tx&&typeof tx!=='string'){scanCursors.delete(key);return {hash:tx.hash,matches:tx.to?.toLowerCase()===r.to.toLowerCase()&&tx.input.toLowerCase()===r.data.toLowerCase()};}
  }
  scanCursors.set(key,cursor<start?latest:cursor);
  return null;
}
async function stellarStatus(hash:string,xdr?:string):Promise<'success'|'failed'|'pending'> {
  const result=await stellarClient.getTransaction(hash);
  if(result.status==='SUCCESS')return 'success';
  if(result.status==='FAILED')return 'failed';
  // RPC history is finite. Horizon verifies old transactions after reopening.
  const h=await fetch(`${MAINNET.stellar.horizon}/transactions/${hash}`,{signal:AbortSignal.timeout(20000)});
  if(h.ok)return (await h.json() as {successful:boolean}).successful?'success':'failed';
  if(h.status!==404)throw new Error('Could not reconcile the Stellar transaction.');
  if(xdr) {
    const tx=TransactionBuilder.fromXDR(xdr,MAINNET.stellar.passphrase);
    if('timeBounds' in tx && tx.timeBounds && Number(tx.timeBounds.maxTime)+60<Date.now()/1000) {
      // A confirmed ledger closing after the tx's expiration plus Horizon 404
      // establishes that it can no longer execute.
      const ledger=await stellarClient.getLatestLedger();
      if(ledger.id && (await stellarClient.getHealth()).status==='healthy') {
        const head=await fetch(`${MAINNET.stellar.horizon}/ledgers?order=desc&limit=1`);
        const date=(await head.json() as {_embedded:{records:{closed_at:string}[]}})._embedded.records[0].closed_at;
        if(Date.parse(date)> (Number(tx.timeBounds.maxTime)+60)*1000)return 'failed';
      }
    }
  }
  return 'pending';
}
async function evmStatus(hash:string):Promise<'success'|'failed'|'pending'> {
  try {const receipt=await baseClient.getTransactionReceipt({hash:hash as Hex});return receipt.status==='success'?'success':'failed';}
  catch(e) {if(e instanceof Error&&e.name==='TransactionReceiptNotFoundError')return 'pending';throw e;}
}
export async function destinationUsed(t:Transfer) {
  if(!t.message)return false;
  const m=verifyMessage(t.message,t);
  return t.direction==='stellar-base'?
    (await baseClient.readContract({address:MAINNET.base.transmitter,abi:TRANSMITTER_ABI,functionName:'usedNonces',args:[m.nonce]}))===1n:
    (await stellarRead(t.stellar,MAINNET.stellar.transmitter,'is_nonce_used',[bytesVal(m.nonce)]))===true;
}
export async function reconcile(t:Transfer,update:Update):Promise<void> {
  if(t.stage==='complete'||t.stage==='failed')return;
  if(t.auxiliary) {
    const a=t.auxiliary;
    if(!a.hash&&a.request) {
      const found=await discoverHash(a.request,t.base);
      if(found)a.hash=found.hash;
    }
    if(!a.hash){t.note='An approval or restoration may still be pending in your wallet. Use its transaction hash to reconcile.';persist(t,update);return;}
    const status=a.chain==='stellar'?await stellarStatus(a.hash,a.signedXdr):await evmStatus(a.hash);
    if(status==='pending')return;
    t.actions=[...(t.actions??[]),{chain:a.chain,hash:a.hash,label:a.kind}];
    t.auxiliary=undefined;t.note=status==='failed'?'The approval or restoration did not execute. Refresh checks to try the same operation again.':undefined;
    persist(t,update);return;
  }
  if(t.stage==='review')return;
  if(t.stage==='source-signing'&&t.direction==='stellar-base'&&!t.sourceSignedXdr) {
    // Source signer does not broadcast. A refresh interrupted signing before submission.
    t.stage='review';t.sourceHash=undefined;t.sourceUnsignedXdr=undefined;persist(t,update);return;
  }
  if(!t.sourceHash&&t.sourceRequest) {
    const found=await discoverHash(t.sourceRequest,t.base);
    if(found) {
      if(!found.matches) {
        const status=await evmStatus(found.hash);
        if(status!=='pending'){t.stage='failed';t.note='A mined replacement consumed the burn nonce. This burn did not execute.';persist(t,update);return;}
      } else {t.sourceHash=found.hash;persist(t,update);}
    }
  }
  if(!t.sourceHash){t.note='The burn outcome is uncertain. Check Coinbase Wallet and enter the transaction hash below. Another burn is blocked.';persist(t,update);return;}
  if(t.stage==='source-pending'||t.stage==='source-signing') {
    if(t.direction==='base-stellar'&&t.sourceRequest)await matchEvmHash(t.sourceHash as Hex,t.sourceRequest,t.base);
    let status=t.direction==='stellar-base'?await stellarStatus(t.sourceHash,t.sourceSignedXdr):await evmStatus(t.sourceHash);
    if(status==='pending'&&t.direction==='base-stellar'&&t.sourceRequest) {
      const replacement=await discoverHash(t.sourceRequest,t.base);
      if(replacement&&!replacement.matches&&await evmStatus(replacement.hash)!=='pending')status='failed';
      else if(replacement&&replacement.matches){t.sourceHash=replacement.hash;persist(t,update);status=await evmStatus(replacement.hash);}
    }
    if(status==='pending')return;
    if(status==='failed'){t.stage='failed';t.note='The source transaction failed or expired without executing. No USDC was burned.';persist(t,update);return;}
    t.stage='attestation';t.note=undefined;persist(t,update);
  }
  // A saved attestation is sufficient for recovery even if Circle's API is down.
  let iris:Awaited<ReturnType<typeof fetchMessage>>=t.message&&t.attestation?{status:'complete',message:t.message,attestation:t.attestation,cctpVersion:2}:null;
  if(!iris)iris=await fetchMessage(t);
  else if(t.direction==='stellar-base'&&!t.destinationHash) {
    try {iris=await fetchMessage(t)??iris;}catch{ /* Destination nonce remains the authority. */ }
  }
  if(iris?.status==='complete'&&iris.attestation?.startsWith('0x')) {
    const m=verifyMessage(iris.message,t);
    t.message=iris.message;t.attestation=iris.attestation;t.received=netAmount(m.amount,m.fee).toString();
    if(iris.forwardTxHash&&t.direction==='stellar-base')t.destinationHash=iris.forwardTxHash;
    if(await destinationUsed(t)) {
      if(t.destinationHash&&(await (t.direction==='stellar-base'?evmStatus(t.destinationHash):stellarStatus(t.destinationHash)))!=='success')
        throw new Error('Destination nonce is used but the recorded execution is not yet confirmed. Keep checking.');
      t.stage='complete';t.note=undefined;persist(t,update);return;
    }
    if(t.destinationHash) {
      const status=t.direction==='stellar-base'?await evmStatus(t.destinationHash):await stellarStatus(t.destinationHash,t.destinationSignedXdr);
      if(status==='pending'){t.stage='destination-pending';persist(t,update);return;}
      if(status==='failed'){t.destinationHash=undefined;t.destinationRequest=undefined;t.destinationSignedXdr=undefined;t.note='The destination transaction failed. Claim this existing transfer again.';}
    }
    if(t.destinationRequest&&!t.destinationHash) {
      const found=await discoverHash(t.destinationRequest,t.base);
      if(found&&found.matches)t.destinationHash=found.hash;
      else {t.stage='destination-pending';t.note='Reconcile the destination transaction from Coinbase Wallet before requesting another claim.';persist(t,update);return;}
    }
    t.stage='destination-ready';
    if(t.direction==='stellar-base'&&!t.note)t.note=`Circle forwarding: ${iris.forwardState??'awaiting delivery'}. A manual claim of this same transfer is available if needed.`;
    persist(t,update);
  } else {
    t.note=iris?.delayReason?`Circle is waiting: ${iris.delayReason}. The existing burn is saved.`:'Waiting for Circle attestation. You can close this page and resume in this browser.';
    persist(t,update);
  }
}
export interface ClaimQuote {cost:bigint;restore:boolean;stellarPrepared?:Awaited<ReturnType<typeof prepareStellar>>;basePrepared?:{data:Hex;gas:bigint};}
export async function quoteClaim(t:Transfer):Promise<ClaimQuote> {
  if(!t.message||!t.attestation)throw new Error('Attestation is not ready.');
  verifyMessage(t.message,t);await checkNetworks();
  if(await destinationUsed(t))throw new Error('This transfer is already delivered. Refresh its status.');
  if(t.direction==='base-stellar') {
    const stellar=await loadStellarAccount(t.stellar);
    if(receivingCapacity(stellar.account)<BigInt(t.received!))throw new Error('Resolve your Stellar USDC trustline receiving capacity in LOBSTR, then claim this existing transfer.');
    const prepared=await prepareStellar(t.stellar,MAINNET.stellar.forwarder,'mint_and_forward',[bytesVal(t.message),bytesVal(t.attestation)]);
    if(stellar.xlm<prepared.fee)throw new Error('Add XLM to LOBSTR for this simulated claim fee, then recover this existing transfer.');
    return {cost:prepared.fee,restore:prepared.restore,stellarPrepared:prepared};
  }
  const data=baseClaimData(t.message,t.attestation);
  const prepared=await estimateBase(t.base,MAINNET.base.transmitter,data);
  if(await baseClient.getBalance({address:t.base})<prepared.fee)throw new Error('Add ETH on Base to Coinbase Wallet for the fallback claim.');
  return {cost:prepared.fee,restore:false,basePrepared:{data,gas:prepared.gas}};
}
export async function claim(t:Transfer,q:ClaimQuote,update:Update) {
  if(t.stage!=='destination-ready'||t.auxiliary)throw new Error('Reconcile the existing destination transaction first.');
  if(await destinationUsed(t)){await reconcile(t,update);return;}
  if(t.direction==='base-stellar') {
    const prepared=q.stellarPrepared!;
    if(prepared.restore)t.auxiliary={kind:'restore',chain:'stellar',side:'destination',hash:Buffer.from(prepared.tx.hash()).toString('hex')};
    let signed;
    try {signed=await signStellar(prepared.tx.toXDR(),t.stellar);}catch(e){t.auxiliary=undefined;persist(t,update);throw e;}
    if(prepared.restore)t.auxiliary!.signedXdr=signed.toXDR();
    else {t.destinationHash=Buffer.from(signed.hash()).toString('hex');t.destinationSignedXdr=signed.toXDR();t.stage='destination-pending';}
    persist(t,update);await stellarClient.sendTransaction(signed);
  } else {
    await checkBaseWallet(t.base);
    const r:EvmRequest={nonce:await baseClient.getTransactionCount({address:t.base,blockTag:'pending'}),to:MAINNET.base.transmitter,
      data:q.basePrepared!.data,startBlock:(await baseClient.getBlockNumber()).toString()};
    t.destinationRequest=r;t.stage='destination-pending';persist(t,update);
    try {
      t.destinationHash=await baseProvider.request({method:'eth_sendTransaction',params:[{from:t.base,to:r.to,data:r.data,
        chainId:'0x2105',nonce:toHex(r.nonce),gas:toHex(q.basePrepared!.gas),value:'0x0'}]}) as Hex;
      persist(t,update);
    } catch(e){if(rejected(e)){t.destinationRequest=undefined;t.stage='destination-ready';persist(t,update);}throw e;}
  }
}
export async function attachHash(t:Transfer,hash:string,update:Update) {
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error('Enter the 0x-prefixed Base transaction hash from Coinbase Wallet.');
  const r=t.auxiliary?.request??(t.stage==='destination-pending'?t.destinationRequest:t.sourceRequest);
  if(!r)throw new Error('No uncertain Base transaction is waiting for reconciliation.');
  await matchEvmHash(hash as Hex,r,t.base);
  if(t.auxiliary)t.auxiliary.hash=hash;else if(t.stage==='destination-pending')t.destinationHash=hash;else t.sourceHash=hash;
  persist(t,update);await reconcile(t,update);
}
