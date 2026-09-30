import { Account, Address, Operation, rpc, scValToNative, Transaction, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { createPublicClient, http, type Address as EvmAddress, type Hex } from 'viem';
import { estimateTotalFee } from 'viem/op-stack';
import { MAINNET } from './config';
import { sorobanTx } from './transactions';
import { jsonFetch } from './accounts';
import { ceilDiv } from './amount';

export const baseClient = createPublicClient({chain:MAINNET.base.chain,transport:http(MAINNET.base.rpc,{timeout:20000,retryCount:2})});
export const stellarClient = new rpc.Server(MAINNET.stellar.rpc);
export const sleep = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
export async function checkNetworks() {
  const [id, network] = await Promise.all([baseClient.getChainId(),stellarClient.getNetwork()]);
  if (id !== 8453 || network.passphrase !== MAINNET.stellar.passphrase) throw new Error('RPC network mismatch. Transfer blocked.');
}
export async function stellarRead(caller: string, contract: string, method: string, args: xdr.ScVal[]) {
  const tx = sorobanTx(new Account(caller,'0'),contract,method,args);
  const sim = await stellarClient.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Stellar check failed: ${sim.error.slice(0,240)}`);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('Stellar check returned no result.');
  return scValToNative(sim.result.retval) as unknown;
}
export async function prepareStellar(caller:string,contract:string,method:string,args:xdr.ScVal[]) {
  const account = await stellarClient.getAccount(caller);
  const stats = await stellarClient.getFeeStats();
  const inclusion = BigInt(stats.sorobanInclusionFee.p95);
  const draft = new TransactionBuilder(account,{fee:(inclusion>100n?inclusion:100n).toString(),networkPassphrase:MAINNET.stellar.passphrase})
    .addOperation(new (await import('@stellar/stellar-sdk')).Contract(contract).call(method,...args)).setTimeout(300).build();
  const sim = await stellarClient.simulateTransaction(draft);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Transaction simulation failed: ${sim.error.slice(0,280)}`);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error('Could not simulate the Stellar transaction.');
  if (rpc.Api.isSimulationRestore(sim)) {
    // SDK 17 adds transactionData.resourceFee to the inclusion fee on build.
    const restore = new TransactionBuilder(await stellarClient.getAccount(caller),{fee:inclusion.toString(),networkPassphrase:MAINNET.stellar.passphrase})
      .setSorobanData(sim.restorePreamble.transactionData.build())
      .addOperation(Operation.restoreFootprint({})).setTimeout(300).build();
    return {tx:restore,fee:BigInt(restore.fee),restore:true};
  }
  const tx = rpc.assembleTransaction(draft,sim).build();
  return {tx,fee:BigInt(tx.fee),restore:false};
}
export async function estimateBase(from:EvmAddress,to:EvmAddress,data:Hex) {
  const [gas,fee] = await Promise.all([
    baseClient.estimateGas({account:from,to,data}),
    estimateTotalFee(baseClient,{account:from,to,data}), // L1 data fee + L2 execution fee, Base OP stack
  ]);
  return {gas:ceilDiv(gas*120n,100n),fee:ceilDiv(fee*130n,100n)};
}
// Use a recent successful forwarder invocation as an empirical destination fee
// estimate, fetched anew. A claim is separately simulated when attestation arrives.
export async function estimateStellarClaim(): Promise<bigint | null> {
  try {
    const latest = await stellarClient.getLatestLedger();
    const events = await stellarClient.getEvents({startLedger:latest.sequence-10000,filters:[{type:'contract',contractIds:[MAINNET.stellar.forwarder]}],limit:10});
    for (const event of [...events.events].reverse()) {
      if (!event.inSuccessfulContractCall) continue;
      const tx = await jsonFetch<{successful:boolean;fee_charged:string}>(`${MAINNET.stellar.horizon}/transactions/${event.txHash}`);
      if (tx.successful) return ceilDiv(BigInt(tx.fee_charged)*150n,100n);
    }
  } catch { /* No recent sample: explicitly disclose unavailable estimate. */ }
  return null;
}
export const stellarAddressArg = (s:string)=>new Address(s).toScVal();
export const i128 = (n:bigint)=>nativeToScVal(n,{type:'i128'});
