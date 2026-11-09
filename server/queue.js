// 排队调度器
// 规则：每 windowSec 秒最多放行 quota 人；窗口内的放行也按先来后到逐个进行，
// 相邻两次放行至少间隔 windowSec / quota 秒（匀速放行，不会在窗口开头一次性放完）。
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const STALE_MS = 15_000; // 排队者超过这么久没有轮询，视为已离开
const SWEEP_MS = 2_000;
const LOG_SIZE = 100;

const newId = () => crypto.randomBytes(16).toString('base64url');

export class ImageQueue extends EventEmitter {
  /** @param {{ getSettings: () => object }} opts */
  constructor({ getSettings }) {
    super();
    this.getSettings = getSettings;
    this.entries = new Map(); // id -> entry
    this.ipCounts = new Map(); // ip -> 该 IP 当前的记录数（排队中 + 待领取）
    this.waiting = []; // 等待中的 id，按入队顺序
    this.tickets = new Map(); // ticket -> entry id
    this.lastGrantAt = -Infinity;
    this.timer = null;
    this.positionCache = null; // id -> 下标，队列变动时失效
    this.stats = { joined: 0, granted: 0, served: 0, expired: 0, abandoned: 0, kicked: 0, startedAt: Date.now() };
    this.log = []; // 最近放行记录
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref?.();
  }

  get intervalMs() {
    const { windowSec, quota } = this.getSettings();
    return (windowSec * 1000) / quota;
  }

  /** 距离下一次可放行的毫秒数（0 表示现在就可以） */
  nextSlotInMs(now = Date.now()) {
    return Math.max(0, this.lastGrantAt + this.intervalMs - now);
  }

  countByIp(ip) {
    return this.ipCounts.get(ip) || 0;
  }

  join(ip) {
    const s = this.getSettings();
    if (s.paused) return { error: '当前已暂停发放，请稍后再来', code: 'paused' };
    if (this.waiting.length >= s.maxQueue) return { error: '队列已满，请稍后再试', code: 'full' };
    if (this.countByIp(ip) >= s.maxPerIp) return { error: '你所在的网络排队人数已达上限', code: 'ip_limit' };

    const now = Date.now();
    const entry = { id: newId(), ip, status: 'waiting', joinedAt: now, lastSeen: now };
    this.entries.set(entry.id, entry);
    this.ipCounts.set(ip, this.countByIp(ip) + 1);
    this.waiting.push(entry.id);
    this.positionCache = null;
    this.stats.joined++;
    this.pump();
    return { entry };
  }

  position(id) {
    if (!this.positionCache) this.positionCache = new Map(this.waiting.map((v, i) => [v, i]));
    return this.positionCache.get(id);
  }

  /** 访客轮询：刷新心跳并返回当前状态 */
  status(id) {
    const entry = this.entries.get(id);
    if (!entry) return { status: 'gone' };
    const now = Date.now();
    entry.lastSeen = now;

    if (entry.status === 'granted') {
      return { status: 'granted', ticket: entry.ticket, expiresInMs: Math.max(0, entry.expiresAt - now) };
    }
    const idx = this.position(id);
    const paused = this.getSettings().paused;
    return {
      status: 'waiting',
      position: idx + 1,
      queueLength: this.waiting.length,
      paused,
      etaMs: paused ? null : Math.round(this.nextSlotInMs(now) + idx * this.intervalMs),
    };
  }

  /**
   * 删除一条记录的索引与计数，但不碰 waiting 数组、也不触发调度。
   * 批量删除时由调用方统一处理 waiting 并只调度一次，避免递归和 O(n²)。
   */
  drop(entry, reason) {
    this.entries.delete(entry.id);
    if (entry.ticket) this.tickets.delete(entry.ticket);
    const n = this.countByIp(entry.ip) - 1;
    if (n > 0) this.ipCounts.set(entry.ip, n);
    else this.ipCounts.delete(entry.ip);
    if (reason && reason in this.stats) this.stats[reason]++;
  }

  remove(id, reason) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.drop(entry, reason);
    if (entry.status === 'waiting') {
      const i = this.position(id);
      if (i !== undefined) this.waiting.splice(i, 1);
      this.positionCache = null;
    }
    this.pump();
    return true;
  }

  /** 用凭证换取图片；凭证一次性有效 */
  consumeTicket(ticket) {
    const id = this.tickets.get(ticket);
    const entry = id && this.entries.get(id);
    if (!entry || entry.expiresAt <= Date.now()) return false;
    const rec = this.log.find((r) => r.id === entry.id);
    if (rec) rec.served = true;
    this.remove(entry.id, 'served');
    return true;
  }

  grant(entry, now) {
    const { ticketTtlSec } = this.getSettings();
    entry.status = 'granted';
    entry.ticket = newId();
    entry.grantedAt = now;
    entry.expiresAt = now + ticketTtlSec * 1000;
    this.tickets.set(entry.ticket, entry.id);
    this.lastGrantAt = now;
    this.stats.granted++;
    this.log.unshift({ id: entry.id, ip: entry.ip, at: now, waitedMs: now - entry.joinedAt, served: false });
    if (this.log.length > LOG_SIZE) this.log.length = LOG_SIZE;
    this.emit('grant', entry);
  }

  /**
   * 尝试放行队首；没到时间就定时到下一个放行点再来。
   * 纯循环实现，不会与 remove() 互相递归，队首有再多离线者也不会栈溢出。
   */
  pump() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.getSettings().paused) return;

    const now = Date.now();
    while (this.waiting.length) {
      // 已离开的队首直接跳过，不占用名额；连续的离线者一次性切掉
      let skip = 0;
      while (skip < this.waiting.length) {
        const e = this.entries.get(this.waiting[skip]);
        if (now - e.lastSeen <= STALE_MS) break;
        this.drop(e, 'abandoned');
        skip++;
      }
      if (skip) {
        this.waiting.splice(0, skip);
        this.positionCache = null;
        continue;
      }
      const wait = this.nextSlotInMs(now);
      if (wait > 0) {
        this.timer = setTimeout(() => this.pump(), Math.ceil(wait));
        return;
      }
      const head = this.entries.get(this.waiting.shift());
      this.positionCache = null;
      this.grant(head, now);
    }
  }

  /** 定期清理：离线的排队者、过期未领取的凭证。整体 O(n)，最后只调度一次 */
  sweep() {
    const now = Date.now();
    for (const e of this.entries.values()) {
      if (e.status === 'granted' && e.expiresAt <= now) this.drop(e, 'expired');
    }
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((id) => {
      const e = this.entries.get(id);
      if (now - e.lastSeen <= STALE_MS) return true;
      this.drop(e, 'abandoned');
      return false;
    });
    if (this.waiting.length !== before) this.positionCache = null;
    this.pump();
  }

  clearWaiting() {
    const n = this.waiting.length;
    for (const id of this.waiting) this.drop(this.entries.get(id), 'kicked');
    this.waiting = [];
    this.positionCache = null;
    this.pump();
    return n;
  }

  /** 控制台使用的快照 */
  snapshot({ limit = 200 } = {}) {
    const now = Date.now();
    const s = this.getSettings();
    const granted = [...this.entries.values()].filter((e) => e.status === 'granted');
    return {
      now,
      intervalMs: this.intervalMs,
      nextSlotInMs: s.paused ? null : this.nextSlotInMs(now),
      queueLength: this.waiting.length,
      waiting: this.waiting.slice(0, limit).map((id, i) => {
        const e = this.entries.get(id);
        return { id: e.id, ip: e.ip, position: i + 1, joinedAt: e.joinedAt, lastSeen: e.lastSeen };
      }),
      granted: granted.map((e) => ({ id: e.id, ip: e.ip, grantedAt: e.grantedAt, expiresAt: e.expiresAt })),
      stats: this.stats,
      log: this.log.slice(0, 50),
    };
  }

  close() {
    clearTimeout(this.timer);
    clearInterval(this.sweeper);
  }
}
