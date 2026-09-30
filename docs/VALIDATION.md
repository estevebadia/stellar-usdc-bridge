# Validation record

Date: 30 September 2026. No production wallet was connected and no mainnet USDC was moved.

## Passed checks

* TypeScript strict type check and Vite production build.
* Automated unit tests: exact amount parsing/formatting, precision conversion/dust, fee rounding/caps, Stellar reserve/trustline/liabilities, exact recipient and hook bytes, both burn transaction constructions, approved amount/expiry, mainnet-only route constants, raw-message validation, and local persistence through interruption.
* Engine recovery tests: persisted intent before a wallet request, unknown Base submission, explicit rejected signature, stale duplicate-burn prevention, hash persistence, delayed attestation, attestation alone never treated as delivery, verified already-completed delivery, and reverted destination claims preserving the original burn.
* Read-only live mainnet probes (`npm run verify:mainnet`): Base chain ID 8453; deployed USDC/messenger/transmitter code; Base USDC decimals 6; Base transmitter domain 6; messenger → transmitter and Base → Stellar remote-messenger mapping; Stellar public passphrase/domain 27; USDC SAC decimals 7; Stellar messenger → transmitter; deployed forwarder footprint; forwarder → intended messenger/transmitter; source minimum fee; live Standard fees for both exact routes.
* The mainnet probe returned Stellar USDC SAC `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`. The Stellar → Base forwarding API returned a dynamic fee near 0.057 USDC; Base → Stellar Standard fee was 0 at the time of the probe. These values are **not** hardcoded in the app.
* A recent successful mainnet forwarder invocation was available as an empirical destination fee sample (approximately 0.042 XLM including a 50% estimate buffer at the time of testing). Every actual claim is still simulated before signing.
* Live testnet probes (`npm run test:testnet`): Base Sepolia chain ID 84532 and official contracts/token decimals; Stellar testnet passphrase/domain/contracts/token decimals; both burn calldata/XDR constructions using official testnet contracts; unfunded Stellar burn rejected by simulation. A disposable Stellar testnet account was funded with friendbot solely for these probes. Its private key was kept only in process memory and never printed, stored, or committed.
* Browser preview: the form loaded, both directions switched correctly, transfer and Max were disabled until wallets/quote were ready, and missing LOBSTR extension produced setup guidance. Browser checks used an unconnected wallet session.

## Not completed end to end

Neither Stellar → Base nor Base → Stellar was run end to end with funded test USDC, Base Sepolia ETH, a paired LOBSTR mobile signer, and Coinbase Wallet. This environment did not provide those wallet sessions or test token funding. The protocol encoding and recovery paths were unit tested; deployed contract reads and an unfunded Stellar source transaction were simulated/probed. Forwarding support is based on current official capability documentation plus an exact-route live API quote, not an observed full transfer from this app.

The app has no independent security audit. Public RPC reliability, actual wallet QR/pairing behavior, real fee changes while mobile signatures are pending, and mainnet end-to-end execution remain outside the completed validation. These limits are recorded so a passing build or attestation cannot be mistaken for a completed funds test.

## Release verification

The deployed revision must equal the public GitHub source revision and the Sites saved-version revision. Before handoff, verify the Site's native deployment state is `succeeded`, access mode is `public`, and a cookie-free request loads the application without a ChatGPT sign-in redirect. Deployment results are reported in the delivery message; runtime publication identifiers and credentials are not committed as validation data.

## Phone connection update

The user reported the desktop LOBSTR signer worked. This is user feedback, not a development-environment funds test. Phone signing was researched against current LOBSTR WalletConnect/Soroban documentation and Reown's Stellar sign-only RPC documentation. Coinbase's current Reown integration explicitly distinguishes its dapp-browser handoff from a WalletConnect relay.

Added automated checks cover: mainnet-only sign-only namespaces; expired/wrong-network/wrong-account/submit-only sessions; exact original Soroban burn signature verification and rejection of modified transactions, other signers and testnet signatures; pairing/session restoration; cancelled pairing with late approval; connection timeout; session deletion/disconnection preserving the existing burn and recovery lock; lazy Coinbase injected-provider selection; Base network switching/account rechecking; cancelled Coinbase connections and fresh reconnection; and encoded native/universal mobile links. These tests use mocked wallet sessions and ephemeral test signatures, not real wallet approvals.

Browser preview checks cover connection choices, missing project setup, desktop fallback, Coinbase phone links and cancellation. Actual phone app pairing, Soroban signing on iOS/Android, Coinbase in-app connection and wallet-to-browser return behavior remain to be verified on the user's device. Neither new phone path is claimed as a completed funded end-to-end transfer.

Reown wallet directory was checked with the owner’s project: LOBSTR advertises `stellar:pubnet`, `supports_wc: true`, and native link `lobstr://`. The hosted origin is allowlisted in that project. Its project ID is supplied through ignored build environment files and not committed to the public repository.

With the owner’s configured Reown project, the local browser generated a live WalletConnect v2 pairing QR and correctly encoded LOBSTR link. Cancellation returned to the disconnected form without a transaction request. No wallet approved that test pairing.
