# Naimakes

Naimakes 论坛 —— 一个讨论人工智能、太空探索、生命科学与人类未来的中文社区网站。
*思想，先于未来。*

## 技术栈

- **前端**：React 19 + TypeScript + Vite，富文本编辑使用 TipTap，动效使用 Motion，3D 部分使用 three.js
- **后端**：Node.js（≥ 24）+ Express 5，内置限流（express-rate-limit）与安全头（helmet）
- **AI 助手**：通过 `@anthropic-ai/sdk` 调用 Claude，或经 Anthropic 兼容接口调用 DeepSeek（可选，需配置 `ANTHROPIC_API_KEY` 或 `DEEPSEEK_API_KEY`）
- **部署**：Docker 多阶段构建 + Caddy 反向代理（自动 HTTPS）

## 目录结构

```
index.html / landing.html   论坛与落地页入口
src/
  forum/                    论坛前端（首页、帖子、版块、搜索、私信、个人主页、治理等）
  landing/                  落地页
  assistant/                AI 助手界面
  typography/               字体与排版（Newsreader、Noto Serif SC）
  interaction/              通用交互样式
server/                     Express API 与业务模块（数据库、账号、帖子、通知、搜索、助手等）
scripts/                    运维与构建脚本（备份、导入、设置管理员、部署检查、打包发布、字体生成）
public/                     静态资源（favicon、加载动画）
models/                     Blender 3D 模型源文件与生成脚本
Dockerfile, compose.yaml    容器化部署
Caddyfile                   反向代理与 HTTPS 配置
.env.example                环境变量示例
```

## 本地开发

需要 Node.js 24 或更高版本。

```bash
npm ci
cp .env.example .env     # 按需修改
npm run dev              # 同时启动前端与 API 开发服务器
```

## 构建与运行

```bash
npm run build            # 类型检查并构建前端到 dist/
npm start                # 启动 API 服务（同时托管 dist/）
```

## 环境变量

完整示例见 `.env.example`。

| 变量 | 说明 |
| --- | --- |
| `APP_ORIGIN` | 站点对外地址，如 `https://forum.example.com` |
| `DOMAIN` | Caddy 使用的域名 |
| `ADMIN_EMAIL` | 管理员邮箱 |
| `COOKIE_SECURE` | 生产环境保持 `true` |
| `SEED_DEMO` | 是否写入演示数据，生产环境保持 `false` |
| `PORT` / `HOST` | API 监听端口与地址 |
| `DATA_DIR` | 数据目录 |
| `DEEPSEEK_API_KEY` | 使用 DeepSeek（默认模型 `deepseek-flash`）时填写，优先于 `ANTHROPIC_API_KEY` |
| `ANTHROPIC_API_KEY` | 使用 Claude 时填写；与 `DEEPSEEK_API_KEY` 都留空则不启用 AI 助手 |
| `ASSISTANT_MODEL` / `ASSISTANT_EFFORT` | 助手使用的模型，以及未选择思考模式时的默认推理强度（DeepSeek V4.1 Flash 填 `deepseek-flash`） |
| `ASSISTANT_TITLE_MODEL` | 生成对话标题的轻量模型，留空时 DeepSeek 用 `deepseek-flash`、Claude 用 `claude-haiku-5-5` |
| `ASSISTANT_RATE_LIMIT` / `ASSISTANT_DAILY_LIMIT` | 助手的频率与每日用量限制 |

## 部署（Docker Compose）

1. 复制 `.env.example` 为 `.env`，填写 `APP_ORIGIN`、`DOMAIN`、`ADMIN_EMAIL` 等。
2. 创建站长账号文件 `secrets/owner.json`（`compose.yaml` 以 Docker secret 方式挂载，该目录已被 `.gitignore` 忽略）。可在交互式终端运行 `npm run create-site-owner` 生成。
3. 启动：

   ```bash
   docker compose up -d --build
   ```

4. 部署前可运行 `npm run check:deploy` 检查配置。

数据与备份分别保存在 `forum_data` 与 `forum_backups` 卷中。

## AI 助手的思考模式

用户可在“设置 → Naimakes”或助手对话框里切换思考模式，选择会同步到账户：

| 档位 | 推理强度 |
| --- | --- |
| 快速（默认） | `low` |
| 均衡 | `medium` |
| 深入 | `high` |

用户最高只能选到 `high`；`xhigh` / `max` 只能由管理员通过 `ASSISTANT_EFFORT` 设置。

## AI 助手的对话历史与分享

登录用户的助手对话会在每轮结束后自动保存到账号，数据存放在 SQLite 的 `assistant_chats` 表中（启动时自动建表，无需手动迁移）。游客的对话只保存在浏览器本地，不会上传。

- **标题**：第一轮问答结束后，由轻量模型（`ASSISTANT_TITLE_MODEL`）生成不超过 14 个汉字的标题；生成前先用第一个问题的开头作为临时标题。
- **历史列表**：助手面板头部的时钟图标。可以重新打开、置顶、收藏、隐藏（在“已隐藏”标签里找回）和删除对话。
- **容量**：每人最多保存 100 段对话，每段最多保留最近 40 条消息；超出时自动清理最旧的，置顶和收藏的对话不会被清理。
- **不保存的内容**：错误提示、附件预览图和助手执行站内操作时产生的操作卡片；只保留文字、引用来源和附件的文件名与类型。
- **分享**：分享的是点击分享那一刻的只读快照，之后的新消息不会同步，只有登录用户能打开。
  - 链接：`/?nmk-chat=<token>`，对方可以把它保存为自己的一段对话继续聊。
  - 站内成员：沿用帖子的分享流程，对话会以卡片形式发到对方私信。
  - 取消分享或删除对话后，链接和私信卡片都会失效；已注销用户分享的链接同样失效。

接口（均需登录，限定为本人对话）：`GET /api/assistant/chats`、`GET|PUT|PATCH|DELETE /api/assistant/chats/:id`、`POST|DELETE /api/assistant/chats/:id/share`、`GET /api/assistant/shared/:token`、`POST /api/assistant/shared/:token/save`，以及生成标题的 `POST /api/assistant/title`。

## 图书馆

登录用户的「图书馆」（账号菜单 → 图书馆，路径 `/library`）收纳自己上传过的全部文件、图片和 PDF，数据存放在 SQLite 的 `library_files` 表中（启动时自动建表，并把已有的帖子、评论、私信附件一次性补录进来）。

- **来源**：发帖、评论、私信里添加的附件；和 AI 助手对话时附上的文件（登录后自动保存，同一份内容不会重复保存）；以及在图书馆里点「上传」直接添加的文件。文件独立于帖子和对话，删除聊天记录或帖子不会删除这些文件。
- **分类**：顶部的液态玻璃滑动选择器依次是「全部 / 收藏 / 图片 / PDF / 文稿 / 表格 / 音视频 / 其他」。
- **操作**：点文件即可查看，也可以直接下载；多选（「选择」按钮）后可批量收藏、删除。右键（移动端长按）文件还可以置顶、隐藏。
- **已隐藏**：隐藏的文件不出现在「全部」和各分类里，在页面右上角「⋯」→「已隐藏」中查看和取消隐藏。
- **已删除**：删除是软删除，文件进入右上角「⋯」→「已删除」，保留 30 天后由服务端自动清除（每小时清理一次）；期间可以查看、下载、恢复，也可以手动彻底删除或清空。彻底删除时，只有没有被任何帖子、头像等内容继续引用的文件才会从磁盘移除。
- **容量**：每人最多保存 2000 个文件（含「已删除」里的）；单个文件上限仍为 25MB。

接口（均需登录，限定为本人文件）：`GET /api/library/files`、`POST /api/library/files`（登记已上传的文件）、`POST /api/library/files/action`（`favorite` / `unfavorite` / `pin` / `unpin` / `hide` / `unhide` / `delete` / `restore` / `purge`，一次最多 200 个）、`DELETE /api/library/trash`（清空已删除）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run backup` | 备份数据 |
| `npm run import-data` | 导入数据 |
| `npm run create-site-owner` | 创建站长账号 |
| `npm run set-admin-role` | 设置管理员角色 |
| `npm run check:deploy` | 部署配置检查 |
| `npm run package:release` | 打包发布 |
| `npm run build:fonts` | 重新生成字体样式（需要 Python 3） |

## 3D 模型

`models/` 下是用 Blender 制作的模型（archive-card、array-lighting）及其生成脚本（`models/blender-scripts/`），可用于重新生成素材。

## 许可证

见 [LICENSE](LICENSE)。
