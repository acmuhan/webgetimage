import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../server/ratelimit.js';
import { createCap } from '../server/cap.js';
import { validateSettings } from '../server/store.js';

// 最小的 req/res 替身，记录状态码与响应头
function call(mw, ip) {
  const res = {
    statusCode: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json() { return this; },
  };
  let passed = false;
  mw({ ip }, res, () => { passed = true; });
  return { passed, res };
}

test('限速：超出上限返回 429 与 Retry-After，窗口过后恢复', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 });
  const mw = rateLimit({ windowMs: 60_000, max: 3 });
  for (let i = 0; i < 3; i++) assert.equal(call(mw, 'a').passed, true);
  const blocked = call(mw, 'a');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.headers['Retry-After'], '60');

  assert.equal(call(mw, 'b').passed, true, '不同 IP 互不影响');

  t.mock.timers.tick(60_000);
  assert.equal(call(mw, 'a').passed, true, '窗口过后恢复');
  mw.close();
});

test('Cap：待解挑战数量有上限，满了返回 null', async () => {
  const cap = createCap({ maxChallenges: 5 });
  for (let i = 0; i < 5; i++) assert.ok(await cap.createChallenge(1));
  assert.equal(await cap.createChallenge(1), null);
  assert.equal(cap.stats().pendingChallenges, 5);
});

test('设置校验：拒绝原型链上的键名', () => {
  for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    const r = validateSettings(JSON.parse(`{"${key}": 1}`));
    assert.ok(r.error, `${key} 应被拒绝`);
  }
  assert.deepEqual(validateSettings({ quota: 3 }).value, { quota: 3 });
});
