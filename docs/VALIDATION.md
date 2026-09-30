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
