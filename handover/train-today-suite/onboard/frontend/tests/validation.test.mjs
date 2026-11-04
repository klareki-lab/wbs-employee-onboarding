import test from 'node:test';
import assert from 'node:assert/strict';
import { validIsoDate, validateEmployee, validUsername, validateActivation } from '../src/lib/validation.ts';

const good = {
  first_name: ' Anna ', last_name: ' Müller ', personal_email: 'anna@example.org',
  department: 'IT', role: 'UX Designerin', start_date: '2026-11-02',
};
test('accepts a valid onboarding form', () => assert.deepEqual(validateEmployee(good), {}));
test('reports all six missing required fields', () => assert.equal(Object.keys(validateEmployee(Object.fromEntries(Object.keys(good).map(k => [k, ''])))).length, 6));
test('rejects invalid email', () => assert.ok(validateEmployee({ ...good, personal_email: 'a@' }).personal_email));
test('rejects impossible leap days', () => { assert.equal(validIsoDate('2026-02-29'), false); assert.equal(validIsoDate('2028-02-29'), true); });
test('rejects invalid calendar dates', () => { for (const value of ['2026-13-01','2026-04-31','2026-1-1','0000-01-01']) assert.equal(validIsoDate(value), false); });
test('validates usernames without whitespace', () => { assert.equal(validUsername('anna.mueller'), true); assert.equal(validUsername('two words'), false); assert.equal(validUsername('ab'), false); });
test('rejects too-short activation password', () => assert.ok(validateActivation('anna', '12345', '12345').password));
test('rejects mismatching passwords', () => assert.ok(validateActivation('anna', 'a'.repeat(12), 'b'.repeat(12)).confirmation));
test('accepts matching long activation credentials', () => assert.deepEqual(validateActivation('anna.mueller', 'a'.repeat(12), 'a'.repeat(12)), {}));

test('backend username policy: lowercase 3 to 64 characters and valid first character', () => {
  assert.equal(validUsername('a' + 'b'.repeat(63)), true);
  for (const name of ['.anna', '-anna', '_anna', 'Anna', 'a' + 'b'.repeat(64), 'äbc']) assert.equal(validUsername(name), false);
});
test('password longer than 128 rejected', () => assert.ok(validateActivation('anna', 'a'.repeat(129), 'a'.repeat(129)).password));
