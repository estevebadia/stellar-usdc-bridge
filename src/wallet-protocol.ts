import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import type { SessionTypes } from '@walletconnect/types';
import { MAINNET } from './config';
import { stellarAccount } from './encoding';

// Sign-only: https://docs.reown.com/advanced/multichain/rpc-reference/stellar-rpc
// https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/src/sdk/modules/wallet-connect.module.ts
export const STELLAR_CHAIN = 'stellar:pubnet';
export const STELLAR_SIGN = 'stellar_signXDR';
export const stellarProposal = { requiredNamespaces: {
  stellar: { chains: [STELLAR_CHAIN], methods: [STELLAR_SIGN], events: [] },
} };

export function stellarSessionAccount(session: SessionTypes.Struct, expected?: string): string {
  if (session.expiry <= Math.floor(Date.now()/1000)) throw new Error('Stellar wallet session expired. Connect again.');
  const namespace = session.namespaces.stellar ?? session.namespaces[STELLAR_CHAIN];
  if (!namespace?.methods.includes(STELLAR_SIGN)) throw new Error('This wallet does not support sign-only Stellar transactions. Use the LOBSTR signer extension.');
  const accounts = namespace.accounts.filter(a => a.startsWith(`${STELLAR_CHAIN}:`)).map(a => stellarAccount(a.slice(`${STELLAR_CHAIN}:`.length)));
  const account = expected ? accounts.find(a => a === expected) : accounts[0];
  if (!account) throw new Error('Reconnect the Stellar mainnet account used for this transfer.');
  return account;
}

export function verifiedStellarSignature(originalXdr: string, signedXdr: string, expected: string) {
  const original = TransactionBuilder.fromXDR(originalXdr, MAINNET.stellar.passphrase);
  const signed = TransactionBuilder.fromXDR(signedXdr, MAINNET.stellar.passphrase);
  if (!Buffer.from(signed.hash()).equals(Buffer.from(original.hash()))) throw new Error('Wallet changed the transaction. Nothing was submitted.');
  const key = Keypair.fromPublicKey(expected);
  if (!signed.signatures.some(s => {try {return key.verify(signed.hash(), s.signature);} catch {return false;}}))
    throw new Error('Wallet returned no valid mainnet signature for the connected account. Nothing was submitted.');
  return signed;
}

// User-tapped handoff: Safari can block links opened after asynchronous setup.
// Coinbase is a separate handoff, not a WalletConnect relay connection:
// https://github.com/reown-com/appkit/blob/main/packages/controllers/src/utils/MobileWallet.ts
export function coinbaseBrowserLink(origin: string, universal = false) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid bridge URL.');
  const encoded=encodeURIComponent(url.href);
  return universal ? `https://go.cb-w.com/dapp?cb_url=${encoded}` : `cbwallet://miniapp?url=${encoded}`;
}
export function lobstrConnectionLink(uri: string) {
  if (!uri.startsWith('wc:') || !uri.includes('@2?')) throw new Error('Invalid WalletConnect URI.');
  // Verified 2026-09-30 in https://api.web3modal.org/getWallets (LOBSTR Wallet):
  // chains:[stellar:pubnet], mobile_link:lobstr://, supports_wc:true.
  return `lobstr://wc?uri=${encodeURIComponent(uri)}`;
}
export const lobstrOpenLink = 'lobstr://';
