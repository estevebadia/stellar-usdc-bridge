import type { SessionTypes } from '@walletconnect/types';
import { G } from './message-fixture';
export function walletSession(account=G):SessionTypes.Struct {
  return {topic:'session-topic',expiry:Math.floor(Date.now()/1000)+3600,
    namespaces:{stellar:{accounts:[`stellar:pubnet:${account}`],methods:['stellar_signXDR'],events:[]}}} as unknown as SessionTypes.Struct;
}
