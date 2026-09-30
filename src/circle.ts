import { Buffer } from 'buffer';
import type { Hex } from 'viem';
import { MAINNET, STELLAR_USDC, sourceDomain, destinationDomain, type Direction } from './config';
import { contractBytes32, evmBytes32, SERVICE_HOOK, stellarHook, ZERO32 } from './encoding';
import { feeForBps, netAmount } from './amount';
import type { Transfer } from './storage';
import { jsonFetch } from './accounts';

interface FeeRow {finalityThreshold:number;minimumFee:number;forwardFee?:{high:number}}
export async function circleFee(direction:Direction,amount:bigint,sourceMinimum=0n) {
  const rows = await jsonFetch<FeeRow[]>(`${MAINNET.circle}/v2/burn/USDC/fees/${sourceDomain(direction)}/${destinationDomain(direction)}${direction==='stellar-base'?'?forward=true':''}`);
  const row = rows.find(r=>r.finalityThreshold===2000);
  if (!row) throw new Error('Circle did not quote a Standard transfer for this route.');
  let fee=feeForBps(amount,row.minimumFee);
  // A live onchain fee switch and the API describe the same protocol fee.
  // Cover the larger requirement once, then add forwarding separately.
  if(sourceMinimum>fee)fee=sourceMinimum;
  if (direction==='stellar-base') {
    if (!row.forwardFee || !Number.isSafeInteger(row.forwardFee.high)||row.forwardFee.high<=0) throw new Error('Circle forwarding is unavailable for this route. Try again later.');
    fee+=BigInt(row.forwardFee.high); // live high quote; UI identifies maxFee/receive estimate
  }
  netAmount(amount,fee);
  return fee;
}
export interface ParsedMessage {
  source:number;destination:number;nonce:Hex;sender:Hex;recipient:Hex;caller:Hex;minFinality:number;executedFinality:number;
  burnToken:Hex;mintRecipient:Hex;amount:bigint;messageSender:Hex;maxFee:bigint;fee:bigint;hook:Hex;
}
export function parseMessage(hex:Hex):ParsedMessage {
  if (!/^0x([a-fA-F0-9]{2})+$/.test(hex)) throw new Error('Invalid CCTP message bytes.');
  const b=Buffer.from(hex.slice(2),'hex');
  if(b.length<376 || b.readUInt32BE(0)!==1 || b.readUInt32BE(148)!==1) throw new Error('Unsupported CCTP message version or length.');
  const h=(start:number,n=32)=>`0x${b.subarray(start,start+n).toString('hex')}` as Hex;
  const n=(start:number)=>BigInt(h(start));
  return {source:b.readUInt32BE(4),destination:b.readUInt32BE(8),nonce:h(12),sender:h(44),recipient:h(76),caller:h(108),
    minFinality:b.readUInt32BE(140),executedFinality:b.readUInt32BE(144),burnToken:h(152),mintRecipient:h(184),amount:n(216),
    messageSender:h(248),maxFee:n(280),fee:n(312),hook:h(376,b.length-376)};
}
export function verifyMessage(hex:Hex,t:Transfer):ParsedMessage {
  const m=parseMessage(hex), outbound=t.direction==='stellar-base';
  const expected={
    sender:outbound?contractBytes32(MAINNET.stellar.messenger):evmBytes32(MAINNET.base.messenger),
    recipient:outbound?evmBytes32(MAINNET.base.messenger):contractBytes32(MAINNET.stellar.messenger),
    caller:outbound?ZERO32:contractBytes32(MAINNET.stellar.forwarder),
    burnToken:outbound?contractBytes32(STELLAR_USDC):evmBytes32(MAINNET.base.usdc),
    mintRecipient:outbound?evmBytes32(t.base):contractBytes32(MAINNET.stellar.forwarder),
    messageSender:outbound?`0x${Buffer.from((requirePublicKey(t.stellar))).toString('hex')}`:evmBytes32(t.base),
    hook:outbound?SERVICE_HOOK:stellarHook(t.stellar),
  };
  if(m.source!==sourceDomain(t.direction)||m.destination!==destinationDomain(t.direction)||m.minFinality!==2000||m.executedFinality!==2000||m.amount!==BigInt(t.amount)||m.maxFee!==BigInt(t.maxFee)||m.fee>m.maxFee||m.fee>=m.amount)
    throw new Error('Circle message does not match the saved transfer. Recovery blocked for review.');
  for(const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if(m[key].toLowerCase()!==expected[key].toLowerCase()) throw new Error(`CCTP ${key} does not match the saved recipient or route. Recovery blocked.`);
  }
  return m;
}
import { StrKey } from '@stellar/stellar-sdk';
const requirePublicKey=(s:string)=>StrKey.decodeEd25519PublicKey(s);
interface IrisMessage {message:Hex;attestation:Hex;status:string;cctpVersion:number;forwardState?:string;forwardTxHash?:string;delayReason?:string;}
export async function fetchMessage(t:Transfer):Promise<IrisMessage|null> {
  if(!t.sourceHash) return null;
  const r=await fetch(`${MAINNET.circle}/v2/messages/${sourceDomain(t.direction)}?transactionHash=${encodeURIComponent(t.sourceHash.toLowerCase())}`,{signal:AbortSignal.timeout(20000)});
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`Circle attestation service returned ${r.status}. Your existing transfer remains saved.`);
  const rows=(await r.json() as {messages:IrisMessage[]}).messages;
  if(!Array.isArray(rows)) throw new Error('Invalid Circle response.');
  const done=rows.filter(m=>m.cctpVersion===2&&m.status==='complete'&&/^0x([a-f0-9]{2})+$/i.test(m.attestation));
  const matching=done.filter(m=>{try {verifyMessage(m.message,t);return true;}catch{return false;}});
  if(done.length && matching.length!==1) throw new Error('Attested message does not uniquely match this saved burn. Do not burn again.');
  return matching[0]??rows[0]??null;
}
