export function units(value: string, decimals = 6): bigint {
  if (!new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`).test(value))
    throw new Error(`Enter a plain amount with up to ${decimals} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}
export function format(value: bigint, decimals = 6): string {
  const sign = value < 0n ? '-' : '';
  const v = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const f = (v % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${v / scale}${f ? '.' + f : ''}`;
}
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export const stellarToCanonical = (v: bigint) => v / 10n;
export const canonicalToStellar = (v: bigint) => v * 10n;
// Parse decimal basis points exactly. No float multiplication or fee rounding down.
export function feeForBps(amount: bigint, bps: string | number) {
  const s = String(bps);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Invalid fee rate from Circle.');
  const [w, f = ''] = s.split('.');
  const denominator = 10n ** BigInt(f.length);
  return ceilDiv(amount * BigInt(w + f), denominator * 10_000n);
}
export function netAmount(amount: bigint, fee: bigint) {
  if (amount <= 0n || fee < 0n || fee >= amount) throw new Error('Amount must exceed the USDC fee.');
  return amount - fee;
}
