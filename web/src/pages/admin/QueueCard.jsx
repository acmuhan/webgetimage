import { useState } from 'react';
import {
  Button, Card, CardHeader, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import { formatDuration, formatTime } from '../../format.js';

export default function QueueCard({ queue, call, notify, onChanged }) {
  const [confirm, setConfirm] = useState(false);

  const kick = async (id) => {
    try {
      await call(`/api/admin/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notify('已移出队列');
      onChanged();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const clear = async () => {
    setConfirm(false);
    try {
      const r = await call('/api/admin/queue', { method: 'DELETE' });
      notify(`已清空 ${r.removed} 人`);
      onChanged();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const rows = queue?.waiting ?? [];
  const now = queue?.now ?? Date.now();

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader title="排队中"
        subheader={queue && queue.queueLength > rows.length ? `仅显示前 ${rows.length} 人，共 ${queue.queueLength} 人` : undefined}
        action={
          <Button color="error" startIcon={<ClearAllIcon />} disabled={!rows.length} onClick={() => setConfirm(true)}>清空</Button>
        } />
      <TableContainer sx={{ maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>位次</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>加入时间</TableCell>
              <TableCell>已等待</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>#{r.position}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.ip}</TableCell>
                <TableCell>{formatTime(r.joinedAt)}</TableCell>
                <TableCell>{formatDuration(now - r.joinedAt)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="移出队列">
                    <IconButton size="small" onClick={() => kick(r.id)} aria-label="移出队列"><PersonRemoveIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>队列为空</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>清空队列？</DialogTitle>
        <DialogContent>
          <DialogContentText>所有正在排队的 {queue?.queueLength ?? 0} 人都会被移出，需要重新验证才能排队。已放行的凭证不受影响。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={clear}>清空</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
