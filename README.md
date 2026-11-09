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

- 访客页：`/`
- 控制台：`/admin`

设置和图片保存在具名卷 `image-queue-data`（容器内 `/data`）。队列和 Cap 令牌只存在内存里，重启后排队中的访客需要重新排队。

### 网络与真实 IP

每 IP 排队上限、接口限速和登录锁定都依赖访客的真实 IP，`BIND_ADDR` 和 `TRUST_PROXY` 必须配对设置：

| 部署方式 | `BIND_ADDR` | `TRUST_PROXY` |
|---|---|---|
| 反向代理后面（默认，推荐） | `127.0.0.1` | `1` |
| 直接对外，不用代理 | `0.0.0.0` | 留空 |

- 只设 `TRUST_PROXY=1` 却把端口对外开放：任何人都能伪造 `X-Forwarded-For`，绕过所有按 IP 的限制。
- 在代理后面却不设 `TRUST_PROXY`：所有访客都是同一个 IP，全站同时只能排 `maxPerIp` 个人，有人输错几次密码就会把管理员锁在外面。
- 代理需要转发 `X-Forwarded-For`，例如 Nginx 的 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`。Caddy 的 `reverse_proxy` 默认就会转发。

### 限速

接口按 IP 限速，超出返回 429 并带 `Retry-After`。数值按同一出口 IP 后面有几十个真实用户（公司、校园网 NAT）留了余量：

| 接口 | 每 IP 每分钟 |
|---|---|
| `/cap/challenge`、`/cap/redeem` | 30 |
| `POST /api/queue`（入队） | 20 |
| `GET /api/queue/:id`（轮询，单人约 40 次/分钟） | 1200 |
| `GET /api/image/:ticket` | 60 |
| `POST /api/admin/login` | 10 |
| 其他公共接口 | 300 |

另外，待解的 Cap 挑战和未使用的令牌各自最多保存 5 万个，满了以后新请求返回 503，防止被刷爆内存。需要调整时修改 `server/index.js` 里的 `limits` 和 `server/cap.js` 顶部的常量。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 无，必填 | 控制台密码，至少 8 位 |
| `PORT` | `3000` | 容器内监听端口 |
| `HOST_PORT` | `3000` | compose 映射到宿主机的端口 |
| `BIND_ADDR` | `127.0.0.1` | compose 绑定的宿主机地址，见上文 |
| `DATA_DIR` | `/data` | 数据目录 |
| `TRUST_PROXY` | 空（`.env.example` 里为 `1`） | 反向代理层数或 Express `trust proxy` 取值 |
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
