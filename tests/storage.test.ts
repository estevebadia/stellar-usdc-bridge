import { describe, expect, it } from 'vitest';
import { canStartNew, clearTransfer, readTransfer, saveTransfer, STORAGE_KEY } from '../src/storage';
import { transfer, message } from './message-fixture';
import { memoryStorage } from './memory-storage';
describe('interruption persistence',()=>{
  it.each(['source-signing','source-pending','attestation','destination-ready','destination-pending'] as const)('keeps a %s transfer through reload and prevents a fresh burn',stage=>{
    const storage=memoryStorage(),t={...transfer(),stage};saveTransfer(t,storage);
    const loaded=readTransfer(storage);expect(loaded).toEqual(t);expect(canStartNew(loaded)).toBe(false);
    expect(()=>clearTransfer(storage)).toThrow('Reconcile');
  });
  it('preserves message, attestation, signed XDR, and destination failure recovery',()=>{
    const storage=memoryStorage(),t={...transfer(),stage:'destination-ready' as const,message:message(transfer()),attestation:'0x1234' as const,sourceSignedXdr:'signed',note:'Claim failed. Recover.'};
    saveTransfer(t,storage);expect(readTransfer(storage)).toEqual(t);
  });
  it('allows a new transfer only after verified completion or a definitively failed burn',()=>{
    expect(canStartNew({...transfer(),stage:'complete'})).toBe(true);expect(canStartNew({...transfer(),stage:'failed'})).toBe(true);
  });
  it('fails closed when persistence cannot be verified',()=>{
    const storage=memoryStorage();storage.setItem=()=>{};
    expect(()=>saveTransfer(transfer(),storage)).toThrow('storage is unavailable');
  });
  it('preserves malformed saved data instead of clearing the transfer lock',()=>{
    const storage=memoryStorage();storage.setItem(STORAGE_KEY,'{"version":2}');
    expect(()=>readTransfer(storage)).toThrow();expect(storage.getItem(STORAGE_KEY)).toBe('{"version":2}');
  });
});
