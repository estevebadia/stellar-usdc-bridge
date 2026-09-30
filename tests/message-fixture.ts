import { Buffer } from 'buffer';
import { StrKey } from '@stellar/stellar-sdk';
import type { Hex } from 'viem';
import { MAINNET, STELLAR_USDC, type Direction } from '../src/config';
import { contractBytes32, evmBytes32, SERVICE_HOOK, stellarHook, ZERO32 } from '../src/encoding';
import type { Transfer } from '../src/storage';
export const G=StrKey.encodeEd25519PublicKey(Buffer.alloc(32,9));
export const E='0x1234567890123456789012345678901234567890' as Hex;
export function transfer(direction:Direction='stellar-base'):Transfer {
  return {version:1,id:'fixture',direction,stellar:G,base:E,amount:'1000000',maxFee:direction==='stellar-base'?'57000':'0',createdAt:100,stage:'source-pending',sourceHash:direction==='stellar-base'?'a'.repeat(64):'0x'+'a'.repeat(64)};
}
// Independent wire-format fixture built from Circle's technical-guide offsets.
export function message(t:Transfer):Hex {
  const out=t.direction==='stellar-base';
  const hook=out?SERVICE_HOOK:stellarHook(t.stellar);
  const data=Buffer.alloc(376+(hook.length-2)/2);
  const h=(offset:number,s:string)=>Buffer.from(s.replace(/^0x/,''),'hex').copy(data,offset);
  const n=(offset:number,s:string)=>h(offset,BigInt(s).toString(16).padStart(64,'0'));
  data.writeUInt32BE(1,0);data.writeUInt32BE(out?27:6,4);data.writeUInt32BE(out?6:27,8);
  h(12,'11'.repeat(32));h(44,out?contractBytes32(MAINNET.stellar.messenger):evmBytes32(MAINNET.base.messenger));
  h(76,out?evmBytes32(MAINNET.base.messenger):contractBytes32(MAINNET.stellar.messenger));
  h(108,out?ZERO32:contractBytes32(MAINNET.stellar.forwarder));
  data.writeUInt32BE(2000,140);data.writeUInt32BE(2000,144);data.writeUInt32BE(1,148);
  h(152,out?contractBytes32(STELLAR_USDC):evmBytes32(MAINNET.base.usdc));h(184,out?evmBytes32(t.base):contractBytes32(MAINNET.stellar.forwarder));
  n(216,t.amount);h(248,out?Buffer.from(StrKey.decodeEd25519PublicKey(t.stellar)).toString('hex'):evmBytes32(t.base));
  n(280,t.maxFee);n(312,t.maxFee);h(376,hook);
  return '0x'+data.toString('hex') as Hex;
}
