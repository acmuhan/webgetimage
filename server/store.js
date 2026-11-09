// 设置与图片元数据的持久化（JSON 文件，位于 DATA_DIR）
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 每个字段的默认值与合法范围，前后端校验都以此为准
export const SETTING_RULES = {
  windowSec: { def: 60, min: 1, max: 86400, int: true },
  quota: { def: 10, min: 1, max: 10000, int: true },
  ticketTtlSec: { def: 30, min: 5, max: 3600, int: true },
  maxQueue: { def: 1000, min: 1, max: 100000, int: true },
  maxPerIp: { def: 3, min: 1, max: 1000, int: true },
  capDifficulty: { def: 4, min: 1, max: 8, int: true },
  paused: { def: false, bool: true },
  title: { def: '排队领取图片', str: true, maxLen: 60 },
  notice: { def: '完成人机验证后进入队列，轮到你时即可查看图片。', str: true, maxLen: 500 },
};

function defaults() {
  return Object.fromEntries(Object.entries(SETTING_RULES).map(([k, r]) => [k, r.def]));
}

/** 校验并规整一份（部分）设置；返回 { value } 或 { error } */
export function validateSettings(input) {
  if (!input || typeof input !== 'object') return { error: '请求体必须是对象' };
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    // 只认自有属性：避免 constructor、toString 等原型链上的键被当成合法字段
    if (!Object.hasOwn(SETTING_RULES, key)) return { error: `未知字段：${key}` };
    const rule = SETTING_RULES[key];
    if (rule.bool) {
      if (typeof raw !== 'boolean') return { error: `${key} 必须是布尔值` };
      out[key] = raw;
    } else if (rule.str) {
      if (typeof raw !== 'string') return { error: `${key} 必须是字符串` };
      if (raw.length > rule.maxLen) return { error: `${key} 最长 ${rule.maxLen} 个字符` };
      out[key] = raw;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || (rule.int && !Number.isInteger(n))) return { error: `${key} 必须是整数` };
      if (n < rule.min || n > rule.max) return { error: `${key} 取值范围 ${rule.min}～${rule.max}` };
      out[key] = n;
    }
  }
  return { value: out };
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function createStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let state = { settings: defaults(), image: null };
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    // 旧文件里可能有非法或多余字段，逐个校验后再合并
    for (const [k, v] of Object.entries(saved.settings || {})) {
      const r = validateSettings({ [k]: v });
      if (r.value) Object.assign(state.settings, r.value);
    }
    if (saved.image && fs.existsSync(path.join(DATA_DIR, saved.image.file))) state.image = saved.image;
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[store] 读取 settings.json 失败，使用默认设置：', err.message);
  }

  const save = () => writeJsonAtomic(SETTINGS_FILE, state);

  return {
    get settings() {
      return state.settings;
    },
    get image() {
      return state.image;
    },
    imagePath() {
      return state.image ? path.join(DATA_DIR, state.image.file) : null;
    },
    updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      save();
      return state.settings;
    },
    /** 替换当前图片：先写临时文件再改名，最后删除旧文件 */
    replaceImage(buffer, { mime, ext, originalName }) {
      const file = `image-${Date.now()}.${ext}`;
      const tmp = path.join(DATA_DIR, `${file}.tmp`);
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, path.join(DATA_DIR, file));
      const old = state.image;
      state.image = { file, mime, size: buffer.length, originalName, updatedAt: Date.now() };
      save();
      if (old && old.file !== file) fs.rm(path.join(DATA_DIR, old.file), { force: true }, () => {});
      return state.image;
    },
  };
}
