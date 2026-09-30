# Stellar USDC Bridge

A small, non-custodial browser app for native USDC between Stellar mainnet and Base mainnet using Circle CCTP V2. One payment form, two routes, no app accounts or server-held keys. The destination is always the connected wallet. Amounts and fees use integer arithmetic.

## Wallet prerequisites

* **Stellar / LOBSTR:** use a desktop Chrome, Brave, Opera, or Edge browser with the [LOBSTR signer extension](https://lobstr.co/signer-extension/) paired to the LOBSTR mobile app. The vendor documents Soroban support. The official `@lobstrco/signer-extension-api` signs prepared Soroban XDRs and returns them for this app to submit. Confirm on your phone. Generic WalletConnect is deliberately not assumed to support these Soroban transactions. No private keys or recovery phrases are requested by the app.
* **Base / Coinbase Wallet:** Coinbase Wallet SDK with `eoaOnly` connects an existing wallet through its extension or mobile QR flow. The app requests Base mainnet (chain ID 8453) and checks chain and account again before each transaction. Coinbase Smart Wallet is outside this app's scope.
* Have native Circle USDC, not a wrapped or bridged imitation. Add native USDC in LOBSTR, activate the Stellar account, keep XLM above the account/subentry reserve, and ensure an authorized trustline with sufficient receiving capacity. Keep ETH on Base for source transactions and for a manual fallback claim, if needed. LOBSTR account setup is done in LOBSTR, with a link and a refresh action in the app.

## Delivery methods and wallet actions

| Route | Mode and delivery | Wallet actions | Network costs |
| --- | --- | --- | --- |
| Stellar → Base | Standard (2000); official `deposit_for_burn_with_hook`, Circle's v0 `cctp-forward` service hook, zero destination caller, connected Base account as mint recipient | LOBSTR exact-amount SEP-41 approval if required, then burn. Coinbase Wallet may be needed for a fallback `receiveMessage` claim if forwarding does not deliver | XLM source simulation; USDC forwarding fee from live Iris API. Circle normally submits Base delivery. Manual fallback requires ETH |
| Base → Stellar | Standard (2000); official `depositForBurnWithHook`; both `mintRecipient` and `destinationCaller` are Circle's Stellar `CctpForwarder`; connected LOBSTR G account encoded in hook | Coinbase Wallet exact-amount approval if required, then burn. After attestation, LOBSTR `mint_and_forward` claim | ETH source estimate includes Base L1 data and L2 execution. XLM claim fee, simulated before signing |

Standard is chosen on Base for cost, simplicity, and no Fast Transfer allowance or expiry management. Base source finality may take around 15–20 minutes; timings are estimates. Stellar is not a Fast Transfer source. No Fast/Standard selector is exposed.

Circle's **transaction-submission Forwarding Service** and the onchain **Stellar CctpForwarder** are separate. The current [capability table](https://developers.circle.com/cctp/concepts/supported-chains-and-domains) lists Base as a forwarding destination and excludes Stellar as a forwarding destination. Circle's [forwarding guide](https://developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service) applies to supported destinations; the live mainnet fee endpoint `GET /v2/burn/USDC/fees/27/6?forward=true` was independently checked and returns Standard forwarding fees. This is documentation/API support, not proof of a completed live forwarded transfer from this app. A fallback claim is always available for that same message. No fixed number of wallet confirmations or unconditional gasless delivery is promised.

Stellar's approval and burn are separate official contract calls. No custom mainnet wrapper is deployed. Archived Soroban data can require a separate restoration transaction and a new simulation. The app guides those actions and reviews the burn only after prerequisites have executed.

## Amounts, fees, and checks

Input accepts at most six decimals. CCTP messages use six-decimal amounts. Stellar contract burn `amount` and `max_fee` use seven-decimal units, so they are multiplied by ten. Max floors Stellar spendable USDC to six decimals after subtracting selling liabilities; seventh-decimal dust stays behind. Receiving capacity subtracts the destination balance and buying liabilities from the trustline limit. XLM reserve calculations include sponsorship counts and the current ledger's base reserve.

Quotes expire after 60 seconds and are invalidated by wallet, network, direction, amount, and browser-focus changes. Before burning, the app checks the native asset, recipient, balance, chain, gas, live fee information, and transaction simulation. Source approval/restoration fees are quoted first; once executed, the burn is separately simulated and reviewed. The UI displays a full destination address and maximum USDC fee before signing. The received amount is an estimate until the attested `feeExecuted` and destination execution are verified.

The Stellar destination fee estimate is based on a recent successful mainnet `CctpForwarder` invocation plus a 50% buffer, fetched from RPC/Horizon. It is an empirical estimate, not a price guarantee. If no recent sample can be fetched, the estimate is explicitly unavailable and the user must keep spendable XLM for the subsequent claim. The actual claim is simulated after attestation and insufficient XLM blocks signing, preserving the existing burn for recovery.

## Mainnet configuration and authoritative sources

[`src/config.ts`](src/config.ts) contains only mainnet values with source links beside them. No environment variable silently changes networks. Testnet fixtures live only in the CLI test script.

| Value | Mainnet |
| --- | --- |
| Base chain / CCTP domain | 8453 / 6 |
| Stellar CCTP domain | 27 |
| Base native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| Base MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |
| Stellar USDC issuer | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| Stellar USDC SAC | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` (derived from classic asset + public network passphrase) |
| Stellar TokenMessengerMinter | `CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL` |
| Stellar MessageTransmitter | `CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV` |
| Stellar CctpForwarder | `CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T` |
| Iris API | `https://iris-api.circle.com` |
| Base RPC | `https://mainnet.base.org` |
| Stellar RPC | `https://soroban-rpc.mainnet.stellar.gateway.fm` |
| Horizon | `https://horizon.stellar.org` |

Sources: [Circle Stellar deployments](https://developers.circle.com/cctp/references/stellar-contracts), [EVM deployments](https://developers.circle.com/cctp/references/contract-addresses), [USDC assets](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Stellar recipient and precision rules](https://developers.circle.com/cctp/references/stellar), [CCTP message format](https://developers.circle.com/cctp/references/technical-guide), [fee API](https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees), [Stellar CCTP docs](https://developers.stellar.org/docs/tokens/cross-chain-transfers), [Stellar RPC providers](https://developers.stellar.org/docs/data/apis/rpc/providers), [Stellar SDK](https://github.com/stellar/js-stellar-sdk), [Base network](https://docs.base.org/base-chain/network-information). See [NOTICE.md](NOTICE.md) for upstream revisions and licenses.

## Recovery after refresh or interruption

The browser's local storage holds the current transfer: route, connected accounts, exact amount/fee cap, source intent/nonce/calldata, transaction hashes, signed public transaction envelopes, message, attestation, and destination state. It contains no private keys. Stay on the same site origin/browser profile; do not clear site data until delivery is verified. Storage is checked before a wallet action. A cross-tab Web Lock prevents concurrent submissions from this app in the same browser origin.

* Reopen the app and reconnect the same wallet accounts. It resumes confirmation and attestation checks automatically.
* A burn with a successful or uncertain outcome blocks another burn. A wallet rejection before broadcast returns to review. Source failure/expiration must be independently reconciled before a new transfer is permitted.
* Stellar transaction hashes are computed before submission and signed XDR is saved before broadcast. Old transactions are reconciled through Horizon after RPC retention expires.
* A Base wallet can submit before returning its hash. The app saves the exact nonce/contract/calldata first. It tries to discover the mined transaction, and provides a transaction-hash recovery field for the existing request. Enter the hash from Coinbase Wallet; the app validates wallet, nonce, contract, and calldata. A network error never silently unlocks a fresh burn.
* Destination errors preserve the original source burn and attestation. Add gas or fix the Stellar trustline, then claim that transfer. **Do not send USDC again to recover delivery.**
* A raw CCTP message must match the saved source/destination domains, contracts, token, amount, fee cap, source account, recipient, and hook. The API's null decoded Stellar address fields are not trusted.
* Completion requires an onchain used-nonce check. The configured recipient paths execute atomically. A saved destination hash must also have a successful receipt. Circle's `status: complete` refers to attestation and is not treated as completed delivery.

If a Base transaction is replaced or cancelled, recently mined replacements are reconciled by nonce. Old unknown replacements beyond the bounded scan may require inspecting Coinbase Wallet/explorer history; the lock is intentionally retained when the outcome cannot be proven. Losing local data requires recovering the burn hash/message through Circle and the chain explorer; this small utility has no account-based or cross-device recovery service.

## Local setup

Requires Node.js 22.12+ (tested on Node.js 24) and npm. No API key, wallet secret, WalletConnect project ID, database, or application login is needed.

```sh
npm ci
npm run dev
npm run check
npm test
npm run verify:mainnet
npm run test:testnet
npm run build
```

The build is a static Vite/React application in `dist/`. Wallet libraries were chosen for the documented signing path: official LOBSTR API, Coinbase Wallet SDK, Stellar SDK, and viem for EVM calls/Base gas estimates. See the checked-in lockfile for exact dependencies.

## Deployment through ChatGPT Sites

`.openai/hosting.json` identifies this Site and declares `static.directory: dist`. To publish updates in Codex, apply the Sites building/hosting skills, run the checks/build, push the exact source revision to the Site's source repository using its short-lived credential via stdin, package `dist/` plus the hosting manifest, save that revision, and deploy the saved version. Keep the public GitHub repository synchronized to that exact revision. Set Site audience to `public` and verify anonymous access without a ChatGPT session. Hosting credentials belong in session memory, never in source, shell arguments, or `.env` files.

To deploy your own copy, register a new Site and replace the project ID with its returned ID; do not reuse this project's identity. The public GitHub repository is a source mirror; ChatGPT Sites has its own source storage.

## Verification and limits

[docs/VALIDATION.md](docs/VALIDATION.md) records what was actually exercised. Unit tests cover fund-changing arithmetic, recipient/hook encodings, route constants, both burn constructions, account prerequisites, fee arithmetic, attestation integrity, and interruption recovery. Live mainnet probes are read-only. Testnet probes check deployed contracts and both transaction constructions; they simulate an unfunded Stellar burn and require rejection. Neither direction has been completed end to end with funded test USDC and both wallet sessions. No mainnet funds were moved during development, and no independent security audit has been performed.

Public RPCs and Iris can be rate limited or unavailable. Reconciliation preserves the transfer during outages. LOBSTR signing was checked against the vendor's integration/API, but an actual paired mobile wallet session was not available for end-to-end verification.
