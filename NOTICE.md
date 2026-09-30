# Upstream references and licenses

This app is independently authored. The protocol integration was checked against:

* Circle's [`stellar-cctp`](https://github.com/circlefin/stellar-cctp), revision `45746f2c803198bc6cd586475eb3c925f12bb488`, Copyright 2026 Circle Internet Group, Inc., Apache-2.0. In particular: `examples/stellar-utils.ts`, the token messenger deposit implementation, and the Rust forwarder hook parser. The Apache license is preserved in `licenses/Circle-Apache-2.0.txt`.
* ElliotFriend's [`stellar-cctp-demo`](https://github.com/ElliotFriend/stellar-cctp-demo), revision `871cead2f6cb5c664a6df259d2e11e71107819c1`, Copyright (c) 2026 ElliotFriend, MIT. This is the source linked by [cctp27.vercel.app](https://cctp27.vercel.app). Its license is preserved in `licenses/stellar-cctp-demo-MIT.txt`. No custom bridge wrapper, experimental relayer behavior, or testnet configuration is used in production.
* The [LOBSTR signer API](https://github.com/Lobstrco/lobstr-browser-extension/tree/main/%40lobstrco/signer-extension-api), Apache-2.0 (the SDK's own license; the browser extension repository has a separate GPL license).
* [Coinbase Wallet SDK](https://github.com/coinbase/coinbase-wallet-sdk), Apache-2.0; [Stellar SDK](https://github.com/stellar/js-stellar-sdk), Apache-2.0; [viem](https://github.com/wevm/viem), MIT; React, MIT; Buffer, MIT.

Dependency licenses and copyright notices are retained in installed package distributions and the dependency lockfile identifies the exact versions. The application license does not replace upstream licenses.

Phone integration references: [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/src/sdk/modules/wallet-connect.module.ts), revision `7663331fd6e8d192653deb08ae93fd0c224b42a8` (MIT), checked for the required Stellar namespace and sign-only request shape; [Reown AppKit](https://github.com/reown-com/appkit/blob/main/packages/controllers/src/utils/MobileWallet.ts), revision `28555e3cf6b8c4d0d95b8c47e261dad8162b6aa0`, checked for Coinbase's separate dapp-browser handoff. No AppKit code is included or copied into this application. WalletConnect Sign Client and its dependencies retain their upstream Apache-2.0 notices; QRCode is MIT.
