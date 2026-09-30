import { units, stellarToCanonical } from './amount';
import { MAINNET } from './config';
import { stellarAccount } from './encoding';

export interface Balance {
  asset_type: string; asset_code?: string; asset_issuer?: string; balance: string;
  limit?: string; buying_liabilities?: string; selling_liabilities?: string; is_authorized?: boolean;
}
export interface StellarAccountData {
  id: string; sequence: string; subentry_count: number; num_sponsoring: number; num_sponsored: number;
  balances: Balance[];
}
export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {...init, signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Service returned ${response.status}. Try again shortly.`);
  return response.json() as Promise<T>;
}
export function usdcLine(a: StellarAccountData) {
  return a.balances.find(b=> b.asset_code === 'USDC' && b.asset_issuer === MAINNET.stellar.issuer);
}
export function receivingCapacity(a: StellarAccountData): bigint {
  const b = usdcLine(a);
  if (!b) throw new Error('Add native USDC to this account in LOBSTR, then refresh the checks. Keep XLM for the trustline reserve.');
  if (!b.is_authorized) throw new Error('The native USDC trustline is not authorized to receive. Resolve this in LOBSTR before transferring.');
  return stellarToCanonical(units(b.limit!,7)-units(b.balance,7)-units(b.buying_liabilities ?? '0',7));
}
export function spendableUsdc(a: StellarAccountData): bigint {
  const b = usdcLine(a);
  if (!b || !b.is_authorized) return 0n;
  return stellarToCanonical(units(b.balance,7)-units(b.selling_liabilities ?? '0',7));
}
export function spendableXlm(a: StellarAccountData, reserve: bigint): bigint {
  const b = a.balances.find(b=>b.asset_type==='native');
  if (!b) return 0n;
  const minimum = BigInt(2 + a.subentry_count + a.num_sponsoring - a.num_sponsored) * reserve;
  const v = units(b.balance,7)-units(b.selling_liabilities ?? '0',7)-minimum;
  return v > 0n ? v : 0n;
}
export async function loadStellarAccount(address: string) {
  stellarAccount(address);
  const response = await fetch(`${MAINNET.stellar.horizon}/accounts/${address}`,{signal:AbortSignal.timeout(20000)});
  if (response.status === 404) throw new Error('Activate this Stellar account with XLM in LOBSTR, then add native USDC before transferring.');
  if (!response.ok) throw new Error('Could not check your Stellar account. Refresh the checks.');
  const account = await response.json() as StellarAccountData;
  const ledgers = await jsonFetch<{_embedded:{records:{base_reserve_in_stroops:number}[]}}>(`${MAINNET.stellar.horizon}/ledgers?order=desc&limit=1`);
  return {account, xlm:spendableXlm(account,BigInt(ledgers._embedded.records[0].base_reserve_in_stroops))};
}
