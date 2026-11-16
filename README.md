# I++ Club · 新主页

面向 **https://iplusplus.club** 的独立新站。现有博客 `https://ippclub.org/` 和 Blogroll `https://ippclub.org/blogroll/` 保持不变，不涉及迁移或旧站改动。

## 本地运行

需要 **Node.js 24.14+**（使用内置 `node:sqlite`）。

```sh
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD（生产环境至少 16 字符）
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci
npm run dev
```

打开 `http://localhost:5173`。API 监听 `3001`，由 Vite 同源代理。默认只信任 `PUBLIC_ORIGIN` 的来源（协议、主机、端口必须一致）；局域网开发需显式配置下述开发白名单，不能通过放开所有来源解决。本地无默认管理密码，未配置时不允许登录。`SHARP_IGNORE_GLOBAL_LIBVIPS=1` 用于避免本机 libvips 触发 Sharp 本地编译，普通环境可省略。

- `/`：服务导航、精选项目与成员、赛事入口
- `/people`：成员与支持者书架，支持搜索、组别与年级筛选
- `/projects`：项目工坊，Dora SSR 为主推项目
- `/events`：赛事展台；当前为空，不代表已有赛事或开放报名
- `/assessment`：问卷入口、隐私告知与昵称填写
- `/assessment/:id`：答题、评分、结果与证书图片下载，仅创建记录的浏览器可访问
- `/verify`、`/verify/:id`：公开证书验真
- `/admin`：受保护的题库、审核设置、最近 100 条答题记录与证书撤销

```sh
npm run check:content # JSON schema、唯一 ID、本地图片存在性与路径校验
npm run build        # TypeScript + 内容校验 + Vite 生产构建
npm test             # 内容/配色/领域逻辑和真实 SQLite / HTTP 接口测试
npx playwright install chromium
npm run test:e2e     # 自动启动独立测试服务，使用独立测试数据库
npm run test:production # 真实生产 CSP、演示数据剔除、临时夹具验证新增成员/赛事
npm audit
```

## 局域网开发与“不可信来源”提示

从局域网 IP、开发域名或不同端口进入时，浏览器发送的 `Origin` 可能不等于 `PUBLIC_ORIGIN`。此时写接口返回 `403 / UNTRUSTED_ORIGIN`：这是 CSRF 校验拒绝配置外来源，不代表已经遭到入侵。

开发时，将 `dev.local.example.json` 复制为 **`dev.local.json`**，填入实际地址（以下 IP 仅为格式示例）：

```json
{ "allowedOrigins": ["http://192.168.1.20:5173"] }
```

修改后重启 `npm run dev`。只填写你控制的来源，不支持通配符；IP 或端口变化需要更新。该文件已被 Git 和 Docker 构建上下文忽略，**生产环境既不读取，也不应用开发例外**，仍只信任 `PUBLIC_ORIGIN`。不会信任请求中的 Host / X-Forwarded-Host 来动态放行。不同地址的浏览器 Cookie 不共享，请从创建问卷的地址继续答题。

正式域名访问仍报错时，应核对生产 `PUBLIC_ORIGIN` 与浏览器地址及反向代理是否保留 Origin，不要关闭校验。证书二维码始终使用 `PUBLIC_ORIGIN`，开发白名单不会改变签发地址。局域网 HTTP 仅用于可信开发网络，不应承载生产凭据或公开暴露。

## 成员、项目与赛事维护

维护方式是 **JSON + 本地图片**，没有新增管理 CMS。详见 [CONTENT.md](CONTENT.md)。

- `src/content/people.json`：正式成员与支持者；头像放 `public/images/people/`。服务器修改后的构建与同步步骤见 `CONTENT.md`。
- `src/content/projects.json`：人工精选的项目资料和官方链接，可选封面放 `public/images/projects/`。不实时拉取 GitHub API、星数或活跃度。
- `src/content/events.json`：赛事展示记录，目前为空；可选封面放 `public/images/events/`。支持时间、状态、社团参与身份和外部链接，不包含报名、投稿与评审系统。
- 开发模式且正式名录为空时，`src/dev/mockPeople.ts` 生成固定种子的 **虚构演示人物**，页面明确标注。生产构建完全移除该模块及头像；正式无数据时首页不显示成员预览，书架显示真实空状态。添加真实资料后，开发环境也不再混入演示人物。
- Vite 启动、JSON 热更新与生产构建会执行内容校验；修改图片会刷新/重新检查。发布内容需要重新构建，修改 JSON 不会直接改变已部署的 bundle。

## 已实现的规则

- 初始题库为 **演示内容**，包括社区礼仪、尊重与协作、隐私与安全。默认抽取 8 题、80 分通过。正式签发默认关闭。
- 单选、多选、判断为客观计分题；简答（最多 2000 字）和固定 1–5 级量表为选填、不计分题。
- 每份问卷在服务器用密码学随机源无放回抽样，至少包含一道计分题。同一匿名浏览器存在有效未提交问卷时恢复原题，不重新抽题。题目和评分规则保存为不可变快照。
- 多选必须与标准答案集合完全一致才得分，没有部分分或倒扣。总分按抽取的客观题分值归一化为 100 分。显示分数保留最多两位小数，是否通过按原始比例判断。
- 正确答案、解析与评分逻辑不下发到浏览器。客观题必须全部完成；后台再次校验选项、题号和类型，不信任客户端分数。
- 进度在停止输入 500ms 后自动保存；当前浏览器的匿名 Cookie 有效 24 小时，问卷有效 60 分钟。正在保存时立即关闭网页可能丢失最后一次输入。正式审核被暂停时，未提交的正式问卷也暂停提交。
- 评分与正式证书入库处于同一事务；重复提交返回同一结果，不重复签发。未通过不签发，演示通过只允许下载明确标注 DEMO 的纪念图片。
- 正式证书包含 UUID、昵称、评分、签发时间、规则版本、在线验真二维码。PNG 由服务器 Sharp 生成，生成时 XML 转义昵称。已撤销证书不可再次下载，验真返回撤销状态。
- 修改题库和设置递增规则版本，不改变历史问卷和已开始问卷。正式模式下不允许将题库减至无法满足抽题要求。

## 从演示到正式

1. 设置强管理密码，进入 `/admin`。
2. 审核、编辑或替换演示题目；核对标准答案、分类、分值与启用状态。
3. 在“审核设置”设定题数与通过线。
4. 明确勾选已代表社团审核题库，开启“正式审核与证书签发”。
5. 使用新浏览器上下文走一次正式通过、PNG 下载、二维码验真和撤销测试。开启前已开始的演示问卷始终是演示，不能升级为正式证书。

## 部署到 iplusplus.club

提供单机 **Docker Compose + Caddy 自动 HTTPS + SQLite 持久卷**。这是部署配置，不表示域名、DNS 或服务器已被配置。

1. 将域名 A/AAAA 记录指向部署机器；有 AAAA 时应确保 IPv6 真正可达。
2. 允许入站 TCP 80/443 和可选 UDP 443，不对外暴露 Node 3001。
3. 在项目目录 `.env` 设置强随机 `ADMIN_PASSWORD`，至少 16 字符。可用 `openssl rand -hex 32` 生成。不要提交 `.env`。
4. 执行 `docker compose up -d --build`。Caddy 使用 `Caddyfile` 中的 `iplusplus.club` 申请证书。
5. 检查 `docker compose logs app caddy`、`https://iplusplus.club/api/health` 及完整流程。

Compose 固定生产 `PUBLIC_ORIGIN=https://iplusplus.club`。不使用 Docker 时先构建，再配置 `NODE_ENV=production`、`PUBLIC_ORIGIN`、`ADMIN_PASSWORD`、`DATABASE_PATH`，执行 `npm start`，由可信 HTTPS 反向代理转发。仅有且恰有一层可信代理时设置 `TRUST_PROXY=1`；不要直接暴露启用该选项的端口。若加 CDN，需重新设计代理信任与真实 IP 提取策略。

服务启动时会检查生产 HTTPS 来源和管理密码长度。服务端生成证书二维码使用配置来源，不能由请求头或用户输入决定。

### 数据和运营

- SQLite 文件默认 `data/club.sqlite`；Docker 中位于 `club-data` 卷。**禁止对该卷执行 `docker compose down -v`，除非明确要删除全部记录。**
- 单实例部署，不支持多副本共享网络文件系统 SQLite。频率限制在进程内，重启会清空计数；规模扩大时应替换为共享限流和数据库。
- 备份应使用 SQLite Online Backup API / SQLite `.backup`，或先停止应用后备份整个数据目录（含 WAL/SHM），不要直接复制正在写入的主数据库文件。先在测试环境验证恢复。
- 当前不会自动清理答题和证书记录，以保持验真持续可用。上线前社团应明确数据保留期限、隐私联系渠道及删除处理制度。答案和昵称可含个人信息，限制服务器与备份访问。
- 管理 Cookie 和匿名记录权限都是随机高熵能力令牌，数据库只存令牌哈希；Cookie 设置 HttpOnly、SameSite=Strict，生产增加 Secure。写接口要求 Origin 精确匹配，防止 CSRF；密码比较使用定时安全的哈希比较，配置中没有预设密码。
- 管理会话 8 小时过期，可显式退出。轮换环境密码不会立即撤销已有会话；若泄露，轮换密码同时清空 SQLite `sessions` 表，并调查历史操作。当前为单管理员模式，尚无多角色和不可篡改管理审计日志。
- 频率限制：每 IP 一小时最多开始 12 次、15 分钟最多 5 次登录请求、API 总量 15 分钟 300 次；不是身份核验，清 Cookie 或更换网络无法被可靠归一为同一个人。校内共享 IP 可能需要按实际流量调整。
- 匿名浏览器 Cookie 丢失后不能恢复私有答题页面或原始证书下载；请及时下载并保存证书编号。公开验真入口仍可访问。证书撤销不会删除已经下载的图片，因此必须核对在线状态。

## 信任边界

**验真证明系统签发过这次达标记录，不证明答题者真实身份、独立完成、人格素质或自动入社资格。** 用户无需登录，昵称自行填写，不能有效阻止替答、分享答案或多次重考。若未来要将其作为正式入社身份凭据，需要额外身份绑定、人工复核和更完整的审计。

公开验真仅提供证书昵称、得分、时间、规则版本与撤销状态；不公开答案。用户在开始前明确同意记录保存与这些字段的公开范围。

## Material 3 设计

- 使用官方 `@material/web` Filled、Filled tonal、Outlined、Text Button，保留状态层、键盘焦点和交互行为。
- `src/styles.css` 集中定义 Material 3 light/dark semantic color roles、surface container 层级、shape scale、动效曲线、表单焦点与状态层。紫色为主色，薄荷与杏色作为扩展语义色成对定义前景。
- 主页使用原创 CSS 几何插画和字体层级表达 I++ 品牌，不依赖付费图片或远程字体；响应式导航、单列移动布局、44–48px 交互区域、skip link、语义表单、对话框焦点约束和 reduced-motion 支持。
- 页头调色盘提供 6 组预设种子色（鸢尾紫、海盐蓝、松石青、森林绿、落日橙、玫瑰粉）和自定义 HEX / 系统取色器。使用 Google 官方 `@material/material-color-utilities` 的 HCT `SchemeTonalSpot` 生成完整 M3 色彩角色，不直接拿原始颜色作为按钮背景；薄荷与杏色扩展色通过 `Blend.harmonize` 协调。
- 深浅色主题遵循系统初始偏好，种子色与模式分别保存在 `ipp-seed` / `ipp-theme`。刷新、路由切换及同源其他标签页可保持偏好；禁用存储时仍能在当前页面切换。
- 昼夜按钮使用 View Transitions API + Web Animations，将新页面快照放在旧快照之上，以按钮中心为圆心，680ms 扩散至视口最远角。两个方向都保持“圈内新模式、圈外旧模式”。键盘触发同样使用按钮中心，快速连续切换以最后意图为准；API 缺失、快照失败或开启减少动态效果时立即完成实际主题变更，不阻塞操作。
- `src/motion.css` 统一使用 M3 standard / emphasized / spring 曲线。几乎所有可见卡片、状态容器、筛选按钮、项目/成员/赛事插画和后台列表都提供 180–500ms 的抬升、阴影、形状变化及内部元素联动；只在 `hover:hover` + `pointer:fine` 下启用空间悬停，触屏不会模拟 hover。没有无限循环装饰动画。
- 路由进入采用 500ms 的淡入、位移、轻微缩放、模糊和圆角裁切，只动画现有 main 节点，不通过给 Routes 加 key 来重新挂载整页表单。项目/成员/赛事筛选、管理 Tab、问卷换题、状态/详情出现另有 300–480ms 的有限切换动画；对话框及昼夜圆形扩散保持独立动效。
- `prefers-reduced-motion: reduce` 会停用路由、切换、悬停位移、视差和装饰动画，保留立即可见的状态变化与完整操作能力。键盘焦点仍有清晰焦点环，不能悬停的核心信息均有文字或状态色表达。
- 插画分为独立的 `--art-*` 固定色系：同一种子色的 I++ 三色牌、书脊和项目示意画面，其填充/前景/边缘在昼夜模式下完全相同；UI 背景、容器与按钮仍按 M3 切换。头像和项目原始图片不参加 HCT 调色或 CSS 滤镜。
- 成员书架原站娘位置现在显示 **“站娘 · 待施工”** 牌，不渲染人物。两轮人物重绘、眨眼/视线跟随代码已撤回；`src/components/Mascot.tsx` 只保留首页猫咪符号和爪印，原始照片不进入生产资源。待施工牌仅在精确鼠标悬停时轻微摆正，不是按钮。
- 成员卡采用书脊与书签结构，最多直接展示三条链接，超出的链接和完整简介通过原生 modal dialog 阅读；键盘 Escape/焦点回退、头像失败占位、长文本换行与移动端布局均保留。窄屏主导航改为五项底部导航，赛事入口位于首页、项目页和页脚。
- 证书有独立可打印浅色外观，Docker 安装 Noto CJK 中文字体；本地生成中文 PNG 也需可用 CJK 字体。

## 结构

```text
src/pages/       Home / People / Projects / Events / Assessment / Verify / Admin
src/content/     正式 JSON 数据、类型化导出、开发演示隔离 Provider
src/dev/         仅开发使用的虚构人物及内联头像
src/components/  猫咪品牌符号、成员书本、项目示意插画
src/community.css 书架、工坊、赛事与门户响应式样式
public/images/   people / projects / events 本地内容图片
shared/content.ts 内容 schema 与类型
scripts/         内容校验 CLI 与 Vite 插件
src/styles.css   Material 3 基础样式、响应式布局、品牌图形
src/theme/       HCT 配色生成、主题设置、圆形快照转场与偏好存储
src/motion.ts    页面入场与鼠标视差（不重新挂载表单）
src/motion.css   悬停、按压、标题与装饰图形动效
shared/types.ts  前后端共享数据类型（不包含答案题库）
server/app.ts    API、权限、SQLite 持久化、事务签发
server/domain.ts 题库校验、随机抽题、评分
server/origin.ts 严格来源解析与仅开发生效的显式来源配置
dev.local.example.json 局域网开发来源模板（实际 dev.local.json 不提交）
server/seed.ts   仅服务端使用的演示题库
server/certificate.ts 服务端证书 PNG 与二维码
tests/          单元、集成和浏览器端到端测试
```
