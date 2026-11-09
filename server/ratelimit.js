// 按 IP 的固定窗口限速（单实例内存实现）
// 超限返回 429 并带 Retry-After；记录表定期清理，且有总量上限，防止被大量 IP 撑爆内存。

const MAX_KEYS = 100_000;

/**
 * @param {{ windowMs: number, max: number, message?: string }} opts
 * @returns Express 中间件，额外带 close() 用于停止清理定时器
 */
export function rateLimit({ windowMs, max, message = '请求过于频繁，请稍后再试' }) {
  const hits = new Map(); // ip -> { count, resetAt }

  const prune = () => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  };
  const timer = setInterval(prune, Math.max(windowMs, 10_000));
  timer.unref?.();

  function middleware(req, res, next) {
    const now = Date.now();
    const key = req.ip || 'unknown';
    let h = hits.get(key);
    if (!h || h.resetAt <= now) {
      if (!h && hits.size >= MAX_KEYS) {
        prune();
        // 清理后仍然满：说明短时间内来自海量不同 IP，直接拒绝新 IP，保护内存
        if (hits.size >= MAX_KEYS) {
          res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
          return res.status(429).json({ error: message, code: 'rate_limited' });
        }
      }
      h = { count: 0, resetAt: now + windowMs };
      hits.set(key, h);
    }
    h.count++;
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
      return res.status(429).json({ error: message, code: 'rate_limited' });
    }
    next();
  }

  middleware.close = () => clearInterval(timer);
  return middleware;
}
