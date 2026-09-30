// Separate, CLI-only testnet probe. Never imported by the published application.
// Source: https://developers.circle.com/cctp/references/{stellar-contracts,contract-addresses}
import assert from 'node:assert/strict';
import { Account, Address, Asset, Contract, Keypair, Networks, nativeToScVal, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { MESSENGER_ABI, TRANSMITTER_ABI, TOKEN_ABI } from '../src/transactions';
import { contractBytes32, evmBytes32, stellarHook, SERVICE_HOOK } from '../src/encoding';
const stellar={rpc:'https://soroban-testnet.stellar.org',passphrase:Networks.TESTNET,
  issuer:'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  messenger:'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
  transmitter:'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
  forwarder:'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ'};
const base={rpc:'https://sepolia.base.org',messenger:'0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  transmitter:'0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',usdc:'0x036CbD53842c5426634e7929541eC2318f3dCF7e'} as const;
const evm=createPublicClient({chain:baseSepolia,transport:http(base.rpc)});
const soroban=new rpc.Server(stellar.rpc);
assert.equal(await evm.getChainId(),84532);assert.equal((await soroban.getNetwork()).passphrase,Networks.TESTNET);
assert.equal(await evm.readContract({address:base.usdc,abi:TOKEN_ABI,functionName:'decimals'}),6);
assert.equal(await evm.readContract({address:base.transmitter,abi:TRANSMITTER_ABI,functionName:'localDomain'}),6);
assert((await evm.getCode({address:base.messenger}))?.length!>2);
// In-memory, disposable TESTNET keypair, never persisted or printed.
const key=Keypair.random();
const funded=await fetch(`https://friendbot.stellar.org?addr=${key.publicKey()}`);assert(funded.ok);
const usdc=new Asset('USDC',stellar.issuer).contractId(Networks.TESTNET);
const account=await soroban.getAccount(key.publicKey());
const build=(contract:string,method:string,args:xdr.ScVal[])=>new TransactionBuilder(new Account(account.accountId(),account.sequenceNumber()),{fee:'200',networkPassphrase:Networks.TESTNET}).addOperation(new Contract(contract).call(method,...args)).setTimeout(300).build();
const simulate=async(contract:string,method:string,args:xdr.ScVal[])=>{
  const result=await soroban.simulateTransaction(build(contract,method,args));
  if(rpc.Api.isSimulationError(result))throw new Error(result.error);
  assert(rpc.Api.isSimulationSuccess(result)&&result.result);return scValToNative(result.result.retval);
};
assert.equal(await simulate(stellar.transmitter,'get_local_domain',[]),27);
assert.equal(await simulate(stellar.forwarder,'get_message_transmitter',[]),stellar.transmitter);
assert.equal(await simulate(stellar.forwarder,'get_token_messenger_minter',[]),stellar.messenger);
assert.equal(await simulate(usdc,'decimals',[]),7);
const recipient='0x1234567890123456789012345678901234567890';
const baseBurn=encodeFunctionData({abi:MESSENGER_ABI,functionName:'depositForBurnWithHook',args:[1000000n,27,contractBytes32(stellar.forwarder),base.usdc,contractBytes32(stellar.forwarder),0n,2000,stellarHook(key.publicKey())]});
const stellarBurn=build(stellar.messenger,'deposit_for_burn_with_hook',[
  new Address(key.publicKey()).toScVal(),nativeToScVal(10000000n,{type:'i128'}),nativeToScVal(6,{type:'u32'}),
  xdr.ScVal.scvBytes(Buffer.from(evmBytes32(recipient).slice(2),'hex')),new Address(usdc).toScVal(),xdr.ScVal.scvBytes(Buffer.alloc(32)),
  nativeToScVal(600000n,{type:'i128'}),nativeToScVal(2000,{type:'u32'}),xdr.ScVal.scvBytes(Buffer.from(SERVICE_HOOK.slice(2),'hex'))]);
// Simulation is expected to reject this unfunded USDC source before a burn.
const burnSimulation=await soroban.simulateTransaction(stellarBurn);
assert(rpc.Api.isSimulationError(burnSimulation),'Unfunded test account must not be allowed to burn');
console.log(JSON.stringify({checkedAt:new Date().toISOString(),baseChainId:84532,stellarNetwork:'testnet',
  contractReads:'passed',stellarBurnConstruction:'passed',baseBurnCalldataBytes:(baseBurn.length-2)/2,
  unfundedStellarBurn:'blocked by simulation',endToEnd:'NOT RUN: no funded test USDC/Base Sepolia ETH accounts or wallet sessions supplied.'},null,2));
