import { StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { isAddress, pad, type Hex } from 'viem';

export const ZERO32 = ('0x' + '00'.repeat(32)) as Hex;
// Circle Forwarding Service v0, not the Stellar CctpForwarder hook.
// https://developers.circle.com/cctp/concepts/forwarding-service#version-0
export const SERVICE_HOOK = '0x636374702d666f72776172640000000000000000000000000000000000000000' as Hex;
export function evmBytes32(address: string): Hex {
  if (!isAddress(address) || /^0x0{40}$/i.test(address)) throw new Error('Invalid Base recipient.');
  return pad(address as Hex, { size: 32 });
}
export function stellarAccount(address: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) throw new Error('Connect a Stellar account (G address).');
  return address;
}
export function contractBytes32(address: string): Hex {
  if (!StrKey.isValidContract(address)) throw new Error('Invalid Stellar forwarder contract.');
  return `0x${Buffer.from(StrKey.decodeContract(address)).toString('hex')}`;
}
// Independently authored against Circle's stellar-utils.ts and Rust forwarder parser.
// https://github.com/circlefin/stellar-cctp/blob/45746f2c803198bc6cd586475eb3c925f12bb488/examples/stellar-utils.ts
export function stellarHook(recipient: string): Hex {
  stellarAccount(recipient); // Only the connected LOBSTR G account is in scope.
  const text = Buffer.from(recipient, 'utf8');
  const data = Buffer.alloc(32 + text.length);
  data.writeUInt32BE(text.length, 28); // BE u32 length; magic/version remain zero.
  text.copy(data, 32);
  return `0x${data.toString('hex')}`;
}
