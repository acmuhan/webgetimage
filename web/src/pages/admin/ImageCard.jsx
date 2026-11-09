import { useEffect, useRef, useState } from 'react';
import { Box, Button, Card, CardContent, CardHeader, Stack, Typography } from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import ImageIcon from '@mui/icons-material/Image';
import { formatBytes } from '../../format.js';

export default function ImageCard({ image, call, notify, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const version = image?.updatedAt;

  // 预览需要带登录令牌，所以用 fetch 取回后转成 blob URL
  useEffect(() => {
    if (!version) return setPreview(null);
    let url;
    let cancelled = false;
    call('/api/admin/image', { raw: true })
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setPreview(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [version, call]);

  const upload = async (file) => {
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    setBusy(true);
    try {
      await call('/api/admin/image', { method: 'POST', body });
      notify('图片已更新');
      onSaved();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
      input.current.value = '';
    }
  };

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader title="发放的图片" />
      <CardContent>
        <Box sx={{
          aspectRatio: '4 / 3', borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
          display: 'grid', placeItems: 'center', overflow: 'hidden', mb: 2,
        }}>
          {preview ? (
            <Box component="img" src={preview} alt="当前图片" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <Stack sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <ImageIcon sx={{ fontSize: 48 }} />
              <Typography variant="body2">尚未上传</Typography>
            </Stack>
          )}
        </Box>
        {image && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, wordBreak: 'break-all' }}>
            {image.originalName || image.file} · {formatBytes(image.size)} · {new Date(image.updatedAt).toLocaleString('zh-CN')}
          </Typography>
        )}
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(e) => upload(e.target.files?.[0])} />
        <Button fullWidth variant="outlined" startIcon={<UploadIcon />} loading={busy} onClick={() => input.current.click()}>
          {image ? '替换图片' : '上传图片'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          支持 PNG / JPEG / GIF / WebP。替换后立即生效，已发出的凭证会领到新图片。
        </Typography>
      </CardContent>
    </Card>
  );
}
