# 排队领取图片

访客完成 [Cap](https://capjs.js.org) 人机验证后进入队列，按「每 N 秒放行 M 人」的节奏依次领取同一张图片。管理员在 `/admin` 控制台上传图片、调整规则、管理队列。

- 后端：Node.js + Express 5，Cap 服务端（`@cap.js/server`）内嵌在本服务里，不需要额外部署 Cap 服务
- 前端：React 19 + MUI 9，Vite 构建；Cap 组件和 WASM 求解器都由本站提供，不依赖外部 CDN

## 放行规则

- 每 `windowSec` 秒最多放行 `quota` 人。
- 窗口内也排队：相邻两次放行至少间隔 `windowSec / quota` 秒，先来先得，不会在窗口开头一次放完。
- 轮到的人拿到一次性凭证，须在 `ticketTtlSec` 秒内领取，过期作废。
- 排队页每 1.5 秒轮询一次。超过 15 秒没有轮询（关掉页面）的人会被移出队列，不占名额。
- 同一 IP 同时排队的人数受 `maxPerIp` 限制，总人数受 `maxQueue` 限制。

## Docker 部署

```bash
cp .env.example .env      # 修改 ADMIN_PASSWORD
docker compose up -d --build
```

- 访客页：`http://<主机>:3000/`
- 控制台：`http://<主机>:3000/admin`

设置和图片保存在具名卷 `image-queue-data`（容器内 `/data`）。队列和 Cap 令牌只存在内存里，重启后排队中的访客需要重新排队。

放在 Nginx、Caddy 等反向代理后面时，在 `.env` 里设置 `TRUST_PROXY=1`，否则所有访客的 IP 都是代理的 IP，每 IP 限制会误伤。直接对外暴露时保持为空。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 无，必填 | 控制台密码，至少 8 位 |
| `PORT` | `3000` | 容器内监听端口 |
| `HOST_PORT` | `3000` | compose 映射到宿主机的端口 |
| `DATA_DIR` | `/data` | 数据目录 |
| `TRUST_PROXY` | 空 | 反向代理层数或 Express `trust proxy` 取值 |
| `MAX_UPLOAD_MB` | `20` | 上传图片大小上限 |

## 本地开发

```bash
npm install
# PowerShell: $env:ADMIN_PASSWORD='dev-password'; npm run dev
ADMIN_PASSWORD=dev-password npm run dev
```

Vite 开发服务器在 `http://localhost:5173`，会把 `/api` 和 `/cap` 转发到 3000 端口的 Node 服务。

```bash
npm test         # 排队调度器单元测试
npm run build    # 构建前端到 dist/
npm start        # 生产模式运行（需要先 build）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/cap/challenge`、`/cap/redeem` | Cap 组件使用 |
| GET | `/api/public` | 标题、规则、排队人数 |
| POST | `/api/queue` | `{ capToken }`，入队 |
| GET | `/api/queue/:id` | 查询位次，同时作为心跳 |
| DELETE | `/api/queue/:id` | 放弃排队 |
| GET | `/api/image/:ticket` | 凭证换图片，一次性 |
| POST | `/api/admin/login` | `{ password }`，返回 Bearer 令牌 |
| GET | `/api/admin/state` | 控制台数据 |
| PUT | `/api/admin/settings` | 修改规则 |
| POST | `/api/admin/image` | 上传图片（字段 `image`，PNG/JPEG/GIF/WebP） |
| DELETE | `/api/admin/queue`、`/api/admin/queue/:id` | 清空队列、移出某人 |
