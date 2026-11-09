import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { createStore, validateSettings } from './store.js';
import { ImageQueue } from './queue.js';
import { createCap } from './cap.js';
import { createAuth } from './auth.js';
import { rateLimit } from './ratelimit.js';

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('[fatal] 请通过环境变量 ADMIN_PASSWORD 设置控制台密码（至少 8 位）');
  process.exit(1);
}

const store = createStore();
const queue = new ImageQueue({ getSettings: () => store.settings });
const cap = createCap();
const auth = createAuth(ADMIN_PASSWORD);

const app = express();
app.disable('x-powered-by');
// 部署在反向代理之后时设置 TRUST_PROXY（如 1、loopback），否则拿到的都是代理的 IP
const tp = process.env.TRUST_PROXY;
if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});
app.use(express.json({ limit: '64kb' }));

// 按 IP 限速。数值按「同一出口 IP 后面可能有几十个真实用户（公司、校园网 NAT）」留了余量：
// 访客页每 1.5 秒轮询一次，单人约 40 次/分钟。
const MINUTE = 60_000;
const limits = {
  challenge: rateLimit({ windowMs: MINUTE, max: 30 }),
  redeem: rateLimit({ windowMs: MINUTE, max: 30 }),
  join: rateLimit({ windowMs: MINUTE, max: 20 }),
  poll: rateLimit({ windowMs: MINUTE, max: 1200 }),
  image: rateLimit({ windowMs: MINUTE, max: 60 }),
  login: rateLimit({ windowMs: MINUTE, max: 10, message: '登录尝试过于频繁，请稍后再试' }),
  general: rateLimit({ windowMs: MINUTE, max: 300 }),
};

const api = express.Router();
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------- 公共信息 ----------
api.get('/public', limits.general, (req, res) => {
  const s = store.settings;
  res.json({
    title: s.title,
    notice: s.notice,
    paused: s.paused,
    hasImage: Boolean(store.image),
    windowSec: s.windowSec,
    quota: s.quota,
    queueLength: queue.waiting.length,
  });
});

// ---------- Cap 人机验证（组件的 data-cap-api-endpoint 指向 /cap/） ----------
app.post('/cap/challenge', limits.challenge, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ch = await cap.createChallenge(store.settings.capDifficulty);
  if (!ch) return res.status(503).json({ error: '服务繁忙，请稍后再试' });
  res.json(ch);
});
app.post('/cap/redeem', limits.redeem, async (req, res) => {
  const { token, solutions } = req.body || {};
  if (!token || !solutions) return res.status(400).json({ success: false });
  res.set('Cache-Control', 'no-store').json(await cap.redeem(token, solutions));
});

// ---------- 排队 ----------
api.post('/queue', limits.join, async (req, res) => {
  if (!store.image) return res.status(503).json({ error: '暂未上传图片', code: 'no_image' });
  const capToken = req.body?.capToken;
  if (!(await cap.validate(capToken))) return res.status(403).json({ error: '人机验证无效或已过期，请重新验证', code: 'captcha' });
  const r = queue.join(req.ip);
  if (r.error) return res.status(r.code === 'paused' ? 503 : 429).json(r);
  res.status(201).json({ id: r.entry.id, ...queue.status(r.entry.id) });
});

api.get('/queue/:id', limits.poll, (req, res) => res.json(queue.status(req.params.id)));

api.delete('/queue/:id', limits.general, (req, res) => {
  queue.remove(req.params.id, 'abandoned');
  res.status(204).end();
});

// 凭证换图片：一次性，过期作废
api.get('/image/:ticket', limits.image, (req, res) => {
  const file = store.imagePath();
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '图片不存在' });
  if (!queue.consumeTicket(req.params.ticket)) return res.status(403).json({ error: '凭证无效、已使用或已过期' });
  res.set({ 'Content-Type': store.image.mime, 'Content-Disposition': 'inline' });
  fs.createReadStream(file).pipe(res);
});

// ---------- 控制台 ----------
api.post('/admin/login', limits.login, (req, res) => {
  const r = auth.login(req.ip, req.body?.password);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

const admin = express.Router();
admin.use(auth.require);

admin.post('/logout', (req, res) => {
  auth.logout(req.sessionToken);
  res.status(204).end();
});

admin.get('/state', (req, res) => {
  res.json({ settings: store.settings, image: store.image, queue: queue.snapshot(), cap: cap.stats() });
});

admin.put('/settings', (req, res) => {
  const r = validateSettings(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const settings = store.updateSettings(r.value);
  queue.pump(); // 间隔或暂停状态可能变了，重新安排放行
  res.json({ settings });
});

// 只接受常见位图格式，按文件头判断真实类型（不信任客户端声明，也不接受 SVG）
function sniffImage(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png' };
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg' };
  if (hex.startsWith('474946383')) return { mime: 'image/gif', ext: 'gif' };
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
admin.post('/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少文件字段 image' });
  const type = sniffImage(req.file.buffer);
  if (!type) return res.status(400).json({ error: '仅支持 PNG、JPEG、GIF、WebP' });
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
  res.json({ image: store.replaceImage(req.file.buffer, { ...type, originalName }) });
});

admin.get('/image', (req, res) => {
  const file = store.imagePath();
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '图片不存在' });
  res.set('Content-Type', store.image.mime);
  fs.createReadStream(file).pipe(res);
});

admin.delete('/queue', (req, res) => res.json({ removed: queue.clearWaiting() }));
admin.delete('/queue/:id', (req, res) => {
  if (!queue.remove(req.params.id, 'kicked')) return res.status(404).json({ error: '该排队记录不存在' });
  res.status(204).end();
});

api.use('/admin', admin);
app.use('/api', api);

// ---------- 前端静态资源 ----------
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

// 统一错误处理（包括上传超限）
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `文件不能超过 ${MAX_UPLOAD_MB} MB` : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体不是合法 JSON' });
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

const server = app.listen(PORT, () => console.log(`[server] 已启动：http://localhost:${PORT}`));

const shutdown = () => {
  queue.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
