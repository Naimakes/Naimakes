# Naimakes

Naimakes 论坛 —— 一个讨论人工智能、太空探索、生命科学与人类未来的中文社区网站。
*思想，先于未来。*

## 技术栈

- **前端**：React 19 + TypeScript + Vite，富文本编辑使用 TipTap，动效使用 Motion，3D 部分使用 three.js
- **后端**：Node.js（≥ 24）+ Express 5，内置限流（express-rate-limit）与安全头（helmet）
- **AI 助手**：通过 `@anthropic-ai/sdk` 调用 Claude（可选，需配置 `ANTHROPIC_API_KEY`）
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
| `ANTHROPIC_API_KEY` | AI 助手所需密钥，留空则不启用 |
| `ANTHROPIC_BASE_URL` | 兼容 Anthropic 接口的服务地址，留空使用 Claude 官方；用 DeepSeek 时填 `https://api.deepseek.com/anthropic` |
| `ASSISTANT_MODEL` / `ASSISTANT_EFFORT` | 助手使用的模型，以及未选择思考模式时的默认推理强度（DeepSeek V4.1 Flash 填 `deepseek-flash`） |
| `ASSISTANT_TITLE_MODEL` | 生成对话标题的轻量模型 |
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
