import { describe, expect, it } from 'vitest';
import { units, format, feeForBps, netAmount, stellarToCanonical, canonicalToStellar } from '../src/amount';
describe('funds arithmetic',()=>{
  it('uses exact six-decimal integers without Number conversion',()=>{
    expect(units('0.000001')).toBe(1n);
    expect(units('123456789.123456')).toBe(123456789123456n);
    expect(format(units('9999999999.999999'))).toBe('9999999999.999999');
  });
  it.each(['1.0000001','1e6','-1','NaN','Infinity',' 1','1 ','1,1','0x20','01','1.',''])('rejects ambiguous input %s',v=>expect(()=>units(v)).toThrow());
  it('leaves seventh-decimal Stellar dust and never rounds Max up',()=>{
    expect(stellarToCanonical(units('12.1234567',7))).toBe(12123456n);
    expect(canonicalToStellar(12123456n)).toBe(121234560n);
    expect(format(stellarToCanonical(units('0.0000009',7)))).toBe('0');
  });
  it('rounds fractional basis point fees up, preserving a fee cap',()=>{
    expect(feeForBps(1_000_000n,'1.3')).toBe(130n);
    expect(feeForBps(1n,'1.3')).toBe(1n);
    expect(feeForBps(10_000_001n,'1.234')).toBe(1235n);
    expect(feeForBps(90000000000000000n,'0.01')).toBe(90000000000n);
    expect(()=>feeForBps(1n,'-1')).toThrow();
  });
  it('blocks fees consuming the whole burn',()=>{
    expect(netAmount(1_000_000n,56_989n)).toBe(943011n);
    expect(()=>netAmount(10n,10n)).toThrow();
    expect(()=>netAmount(10n,-1n)).toThrow();
  });
});
