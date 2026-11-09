// 简单的 fetch 封装：统一解析 JSON 与错误信息
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const TOKEN_KEY = 'admin-token';

export const adminToken = {
  get() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* 隐私模式下可能不可用，忽略 */
    }
  },
};

export async function request(url, { method = 'GET', body, admin = false, raw = false, ...rest } = {}) {
  const headers = {};
  if (admin) headers.Authorization = `Bearer ${adminToken.get() || ''}`;
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, ...rest });
  if (raw && res.ok) return res;
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `请求失败（${res.status}）`, res.status, data);
  return data;
}
