import * as lobstr from '@lobstrco/signer-extension-api';
import { createCoinbaseWalletSDK } from '@coinbase/wallet-sdk';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { getAddress, type Address, type EIP1193Provider } from 'viem';
import { MAINNET } from './config';
import { Buffer } from 'buffer';
import { stellarAccount } from './encoding';

const sdk = createCoinbaseWalletSDK({appName:'Stellar USDC Bridge',appChainIds:[8453],preference:{options:'eoaOnly'}});
export const baseProvider = sdk.getProvider();
export const viemProvider = baseProvider as unknown as EIP1193Provider;
export async function connectStellar() {
  if (!await lobstr.isConnected()) throw new Error('Install the LOBSTR signer extension in a desktop browser and pair it with your LOBSTR mobile app.');
  return stellarAccount(await lobstr.getPublicKey());
}
export async function connectBase(): Promise<Address> {
  const accounts = await baseProvider.request({method:'eth_requestAccounts'}) as string[];
  if (!accounts[0]) throw new Error('Choose an account in Coinbase Wallet.');
  return getAddress(accounts[0]);
}
export async function checkBaseWallet(expected: string, switchNetwork = true) {
  let chain = await baseProvider.request({method:'eth_chainId'});
  if (chain !== '0x2105' && switchNetwork) {
    await baseProvider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x2105'}]});
    chain = await baseProvider.request({method:'eth_chainId'});
  }
  if (chain !== '0x2105') throw new Error('Select Base mainnet in Coinbase Wallet.');
  const accounts = await baseProvider.request({method:'eth_accounts'}) as string[];
  if (accounts[0]?.toLowerCase() !== expected.toLowerCase()) throw new Error('Reconnect the Coinbase Wallet account used for this transfer.');
}
export async function signStellar(xdr: string, expected: string) {
  if ((await lobstr.getPublicKey()) !== expected) throw new Error('Reconnect the LOBSTR account used for this transfer.');
  const original = TransactionBuilder.fromXDR(xdr, MAINNET.stellar.passphrase);
  const signed = TransactionBuilder.fromXDR(await lobstr.signTransaction(xdr),MAINNET.stellar.passphrase);
  if (!Buffer.from(signed.hash()).equals(Buffer.from(original.hash()))) throw new Error('Wallet changed the transaction. Nothing was submitted.');
  const key = Keypair.fromPublicKey(expected);
  if (!signed.signatures.some(s=> {
    try {return key.verify(signed.hash(),s.signature);} catch {return false;}
  })) throw new Error('LOBSTR returned no valid mainnet signature for the connected account. Nothing was submitted.');
  return signed;
}
