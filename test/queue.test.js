import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImageQueue } from '../server/queue.js';

function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const settings = { windowSec: 10, quota: 5, ticketTtlSec: 30, maxQueue: 100, maxPerIp: 100, paused: false, ...overrides };
  const q = new ImageQueue({ getSettings: () => settings });
  const grants = [];
  q.on('grant', (e) => grants.push({ id: e.id, at: Date.now() }));
  return { q, settings, grants };
}

// 每个排队者都在轮询，避免被当作离开
const keepAlive = (q, ids) => ids.forEach((id) => q.status(id));

test('窗口内按固定间隔逐个放行，先来先得', (t) => {
  const { q, grants } = setup(t); // 10 秒 5 人 => 每 2 秒 1 人
  const ids = Array.from({ length: 7 }, (_, i) => q.join(`ip${i}`).entry.id);

  assert.equal(grants.length, 1, '第一个人立即放行');
  for (let i = 0; i < 12; i++) {
    t.mock.timers.tick(1000);
    keepAlive(q, ids);
  }
  assert.deepEqual(grants.map((g) => g.id), ids.slice(0, 7));
  const gaps = grants.slice(1).map((g, i) => g.at - grants[i].at);
  assert.ok(gaps.every((g) => g === 2000), `间隔应为 2000ms，实际 ${gaps}`);

  // 任意 10 秒窗口（左闭右开）内不超过 5 人
  for (const g of grants) {
    const inWindow = grants.filter((x) => x.at >= g.at && x.at < g.at + 10_000).length;
    assert.ok(inWindow <= 5);
  }
  q.close();
});

test('位次与预计等待时间', (t) => {
  const { q } = setup(t);
  const a = q.join('a').entry.id; // 立即放行
  const b = q.join('b').entry.id;
  const c = q.join('c').entry.id;
  assert.equal(q.status(a).status, 'granted');
  assert.deepEqual([q.status(b).position, q.status(c).position], [1, 2]);
  assert.equal(q.status(b).etaMs, 2000);
  assert.equal(q.status(c).etaMs, 4000);
  q.close();
});

test('凭证一次性有效，过期作废', (t) => {
  const { q } = setup(t, { ticketTtlSec: 5 });
  const a = q.join('a').entry.id;
  const { ticket } = q.status(a);
  assert.equal(q.consumeTicket(ticket), true);
  assert.equal(q.consumeTicket(ticket), false);

  t.mock.timers.tick(2000);
  const b = q.join('b').entry.id;
  const t2 = q.status(b).ticket;
  t.mock.timers.tick(6000);
  assert.equal(q.consumeTicket(t2), false);
  q.close();
});

test('长时间不轮询的排队者被移出，不占用名额', (t) => {
  const { q, grants } = setup(t, { windowSec: 60, quota: 2 }); // 每 30 秒 1 人
  q.join('a');
  const gone = q.join('b').entry.id;
  const alive = q.join('c').entry.id;
  for (let i = 0; i < 40; i++) {
    t.mock.timers.tick(1000);
    q.status(alive);
  }
  assert.equal(q.status(gone).status, 'gone');
  assert.ok(grants.some((g) => g.id === alive));
  assert.ok(!grants.some((g) => g.id === gone));
  q.close();
});

test('暂停、队列上限、每 IP 上限', (t) => {
  const { q, settings } = setup(t, { maxQueue: 2, maxPerIp: 2 });
  q.join('x'); // 立即放行，不计入等待队列
  q.join('y');
  q.join('z');
  assert.equal(q.join('w').code, 'full');
  settings.maxQueue = 100;
  assert.equal(q.join('y').code === undefined, true);
  assert.equal(q.join('y').code, 'ip_limit');
  settings.paused = true;
  assert.equal(q.join('n').code, 'paused');
  q.close();
});
