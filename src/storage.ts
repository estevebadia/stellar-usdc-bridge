import type { Hex } from 'viem';
import type { Direction } from './config';
import { evmBytes32, stellarAccount } from './encoding';

export type Stage = 'review' | 'source-signing' | 'source-pending' | 'attestation' | 'destination-ready' | 'destination-pending' | 'complete' | 'failed';
export interface EvmRequest {nonce:number; to:Hex; data:Hex; startBlock:string;}
export interface Transfer {
  version:1; id:string; direction:Direction; stellar:string; base:Hex; amount:string; maxFee:string;
  createdAt:number; stage:Stage; sourceHash?:string; sourceRequest?:EvmRequest; sourceSignedXdr?:string;
  sourceUnsignedXdr?:string; destinationHash?:string; destinationRequest?:EvmRequest; destinationSignedXdr?:string;
  message?:Hex; attestation?:Hex; received?:string; destinationStartBlock?:string; note?:string;
  auxiliary?: {kind:'approval'|'restore';chain:'stellar'|'base';hash?:string;signedXdr?:string;request?:EvmRequest;side:'source'|'destination'};
  actions?: {chain:'stellar'|'base';hash:string;label:string}[];
}
export const STORAGE_KEY = 'stellar-usdc-bridge:transfer:v1';
export function validateTransfer(t: Transfer) {
  if (t.version!==1 || !['stellar-base','base-stellar'].includes(t.direction)) throw new Error('Unsupported saved transfer. Preserve browser data and recover from the source transaction.');
  stellarAccount(t.stellar); evmBytes32(t.base);
  if (!/^\d+$/.test(t.amount)||!/^\d+$/.test(t.maxFee)||BigInt(t.amount)<=BigInt(t.maxFee)) throw new Error('Invalid saved amount.');
  if (!['review','source-signing','source-pending','attestation','destination-ready','destination-pending','complete','failed'].includes(t.stage)) throw new Error('Invalid saved transfer state.');
  return t;
}
export function readTransfer(storage:Storage=localStorage): Transfer | null {
  const raw=storage.getItem(STORAGE_KEY);
  return raw ? validateTransfer(JSON.parse(raw)) : null;
}
export function saveTransfer(t:Transfer,storage:Storage=localStorage) {
  validateTransfer(t);
  const raw=JSON.stringify(t);
  storage.setItem(STORAGE_KEY,raw);
  if (storage.getItem(STORAGE_KEY)!==raw) throw new Error('Browser storage is unavailable. Transfer blocked until recovery can be saved.');
}
export const canStartNew = (t:Transfer|null) => !t || t.stage==='complete' || t.stage==='failed';
export function clearTransfer(storage:Storage=localStorage) {
  const t=readTransfer(storage);
  if (!canStartNew(t) && t?.stage!=='review') throw new Error('Reconcile the current burn before starting another transfer.');
  storage.removeItem(STORAGE_KEY);
}
export async function withTransferLock<T>(action:()=>Promise<T>):Promise<T> {
  if (!navigator.locks) throw new Error('This browser cannot safely lock transfers across tabs. Use current Chrome, Brave, Edge, or Safari.');
  return navigator.locks.request('stellar-usdc-bridge:sign',{ifAvailable:true},async lock=>{
    if (!lock) throw new Error('A transfer is being signed in another tab.');
    return action();
  });
}
