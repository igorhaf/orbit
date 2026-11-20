import assert from 'node:assert/strict';
import test from 'node:test';
import { permissionForRoute } from './privileges';

test('MFA self-service routes do not require a global account permission', () => {
  assert.equal(permissionForRoute('/account/mfa', 'GET'), null);
  assert.equal(permissionForRoute('/account/mfa/challenge', 'POST'), null);
  assert.equal(permissionForRoute('/account/mfa/confirm', 'POST'), null);
});

test('MFA routes outside the self-service contract retain account authorization', () => {
  assert.equal(permissionForRoute('/account/mfa', 'POST'), 'account.write');
  assert.equal(permissionForRoute('/account/mfa/challenge', 'GET'), 'account.read');
  assert.equal(permissionForRoute('/account/mfa/admin', 'POST'), 'account.write');
});

test('email change request is self-service and token completion does not require a global RBAC privilege', () => {
  assert.equal(permissionForRoute('/auth/email-change', 'POST'), null);
  assert.equal(permissionForRoute('/auth/email-change/complete', 'POST'), null);
  assert.equal(permissionForRoute('/auth/email-change', 'GET'), 'root.only');
});
