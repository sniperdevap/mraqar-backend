import assert from 'assert';
import { formatAmount, generateTrackId, safeUrl, sanitizeRef, summarize } from './knet.service';
import { redactUrl } from '../../middlewares/request-logger';

assert.strictEqual(formatAmount(1.5), '1.500');
assert.strictEqual(formatAmount(30), '30.000');
assert.strictEqual(formatAmount(0.25), '0.250');
assert.strictEqual(formatAmount(1.5 * 3), '4.500');

const ids = Array.from({ length: 5000 }, generateTrackId);
for (const id of ids) {
    assert.match(id, /^[A-Z0-9]{1,30}$/, `track id must be alphanumeric and <=30 chars, got "${id}"`);
}
assert.strictEqual(new Set(ids).size, ids.length, 'track ids must be unique');

assert.strictEqual(sanitizeRef('Office plan #1 (30 KWD)'), 'Office plan 1 30 KWD');
assert.strictEqual(sanitizeRef('AB&cd-1.23'), 'AB&cd-1.23');
assert.strictEqual(sanitizeRef('خطة المكتب'), 'خطة المكتب');
assert.ok(sanitizeRef('x'.repeat(60)).length <= 30);

// A logged URL must never carry the access token.
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-access-token';
for (const url of [
    `https://pgtest.cbk.com/ePay/api/cbk/online/pg/GetTransactions/ENCRP123/${TOKEN}`,
    `https://pgtest.cbk.com/ePay/pg/epay?_v=${TOKEN}`,
    `https://pgtest.cbk.com/ePay/pg/epay?a=1&_v=${TOKEN}&b=2`
]) {
    assert.ok(!safeUrl(url).includes(TOKEN), `token leaked into log for ${url}`);
}
assert.match(safeUrl('https://pgtest.cbk.com/ePay/api/cbk/online/pg/GetTransactions/ENCRP123/tok'), /GetTransactions\/ENCRP123\/<token>$/);
assert.strictEqual(safeUrl('https://pgtest.cbk.com/ePay/api/cbk/online/pg/merchant/Authenticate'), 'https://pgtest.cbk.com/ePay/api/cbk/online/pg/merchant/Authenticate');
assert.strictEqual(safeUrl(), '');

// A logged response body must carry the codes and nothing else.
assert.strictEqual(summarize({ Status: '1', Message: 'Success', AccessToken: TOKEN }), 'Status=1 Message=Success');
assert.strictEqual(summarize({ Status: '2', Message: 'Failed', PayId: 'BG1', Amount: '30.000' }), 'Status=2 Message=Failed PayId=BG1 Amount=30.000');
assert.strictEqual(summarize({ AccessToken: TOKEN }), 'body=<no status fields>');
assert.strictEqual(summarize(undefined), 'body=<undefined>');
assert.ok(!summarize({ Status: '1', AccessToken: TOKEN, ENCRP_KEY: 'k' }).includes(TOKEN), 'token leaked into log');

// The request logger must not undo what payment.controller is careful about.
assert.strictEqual(redactUrl('/api/v1/payments/callback?encrp=ABC123'), '/api/v1/payments/callback?encrp=<redacted>');
assert.strictEqual(redactUrl('/mock-knet/ePay/pg/epay?_v=tok&x=1'), '/mock-knet/ePay/pg/epay?_v=<redacted>&x=1');
assert.strictEqual(redactUrl('/api/v1/payments/callback?ErrorCode=TIJ0020&PayTrackID=MA1'), '/api/v1/payments/callback?ErrorCode=TIJ0020&PayTrackID=MA1');

console.log('knet.check: all assertions passed');
