# iplusplus.club 安全审计报告

- 日期：2026-11-17（CST）
- 范围：`https://iplusplus.club` 站点与源服务器（cannedberry 主机，Debian 13.7/arm64），本地源码仓库本目录
- 架构实况：Cloudflare（代理 DNS）→ nginx + Certbot（TLS 终止）→ systemd `iplusplus-club.service`（NODE_ENV=production，node/tsx 直跑，非 Docker）→ Express 5 监听 `127.0.0.1:3001`，SQLite（`/opt/iplusplus-club/data/club.sqlite`）
- 方法：本地静态审计（依赖/密钥/代码走查/前端产物）+ 线上低速率主动测试 + 服务器侧配置/日志/数据抽样。仅使用不存在邮箱 `example.invalid` 与伪造 IP 做探针，未针对真实账号，未删除任何数据。

## 一、发现汇总（按严重度）

| # | 级别 | 发现 |
|---|------|------|
| M-1 | 中 | 源站 IPv6 公开暴露（api.yorozumoon.cn DNS-only AAAA），可直接绕过 Cloudflare 层防护 |
| M-2 | 中 | `ipp_guest` cookie 客户端可任意设置/固定，匿名答题归属完全由该 token 决定 |
| M-3 | 中 | club 数据库仅有手动快照备份，无自动化，滞留副本含密钥 |
| M-4 | 中 | 111 个系统待升级包（含 Debian-Security 更新） |
| L-1 | 低 | `/etc/iplusplus-club.env` 仍保留 `ADMIN_PASSWORD`（生产登录路径已禁用） |
| L-2 | 低 | 4xx 错误透传内部消息（含 zod 校验模式正则） |
| L-3 | 低 | `password_reset_codes.email` 明文存储（TTL ≤1h，窗口内可枚举曾申请重置的邮箱） |
| L-4 | 低 | 遗留匿名 `/api/attempts` demo 通道在生产仍注册（当前因题库计分题不足实际不可创建；库内 10 条历史 guest 记录） |
| I-1 | 信息 | IPv6 普及使“按 IP 限流”单独不可靠；实测每邮箱维度限流有效兜底 |
| I-2 | 信息 | `RateLimit` 响应头暴露限流窗口参数（300-in-15min 等） |
| I-3 | 信息 | CSP 由 nginx 与 helmet 双重叠加（内容相容，注意未来漂移） |

## 二、发现细节与复现

### M-1 源站暴露，可绕过 Cloudflare
- 证据：`api.yorozumoon.cn` 的 AAAA 为源机公网 IPv6 `240c:c603:1007:a84f:...`；从外部直接 `curl -6 --resolve 'iplusplus.club:443:[240c:...]' https://iplusplus.club/api/health` 返回 `200 {"ok":true}`，证书 CN=iplusplus.club 校验通过。
- 影响：CF 的 WAF/机器人/速率规则全部旁路，直打 nginx+app；同机其他租户同样暴露。XFF 伪造经 `trust proxy=1` 最右跳语义验证不会污染 `req.ip`（bucket 不随伪造头变化），故 app 自身按真实 IP 的限流仍成立，但防护纵深显著变浅。
- 建议：nginx 443 仅放行 Cloudflare IP 段（nftables/ufw 白名单），或将该记录也改为 proxied / 迁移到 cloudflared Tunnel；CT 日志中避免 DNS-only 记录与隐藏源共用地址。

### M-2 guest token 固定化风险
- 代码：`server/app.ts` POST `/api/attempts`——若请求携带合法 64-hex `ipp_guest` 即原样复用（不轮换），归属 `owner=hash(token)`；GET/PATCH `/api/attempts/:id*` 仅比对 `row.owner === hash(req.cookies.ipp_guest)`。
- 影响：共享设备、XSS、日志/Referer 泄漏或攻击者预先设定的 token（浏览器会原样接受服务端 set 的 cookie 值）都可让他人读取该匿名记录（昵称、答题、成绩、证书）。实测公开创建被题库规则阻断（见 L-4），风险来自历史与恢复后的通道。
- 建议：服务端始终 `randomBytes` 新 token 并在创建时轮换；或绑定短时会话/服务端随机 owner id 写入 Set-Cookie 而非信任客户端值。

### M-3 数据库备份为手动快照、无自动化（可用性）
- 更正：存在 `/opt/iplusplus-backups/`（755 root，内含多次手动快照，最新为 2026-11-16，权限 700 root；部分快照目录含 `data/club.sqlite` 与 `service.env` 副本）。但无 club 相关 systemd timer/cron——sub2api 有自动备份，club 依赖手动；2026-09-19 的部署备份滞留且同样含 env 副本。
- 影响：RPO 不确定；单机同盘存放不抗宿主故障/勒索；备份链中 env/密钥副本扩大敏感文件面。
- 建议：每日自动 `sqlite3 .backup`（或 Litestream）+ 异地/CF R2 加密存放 + 保留策略与恢复演练；清理 9 月滞留快照并将备份根目录收紧为 700。

### M-4 系统补丁
- 证据：`apt-get -s upgrade`：111 upgraded（含 Debian-Security 源 util-linux/fdisk 等），11 held。
- 建议：立即 `apt full-upgrade` 评估，启用 unattended-upgrades（security pocket）。

### L-1 ADMIN_PASSWORD 残留
- `EnvironmentFiles=/etc/iplusplus-club.env (600 root)` 键清单含 `ADMIN_PASSWORD=`；生产 `allowLegacyAdmin=false`，实测 POST `/api/admin/login` 返回 410「请使用邮箱账号登录」。建议从 env 删除该键，避免未来误配置（如 NODE_ENV 漂移）复活旧后门。

### L-2 错误透传
- `app.ts` 错误处理器将 4xx `error.message` 原样返回，含 zod 内部正则文本（如 displayName 的 bidi 校验模式）。轻微信息泄露，也便于攻击者逆向校验规则。建议 4xx 归一化为业务文案 + code。

### L-3 重置码表明文邮箱
- `password_reset_codes(email PRIMARY KEY, codeHash, expiresAt, sentAt)`：对未注册邮箱也会建行（实测 `audit-*@example.invalid` 已入库、≤1h TTL 自动清理）。建议行内仅存 email 摘要，或缩短 TTL。

### L-4 遗留 demo 通道
- `domain.ts:83`「可用题目不足，或缺少计分题」阻断了当前创建；历史 10 条 `userId IS NULL` 记录仍在库。建议正式期外从路由层关闭 `/api/attempts*`（requireAccount 开启时本就 401，可彻底移除 demo 分支）。

## 三、验证通过项（无需整改）

- 依赖：`npm audit` 0 漏洞（含 production-only）；本地 `npm test` 47/47 通过。
- 密钥卫生：仓库/历史无真实密钥（仅测试常量与模板占位）；`.env`、`data/` 不出 git/docker 上下文；env 文件 600 root；数据目录 700 服务用户。
- 认证与会话：scrypt 口令哈希、12 位最短口令；会话/邮箱码均存摘要或 HMAC（无明文令牌落库）；登录双维度限流实测 9×401→429；验证码 60s 冷却 + 每邮箱 5/HOUR；未注册/已注册重置请求响应一致（无枚举 oracle）；旧版 ADMIN_PASSWORD 登录生产禁用（410）。
- CSRF/Origin：非 GET 无 Origin 或错 Origin 一律 403；GET 不受 Origin 约束但无副作用。
- 注入面：SQLite 全参数化；无 `dangerouslySetInnerHTML/innerHTML/eval`；证书 SVG 姓名转义；邮件头清洗；dist 无 sourcemap/dev 泄漏；路径穿越返回 SPA 壳而非源码；OPTIONS 无 CORS 反射。
- 传输与头：TLS 1.0/1.1 拒绝；HSTS preload；CF+nginx 双 CSP；server_tokens off；未认证管理面全 401；`/api/config`、`/api/join/schedules` 公开内容与预期一致（无 PII）。
- 宿主：防火墙仅 80/443/20022；sshd 禁 root/禁密码/MaxAuthTries 6；3001、redis、gitea、sub2api 均仅回环；journal 30 天无敏感信息；sqlite `integrity_check ok`；DDNS 单元加固良好。

## 四、修复优先级建议

1. 本周内：M-1 源站 IP 白名单/收敛暴露；M-4 打安全补丁；M-3 建立自动每日备份并清理滞留含密钥快照。
2. 下个发布：M-2 guest token 服务端生成+轮换；L-1 删除 ADMIN_PASSWORD；L-2 错误归一化。
3. 择机：L-3/L-4、I-2 收敛；为注册/重置/登录在 CF 层加速率规则兜底（对抗 IPv6 换址）。

## 五、审计操作留痕（可清理项）

- 生产库新增：`password_reset_codes` 2 行、`email_codes` 数行（均 `example.invalid` 假邮箱，TTL ≤1h 自动过期）；多次 429 探针占用伪造 IP bucket（9.9.9.x/203.0.113.x/198.51.100.x 等，不影响真实用户）。未创建/修改/删除任何真实账号、答题或邮件任务（群发功能未触发）。
