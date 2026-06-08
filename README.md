# Smart Sticky Notes

A self-hosted, chat-style sticky notes PWA — Markdown, voice, offline, multi-workspace, sync to local files.

> 一款自部署的聊天式便签应用，支持 Markdown、语音、离线使用、多工作区、同步到本地 Markdown 文件。

**[Live Demo](https://smartstickynotes.vercel.app)** · Designed by Anzhi

---

## 这个项目是什么

Smart Sticky Notes 是一个**你自己的笔记系统**。它不是注册即用的 SaaS 服务——你用你自己的云数据库，数据完全由你掌控。

**几个核心的组件：**

| 组件 | 做什么 | 跑在哪 |
|------|--------|--------|
| PWA 前端（`pwa/`） | 你每天使用的笔记界面 | 浏览器 / 手机桌面 |
| Supabase | 数据库 + 用户登录 | Supabase 云（免费额度够用） |
| SMTP（如 Brevo） | 发送登录验证码邮件 | SMTP 服务商 |
| PC 同步脚本（`sync/`） | 把云端笔记导出为本地 .md 文件 | 你的电脑 |

```
你打开 App → 输入邮箱 → 收到验证码（Brevo → 你的邮箱）
                         ↓
你输入验证码 → Supabase 验证通过 → 开始记笔记
                         ↓
你的笔记 → 存在你自己的 Supabase 数据库里
                         ↓
PC 同步脚本 → 把笔记下载成 .md 文件到你的电脑
```

---

## 准备工作：你需要哪些账号

在开始之前，你需要注册以下服务（全部有免费额度）：

| 服务 | 用途 | 注册地址 | 费用 |
|------|------|----------|------|
| **GitHub** | 存放代码 | [github.com](https://github.com) | 免费 |
| **Supabase** | 数据库 + 用户认证 | [supabase.com](https://supabase.com) | 免费（500MB 数据库，50,000 月活用户） |
| **Brevo**（或其他 SMTP） | 发送登录验证码邮件 | [brevo.com](https://brevo.com) | 免费（300 封/天） |
| **Vercel** | 部署网页 | [vercel.com](https://vercel.com) | 免费（100GB 带宽/月） |

> **关于 Brevo**：Supabase 自带的邮件服务只适合开发测试。你需要一个 SMTP 服务来发送真实验证码邮件。Brevo 只是推荐选项，你也可以用 SendGrid、Resend、阿里云邮件推送等任何 SMTP 服务。

---

## 第一步：配置 Supabase 数据库

### 1.1 创建 Supabase 项目

1. 打开 [supabase.com](https://supabase.com) → 登录 → **New project**
2. 填写项目名称（如 `my-notes`）→ 设置数据库密码（**记住这个密码**）→ 选择离你最近的区域 → **Create project**
3. 等待数据库初始化完成（约 2 分钟）

### 1.2 创建数据库表

1. 在 Supabase Dashboard 左侧菜单 → **SQL Editor** → **New query**
2. 打开本项目的 `supabase/migrations/001_initial.sql` → 复制全部内容 → 粘贴到 SQL Editor → **Run**
3. 再打开 `supabase/migrations/002_v2.sql` → 同样粘贴执行

执行成功后，你的数据库就有了所有需要的表和索引。

### 1.3 创建存储桶（用于语音笔记）

1. Supabase Dashboard → 左侧 **Storage** → **New bucket**
2. 名称填：`smartstickynotes_audio`
3. **勾选 "Private bucket"**（不公开）
4. 点击 **Create bucket**

### 1.4 记录你的连接信息

Supabase Dashboard → 左侧 **Settings** → **API**：

- 记下 **Project URL**（类似 `https://xxxxx.supabase.co`）
- 记下 **anon public key**（以 `eyJ` 开头的长字符串）

> ⚠️ **重要**：`anon key` 是可以公开的（它受 RLS 限制，只能访问你自己的数据）。但 `service_role key` 是**秘密**，永远不要公开或放到前端代码里。它只在你自己的电脑上用于同步脚本。

---

## 第二步：配置邮件发送（SMTP · 可选但推荐）

Supabase 自带测试邮件服务，每天有免费额度限制（约 4 封/小时），仅适合开发测试。如果你打算长期使用，建议配置自己的 SMTP，推荐 Brevo（免费 300 封/天）。

> 如果暂时不想配置 SMTP，可以先跳过这一步——你能收到验证码，只是数量有限。后续随时可以回来配置。

### 2.1 获取 SMTP 凭证（以 Brevo 为例）

1. 注册 [Brevo](https://brevo.com) → 登录
2. 左侧菜单 → **SMTP & API** → **SMTP Keys**
3. 点击 **Generate a new SMTP key** → 复制生成的密码
4. 记下以下信息：
   - SMTP 服务器：`smtp-relay.brevo.com`
   - 端口：`587`
   - 用户名：你的 Brevo 注册邮箱
   - 密码：刚刚生成的 SMTP key

### 2.2 在 Supabase 中配置 SMTP

1. Supabase Dashboard → **Authentication** → **Email**
2. 找到 **SMTP Settings** → 关闭 "Use custom SMTP" 旁边的开关（打开自定义 SMTP）
3. 填入 Brevo 的 SMTP 信息：

```
Host:        smtp-relay.brevo.com
Port:        587
Username:    your-email@example.com
Password:    你的 Brevo SMTP key
```

4. 点击 **Save**

### 2.3 配置邮件模板为发送验证码（重要）

Supabase 默认的 Magic Link 邮件发送的是一个**确认链接**（`{{ .ConfirmationURL }}`），用户点击链接后自动登录。但本项目使用的是 **8 位数字验证码**（OTP），你需要把邮件模板改成发送 Token：

1. Supabase Dashboard → **Authentication** → **Email Templates**
2. 找到 **Magic Link** 模板
3. 把邮件正文中的 `{{ .ConfirmationURL }}` **替换为** `{{ .Token }}`
4. 同时把邮件标题和正文改成中文：

**邮件标题示例：**
```
你的 Smart Sticky Notes 登录验证码
```

**邮件正文示例：**
```html
<p>你的登录验证码是：</p>
<h2>{{ .Token }}</h2>
<p>验证码 8 位数字，10 分钟内有效。</p>
<p>如果这不是你发起的请求，请忽略此邮件。</p>
```

> **为什么用 `{{ .Token }}` 而不是 `{{ .ConfirmationURL }}`？**
> `{{ .Token }}` 发送的是原始的 8 位数字验证码，用户可以直接复制粘贴到 App 里。`{{ .ConfirmationURL }}` 是一个链接，点击后在浏览器打开——在 PWA 场景下体验不好。`{{ .TokenHash }}` 是 Token 的哈希值，无法用于登录。经过实测，`{{ .Token }}` 是最适合本项目的方案。

### 2.4 测试邮件

1. Supabase Dashboard → **Authentication** → **Email** → 页面底部找到 **"Send test email"**
2. 输入你的邮箱地址 → 点击发送
3. 检查收件箱——收到邮件说明 SMTP 配置成功

---

## 第三步：部署前端

### 方式 A：部署到 Vercel（推荐）

1. 把本项目 Fork 到你的 GitHub 账号
2. 打开 [vercel.com](https://vercel.com) → 用 GitHub 登录
3. **New Project** → 选择你 fork 的仓库
4. **Root Directory** 设为 `pwa`
5. Framework 自动检测（应该显示 "Other" 或 "Static"）→ **不用改任何设置**
6. 点击 **Deploy**
7. 等待部署完成 → 你会得到一个 `https://xxx.vercel.app` 地址

> ⚠️ **中国用户注意**：Vercel 的默认域名 `*.vercel.app` 在中国大陆无法直接访问，需要科学上网。解决方案：
> - 在 Vercel 中绑定你自己的**自定义域名**（需在国内备案）
> - 或者部署到国内静态托管服务（如腾讯云 COS、阿里云 OSS）

### 方式 B：任意静态托管

`pwa/` 目录就是纯静态文件（HTML + CSS + JS），可以部署到任何静态托管服务：Cloudflare Pages、GitHub Pages、Netlify、或者你自己 nginx 服务器。

```bash
# 本地测试
cd pwa
python -m http.server 3000
```

### 首次打开 App + 设置向导

1. 打开你部署的网址
2. 看到 "连接你的 Supabase 项目" 页面
3. 输入第一步记下的 **Supabase URL** + **Anon Key** → 点击连接
4. 输入你的邮箱 → 收到验证码 → 输入 8 位验证码 → 登录成功
5. 登录后，App 会自动弹出**设置向导**，共三步：

**向导步骤 1 — 设置本地文件夹**

```
笔记最终会以 Markdown 文件存到这个文件夹
PC 同步脚本需要访问此路径
```

这里输入的路径（如 `D:/OneDrive/Notes` 或 `/Users/xxx/Notes`）会保存在 Supabase 配置中。同步脚本运行时会读取这个配置，把笔记下载到指定文件夹。

> 如果你不用 PC 同步，这一步可以随便填，不影响 App 使用。

**向导步骤 2 — 初始化数据库**

提供了一份完整的 SQL 脚本，需要复制到 Supabase SQL Editor 执行。创建所有表、索引和 RLS 安全策略。

**向导步骤 3 — 下载 PC 同步脚本**

给出同步脚本的运行方法（见下方第四步）。

> 之后在 App 的设置页面（⚙️）也可以随时重新打开这个向导。

---

## 第四步：PC 同步脚本（可选）

App 内的设置向导已经把文件夹路径保存到了 Supabase。接下来只需在你的电脑上运行同步脚本——它会自动读取你配置的文件夹路径，把云端笔记同步为本地 Markdown 文件。

### 前置要求

- Python 3.12+
- 你的 Supabase **service_role key**（在 Supabase Dashboard → Settings → API → `service_role` secret）
  - ⚠️ 注意：这里需要的是 **service_role key**，不是连接 App 时用的 anon key
  - anon key 受 RLS 限制只能访问自己的数据，无法用于批量导出
  - service_role key 只存在你自己电脑的 `.env` 文件里，永远不会上传

### 安装与运行

```bash
# 1. 进入 sync 文件夹
cd sync

# 2. 创建配置文件
cp .env.example .env

# 3. 编辑 .env，填入你的 Supabase 信息
# SUPABASE_URL=https://你的项目.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=你的-service_role-key

# 4. 安装依赖
pip install -r requirements.txt

# 5. 运行同步（一次性）
python main.py --once

# 或者持续运行（带系统托盘图标）
python main.py
```

### 运行模式

| 命令 | 说明 |
|------|------|
| `python main.py --once` | 同步一次后退出 |
| `python main.py` | 持续运行，系统托盘图标，定时自动同步 |
| Windows 任务计划 / cron | 定期执行 `--once` 模式 |

同步后的文件会保存在你设置向导里指定的本地文件夹中（默认 `D:/OneDrive/Notes`）。

---

## 常见问题

### 收不到验证码邮件

**如果你配置了 Brevo SMTP：**

1. 先在 Brevo 后台验证你的**发件人邮箱地址**：
   - Brevo → 右上角头像 → **SMTP & API** → **Senders** → 添加你的发件邮箱 → 去邮箱点击验证链接
   - 未验证的发件邮箱会导致邮件静默失败
2. 确认是否需要**授权 IP 地址**：
   - Brevo → **SMTP & API** → **API Keys** → 找到你的 SMTP Key → **IP Restriction**
   - 如果开启了 IP 白名单，需要添加 Supabase 的出站 IP（Supabase Dashboard → Settings → API → 页面底部有列出）
3. 用 Supabase 的 **"Send test email"** 测试（Authentication → Email → 页面底部）
4. 检查垃圾邮件箱

**如果你使用 Supabase 默认邮件服务（未配置 SMTP）：**

1. 免费额度限制：约 4 封/小时。如果之前发送过多，需要等一段时间再试
2. 检查垃圾邮件箱
3. 建议配置自己的 SMTP（见第二步）

**通用排查：**

- 检查邮件模板中是否使用了 `{{ .Token }}`（不是 `{{ .ConfirmationURL }}` 或 `{{ .TokenHash }}`）
- Supabase → Authentication → Email → 确认 "Enable email confirmations" 等相关开关状态

### 登录后看不到之前的笔记

笔记是按用户隔离的（RLS）。检查你是否用了不同的邮箱登录。

### 本地部署 vs 使用 demo 站的区别

`smartstickynotes.vercel.app` 是我部署的 demo。你可以直接用，但你的数据存**在你自己配置的 Supabase 项目里**，和 demo 站无关。demo 站只是前端页面，不接触你的数据。

### 手机如何使用

在手机浏览器打开你的 Vercel 地址，Chrome/Safari 会提示 "添加到主屏幕"——安装后就是一个独立 App，可以离线使用。

---

## 项目结构

```
├── pwa/                     # 前端 PWA 应用
│   ├── index.html           # 入口页面
│   ├── manifest.json        # PWA 清单
│   ├── sw.js                # Service Worker（缓存 + 离线）
│   ├── css/app.css          # 样式
│   ├── js/                  # JS 模块
│   │   ├── app.js           # 主控制器
│   │   ├── supabase.js      # Supabase 客户端
│   │   ├── db.js            # 数据库 CRUD
│   │   ├── auth.js          # 邮箱验证码登录
│   │   ├── notes.js         # 笔记气泡渲染 + Markdown
│   │   ├── editor.js        # 行内编辑
│   │   ├── toolbar.js       # 格式工具栏 + 快捷语
│   │   ├── wizard.js        # 首次设置向导
│   │   └── ...              # 更多模块
│   └── icons/               # PWA 图标
├── sync/                    # PC 同步脚本（Python）
│   ├── main.py              # 入口
│   ├── sync_loop.py         # 同步引擎
│   ├── markdown_writer.py   # 笔记 → .md 文件导出
│   ├── .env.example         # 环境变量模板
│   └── requirements.txt     # Python 依赖
└── supabase/migrations/     # 数据库初始化 SQL
    ├── 001_initial.sql      # 核心表 + RLS 策略
    └── 002_v2.sql           # 同步请求表 + 索引优化
```

---

## 安全模型

这个项目没有后端服务器。安全检查依赖 Supabase 的 **Row Level Security (RLS)**：

```
你的浏览器                  Supabase
─────────                  ────────
每次请求都带着你的 JWT    →   RLS 检查：这个用户只能看自己的数据
```

- **anon key** 在前端代码中（这不是秘密——它只允许通过 RLS 检查的操作）
- **service_role key** 仅在你的电脑上的 `sync/.env` 文件中（绕过 RLS 用于导出）
- 没有密码存储——登录用的是邮箱一次性验证码
- Markdown 渲染经过 XSS 过滤

---

## License

MIT © Designed by Anzhi
