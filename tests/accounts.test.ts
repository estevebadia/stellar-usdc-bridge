import { describe, expect, it } from 'vitest';
import { MAINNET } from '../src/config';
import { receivingCapacity, spendableUsdc, spendableXlm, type StellarAccountData } from '../src/accounts';
const a:StellarAccountData={id:'G',sequence:'1',subentry_count:1,num_sponsored:0,num_sponsoring:0,balances:[
 {asset_type:'native',balance:'10.0000000',selling_liabilities:'1.0000000'},
 {asset_type:'credit_alphanum4',asset_code:'USDC',asset_issuer:MAINNET.stellar.issuer,balance:'1.1234567',limit:'10.0000000',buying_liabilities:'2.0000000',selling_liabilities:'0.0000008',is_authorized:true},
]};
describe('Stellar prerequisites',()=>{
  it('accounts for buying liabilities and capacity dust',()=>expect(receivingCapacity(a)).toBe(6876543n));
  it('accounts for selling liabilities before flooring Max',()=>expect(spendableUsdc(a)).toBe(1123455n));
  it('uses current ledger reserve and sponsorship counts',()=>{
    expect(spendableXlm(a,5000000n)).toBe(75000000n);
    expect(spendableXlm({...a,num_sponsoring:1},5000000n)).toBe(70000000n);
    expect(spendableXlm({...a,num_sponsored:1},5000000n)).toBe(80000000n);
  });
  it('blocks missing, unauthorized, or wrong-issuer USDC lines',()=>{
    expect(()=>receivingCapacity({...a,balances:a.balances.slice(0,1)})).toThrow('Add native USDC');
    expect(()=>receivingCapacity({...a,balances:[{...a.balances[1],is_authorized:false}]})).toThrow('not authorized');
    expect(spendableUsdc({...a,balances:[{...a.balances[1],asset_issuer:'wrong'}]})).toBe(0n);
  });
});
