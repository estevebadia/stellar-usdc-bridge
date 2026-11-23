import { xdr } from '@stellar/stellar-sdk';
import { expect, it } from 'vitest';

it('decodes the Protocol 30 ledger header that failed during fee checks', () => {
  // getLatestLedger on Stellar mainnet, ledger 65636550. scpValue.ext uses discriminant 3.
  const header = xdr.LedgerHeader.fromXdr(
    'AAAAHqNt7ypru4fbtAxHt1x7nKF71zkz1tf0tgOKvETWoy8bwvrlE70+MlQo7tyzxkC/LZg5BrxAV/h9V+JJ4889PwYAAAAAawSt/gAAAAAAAAADAAABogpHqM4AAAAA5Q+EiPNEM43PAE8yjG64qVbzPWGxhga4ts3RNPBkGagAAABA3NItBu+eGmp1tmXmygZDmgzGwGHqbY7CE7Ou86NrMdgRIN8MCihWqmW8Q4H8Z/emxTop+dFoGXsqmO6+a670Cztyduo+jFm15GvcIF4rzioERYed94MiDtW1JnB7EhNyyGMUXmkUfX2Ud2T32VxNGmtShH0/QBxWomzdPo8P6VoD6YjGDqIes+x5W2EAAGTWTzoiugAAARYAAAAAb00W4wAAAGQATEtAAAAD6MhjFF5pFH19lHdk99lcTRprUoR9P0AcVqJs3T6PD+la+U6Xx4BGt9kqo0rT9ZDK1O1Uc+F3EKCcpcyJxHiCRP9XN1BjG6+wzGG8/3nA73Xgq25hAUY9Ixd/bxZVyNSwm34Tx2EmkiOkdQW3vG3aDWviGzPDZNvk37cyFbMqTL+xAAAAAA==',
    'base64',
  );
  expect(header.ledgerSeq).toBe(65636550);
  expect(header.scpValue.ext.type).toBe('stellarValueSignedMs');
});
