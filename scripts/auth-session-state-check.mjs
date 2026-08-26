import assert from 'node:assert/strict';
import {
  EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
  hasUsableAuthSession,
} from '../src/utils/authSession.ts';

assert.equal(
  hasUsableAuthSession({ user: { id: 'user-1' } }),
  false,
  'signup responses without access_token must not enter authenticated UI'
);

assert.equal(
  hasUsableAuthSession({ access_token: '', user: { id: 'user-1' } }),
  false,
  'empty access_token must not enter authenticated UI'
);

assert.equal(
  hasUsableAuthSession({ access_token: 'token', user: { id: 'user-1' } }),
  true,
  'access_token + user should be treated as an authenticated session'
);

assert.match(EMAIL_CONFIRMATION_REQUIRED_MESSAGE, /登录/);

console.log('auth-session-state-check passed');
