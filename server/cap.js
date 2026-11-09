// Cap 人机验证（https://capjs.js.org），使用 @cap.js/server 内嵌在本服务中，
// 挑战与令牌只存在内存里（不写文件），服务重启后未使用的令牌失效即可。
import Cap from '@cap.js/server';

// 内存保护：待解挑战与未使用令牌的总量上限（每条约 200 字节，5 万条约 10MB）
const MAX_CHALLENGES = 50_000;
const MAX_TOKENS = 50_000;

function pruneExpired(map, getExpires) {
  const now = Date.now();
  for (const [k, v] of map) if (getExpires(v) <= now) map.delete(k);
}

export function createCap({ maxChallenges = MAX_CHALLENGES, maxTokens = MAX_TOKENS } = {}) {
  const challenges = new Map();
  const tokens = new Map();

  const cap = new Cap({
    storage: {
      challenges: {
        store: async (token, data) => void challenges.set(token, data),
        read: async (token) => {
          const d = challenges.get(token);
          return d && d.expires > Date.now() ? d : null;
        },
        delete: async (token) => void challenges.delete(token),
        deleteExpired: async () => {
          const now = Date.now();
          for (const [k, d] of challenges) if (d.expires <= now) challenges.delete(k);
        },
      },
      tokens: {
        store: async (key, expires) => void tokens.set(key, expires),
        get: async (key) => {
          const e = tokens.get(key);
          return e && e > Date.now() ? e : null;
        },
        delete: async (key) => void tokens.delete(key),
        deleteExpired: async () => {
          const now = Date.now();
          for (const [k, e] of tokens) if (e <= now) tokens.delete(k);
        },
      },
    },
  });

  return {
    /**
     * 生成挑战；挑战本身 2 分钟内有效。
     * 待解挑战数量达到上限时先清理过期的，仍然满则返回 null（由调用方回 503）。
     */
    async createChallenge(difficulty) {
      if (challenges.size >= maxChallenges) pruneExpired(challenges, (d) => d.expires);
      if (challenges.size >= maxChallenges) return null;
      return cap.createChallenge({ challengeDifficulty: difficulty, expiresMs: 120_000 });
    },
    /** 兑换挑战；未使用令牌达到上限时同样先清理，仍然满则拒绝 */
    async redeem(token, solutions) {
      if (tokens.size >= maxTokens) pruneExpired(tokens, (e) => e);
      if (tokens.size >= maxTokens) return { success: false, message: 'Server busy' };
      return cap.redeemChallenge({ token, solutions });
    },
    /** 校验并作废令牌（一次性） */
    validate: async (token) => (await cap.validateToken(token)).success,
    stats: () => ({ pendingChallenges: challenges.size, unusedTokens: tokens.size }),
  };
}
