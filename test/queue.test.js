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

test('队首大量离线者不会栈溢出，清理为线性时间', (t) => {
  // 修复前：pump() 与 remove() 互相递归，约 4000 个连续离线者就会栈溢出并让进程退出
  const { q, grants } = setup(t, { windowSec: 3600, quota: 1, maxQueue: 1e6, maxPerIp: 1e6 });
  q.join('first'); // 立即放行，之后 1 小时内不会再放行
  const n = 50_000;
  for (let i = 0; i < n; i++) q.join(`ip${i % 100}`);
  const alive = q.join('alive').entry.id;

  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(1000);
    q.status(alive); // 只有最后一人保持在线
  }
  assert.equal(q.waiting.length, 1, '离线者全部被清理');
  assert.equal(q.status(alive).position, 1);
  assert.equal(q.stats.abandoned, n);
  assert.equal(q.ipCounts.size, 2, '每 IP 计数随清理一起释放（剩 first 与 alive）');
  assert.equal(grants.length, 1);

  // 到下一个放行点时，alive 前面没有残留的离线者，直接被放行
  for (let i = 20; i < 3600; i++) {
    t.mock.timers.tick(1000);
    q.status(alive);
  }
  assert.equal(grants.length, 2);
  assert.equal(grants[1].id, alive);
  q.close();
});

test('放行时一次跳过连续多个离线的队首', (t) => {
  const { q, grants } = setup(t, { windowSec: 10, quota: 1, maxQueue: 1e6, maxPerIp: 1e6 }); // 每 10 秒 1 人
  q.join('first');
  for (let i = 0; i < 10_000; i++) q.join('gone');
  const alive = q.join('alive').entry.id;
  // 关掉定时清理，只测 pump() 自己跳过离线队首的逻辑
  clearInterval(q.sweeper);
  for (let i = 0; i < 25; i++) {
    t.mock.timers.tick(1000);
    q.status(alive); // 只有 alive 在轮询
  }
  // 第 10 秒：离线者才离开 10 秒（未超过 15 秒），放行第一个 gone
  // 第 20 秒：其余 9999 个 gone 都已超时，被一次性跳过，放行 alive
  assert.equal(grants.length, 3);
  assert.equal(grants[2].id, alive);
  assert.equal(grants[2].at - grants[1].at, 10_000);
  assert.equal(q.stats.abandoned, 9_999);
  q.close();
});

test('每 IP 计数：领取、过期、移出后都会释放名额', (t) => {
  const { q } = setup(t, { maxPerIp: 2, ticketTtlSec: 5 });
  const a = q.join('x').entry.id; // 立即放行
  q.join('x');
  assert.equal(q.join('x').code, 'ip_limit');

  assert.equal(q.consumeTicket(q.status(a).ticket), true); // 领取后释放 1 个
  const c = q.join('x').entry.id;
  assert.equal(q.join('x').code, 'ip_limit');

  q.remove(c, 'kicked');
  assert.equal(q.countByIp('x'), 1);
  q.clearWaiting();
  assert.equal(q.countByIp('x'), 0);
  assert.equal(q.ipCounts.has('x'), false, '计数归零后删除键，不留垃圾');
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
