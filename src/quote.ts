import { Address } from '@stellar/stellar-sdk';
import type { Address as EvmAddress, Hex } from 'viem';
import { MAINNET, STELLAR_USDC, type Direction } from './config';
import { netAmount, canonicalToStellar, ceilDiv, stellarToCanonical } from './amount';
import { evmBytes32, stellarAccount } from './encoding';
import { loadStellarAccount, receivingCapacity, spendableUsdc } from './accounts';
import { baseClient, checkNetworks, estimateBase, estimateStellarClaim, prepareStellar, stellarRead } from './clients';
import { circleFee } from './circle';
import { baseApproveData, baseBurnData, stellarApproveArgs, stellarBurnArgs, TOKEN_ABI } from './transactions';

export interface Input {direction:Direction;stellar:string;base:Hex;amount:bigint}
export interface Quote {
  input:Input; expiresAt:number; fee:bigint; receive:bigint; balance:bigint; allowance:bigint;
  needsApproval:boolean; sourceCost:bigint; destinationCost:bigint|null;
  stellarXlm:bigint; baseEth:bigint; action:'approval'|'burn'|'restore';
  stellarPrepared?:Awaited<ReturnType<typeof prepareStellar>>;
  basePrepared?:{to:Hex;data:Hex;gas:bigint};
}
export async function getBalance(direction:Direction,stellar:string,base:Hex) {
  return direction==='stellar-base'?spendableUsdc((await loadStellarAccount(stellar)).account):
    baseClient.readContract({address:MAINNET.base.usdc,abi:TOKEN_ABI,functionName:'balanceOf',args:[base]});
}
export async function quote(input:Input):Promise<Quote> {
  stellarAccount(input.stellar); evmBytes32(input.base);
  if(input.amount<=0n) throw new Error('Enter an amount greater than zero.');
  await checkNetworks();
  const [stellar,balance,eth,fee0,decimals] = await Promise.all([
    loadStellarAccount(input.stellar),getBalance(input.direction,input.stellar,input.base),
    baseClient.getBalance({address:input.base}),circleFee(input.direction,input.amount),
    baseClient.readContract({address:MAINNET.base.usdc,abi:TOKEN_ABI,functionName:'decimals'}),
  ]);
  if(decimals!==6) throw new Error('Base asset precision mismatch. Transfer blocked.');
  if(input.amount>balance) throw new Error('Amount exceeds your spendable native USDC balance.');
  const outbound=input.direction==='stellar-base';
  let fee=fee0;
  if(outbound) {
    const minLocal=BigInt(await stellarRead(input.stellar,MAINNET.stellar.messenger,'get_min_fee_amount',[
      new Address(STELLAR_USDC).toScVal(),(await import('./clients')).i128(canonicalToStellar(input.amount)),
    ]) as bigint);
    fee += ceilDiv(minLocal,10n); // Any source fee switch is checked against live contract.
  } else {
    if(receivingCapacity(stellar.account)<input.amount) throw new Error('Your Stellar USDC trustline has insufficient receiving capacity. Increase its limit in LOBSTR, then refresh.');
  }
  const receive=netAmount(input.amount,fee);
  const allowance=outbound?stellarToCanonical(BigInt(await stellarRead(input.stellar,STELLAR_USDC,'allowance',[
    new Address(input.stellar).toScVal(),new Address(MAINNET.stellar.messenger).toScVal(),
  ]) as bigint)):
    await baseClient.readContract({address:MAINNET.base.usdc,abi:TOKEN_ABI,functionName:'allowance',args:[input.base,MAINNET.base.messenger]});
  const needsApproval=allowance<input.amount;
  const q:Quote={input,expiresAt:Date.now()+60000,fee,receive,balance,allowance,needsApproval,
    sourceCost:0n,destinationCost:null,stellarXlm:stellar.xlm,baseEth:eth,action:needsApproval?'approval':'burn'};
  if(outbound) {
    const latest=await (await import('./clients')).stellarClient.getLatestLedger();
    const prepared=await prepareStellar(input.stellar,needsApproval?STELLAR_USDC:MAINNET.stellar.messenger,
      needsApproval?'approve':'deposit_for_burn_with_hook',needsApproval?stellarApproveArgs(input.stellar,input.amount,latest.sequence+720):stellarBurnArgs(input.stellar,input.amount,fee,input.base));
    q.stellarPrepared=prepared; q.sourceCost=prepared.fee;
    if(prepared.restore) q.action='restore';
    if(stellar.xlm<prepared.fee) throw new Error('Add XLM to LOBSTR for the simulated network fee, above your account reserve.');
  } else {
    const to=needsApproval?MAINNET.base.usdc:MAINNET.base.messenger;
    const data=needsApproval?baseApproveData(input.amount):baseBurnData(input.amount,fee,input.stellar);
    const prepared=await estimateBase(input.base as EvmAddress,to,data);
    q.basePrepared={to,data,gas:prepared.gas};q.sourceCost=prepared.fee;
    q.destinationCost=await estimateStellarClaim();
    if(eth<prepared.fee) throw new Error('Add ETH on Base to Coinbase Wallet for the estimated network fee.');
    if(stellar.xlm<=0n || (q.destinationCost!==null&&stellar.xlm<q.destinationCost)) throw new Error('Add spendable XLM to LOBSTR for the destination claim, above your account reserve.');
  }
  return q;
}
