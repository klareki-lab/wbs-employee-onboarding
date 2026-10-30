import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingLabels, processingLabels, invitationLabels, deliveryLabels, mayApprove, maySendInvitation, hasHrApproval, isProcessing } from '../src/lib/status.ts';
const statuses = ['pending', 'approved', 'active'];
const processing = ['unavailable','queued','dispatching','awaiting_result','completed','failed'];
test('all backend employee states have German labels', () => assert.ok(statuses.every(s => typeof onboardingLabels[s] === 'string')));
test('all backend processing states have German labels', () => assert.deepEqual(Object.keys(processingLabels).sort(), processing.sort()));
test('all invitation and delivery states have labels', () => { assert.equal(Object.keys(invitationLabels).length, 5); assert.equal(Object.keys(deliveryLabels).length, 4); });
test('approval only possible after completed onboarding on pending employee', () => {
  for (const status of statuses) for (const job of processing) assert.equal(mayApprove(status, job), status === 'pending' && job === 'completed');
});
test('invitation sending requires approved employee', () => { for (const status of statuses) assert.equal(maySendInvitation(status), status === 'approved'); });
test('approved and active employees have HR approval', () => {
  assert.equal(hasHrApproval('pending'), false); assert.equal(hasHrApproval('approved'), true); assert.equal(hasHrApproval('active'), true);
});

test('processing polls automatically and terminal phases remain explicit and gated', () => {
  for (const phase of processing) {
    assert.equal(isProcessing(phase), ['queued','dispatching','awaiting_result'].includes(phase));
    assert.equal(mayApprove('pending',phase), phase === 'completed');
  }
  assert.equal(isProcessing(undefined),false);
});
