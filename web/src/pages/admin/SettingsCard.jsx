import { useEffect, useState } from 'react';
import {
  Button, Card, CardContent, CardHeader, FormControlLabel, Grid, InputAdornment, Stack, Switch, TextField, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

const NUM_FIELDS = [
  { key: 'windowSec', label: '时间窗口', unit: '秒', help: '统计放行人数的时间段' },
  { key: 'quota', label: '窗口内放行人数', unit: '人', help: '窗口内按顺序匀速放行' },
  { key: 'ticketTtlSec', label: '领取时限', unit: '秒', help: '轮到后多久内必须领取' },
  { key: 'maxQueue', label: '队列上限', unit: '人', help: '超出后拒绝新加入' },
  { key: 'maxPerIp', label: '每 IP 同时排队数', unit: '个', help: '同一网络同时排队上限' },
  { key: 'capDifficulty', label: '验证难度', unit: '1-8', help: '越高越耗访客算力，默认 4' },
];

export default function SettingsCard({ settings, call, notify, onSaved }) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);

  // 外部设置变化（如另一个管理员保存）时同步，但不覆盖正在编辑的内容
  const [base, setBase] = useState(settings);
  useEffect(() => {
    if (JSON.stringify(settings) !== JSON.stringify(base)) {
      setBase(settings);
      setForm(settings);
    }
  }, [settings, base]);

  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (patch) => {
    setBusy(true);
    try {
      const body = Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [k, NUM_FIELDS.some((f) => f.key === k) ? Number(v) : v]),
      );
      const r = await call('/api/admin/settings', { method: 'PUT', body });
      setBase(r.settings);
      setForm(r.settings);
      notify('设置已保存');
      onSaved();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const interval = Number(form.windowSec) / Number(form.quota);

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader title="发放规则"
        action={
          <FormControlLabel label={settings.paused ? '已暂停' : '发放中'} labelPlacement="start"
            control={<Switch checked={!settings.paused} disabled={busy} onChange={(e) => save({ paused: !e.target.checked })} />} />
        } />
      <CardContent>
        <Grid container spacing={2}>
          {NUM_FIELDS.map((f) => (
            <Grid key={f.key} size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" type="number" label={f.label} value={form[f.key]} onChange={set(f.key)}
                helperText={f.help}
                slotProps={{ input: { endAdornment: <InputAdornment position="end">{f.unit}</InputAdornment> } }} />
            </Grid>
          ))}
          <Grid size={12}>
            <TextField fullWidth size="small" label="页面标题" value={form.title} onChange={set('title')} />
          </Grid>
          <Grid size={12}>
            <TextField fullWidth size="small" multiline minRows={2} label="访客提示" value={form.notice} onChange={set('notice')} />
          </Grid>
        </Grid>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {Number.isFinite(interval) && interval > 0 ? `即每 ${interval.toFixed(2)} 秒放行 1 人` : '请填写有效数值'}
          </Typography>
          <Button onClick={() => setForm(base)} disabled={!dirty || busy}>撤销</Button>
          <Button variant="contained" startIcon={<SaveIcon />} loading={busy} disabled={!dirty}
            onClick={() => { const { paused: _p, ...rest } = form; save(rest); }}>
            保存
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
