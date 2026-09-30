import { Account, Address, BASE_FEE, Contract, nativeToScVal, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import { MAINNET, STELLAR_USDC } from './config';
import { canonicalToStellar } from './amount';
import { contractBytes32, evmBytes32, SERVICE_HOOK, stellarAccount, stellarHook, ZERO32 } from './encoding';

// https://developers.circle.com/cctp/references/contract-interfaces
export const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
]);
export const MESSENGER_ABI = parseAbi([
  'function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)',
  'function localMessageTransmitter() view returns (address)',
  'function remoteTokenMessengers(uint32) view returns (bytes32)',
  'event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)',
]);
export const TRANSMITTER_ABI = parseAbi([
  'function receiveMessage(bytes,bytes) returns (bool)',
  'function usedNonces(bytes32) view returns (uint256)',
  'function localDomain() view returns (uint32)',
  'event MessageSent(bytes message)',
  'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
]);
export function baseBurnData(amount: bigint, maxFee: bigint, recipient: string): Hex {
  const forwarder = contractBytes32(MAINNET.stellar.forwarder);
  return encodeFunctionData({abi: MESSENGER_ABI, functionName: 'depositForBurnWithHook', args: [
    amount, 27, forwarder, MAINNET.base.usdc, forwarder, maxFee, 2000, stellarHook(recipient),
  ]});
}
export function baseApproveData(amount: bigint): Hex {
  return encodeFunctionData({abi: TOKEN_ABI, functionName: 'approve', args: [MAINNET.base.messenger, amount]});
}
export function baseClaimData(message: Hex, attestation: Hex): Hex {
  return encodeFunctionData({abi: TRANSMITTER_ABI, functionName: 'receiveMessage', args: [message, attestation]});
}
export const bytesVal = (hex: Hex) => xdr.ScVal.scvBytes(Buffer.from(hex.slice(2), 'hex'));
export function stellarBurnArgs(caller: string, amount: bigint, maxFee: bigint, recipient: string): xdr.ScVal[] {
  return [new Address(stellarAccount(caller)).toScVal(), nativeToScVal(canonicalToStellar(amount), {type:'i128'}),
    nativeToScVal(6, {type:'u32'}), bytesVal(evmBytes32(recipient)), new Address(STELLAR_USDC).toScVal(),
    bytesVal(ZERO32), nativeToScVal(canonicalToStellar(maxFee), {type:'i128'}), nativeToScVal(2000, {type:'u32'}), bytesVal(SERVICE_HOOK)];
}
export function stellarApproveArgs(caller: string, amount: bigint, expiration: number): xdr.ScVal[] {
  return [new Address(stellarAccount(caller)).toScVal(), new Address(MAINNET.stellar.messenger).toScVal(),
    nativeToScVal(canonicalToStellar(amount), {type:'i128'}), nativeToScVal(expiration, {type:'u32'})];
}
export function sorobanTx(account: Account, contract: string, method: string, args: xdr.ScVal[], passphrase: string = MAINNET.stellar.passphrase) {
  return new TransactionBuilder(account, {fee:BASE_FEE,networkPassphrase:passphrase})
    .addOperation(new Contract(contract).call(method,...args)).setTimeout(300).build();
}
