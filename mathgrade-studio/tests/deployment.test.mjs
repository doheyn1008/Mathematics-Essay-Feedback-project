import test from 'node:test';
import assert from 'node:assert/strict';
import { readDeploymentTarget } from '../scripts/deployment-target.mjs';
import { standaloneRequest } from '../lib/worker-ingress.mjs';

test('clean checkouts build Cloudflare and Sites requires explicit selection', () => {
  assert.equal(readDeploymentTarget({}), 'cloudflare');
  assert.equal(readDeploymentTarget({ MATHGRADE_DEPLOYMENT_TARGET: 'sites' }), 'sites');
  assert.throws(() => readDeploymentTarget({ MATHGRADE_DEPLOYMENT_TARGET: 'typo' }));
});

test('public ingress removes every asserted Sites identity and retains app session and body', async () => {
  const request = new Request('https://example.test/api/product/auth/login', {
    method: 'POST',
    headers: {
      'OAI-Authenticated-User-Id': 'forged-owner',
      'oai-authenticated-user-email': 'owner@example.test',
      'oai-authenticated-user-custom': 'forged-attribute',
      cookie: 'mg_session=valid-session', origin: 'https://example.test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username: 'member' }),
  });
  const cleaned = standaloneRequest(request);
  assert.equal([...cleaned.headers.keys()].some(key => key.startsWith('oai-authenticated-user-')), false);
  assert.equal(cleaned.headers.get('cookie'), 'mg_session=valid-session');
  assert.equal(cleaned.headers.get('origin'), 'https://example.test');
  assert.deepEqual(await cleaned.json(), { username: 'member' });
});
