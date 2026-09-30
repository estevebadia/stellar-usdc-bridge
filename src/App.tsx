import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { MAINNET, txLink, type Direction } from './config';
import { format, units } from './amount';
import { connectBase, connectStellar, disconnectWallet, subscribeWallets, type StellarMethod } from './wallets';
import { WalletDialog } from './WalletDialog';
import { lobstrOpenLink } from './wallet-protocol';
import { getBalance, quote, type Quote } from './quote';
import { attachHash, claim, newTransfer, quoteClaim, reconcile, submitSource, type ClaimQuote } from './engine';
import { canStartNew, clearTransfer, readTransfer, saveTransfer, STORAGE_KEY, withTransferLock, type Transfer } from './storage';

const short=(s:string)=>`${s.slice(0,6)}…${s.slice(-5)}`;
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
const stages=['Source transfer','Circle attestation','Destination delivery'];
function initialTransfer():{transfer:Transfer|null;error:string} {
  try{return {transfer:readTransfer(),error:''};}catch(e){return {transfer:null,error:errorText(e)};}
}
export function App() {
  const [initial]=useState(initialTransfer);
  const [transfer,setTransfer]=useState(initial.transfer);
  const [direction,setDirection]=useState<Direction>(initial.transfer?.direction??'stellar-base');
  const [stellar,setStellar]=useState('');const [base,setBase]=useState<Hex|''>('');
  const [amount,setAmount]=useState(initial.transfer?format(BigInt(initial.transfer.amount)):'');
  const [q,setQuote]=useState<Quote|null>(null);const [balance,setBalance]=useState<bigint|null>(null);
  const [error,setError]=useState(initial.error);const [checking,setChecking]=useState(false);
  const [busy,setBusy]=useState(false);const [walletBusy,setWalletBusy]=useState('');
  const [walletDialog,setWalletDialog]=useState<{chain:'stellar'|'base';uri:string}|null>(null);
  const [walletAction,setWalletAction]=useState<'stellar'|'base'|null>(null);
  const connectionAbort=useRef<AbortController|null>(null);
  const [review,setReview]=useState(false);const [claimQ,setClaimQuote]=useState<ClaimQuote|null>(null);
  const [hash,setHash]=useState('');const [refresh,setRefresh]=useState(0);
  const update=useCallback((t:Transfer)=>setTransfer({...t}),[]);
  const savedRef=useRef(transfer);savedRef.current=transfer;
  const refreshRef=useRef(0);
  const active=transfer&&!canStartNew(transfer);
  const locked=!!active&&transfer.stage!=='review';
  const outbound=direction==='stellar-base';
  const recipient=outbound?base:stellar;
  const quoteInput=transfer?.stage==='review'?{direction:transfer.direction,stellar:transfer.stellar,base:transfer.base,amount:BigInt(transfer.amount)}:
    (stellar&&base&&amount?{direction,stellar,base,amount:(()=>{try{return units(amount);}catch{return 0n;}})()}:null);

  useEffect(()=>{
    const changed=()=>{setQuote(null);setClaimQuote(null);setRefresh(v=>v+1);};
    const unsubscribe=subscribeWallets(event=>{
      if(event.action){setWalletAction(event.action==='signing'?event.chain:null);return;}
      if(event.address!==undefined){if(event.chain==='stellar')setStellar(event.address);else setBase(event.address as Hex|'');}
      changed();
    });
    const storage=(e:StorageEvent)=>{if(e.key===STORAGE_KEY){try{setTransfer(readTransfer());}catch(e){setError(errorText(e));}}};
    const focus=()=>changed();
    window.addEventListener('storage',storage);window.addEventListener('focus',focus);
    const timer=setInterval(changed,45000);
    return ()=>{unsubscribe();connectionAbort.current?.abort();window.removeEventListener('storage',storage);window.removeEventListener('focus',focus);clearInterval(timer);};
  },[]);
  useEffect(()=>{
    let alive=true;
    setQuote(null);setClaimQuote(null);
    if(locked||!stellar||!base||!amount||transfer?.auxiliary)return;
    const id=++refreshRef.current;
    const timer=setTimeout(async()=>{
      setChecking(true);setError('');
      try {
        units(amount);
        const result=await quote(quoteInput!);
        if(alive&&id===refreshRef.current){setQuote(result);setBalance(result.balance);}
      }catch(e){if(alive&&id===refreshRef.current)setError(errorText(e));}
      finally{if(alive&&id===refreshRef.current)setChecking(false);}
    },450);
    return ()=>{alive=false;clearTimeout(timer);};
  },[direction,stellar,base,amount,refresh,locked,transfer?.auxiliary,transfer?.stage]);
  useEffect(()=>{
    if(!transfer||canStartNew(transfer))return;
    let stopped=false,running=false;
    const poll=async()=>{
      if(stopped||running)return;running=true;
      try {await withTransferLock(async()=>{
        const latest=readTransfer();
        if(latest && !canStartNew(latest))await reconcile(latest,update);
      });}catch(e){if(!stopped)setError(errorText(e));}finally{running=false;}
    };
    const timer=setInterval(poll,7000);void poll();
    return ()=>{stopped=true;clearInterval(timer);};
  },[transfer?.id,transfer?.stage,update]);
  async function task(action:()=>Promise<void>) {
    setBusy(true);setError('');
    try {await withTransferLock(action);}catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function connect(which:'stellar'|'base',method:StellarMethod='walletconnect') {
    const controller=new AbortController();connectionAbort.current=controller;
    setWalletBusy(which);setError('');
    try {
      if(which==='stellar'){const a=await connectStellar(method,uri=>setWalletDialog({chain:'stellar',uri}),controller.signal);if(active&&a!==transfer.stellar)throw new Error(`Reconnect ${short(transfer.stellar)} to recover this transfer.`);setStellar(a);}
      else{const a=await connectBase(controller.signal);if(active&&a.toLowerCase()!==transfer.base.toLowerCase())throw new Error(`Reconnect ${short(transfer.base)} to recover this transfer.`);setBase(a);}
      setWalletDialog(null);
    }catch(e){if(!controller.signal.aborted)setError(errorText(e));setWalletDialog(d=>d?{...d,uri:''}:null);}
    finally{if(connectionAbort.current===controller){connectionAbort.current=null;setWalletBusy('');}}
  }
  function cancelConnection(){connectionAbort.current?.abort();setWalletDialog(null);setError('');}
  async function max() {
    if(!stellar||!base)return;setChecking(true);setError('');
    try{const b=await getBalance(direction,stellar,base);setBalance(b);setAmount(format(b));}catch(e){setError(errorText(e));}finally{setChecking(false);}
  }
  function reset() {
    try{clearTransfer();setTransfer(null);setQuote(null);setClaimQuote(null);setAmount('');setReview(false);setError('');setRefresh(v=>v+1);}catch(e){setError(errorText(e));}
  }
  async function prepareReview() {
    if(!q)return;
    await task(async()=>{
      const latest=await quote(q.input);setQuote(latest);setReview(true);
    });
  }
  async function confirm() {
    if(!q)return;
    await task(async()=>{
      const current=readTransfer();
      const t=current?.stage==='review'?current:newTransfer(q);
      if(current&&!canStartNew(current)&&current.stage!=='review')throw new Error('Recover the saved transfer first.');
      t.maxFee=q.fee.toString();saveTransfer(t);update(t);
      await submitSource(q,t,update);
      await reconcile(t,update);
      setQuote(null);setRefresh(v=>v+1);
      if(t.stage!=='review')setReview(false);
    });
  }
  async function prepareClaim() {
    if(!transfer)return;
    await task(async()=>{setClaimQuote(await quoteClaim(transfer));});
  }
  async function submitClaim() {
    if(!claimQ||!transfer)return;
    await task(async()=>{
      const latest=readTransfer();if(!latest||latest.id!==transfer.id)throw new Error('Transfer changed in another tab. Refresh its status.');
      const fresh=await quoteClaim(latest);
      if(fresh.cost>claimQ.cost){setClaimQuote(fresh);throw new Error('The claim fee increased. Review the updated estimate and confirm again.');}
      await claim(latest,fresh,update);setClaimQuote(null);await reconcile(latest,update);
    });
  }
  const walletRow=(chain:'stellar'|'base',role:string)=>{
    const address=chain==='stellar'?stellar:base;
    const expected=active?(chain==='stellar'?transfer.stellar:transfer.base):address;
    return <div className="wallet-row"><div className={`chain-icon ${chain}`} aria-hidden="true">{chain==='stellar'?'✦':'━'}</div><div className="wallet-info"><span className="eyebrow">{role}</span><strong>{chain==='stellar'?'Stellar':'Base'} <span className="network">Mainnet</span></strong></div><button className="wallet-button" onClick={()=>{setError('');setWalletDialog({chain,uri:''});}} disabled={!!walletBusy||busy}>{walletBusy===chain?'Connecting…':address?short(address):`Connect ${chain==='stellar'?'Stellar wallet':'Coinbase Wallet'}`}</button>{expected&&!address&&<span className="saved-address">Saved: {short(expected)}</span>}</div>;
  };
  const step=transfer?(transfer.stage==='complete'?3:['destination-ready','destination-pending'].includes(transfer.stage)?2:transfer.stage==='attestation'?1:0):0;
  return <main>
    <header className="top"><a href="/" className="brand"><span className="brand-icon" aria-hidden="true">↔</span>USDC Bridge</a><span className="top-note">Stellar <span>↔</span> Base</span></header>
    <section className="bridge" aria-labelledby="heading">
      <div className="card-heading"><div><span className="eyebrow">NATIVE USDC · CIRCLE CCTP</span><h1 id="heading">{transfer?.stage==='complete'?'Transfer complete':locked?'Your transfer':'Transfer USDC'}</h1></div><span className="live-badge">Mainnet</span></div>
      {transfer?.stage==='complete'?<div className="success"><div className="success-mark" aria-hidden="true">✓</div><p className="received">{format(BigInt(transfer.received!))} <span>USDC</span></p><p>Received on {transfer.direction==='stellar-base'?'Base':'Stellar'}</p><details><summary>Recipient</summary><code>{transfer.direction==='stellar-base'?transfer.base:transfer.stellar}</code></details><TransactionLinks transfer={transfer}/><button className="primary" onClick={reset}>New transfer</button></div>:
      <>
        <div className="route">{walletRow(outbound?'stellar':'base','FROM')}<div className="switch-line"><button className="direction-switch" aria-label="Switch transfer direction" disabled={!!active||busy} onClick={()=>{setDirection(outbound?'base-stellar':'stellar-base');setQuote(null);setBalance(null);setError('');}}>⇅</button></div>{walletRow(outbound?'base':'stellar','TO')}</div>
        {!locked&&<>
          <div className="amount-box"><div className="amount-top"><label htmlFor="amount">You send</label><span>{balance!==null?`${format(balance)} USDC available`:'Connect both wallets'}</span></div><div className="amount-entry"><input id="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" aria-describedby="amount-hint" value={amount} disabled={!!active||busy} onChange={e=>{setAmount(e.target.value);setQuote(null);}}/><span className="asset"><span className="usdc-icon" aria-hidden="true">$</span>USDC</span></div><div className="amount-bottom"><span id="amount-hint">Native USDC · up to 6 decimals</span><button className="text-button" onClick={max} disabled={!stellar||!base||!!active||busy}>Max</button></div></div>
          <div className="summary"><div><span>USDC fees <small>{outbound?'incl. forwarding':''}</small></span><b>{q?`${format(q.fee)} USDC`:'—'}</b></div><div className="receive-line"><span>You receive <small>estimated</small></span><b>{q?`${format(q.receive)} USDC`:'—'}</b></div><div className="gas"><span>{outbound?'Stellar':'Base'} network <small>{q?.action==='burn'?'transfer':q?.action??'estimate'}</small></span><span>{q?`≈ ${format(q.sourceCost,outbound?7:18)} ${outbound?'XLM':'ETH'}`:'—'}</span></div>{!outbound&&<div className="gas"><span>Stellar claim <small>estimated separately</small></span><span>{q?.destinationCost!=null?`≈ ${format(q.destinationCost,7)} XLM`:'Quoted when ready'}</span></div>}</div>
          {recipient&&<details className="destination"><summary>Receiving in {outbound?'Coinbase Wallet':'LOBSTR'} · {short(recipient)}</summary><code>{recipient}</code></details>}
          <p className="delivery">{outbound?'Standard transfer. Circle submits delivery on Base. A fallback claim may require Coinbase Wallet and ETH.':'Standard transfer. After attestation, claim in LOBSTR with a separate XLM network fee. Base finality can take around 15–20 minutes.'}</p>
          {transfer?.auxiliary?<p className="notice" role="status">{busy?'Confirm in your wallet, then wait for execution.':'Checking your approval or restoration…'}</p>:<button className="primary" disabled={!q||checking||busy||!!walletBusy||!!initial.error} onClick={prepareReview}>{busy?'Preparing…':checking?'Checking balances & fees…':'Transfer USDC'}</button>}
          {transfer?.stage==='review'&&!transfer.auxiliary&&<button className="text-button cancel-draft" onClick={reset} disabled={busy}>Cancel transfer</button>}
        </>}
        {locked&&transfer&&<div className="progress"><p className="progress-amount">{format(BigInt(transfer.amount))} <span>USDC</span></p><ol>{stages.map((s,i)=><li key={s} className={i<step?'done':i===step?'current':''}><span>{i<step?'✓':i+1}</span>{s}{i===step&&<small>{busy?'Wallet action in progress':transfer.stage==='destination-ready'?'Ready to claim':'In progress'}</small>}</li>)}</ol><p className="notice" role="status">{transfer.note??'Checking the saved transfer…'}</p><details className="destination"><summary>Full destination address</summary><code>{outbound?transfer.base:transfer.stellar}</code></details><TransactionLinks transfer={transfer}/>{transfer.stage==='destination-ready'&&!transfer.auxiliary&&<><button className="primary" onClick={prepareClaim} disabled={busy}>{busy?'Simulating claim…':outbound?'Prepare fallback claim':'Prepare Stellar claim'}</button>{claimQ&&<div className="claim-review"><p>Network estimate: <strong>{format(claimQ.cost,outbound?18:7)} {outbound?'ETH':'XLM'}</strong></p><p>{claimQ.restore?'Restore archived Stellar data first. Then simulate and confirm the claim.':`Confirm delivery of ${format(BigInt(transfer.received!))} USDC to the destination above.`}</p><button className="primary" onClick={submitClaim} disabled={busy}>{claimQ.restore?'Restore Stellar data':'Confirm claim'}</button></div>}</>}<button className="text-button refresh-button" onClick={()=>task(async()=>{const t=readTransfer();if(t)await reconcile(t,update);})} disabled={busy}>Refresh transfer status</button></div>}
        {transfer?.stage==='failed'&&<div className="notice"><p>{transfer.note}</p><TransactionLinks transfer={transfer}/><button className="text-button" onClick={reset}>New transfer</button></div>}
      </>}
      {error&&<div className="error" role="alert">{error}<button className="text-button" onClick={()=>{setError('');setRefresh(v=>v+1);}} disabled={busy}>Refresh checks</button></div>}
      {transfer&&((transfer.sourceRequest&&!transfer.sourceHash)||(transfer.destinationRequest&&!transfer.destinationHash)||(transfer.auxiliary?.request&&!transfer.auxiliary.hash))&&<div className="hash-recovery"><label htmlFor="hash">Recover the existing Base transaction</label><input id="hash" value={hash} onChange={e=>setHash(e.target.value)} placeholder="0x… transaction hash"/><button className="secondary" disabled={busy||!hash} onClick={()=>task(async()=>{const t=readTransfer();if(t)await attachHash(t,hash,update);})}>Check transaction</button></div>}
      <details className="setup"><summary>Wallet setup & transfer recovery</summary><p>On your phone, open this site inside Coinbase Wallet’s browser and connect Coinbase Wallet there. Connect your Stellar wallet with WalletConnect, tap Open LOBSTR, and return here after approval. Keep LOBSTR’s WalletConnect / Explore Apps screen open for signing requests. Desktop users can scan the QR code or use the <a href="https://lobstr.co/signer-extension/" target="_blank" rel="noreferrer">LOBSTR signer extension</a>.</p><p>Add Circle’s native USDC to LOBSTR and keep spendable XLM above the account reserve. Keep ETH on Base for source transactions or a fallback claim. Approvals and archived Stellar data can require additional wallet actions.</p><p>Your current transfer is saved in this browser. Reopen this same URL and reconnect the same accounts to recover it. After a burn, use the existing transfer’s claim. Keep this browser’s site data until delivery is verified.</p></details>
    </section>
    <footer><span>Native USDC only</span><a href="https://github.com/estevebadia/stellar-usdc-bridge" target="_blank" rel="noreferrer">Source & documentation</a></footer>
    {walletDialog&&<WalletDialog chain={walletDialog.chain} uri={walletDialog.uri} busy={!!walletBusy} error={error} canOpenBrowser={!active} connected={walletDialog.chain==='stellar'?!!stellar:!!base} onConnect={method=>connect(walletDialog.chain,method)} onCancel={cancelConnection} onDisconnect={()=>{void disconnectWallet(walletDialog.chain).catch(e=>setError(errorText(e)));setError('');}}/>}
    {walletAction==='stellar'&&<div className="wallet-action" role="status"><strong>Approve in your Stellar wallet</strong><p>In LOBSTR, open WalletConnect / Explore Apps to see this bridge’s request. Return to this browser afterwards.</p><a className="secondary" href={lobstrOpenLink}>Open LOBSTR</a></div>}
    {review&&q&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><span className="eyebrow">REVIEW BEFORE SIGNING</span><h2 id="review-title">{q.action==='approval'?'Approve native USDC':q.action==='restore'?'Restore Stellar data':'Confirm your transfer'}</h2><dl><div><dt>You send</dt><dd>{format(q.input.amount)} USDC</dd></div><div><dt>Maximum USDC fee</dt><dd>{format(q.fee)} USDC</dd></div><div><dt>Estimated received</dt><dd>{format(q.receive)} USDC</dd></div><div><dt>{outbound?'XLM':'ETH'} network estimate</dt><dd>{format(q.sourceCost,outbound?7:18)} {outbound?'XLM':'ETH'}</dd></div>{!outbound&&<div><dt>Stellar claim estimate</dt><dd>{q.destinationCost!==null?`${format(q.destinationCost,7)} XLM`:'Quoted after attestation'}</dd></div>}</dl><div className="review-address"><span>Destination · {outbound?'Base':'Stellar'} mainnet</span><code>{outbound?q.input.base:q.input.stellar}</code></div><p>{q.action==='approval'?'Approve only this transfer amount. The burn fee will be simulated and shown next, before a separate confirmation.':q.action==='restore'?'Archived contract data must be restored first. The burn will be simulated and reviewed afterwards.':outbound?'Circle forwarding will attempt delivery on Base. If needed, recover with a Coinbase Wallet claim and ETH.':'After Circle attestation, confirm a Stellar claim in LOBSTR. Its XLM fee is simulated before you sign.'}</p>{!outbound&&q.destinationCost===null&&<p>The claim estimate is currently unavailable. Keep spendable XLM in LOBSTR; additional funding may be needed to finish delivery.</p>}<button className="primary" disabled={busy||!!transfer?.auxiliary||q.expiresAt<Date.now()} onClick={confirm}>{busy?'Check your wallet…':q.action==='approval'?'Approve USDC':q.action==='restore'?'Restore data':'Transfer USDC'}</button><button className="secondary" onClick={()=>setReview(false)} disabled={busy}>Back</button>{error&&<p className="error" role="alert">{error}</p>}</section></div>}
  </main>;
}
function TransactionLinks({transfer:t}:{transfer:Transfer}) {
  return <div className="transaction-links">{(t.actions??[]).map(a=><a key={a.hash} href={a.chain==='base'?`https://basescan.org/tx/${a.hash}`:`https://stellar.expert/explorer/public/tx/${a.hash}`} target="_blank" rel="noreferrer">{a.label} transaction</a>)}{t.sourceHash&&<a href={txLink(t.direction,t.sourceHash)} target="_blank" rel="noreferrer">Source transaction · {short(t.sourceHash)}</a>}{t.destinationHash&&<a href={txLink(t.direction,t.destinationHash,true)} target="_blank" rel="noreferrer">Destination transaction · {short(t.destinationHash)}</a>}</div>;
}
