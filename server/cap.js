// Cap 人机验证（https://capjs.js.org），使用 @cap.js/server 内嵌在本服务中，
// 挑战与令牌只存在内存里（不写文件），服务重启后未使用的令牌失效即可。
import Cap from '@cap.js/server';

export function createCap() {
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
    /** 生成挑战；挑战本身 2 分钟内有效 */
    createChallenge: (difficulty) => cap.createChallenge({ challengeDifficulty: difficulty, expiresMs: 120_000 }),
    redeem: (token, solutions) => cap.redeemChallenge({ token, solutions }),
    /** 校验并作废令牌（一次性） */
    validate: async (token) => (await cap.validateToken(token)).success,
    stats: () => ({ pendingChallenges: challenges.size, unusedTokens: tokens.size }),
  };
}
