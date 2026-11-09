import { Card, CardHeader, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { formatDuration, formatTime } from '../../format.js';

export default function LogCard({ log }) {
  const rows = log ?? [];
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardHeader title="最近放行" subheader="最多显示 50 条" />
      <TableContainer sx={{ maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>时间</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>等待</TableCell>
              <TableCell>状态</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatTime(r.at)}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{r.ip}</TableCell>
                <TableCell>{formatDuration(r.waitedMs)}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" color={r.served ? 'success' : 'default'} label={r.served ? '已领取' : '未领取'} />
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>暂无记录</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}
