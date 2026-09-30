import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import { MAINNET } from '../src/config';
import { sorobanTx, stellarBurnArgs } from '../src/transactions';
import { E, G } from './message-fixture';
import { walletSession as session } from './wallet-session-fixture';
import { coinbaseBrowserLink, lobstrConnectionLink, stellarProposal, stellarSessionAccount, verifiedStellarSignature } from '../src/wallet-protocol';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));});
afterEach(()=>vi.useRealTimers());
describe('wallet session constraints',()=>{
  it('requests only mainnet sign-only Stellar, never sign-and-submit or other chains',()=>{
    expect(stellarProposal).toEqual({requiredNamespaces:{stellar:{chains:['stellar:pubnet'],methods:['stellar_signXDR'],events:[]}}});
  });
  it('accepts the intended public account and rejects testnet, expired, wrong-account and submit-only sessions',()=>{
    expect(stellarSessionAccount(session(),G)).toBe(G);
    const bad=session();bad.namespaces.stellar.accounts=[`stellar:testnet:${G}`];expect(()=>stellarSessionAccount(bad)).toThrow('mainnet');
    const expired=session();expired.expiry=1;expect(()=>stellarSessionAccount(expired)).toThrow('expired');
    const submit=session();submit.namespaces.stellar.methods=['stellar_signAndSubmitXDR'];expect(()=>stellarSessionAccount(submit)).toThrow('sign-only');
    expect(()=>stellarSessionAccount(session(),Keypair.random().publicKey())).toThrow('Reconnect');
  });
  it('also understands a chain-qualified approved namespace',()=>{
    const s=session();s.namespaces['stellar:pubnet']=s.namespaces.stellar;delete s.namespaces.stellar;
    expect(stellarSessionAccount(s)).toBe(G);
  });
});
describe('Soroban signatures returned by either signing path',()=>{
  function tx(key:Keypair,amount=1000000n,network=Networks.PUBLIC) {
    return sorobanTx(new Account(key.publicKey(),'7'),MAINNET.stellar.messenger,'deposit_for_burn_with_hook',stellarBurnArgs(key.publicKey(),amount,60000n,E),network);
  }
  it('accepts the exact original mainnet Soroban burn signed by the connected account',()=>{
    const key=Keypair.random(),t=tx(key),original=t.toXDR();t.sign(key);
    expect(verifiedStellarSignature(original,t.toXDR(),key.publicKey()).toXDR()).toBe(t.toXDR());
  });
  it('rejects changed amounts, another signer, unsigned output, and testnet signatures',()=>{
    const key=Keypair.random(),t=tx(key),original=t.toXDR();
    expect(()=>verifiedStellarSignature(original,original,key.publicKey())).toThrow('no valid mainnet');
    t.sign(Keypair.random());expect(()=>verifiedStellarSignature(original,t.toXDR(),key.publicKey())).toThrow('no valid mainnet');
    const changed=tx(key,2000000n);changed.sign(key);expect(()=>verifiedStellarSignature(original,changed.toXDR(),key.publicKey())).toThrow('changed');
    const wrongNetwork=tx(key,1000000n,Networks.TESTNET);wrongNetwork.sign(key);
    expect(()=>verifiedStellarSignature(original,wrongNetwork.toXDR(),key.publicKey())).toThrow('no valid mainnet');
  });
});
describe('explicit mobile links',()=>{
  it('encodes the entire WalletConnect v2 pairing URI once',()=>{
    const uri='wc:abc@2?relay-protocol=irn&symKey=secret&expiryTimestamp=123';
    expect(new URL(lobstrConnectionLink(uri)).searchParams.get('uri')).toBe(uri);
    expect(()=>lobstrConnectionLink('https://wrong.example')).toThrow('Invalid');
  });
  it('opens the exact origin in Coinbase Wallet without putting addresses or transfer data in the URL',()=>{
    const origin='https://stellar-usdc-bridge-esteve.esteveb.chatgpt.site';
    const native=new URL(coinbaseBrowserLink(origin));expect(native.protocol).toBe('cbwallet:');
    expect(native.searchParams.get('url')).toBe(origin+'/');
    const link=coinbaseBrowserLink(origin,true);
    expect(new URL(link).origin).toBe('https://go.cb-w.com');
    expect(new URL(link).searchParams.get('cb_url')).toBe('https://stellar-usdc-bridge-esteve.esteveb.chatgpt.site/');
    expect(()=>coinbaseBrowserLink('javascript:alert(1)')).toThrow();
  });
});
