import assert from 'assert';
import { statusFor } from './payment.service';
import { generateTrackId, isSuccessful, MfInvoice, MfTransaction } from './myfatoorah.service';
import { PaymentStatus } from './models/payment.model';

const inv = (InvoiceStatus: string, ...txns: string[]): MfInvoice => ({
    InvoiceId: 1,
    InvoiceStatus,
    InvoiceValue: 1,
    InvoiceTransactions: txns.map((TransactionStatus) => ({ TransactionStatus }))
});
const txn = (TransactionStatus: string): MfTransaction => ({ TransactionStatus });

assert.strictEqual(statusFor(inv('Paid', 'Succss')), PaymentStatus.PAID);
assert.strictEqual(statusFor(inv('Canceled')), PaymentStatus.CANCELLED);
assert.strictEqual(statusFor(inv('Pending')), null);
assert.strictEqual(statusFor(inv('Pending', 'InProgress'), txn('InProgress')), null);
assert.strictEqual(statusFor(inv('Pending', 'Failed'), txn('Failed')), PaymentStatus.FAILED);
assert.strictEqual(statusFor(inv('Paid', 'Failed', 'Succss'), txn('Failed')), PaymentStatus.PAID);
assert.strictEqual(statusFor(inv('Pending', 'Failed')), null);

assert.ok(isSuccessful(txn('Succss')) && isSuccessful(txn('Success')) && !isSuccessful(txn('Failed')));

const ids = Array.from({ length: 5000 }, generateTrackId);
for (const id of ids) assert.match(id, /^[A-Z0-9]{1,30}$/);
assert.strictEqual(new Set(ids).size, ids.length, 'track ids must be unique');

console.log('payment.check: all assertions passed');
process.exit(0);
