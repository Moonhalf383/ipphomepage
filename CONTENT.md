# 门户内容维护

三份正式数据都在 `src/content/`，图片只放本地 `public/images/`。**不要把真实成员或未公布赛事写入开发 mock。** 页面展示不意味着社团正式审核、赛事报名开放，或素材已经获得再使用授权。

## 常规操作

1. 确认本人愿意公开姓名、身份、年级、介绍、头像和外部链接；确认图片授权。
2. 放入图片，编辑对应 JSON；字段名、枚举和必填项由 `shared/content.ts` 校验。
3. `npm run check:content`，再通过 `npm run dev` 检查桌面/手机与深浅色。
4. `npm run build`，按既有部署流程发布构建。JSON 不是运行时接口，线上更新必须重新构建。

Vite 启动/热更新/构建也会检查；图片不存在、重复 ID、危险 URL、路径越界、字段拼写错误和不合法的日期会报错，而不是静默带入生产。字符串会被去除首尾空白，可选数组/布尔字段补默认值。编辑者也应人工检查描述事实、外链可用性和授权状态，校验程序不能代替这些审核。

## 当前服务器上的内容更新

网站目录为 `/opt/iplusplus-club/`，发布工作区为 `/home/rhinestone/ipp-account-release/`。先确认修改的是哪一份；构建只读取命令所在项目目录的 JSON。

若修改了发布工作区的成员配置，先同步到网站目录：

```bash
sudo install -o iplusplus -g iplusplus -m 644 \
  /home/rhinestone/ipp-account-release/src/content/people.json \
  /opt/iplusplus-club/src/content/people.json
```

如有新增或替换的头像，同时同步 `public/images/people/` 下对应文件。发布前备份当前 `dist/` 和配置，再执行：

```bash
sudo -u iplusplus sh -c '
  set -e
  cd /opt/iplusplus-club
  npm run check:content
  npm run build -- --outDir dist-next
  rsync -a --exclude=index.html dist-next/ dist/
  cp dist-next/index.html dist/index.html.next
  mv dist/index.html.next dist/index.html
'
```

构建成功后先更新资源，再切换页面入口。刷新 `/people` 查看结果，无需重启服务。将确认后的 JSON、头像同步到本地仓库并提交，保持本地、发布工作区和网站目录一致。

## 成员与支持者

编辑 `src/content/people.json` 的 `people` 数组。以下为字段示例，头像路径需对应实际文件：

```json
{
  "people": [
    {
      "id": "replace-with-member-id",
      "name": "填写真实成员公开名",
      "avatar": "/images/people/replace-with-avatar.webp",
      "description": "本人确认可公开的简短介绍。",
      "title": "前社长",
      "year": 2025,
      "group": "core",
      "featured": true,
      "lead": false,
      "links": [
        { "label": "个人博客", "url": "https://example.com/" },
        { "label": "GitHub", "url": "https://github.com/example" }
      ]
    }
  ]
}
```

- `id`：唯一、稳定的小写英文/数字/连字符 slug；更改姓名不必改 ID。
- `name`、`title`：必填字符串，分别最多 80 字符；身份是普通字符串，不决定排序。
- `description`：必填，最多 3000 字符；封面显示三行，可通过“翻开这一页”读完整内容。
- `avatar`：必填本地路径。推荐 256×256 以上的 WebP，方形主体，尽量小于 150KB；这些尺寸/大小是建议，不是硬性校验规则。加载失败会显示姓名首字，不影响其他内容。
- `year`：**整数**，例如 `2025`，不是字符串 `"2025级"`，可接受 1900–2100。含义为入学年级，不是职务任期。
- `group`：`core`（核心成员）或 `supporter`（支持者）。两类分架展示，各组年级倒序，同年级按 JSON 顺序；标记 `lead` 的现任社长排在所在组的最前面，不受年级影响。
- `featured`：可选，默认 `false`；首页取前四位精选，600px 以下只显示前两位；完整书架不截断。
- `lead`：可选，默认 `false`；标记**现任社长**，全站至多一位，标记两位以上会校验报错。社长头像显示为方形（其余人保持圆角），并排在名录与首页精选的最前面；`title` 写什么都不影响这个标记，卸任后记得改回 `false`。
- `links`：可省略或留空，最多 30 条；每条 `label` 最多 40 字符、`url` 最多 2048 字符。书签展示前三条，多余条目由“更多”弹窗展示。可用纯键盘浏览及关闭。

只添加/修改 JSON 和头像即可，不需要改 React 页面。正式列表为空时：开发模式自动显示有标识的虚构样例；生产模式首页隐藏成员预览，`/people` 显示空书架。真实成员一旦录入，开发模式同样使用真实列表，不再混入 mock。

## 项目

编辑 `src/content/projects.json` 的 `projects` 数组。现已精选 Dora SSR、YueScript、Dora Story 和《灵数奇缘》，关系说明以官方项目资料为依据；《灵数奇缘》标注 IppClub 技术支持，不冒认全部开发归属。

必填字段：

| 字段           | 用途                                         |
| -------------- | -------------------------------------------- |
| `id`、`name`   | 稳定唯一标识与名称                           |
| `summary`      | 项目介绍，最多 1000 字符                     |
| `category`     | `engine` / `language` / `framework` / `game` |
| `relationship` | 与社团的真实关系，最多 200 字符              |
| `tags`         | 最多 8 项，每项最多 30 字符；允许空数组      |
| `licenseNote`  | 代码/资源使用提醒，最多 600 字符             |
| `sourceUrl`    | 核实项目介绍及授权的官方来源                 |

可选：`featured`（首页前三个）、`links`、`cover`、`coverAlt`、`illustration`。

- `cover` 放 `/images/projects/`，填写时 `coverAlt` 必须非空。推荐 16:10 或 16:9，主体留安全边距；原图不会随主题反色。
- 不提供封面时使用抽象示意 SVG，`illustration` 可为 `engine`、`code`、`story`、`game`。示意图明确写有“非运行截图”，不是项目角色或宣传原画。
- Dora SSR 作为当前主推项目；首页精选与独立页面有不同排版。调整主推逻辑需同时检查 `Home.tsx` 与 `Projects.tsx`，不要仅凭 `featured` 推断全部页面的主推位置。
- 不因为 GitHub 代码仓库开源就下载使用角色图、截图、音乐或 Logo。特别注意 Spine Runtime 和游戏美术的独立许可。
- 内容人工维护，不实时请求 GitHub，不显示未经维护的星数、最后更新时间或“停止维护”标签。

## 赛事预留与后续发布

`src/content/events.json` 收录已确认可公布的赛事；没有赛事时保持 `{ "events": [] }`，页面显示“目前暂无已公布赛事”。**不要为了填满页面发布格式样例。** 当前收录 2026 开源游戏开发大赛（我社身份：宣传与支持，`role: support`），海报位于 `public/images/events/osgame-2026.webp`。

未来正式收录时，可使用如下结构（以下完全是格式占位，不代表赛事计划）：

```json
{
  "events": [
    {
      "id": "replace-with-confirmed-event-id",
      "name": "替换为已确认的真实赛事名",
      "summary": "已确认可公开的赛事介绍。",
      "status": "upcoming",
      "role": "organizer",
      "startDate": "2030-01-01",
      "endDate": "2030-01-03",
      "location": "替换为真实地点或线上",
      "links": [{ "label": "赛事公告", "url": "https://example.com/" }]
    }
  ]
}
```

- 必填：`id`、`name`、`summary`（最多 2000 字符）、`status`、`role`、`startDate`。
- `status`：`upcoming`（即将开始）、`ongoing`（进行中）、`completed`（已结束）。**状态由编辑者维护，不会根据日期自动变更**，请在开始/结束后更新。支持按状态筛选。
- `role`：`host`（主办）、`cohost`（联合主办）、`organizer`（承办）、`support`（支持）。必须核实社团在该赛事中的实际身份。
- 日期为有效的 `YYYY-MM-DD`；`endDate` 可省略，不得早于开始日期。页面仅展示日期，不作时区换算；赛事按开始日期倒序，同日保留 JSON 顺序。
- 可选 `location`、`links`、`cover` 与 `coverAlt`。封面放 `/images/events/`，有封面必须有替代文本。
- 外链可以指向已有官方公告、报名系统或赛后作品集；本站**没有**内置报名、身份验证、投稿、评审、奖项管理或倒计时。不要填入不确定的时间或虚构已承办赛事。

## 图片与链接安全

图片路径必须是 `/images/people/...`、`/images/projects/...`、`/images/events/...` 下的 PNG/JPEG/WebP/AVIF/SVG。禁止 `..`、编码路径、反斜杠、查询参数和路径越界软链接。建议使用简单 ASCII 文件名。校验存在性和路径，不验证文件真实像素格式，也不净化 SVG；仅发布可信、审核过且无脚本/外部依赖的 SVG，优先使用压缩位图。

外链仅接受无账号密码的 HTTP(S)，推荐 HTTPS；所有内容外链自动以新窗口打开并设置 `noopener noreferrer`、读屏提示。编辑者仍须确认链接真实、持续可用且不含敏感查询参数。

## 站娘与主题

- 人物 SVG 重绘已停止并撤回；成员书架原站娘位置改为 **“站娘 · 待施工”** 牌（`src/pages/People.tsx` / `src/community.css`），不再加载人物、眨眼或视线跟随逻辑。
- `src/components/Mascot.tsx` 只保留首页猫咪符号与爪印。后续若有合适的、已授权的人物素材，再另行确认接入方案。
- 参考 JPG 没有放入 `public`，不对外发布照片。
- `src/theme/palette.ts` 的 `--art-*` 是固定插画配色；同一种子色下不随日夜改变。`--md-sys-color-*` 和扩展 UI 角色依旧自动切换；爪印等小型 UI 点缀也跟随界面角色色，不属于固定画面。不要给头像、原画、封面或证书加全局反色滤镜。
- `src/community.css` 控制书架/工坊/赛事布局及有限悬停互动；小屏和减少动态效果偏好下不启用装饰动画。

## 回归

```sh
npm run check:content
npm test
npm run test:e2e
npm run test:production
```

生产测试扫描编译产物确认没有 mock 模块/内联头像，并在临时目录构建虚构成员/赛事夹具来验证只编辑 JSON 和图片即可展示，结束后销毁临时数据，不改动正式名录。发布前还应人工核对实际头像裁剪、链接目的地、长名字、窄屏书签和待施工牌布局是否合适。
