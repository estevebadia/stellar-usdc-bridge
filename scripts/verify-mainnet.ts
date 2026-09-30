import assert from 'node:assert/strict';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { MAINNET, SOURCES, STELLAR_USDC } from '../src/config';
import { baseClient, checkNetworks, estimateStellarClaim, stellarRead } from '../src/clients';
import { TOKEN_ABI, MESSENGER_ABI, TRANSMITTER_ABI } from '../src/transactions';
import { contractBytes32 } from '../src/encoding';
import { circleFee } from '../src/circle';

await checkNetworks();
for(const address of [MAINNET.base.usdc,MAINNET.base.messenger,MAINNET.base.transmitter]) {
  assert((await baseClient.getCode({address}))?.length!>2,`No deployed Base code: ${address}`);
}
assert.equal(await baseClient.readContract({address:MAINNET.base.usdc,abi:TOKEN_ABI,functionName:'decimals'}),6);
assert.equal(await baseClient.readContract({address:MAINNET.base.transmitter,abi:TRANSMITTER_ABI,functionName:'localDomain'}),6);
assert.equal((await baseClient.readContract({address:MAINNET.base.messenger,abi:MESSENGER_ABI,functionName:'localMessageTransmitter'})).toLowerCase(),MAINNET.base.transmitter.toLowerCase());
assert.equal((await baseClient.readContract({address:MAINNET.base.messenger,abi:MESSENGER_ABI,functionName:'remoteTokenMessengers',args:[27]})).toLowerCase(),contractBytes32(MAINNET.stellar.messenger).toLowerCase());
const caller=MAINNET.stellar.issuer;
assert.equal(await stellarRead(caller,MAINNET.stellar.transmitter,'get_local_domain',[]),27);
assert.equal(await stellarRead(caller,MAINNET.stellar.messenger,'get_local_message_transmitter',[]),MAINNET.stellar.transmitter);
assert.equal(await stellarRead(caller,STELLAR_USDC,'decimals',[]),7);
const minFee=await stellarRead(caller,MAINNET.stellar.messenger,'get_min_fee_amount',[new Address(STELLAR_USDC).toScVal(),nativeToScVal(100000000n,{type:'i128'})]);
// Ensure the official forwarder exists and its configured route is the intended route.
const forwarderEntry=await stellarClientEntry();
assert(forwarderEntry);
assert.equal(await stellarRead(caller,MAINNET.stellar.forwarder,'get_message_transmitter',[]),MAINNET.stellar.transmitter);
assert.equal(await stellarRead(caller,MAINNET.stellar.forwarder,'get_token_messenger_minter',[]),MAINNET.stellar.messenger);
const [outboundFee,inboundFee,claimEstimate]=await Promise.all([circleFee('stellar-base',10000000n),circleFee('base-stellar',10000000n),estimateStellarClaim()]);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),chainId:8453,stellarPassphrase:MAINNET.stellar.passphrase,stellarUsdcSAC:STELLAR_USDC,
  contracts:MAINNET,liveFees:{outbound:outboundFee.toString(),inbound:inboundFee.toString(),stellarMinLocalFee:String(minFee)},
  stellarClaimEstimate:claimEstimate?.toString()??null,sources:SOURCES},(_k,v)=>typeof v==='bigint'?v.toString():v,2));
async function stellarClientEntry() {
  const {xdr,Contract}=await import('@stellar/stellar-sdk');
  const {stellarClient}=await import('../src/clients');
  const result=await stellarClient.getLedgerEntries(new Contract(MAINNET.stellar.forwarder).getFootprint());
  return result.entries.length===1;
}
