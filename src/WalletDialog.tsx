import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { coinbaseBrowserLink, lobstrConnectionLink } from './wallet-protocol';
import { injectedCoinbase, type StellarMethod } from './wallets';
import { walletConnectConfigured } from './stellar-walletconnect';

export function WalletDialog({chain,uri,busy,error,connected,canOpenBrowser,onConnect,onCancel,onDisconnect}:{
  chain:'stellar'|'base';uri:string;busy:boolean;error:string;connected:boolean;canOpenBrowser:boolean;
  onConnect:(method:StellarMethod)=>void;onCancel:()=>void;onDisconnect:()=>void;
}) {
  const [qr,setQr]=useState('');const [copied,setCopied]=useState(false);
  const close=useRef<HTMLButtonElement>(null);
  const injected=chain==='base'&&!!injectedCoinbase();
  useEffect(()=>{let alive=true;setQr('');setCopied(false);
    if(uri)void QRCode.toDataURL(uri,{width:280,margin:2,errorCorrectionLevel:'M'}).then(q=>{if(alive)setQr(q);});
    return()=>{alive=false;};},[uri]);
  useEffect(()=>{close.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onCancel();};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
  return <div className="modal-backdrop wallet-dialog"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
    <span className="eyebrow">CONNECT YOUR WALLET</span><h2 id="wallet-title">{chain==='stellar'?'Stellar wallet':'Coinbase Wallet'}</h2>
    {chain==='stellar'?<>
      {uri?<><p>Scan this code in LOBSTR’s WalletConnect screen, or tap Open LOBSTR on this phone. Approve the connection, then return here.</p>
        {qr&&<img className="wallet-qr" src={qr} alt="WalletConnect pairing QR code"/>}
        <a className="primary wallet-link" href={lobstrConnectionLink(uri)}>Open LOBSTR</a>
        <button className="secondary" onClick={()=>{void navigator.clipboard.writeText(uri).then(()=>setCopied(true)).catch(()=>setCopied(false));}}>{copied?'Connection link copied':'Copy connection link'}</button>
        <p role="status">Waiting for approval in your wallet…</p></>:
      <><p>Connect LOBSTR on your phone with WalletConnect. Signing stays in your wallet; the app submits the signed transaction.</p>
        <button className="primary" disabled={busy||!walletConnectConfigured} onClick={()=>onConnect('walletconnect')}>{busy?'Preparing connection…':'WalletConnect · phone or QR'}</button>
        {!walletConnectConfigured&&<p>Mobile connection is awaiting the site owner’s setup.</p>}
        <button className="secondary" disabled={busy} onClick={()=>onConnect('extension')}>LOBSTR signer · desktop extension</button></>}
    </>:<>
      <p>{injected?'You’re in the wallet browser or using its extension. Approve access to your existing Base account.':'On your phone, open this bridge in Coinbase Wallet’s browser first. Then connect both wallets from there.'}</p>
      {!injected&&canOpenBrowser&&<><a className="primary wallet-link" href={coinbaseBrowserLink(window.location.origin)}>Open in Coinbase Wallet</a><a className="secondary wallet-link" href={coinbaseBrowserLink(window.location.origin,true)}>Try the universal link</a></>}
      {!injected&&!canOpenBrowser&&<p>Your saved transfer belongs to this browser. Recover it here; opening another browser will not copy its saved state.</p>}
      <button className={injected?'primary':'secondary'} disabled={busy} onClick={()=>onConnect('extension')}>{busy?'Approve in Coinbase Wallet…':injected?'Connect this Coinbase Wallet':'Connect here · extension or desktop QR'}</button>
      {busy&&<p role="status">If no request appears, cancel below, disconnect this site in Coinbase Wallet, and reconnect.</p>}
    </>}
    {error&&<p className="error" role="alert">{error}</p>}
    {connected&&!busy&&<button className="secondary" onClick={onDisconnect}>Disconnect wallet</button>}
    <button ref={close} className="secondary" onClick={onCancel}>{busy?'Cancel connection':'Close'}</button>
  </section></div>;
}
