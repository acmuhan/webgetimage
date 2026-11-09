import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AppBar, Box, Button, Card, CardContent, Chip, CircularProgress, Container, Divider,
  FormControlLabel, IconButton, LinearProgress, Snackbar, Stack, Switch, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Toolbar, Tooltip, Typography,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import GroupIcon from '@mui/icons-material/Group';
import SpeedIcon from '@mui/icons-material/Speed';
import ImageIcon from '@mui/icons-material/Image';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { adminToken, request, ApiError } from '../api.js';
import { formatBytes, formatDuration, formatTime } from '../format.js';

const POLL_MS = 2000;

const NUM_FIELDS = [
  { key: 'windowSec', label: '放行窗口（秒）', help: '每这么多秒最多放行 quota 人' },
  { key: 'quota', label: '窗口内放行人数', help: '窗口内仍按先来后到逐个放行，间隔 = 窗口 ÷ 人数' },
  { key: 'ticketTtlSec', label: '凭证有效期（秒）', help: '轮到你之后须在此时间内领取，过期作废' },
  { key: 'maxQueue', label: '队列上限（人）', help: '超过后新访客会被拒绝' },
  { key: 'maxPerIp', label: '同一 IP 上限（人）', help: '避免同一网络占多个位置' },
  { key: 'capDifficulty', label: '人机验证难度', help: '1 最宽松，8 最严格' },
];

const EMPTY_FORM = {
  windowSec: '', quota: '', ticketTtlSec: '', maxQueue: '', maxPerIp: '',
  capDifficulty: '', title: '', notice: '', paused: false,
};

function toForm(s) {
  return {
    windowSec: String(s.windowSec), quota: String(s.quota), ticketTtlSec: String(s.ticketTtlSec),
    maxQueue: String(s.maxQueue), maxPerIp: String(s.maxPerIp), capDifficulty: String(s.capDifficulty),
    title: s.title, notice: s.notice, paused: s.paused,
  };
}

function Stat({ icon, label, value, hint }) {
  return (
    <Card variant="outlined" sx={{ flex: '1 1 150px', minWidth: 140 }}>
      <CardContent sx={{ py: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          {icon}
          <Typography variant="caption">{label}</Typography>
        </Stack>
        <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5 }}>{value}</Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

function Section({ title, subtitle, action, children }) {
  return (
    <Card variant="outlined" component="section">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await request('/api/admin/login', { method: 'POST', body: { password } });
      adminToken.set(r.token);
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Container maxWidth="xs">
        <Card variant="outlined">
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2} component="form" onSubmit={submit}>
              <Stack spacing={0.5}>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>运营控制台</Typography>
                <Typography variant="body2" color="text.secondary">
                  请输入管理员密码，密码由部署时的环境变量 ADMIN_PASSWORD 决定。
                </Typography>
              </Stack>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="管理员密码" type="password" value={password} autoFocus fullWidth
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" variant="contained" disabled={busy || !password} fullWidth>
                {busy ? '登录中…' : '登录'}
              </Button>
              <Button href="/" color="inherit" size="small">返回领取页</Button>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => adminToken.get());
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const logout = useCallback(() => {
    request('/api/admin/logout', { method: 'POST', admin: true }).catch(() => {});
    adminToken.set(null);
    setToken(null);
    setState(null);
    setForm(EMPTY_FORM);
    setDirty(false);
  }, []);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const s = await request('/api/admin/state', { admin: true });
      setState(s);
      if (!dirtyRef.current) setForm(toForm(s.settings));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return logout();
      if (!silent) setToast({ severity: 'error', text: err.message });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    load(false);
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [token, load]);

  // 图片预览需要带上 Authorization，因此用 blob 拉取
  const imageUpdatedAt = state?.image?.updatedAt;
  useEffect(() => {
    let revoked = null;
    let alive = true;
    setImageUrl(null);
    if (!imageUpdatedAt) return undefined;
    request('/api/admin/image', { admin: true, raw: true })
      .then((res) => res.blob())
      .then((blob) => {
        if (!alive) return;
        revoked = URL.createObjectURL(blob);
        setImageUrl(revoked);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [imageUpdatedAt]);

  const patch = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        title: form.title,
        notice: form.notice,
        paused: form.paused,
      };
      for (const f of NUM_FIELDS) {
        const n = Number(form[f.key]);
        if (!Number.isFinite(n)) throw new Error(f.label + ' 必须是数字');
        body[f.key] = n;
      }
      const r = await request('/api/admin/settings', { method: 'PUT', body, admin: true });
      setForm(toForm(r.settings));
      setDirty(false);
      await load(true);
      setToast({ severity: 'success', text: '设置已保存并立即生效' });
    } catch (err) {
      setToast({ severity: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      await request('/api/admin/image', { method: 'POST', body: fd, admin: true });
      await load(true);
      setToast({ severity: 'success', text: '图片已更新' });
    } catch (err) {
      setToast({ severity: 'error', text: err.message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const kick = async (id) => {
    try {
      await request('/api/admin/queue/' + encodeURIComponent(id), { method: 'DELETE', admin: true });
      await load(true);
    } catch (err) {
      setToast({ severity: 'error', text: err.message });
    }
  };

  const clearQueue = async () => {
    try {
      const r = await request('/api/admin/queue', { method: 'DELETE', admin: true });
      await load(true);
      setToast({ severity: 'success', text: '已清空 ' + r.removed + ' 个等待中的访客' });
    } catch (err) {
      setToast({ severity: 'error', text: err.message });
    }
  };

  if (!token) return <Login onLogin={() => setToken(adminToken.get())} />;

  const q = state?.queue;
  const s = state?.settings || EMPTY_FORM;
  const stats = q?.stats;
  const intervalSec = s.windowSec && s.quota ? (s.windowSec / s.quota).toFixed(2) : '—';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 6 }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>运营控制台</Typography>
          {s.paused && <Chip size="small" color="warning" label="发放已暂停" />}
          <Box sx={{ flex: 1 }} />
          <Tooltip title="立即刷新">
            <IconButton onClick={() => load(false)}><RefreshIcon /></IconButton>
          </Tooltip>
          <Button onClick={logout} startIcon={<LogoutIcon />} color="inherit">退出</Button>
        </Toolbar>
        {loading && <LinearProgress />}
      </AppBar>

      <Container maxWidth="lg" sx={{ pt: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
            <Stat icon={<GroupIcon fontSize="small" />} label="等待中" value={q ? q.queueLength : '—'}
              hint={q ? '队列上限 ' + s.maxQueue : ''} />
            <Stat icon={<CheckCircleIcon fontSize="small" />} label="已放行" value={stats ? stats.granted : '—'}
              hint={stats ? '累计入队 ' + stats.joined : ''} />
            <Stat icon={<ImageIcon fontSize="small" />} label="已领取" value={stats ? stats.served : '—'}
              hint={stats ? '过期 ' + stats.expired + ' · 放弃 ' + stats.abandoned : ''} />
            <Stat icon={<SpeedIcon fontSize="small" />} label="放行间隔" value={intervalSec + ' s'}
              hint={'每 ' + s.windowSec + ' 秒放行 ' + s.quota + ' 人'} />
            <Stat icon={<VerifiedUserIcon fontSize="small" />} label="人机验证" value={state ? state.cap.unusedTokens : '—'}
              hint={state ? '待用令牌 · 挑战 ' + state.cap.pendingChallenges : ''} />
          </Stack>

          <Section
            title="当前图片"
            subtitle={state?.image
              ? state.image.originalName + ' · ' + formatBytes(state.image.size) + ' · 更新于 ' + formatTime(state.image.updatedAt)
              : '还没有上传图片，访客暂时无法排队'}
            action={(
              <Stack direction="row" spacing={1}>
                <Button variant="contained" size="small" startIcon={<UploadFileIcon />} disabled={uploading}
                  onClick={() => fileRef.current?.click()}>
                  {uploading ? '上传中…' : state?.image ? '更换图片' : '上传图片'}
                </Button>
              </Stack>
            )}
          >
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
              onChange={(e) => upload(e.target.files && e.target.files[0])} />
            {imageUrl ? (
              <Box component="img" src={imageUrl} alt="当前图片"
                sx={{ maxWidth: '100%', maxHeight: 320, borderRadius: 1, border: 1, borderColor: 'divider' }} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                支持 PNG / JPEG / GIF / WebP，服务端按文件头判断真实类型，不接受 SVG。
              </Typography>
            )}
          </Section>

          <Section
            title="发放规则"
            subtitle="窗口与人数决定放行节奏：相邻两次放行至少间隔 窗口 ÷ 人数 秒，窗口内也不会一次性放完。"
            action={(
              <Button variant="contained" size="small" onClick={save} disabled={!dirty || saving}>
                {saving ? '保存中…' : dirty ? '保存修改' : '已保存'}
              </Button>
            )}
          >
            <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {NUM_FIELDS.map((f) => (
                <TextField
                  key={f.key} label={f.label} value={form[f.key]} size="small" sx={{ flex: '1 1 200px' }}
                  helperText={f.help} onChange={(e) => patch(f.key, e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                />
              ))}
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack spacing={2}>
              <TextField label="页面标题" value={form.title} size="small" onChange={(e) => patch('title', e.target.value)}
                helperText="显示在领取页顶端，最长 60 字" />
              <TextField label="提示文案" value={form.notice} size="small" multiline minRows={2}
                onChange={(e) => patch('notice', e.target.value)} helperText="显示在排队卡片里，最长 500 字" />
              <FormControlLabel
                control={<Switch checked={form.paused} onChange={(e) => patch('paused', e.target.checked)} />}
                label="暂停发放（已放行的凭证仍然有效，队列保留）"
              />
            </Stack>
          </Section>

          <Section
            title={'等待队列（' + (q ? q.queueLength : 0) + ' 人）'}
            subtitle={q && !s.paused
              ? '下一次放行还有 ' + formatDuration(q.nextSlotInMs) + '；超过 15 秒不轮询的访客会被自动移出。'
              : '当前处于暂停状态，恢复后才继续放行。'}
            action={(
              <Button size="small" startIcon={<DeleteIcon />} onClick={clearQueue} disabled={!q || q.queueLength === 0}>
                清空队列
              </Button>
            )}
          >
            {!q || q.waiting.length === 0 ? (
              <Typography variant="body2" color="text.secondary">队列为空。</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>位置</TableCell>
                      <TableCell>IP</TableCell>
                      <TableCell>入队时间</TableCell>
                      <TableCell>已等待</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {q.waiting.map((e) => (
                      <TableRow key={e.id} hover>
                        <TableCell>#{e.position}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{e.ip}</TableCell>
                        <TableCell>{formatTime(e.joinedAt)}</TableCell>
                        <TableCell>{formatDuration(q.now - e.joinedAt)}</TableCell>
                        <TableCell align="right">
                          <Tooltip title="移出队列">
                            <IconButton size="small" onClick={() => kick(e.id)}><PersonRemoveIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Section>

          <Section
            title={'已放行待领取（' + (q ? q.granted.length : 0) + '）'}
            subtitle="凭证一次性有效，过期或已领取都会从列表中消失。"
          >
            {!q || q.granted.length === 0 ? (
              <Typography variant="body2" color="text.secondary">暂时没有待领取的凭证。</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>IP</TableCell>
                      <TableCell>放行时间</TableCell>
                      <TableCell>剩余有效期</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {q.granted.map((e) => (
                      <TableRow key={e.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{e.ip}</TableCell>
                        <TableCell>{formatTime(e.grantedAt)}</TableCell>
                        <TableCell>{formatDuration(e.expiresAt - q.now)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Section>

          <Section title="放行记录" subtitle="最近 50 条，按时间倒序。">
            {!q || q.log.length === 0 ? (
              <Typography variant="body2" color="text.secondary">还没有放行记录。</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>时间</TableCell>
                      <TableCell>IP</TableCell>
                      <TableCell>排队时长</TableCell>
                      <TableCell>是否领取</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {q.log.map((r) => (
                      <TableRow key={r.id + '-' + r.at} hover>
                        <TableCell>{formatTime(r.at)}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{r.ip}</TableCell>
                        <TableCell>{formatDuration(r.waitedMs)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={r.served ? '已领取' : '未领取'}
                            color={r.served ? 'success' : 'default'} variant="outlined" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Section>

          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            <HourglassTopIcon sx={{ fontSize: 14, verticalAlign: 'text-bottom', mr: 0.5 }} />
            队列与设置保存在数据卷中，重启容器不会丢失；人机验证令牌只存在内存里，重启后失效。
          </Typography>
        </Stack>
      </Container>

      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.text}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}
