// 控制台登录：密码来自环境变量 ADMIN_PASSWORD，登录成功后发放内存会话令牌
import crypto from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function createAuth(password) {
  const expected = sha(password);
  const sessions = new Map(); // token -> expiresAt
  const fails = new Map(); // ip -> { count, since }

  function locked(ip) {
    const f = fails.get(ip);
    if (!f) return false;
    if (Date.now() - f.since > FAIL_WINDOW_MS) {
      fails.delete(ip);
      return false;
    }
    return f.count >= MAX_FAILS;
  }

  return {
    login(ip, input) {
      if (locked(ip)) return { error: '尝试次数过多，请 15 分钟后再试', status: 429 };
      if (typeof input !== 'string' || !crypto.timingSafeEqual(sha(input), expected)) {
        const f = fails.get(ip) || { count: 0, since: Date.now() };
        f.count++;
        fails.set(ip, f);
        return { error: '密码错误', status: 401 };
      }
      fails.delete(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      return { token, expiresInMs: SESSION_TTL_MS };
    },
    logout(token) {
      sessions.delete(token);
    },
    /** Express 中间件：要求 Authorization: Bearer <token> */
    require(req, res, next) {
      const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const exp = sessions.get(token);
      if (!exp || exp < Date.now()) {
        sessions.delete(token);
        return res.status(401).json({ error: '未登录或登录已过期' });
      }
      req.sessionToken = token;
      next();
    },
  };
}
