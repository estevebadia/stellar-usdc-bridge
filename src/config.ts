import { Asset, Networks } from '@stellar/stellar-sdk';
import { base } from 'viem/chains';

// Production-only. Sources sit beside the values; testnet lives in scripts/testnet.ts.
export const SOURCES = {
  stellar: 'https://developers.circle.com/cctp/references/stellar-contracts',
  encoding: 'https://developers.circle.com/cctp/references/stellar',
  evm: 'https://developers.circle.com/cctp/references/contract-addresses',
  usdc: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  capabilities: 'https://developers.circle.com/cctp/concepts/supported-chains-and-domains',
  forwarding: 'https://developers.circle.com/cctp/concepts/forwarding-service',
  fees: 'https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees',
  rpc: 'https://developers.stellar.org/docs/data/apis/rpc/providers',
  base: 'https://docs.base.org/base-chain/network-information',
} as const;

export const MAINNET = {
  circle: 'https://iris-api.circle.com', // Circle technical guide, API service hosts
  finality: 2000, // Standard, supported by both routes; no Fast Transfer fee/expiry.
  base: {
    chain: base,
    domain: 6,
    rpc: 'https://mainnet.base.org', // SOURCES.base; chain ID 8453
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // SOURCES.usdc
    messenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d', // SOURCES.evm TokenMessengerV2
    transmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64', // SOURCES.evm MessageTransmitterV2
  },
  stellar: {
    domain: 27,
    passphrase: Networks.PUBLIC,
    rpc: 'https://soroban-rpc.mainnet.stellar.gateway.fm', // SOURCES.rpc, live getNetwork checked
    horizon: 'https://horizon.stellar.org', // https://developers.stellar.org/docs/data/apis/horizon
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', // SOURCES.usdc
    messenger: 'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL', // SOURCES.stellar
    transmitter: 'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV', // SOURCES.stellar
    forwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T', // SOURCES.stellar
  },
} as const;
// SAC derives deterministically from the official classic asset and PUBLIC passphrase.
// https://developers.stellar.org/docs/tokens/stellar-asset-contract
export const STELLAR_USDC = new Asset('USDC', MAINNET.stellar.issuer).contractId(MAINNET.stellar.passphrase);
export type Direction = 'stellar-base' | 'base-stellar';
export const sourceDomain = (d: Direction) => d === 'stellar-base' ? 27 : 6;
export const destinationDomain = (d: Direction) => d === 'stellar-base' ? 6 : 27;
export const txLink = (d: Direction, hash: string, destination = false) =>
  (d === 'stellar-base') !== destination
    ? `https://stellar.expert/explorer/public/tx/${hash}`
    : `https://basescan.org/tx/${hash}`;
