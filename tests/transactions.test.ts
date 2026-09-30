import { describe, expect, it } from 'vitest';
import { Account, Keypair, StrKey, scValToNative } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { decodeFunctionData } from 'viem';
import { MAINNET, STELLAR_USDC } from '../src/config';
import { contractBytes32, evmBytes32, SERVICE_HOOK, stellarHook, ZERO32 } from '../src/encoding';
import { baseBurnData, MESSENGER_ABI, sorobanTx, stellarApproveArgs, stellarBurnArgs } from '../src/transactions';
const stellar=StrKey.encodeEd25519PublicKey(Buffer.alloc(32,7));
const base='0x1234567890123456789012345678901234567890';
describe('authoritative route configuration',()=>{
  it('contains only intended mainnets and Circle deployed contracts',()=>{
    expect(MAINNET.base.chain.id).toBe(8453);expect(MAINNET.base.domain).toBe(6);expect(MAINNET.stellar.domain).toBe(27);
    expect(MAINNET.stellar.passphrase).toBe('Public Global Stellar Network ; September 2015');
    expect(MAINNET.circle).toBe('https://iris-api.circle.com');
    expect(MAINNET.stellar.forwarder).toBe('CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T');
    expect(MAINNET.base.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(StrKey.isValidContract(STELLAR_USDC)).toBe(true);
  });
});
describe('recipient encoding compared with the official format',()=>{
  it('left pads the Base account, never right pads it',()=>{
    expect(evmBytes32(base)).toBe('0x'+'00'.repeat(12)+base.slice(2));
    expect(()=>evmBytes32('0x'+'00'.repeat(20))).toThrow();
  });
  it('matches the Circle example and Rust parser byte for byte',()=>{
    const data=Buffer.from(stellarHook(stellar).slice(2),'hex');
    expect(data.length).toBe(88);expect(data.subarray(0,28)).toEqual(Buffer.alloc(28));
    expect(data.subarray(28,32).toString('hex')).toBe('00000038');
    expect(data.subarray(32).toString('utf8')).toBe(stellar);
    // Independent reference recipe, matching official stellar-utils.ts.
    const ref=Buffer.alloc(32+Buffer.byteLength(stellar));ref.writeUInt32BE(0,24);ref.writeUInt32BE(Buffer.byteLength(stellar),28);Buffer.from(stellar).copy(ref,32);
    expect(data).toEqual(ref);
    expect(()=>stellarHook(MAINNET.stellar.forwarder)).toThrow();
  });
  it('keeps the forwarding SERVICE hook distinct from Stellar forwarder hook',()=>{
    expect(Buffer.from(SERVICE_HOOK.slice(2),'hex').subarray(0,12).toString()).toBe('cctp-forward');
    expect(stellarHook(stellar)).not.toBe(SERVICE_HOOK);
  });
});
describe('constructed transactions',()=>{
  it('Base burn sets BOTH addresses to the forwarder and G recipient only in hook',()=>{
    const decoded=decodeFunctionData({abi:MESSENGER_ABI,data:baseBurnData(123456n,0n,stellar)});
    expect(decoded.functionName).toBe('depositForBurnWithHook');
    expect(decoded.args).toEqual([123456n,27,contractBytes32(MAINNET.stellar.forwarder),MAINNET.base.usdc,contractBytes32(MAINNET.stellar.forwarder),0n,2000,stellarHook(stellar)]);
  });
  it('Stellar burn uses local amount AND local max_fee scaled by ten',()=>{
    const args=stellarBurnArgs(stellar,123456n,57000n,base);
    expect(scValToNative(args[0])).toBe(stellar);expect(scValToNative(args[1])).toBe(1234560n);
    expect(scValToNative(args[2])).toBe(6);expect(Buffer.from(scValToNative(args[3])).toString('hex')).toBe(evmBytes32(base).slice(2));
    expect(scValToNative(args[4])).toBe(STELLAR_USDC);expect(Buffer.from(scValToNative(args[5])).toString('hex')).toBe(ZERO32.slice(2));
    expect(scValToNative(args[6])).toBe(570000n);expect(scValToNative(args[7])).toBe(2000);
    expect(Buffer.from(scValToNative(args[8])).toString('hex')).toBe(SERVICE_HOOK.slice(2));
    const tx=sorobanTx(new Account(stellar,'1234'),MAINNET.stellar.messenger,'deposit_for_burn_with_hook',args);
    expect(tx.operations).toHaveLength(1);expect(tx.sequence).toBe('1235');expect(tx.source).toBe(stellar);
    expect(tx.networkPassphrase).toBe(MAINNET.stellar.passphrase);
    expect(tx.operations[0].type).toBe('invokeHostFunction');
  });
  it('approves only exact local amount with a bounded ledger expiry',()=>{
    const args=stellarApproveArgs(stellar,1000000n,64694500);
    expect(scValToNative(args[2])).toBe(10000000n);expect(scValToNative(args[3])).toBe(64694500);
  });
});
