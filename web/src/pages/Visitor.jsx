import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Container, LinearProgress, Stack, Typography,
} from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import ImageIcon from '@mui/icons-material/Image';
import DownloadIcon from '@mui/icons-material/Download';
import ReplayIcon from '@mui/icons-material/Replay';
import { request } from '../api.js';
import { formatDuration } from '../format.js';
import CapWidget from '../CapWidget.jsx';

const POLL_MS = 1500;
const ENTRY_KEY = 'queue-entry';

const savedEntry = {
  get: () => { try { return sessionStorage.getItem(ENTRY_KEY); } catch { return null; } },
  set: (v) => { try { v ? sessionStorage.setItem(ENTRY_KEY, v) : sessionStorage.removeItem(ENTRY_KEY); } catch { /* 忽略 */ } },
};

export default function Visitor() {
  const [info, setInfo] = useState(null);
  // phase: verify | joining | waiting | loading | done
  const [phase, setPhase] = useState(savedEntry.get() ? 'waiting' : 'verify');
  const [entryId, setEntryId] = useState(savedEntry.get());
  const [status, setStatus] = useState(null);
  const [firstPosition, setFirstPosition] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState('');
  const [capReset, setCapReset] = useState(0);
  const fetchingImage = useRef(false);

  useEffect(() => {
    request('/api/public').then((d) => { setInfo(d); document.title = d.title; }).catch(() => {});
  }, []);

  useEffect(() => () => imageUrl && URL.revokeObjectURL(imageUrl), [imageUrl]);

  const leave = useCallback(() => {
    savedEntry.set(null);
    setEntryId(null);
    setStatus(null);
    setFirstPosition(null);
  }, []);

  const fetchImage = useCallback(async (ticket) => {
    if (fetchingImage.current) return;
    fetchingImage.current = true;
    setPhase('loading');
    try {
      const res = await request(`/api/image/${encodeURIComponent(ticket)}`, { raw: true });
      setImageUrl(URL.createObjectURL(await res.blob()));
      setPhase('done');
    } catch (e) {
      setError(e.message);
      setPhase('verify');
    } finally {
      fetchingImage.current = false;
      leave();
    }
  }, [leave]);

  // 排队中：定时轮询状态（同时作为心跳，停止轮询约 15 秒后会被移出队列）
  useEffect(() => {
    if (phase !== 'waiting' || !entryId) return;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const s = await request(`/api/queue/${encodeURIComponent(entryId)}`);
        if (stop) return;
        if (s.status === 'granted') return fetchImage(s.ticket);
        if (s.status === 'gone') {
          leave();
          setError('排队记录已失效（可能离开太久或被移出），请重新排队');
          setPhase('verify');
          return;
        }
        setStatus(s);
        setFirstPosition((p) => p ?? s.position);
      } catch { /* 网络抖动，下次再试 */ }
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [phase, entryId, fetchImage, leave]);

  const onSolve = async (capToken) => {
    setError('');
    setPhase('joining');
    try {
      const r = await request('/api/queue', { method: 'POST', body: { capToken } });
      savedEntry.set(r.id);
      setEntryId(r.id);
      if (r.status === 'granted') return fetchImage(r.ticket);
      setStatus(r);
      setFirstPosition(r.position);
      setPhase('waiting');
    } catch (e) {
      setError(e.message);
      setPhase('verify');
      setCapReset((n) => n + 1);
    }
  };

  const cancel = () => {
    if (entryId) request(`/api/queue/${encodeURIComponent(entryId)}`, { method: 'DELETE' }).catch(() => {});
    leave();
    setPhase('verify');
    setCapReset((n) => n + 1);
  };

  const again = () => {
    setImageUrl(null);
    setError('');
    setPhase('verify');
    setCapReset((n) => n + 1);
  };

  const progress = status && firstPosition ? ((firstPosition - status.position + 1) / firstPosition) * 100 : 0;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 3, sm: 6 } }}>
      <Container maxWidth="sm">
        <Stack spacing={1} sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>{info?.title || '排队领取图片'}</Typography>
          {info && (
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <Chip size="small" label={`每 ${info.windowSec} 秒放行 ${info.quota} 人`} />
              <Chip size="small" label={`当前排队 ${info.queueLength} 人`} />
              {info.paused && <Chip size="small" color="warning" label="已暂停发放" />}
            </Stack>
          )}
        </Stack>

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

            {(phase === 'verify' || phase === 'joining') && (
              <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
                <ImageIcon color="primary" sx={{ fontSize: 48 }} />
                <Typography color="text.secondary">{info?.notice}</Typography>
                {info && !info.hasImage ? (
                  <Alert severity="info">暂未上传图片，请稍后再来。</Alert>
                ) : (
                  <CapWidget onSolve={onSolve} onError={setError} resetKey={capReset} />
                )}
                {phase === 'joining' && <Typography variant="body2">正在加入队列…</Typography>}
              </Stack>
            )}

            {phase === 'waiting' && (
              <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
                <HourglassTopIcon color="primary" sx={{ fontSize: 48 }} />
                {status ? (
                  <>
                    <Typography variant="h6">你前面还有 {status.position - 1} 人</Typography>
                    <Typography variant="h2" component="p" sx={{ fontWeight: 700, lineHeight: 1 }}>
                      #{status.position}
                    </Typography>
                    <Typography color="text.secondary">
                      {status.paused ? '发放已暂停，恢复后继续排队' : `预计等待 ${formatDuration(status.etaMs)}`}
                    </Typography>
                    <LinearProgress variant="determinate" value={progress} sx={{ width: '100%', height: 8, borderRadius: 4 }} />
                  </>
                ) : (
                  <CircularProgress />
                )}
                <Alert severity="info" sx={{ textAlign: 'left' }}>请保持页面打开，离开超过 15 秒会失去排队位置。</Alert>
                <Button color="inherit" onClick={cancel}>放弃排队</Button>
              </Stack>
            )}

            {phase === 'loading' && (
              <Stack spacing={2} sx={{ alignItems: 'center', py: 4 }}>
                <CircularProgress />
                <Typography>轮到你了，正在加载图片…</Typography>
              </Stack>
            )}

            {phase === 'done' && imageUrl && (
              <Stack spacing={2}>
                <Alert severity="success">领取成功！图片仅本次有效，刷新页面后需要重新排队。</Alert>
                <Box component="img" src={imageUrl} alt="领取到的图片"
                  sx={{ width: '100%', borderRadius: 1, border: 1, borderColor: 'divider' }} />
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                  <Button variant="contained" startIcon={<DownloadIcon />} href={imageUrl} download="image">保存图片</Button>
                  <Button startIcon={<ReplayIcon />} onClick={again}>再排一次</Button>
                </Stack>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
