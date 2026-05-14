# 达人邮件管理助手

TikTok 达人邮件沟通管理系统，一站式管理达人联系、邮件往来、合作阶段的全栈 Web 应用。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, React Router 7, Vite 6 |
| 后端 | Express.js (Node.js), sql.js (SQLite) |
| AI | DeepSeek API（AI 摘要 + 阶段建议） |
| 邮箱 | Gmail OAuth 2.0 + IMAP 同步 |
| 认证 | JWT 登录 + bcryptjs 密码加密 |

## 功能

- **达人管理** — 添加、搜索达人，记录报价、合作阶段、品牌/备注
- **邮件往来** — 手动添加邮件记录，或通过 Gmail OAuth 同步真实收件箱
- **阶段追踪** — 合作阶段（已筛选/待联系/已联系/沟通中/已合作/已拒绝），阶段变更历史
- **AI 智能摘要** — DeepSeek API 自动对每条邮件生成中文摘要
- **AI 阶段建议** — 根据邮件内容自动推荐合作阶段
- **对接邮箱** — 多邮箱管理，一键切换发送方
- **响应式 UI** — 自研 CSS 组件库，无需第三方 UI 库

## 项目结构

```
├── influencer-crm/          # 前端 (Vite + React)
│   ├── src/
│   │   ├── pages/           # Dashboard, InfluencerDetail, Login, EmailSettings
│   │   ├── components/      # Layout, SearchBar, StatusBadge, UserProfile
│   │   ├── contexts/        # AuthContext (JWT 登录态)
│   │   ├── utils/           # api.js, storage.js, aiSuggestions.js
│   │   ├── data/            # 阶段定义等常量
│   │   └── styles/          # global.css
│   ├── prompts/             # AI Prompt 模板
│   └── vite.config.js
│
├── server/                  # 后端 (Express + SQLite)
│   ├── src/
│   │   ├── routes/          # auth, influencers, timeline, emails, gmail, ai, user
│   │   ├── services/        # Gmail OAuth, IMAP 代理
│   │   ├── middleware/       # JWT 鉴权
│   │   ├── scripts/         # 测试数据导入
│   │   ├── db.js            # 数据库初始化、建表、种子数据
│   │   └── index.js         # Express 入口
│   └── test-data/           # 示例邮件 JSON
│
└── .gitignore
```

## 快速开始

### 前置条件

- Node.js 18+
- Gmail 账号（用于 OAuth 邮件同步）
- DeepSeek API Key（用于 AI 功能，可选）

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/yishu5990-boop/influencer-crm.git
cd influencer-crm

# 2. 安装后端依赖
cd server
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 JWT_SECRET, DEEPSEEK_API_KEY, GMAIL_EMAIL 等

# 4. 启动后端 (端口 3001)
node src/index.js

# 5. 另开终端，安装前端依赖
cd ../influencer-crm
npm install

# 6. 配置前端环境变量
cp .env.example .env
# 编辑 VITE_API_BASE_URL 指向后端地址

# 7. 启动前端开发服务器
npm run dev

# 8. 构建前端（生产环境）
npm run build
# 构建产物在 dist/，后端会自动托管
```

### 首次使用

1. 访问 `http://localhost:3001`
2. 默认管理员账号：`admin` / `admin123`
3. 系统已预置 8 位测试达人及 19 条邮件记录
4. 在「邮箱设置」页绑定 Gmail 账号以同步真实邮件

## 环境变量

**server/.env**
```bash
PORT=3001
JWT_SECRET=your-secret-key
DEEPSEEK_API_KEY=sk-your-deepseek-key
GMAIL_EMAIL=your@gmail.com
GMAIL_APP_PASSWORD=your-app-password
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/oauth-callback
```

**influencer-crm/.env**
```bash
VITE_API_BASE_URL=http://localhost:3001/api
```

## 面试亮点

以下是在面试中可以分享的技术亮点：

1. **TDZ 实战调试** — `Cannot access 'ea' before initialization`：React 组件中 `const` 声明被 early return 提前阻止执行，导致 Temporal Dead Zone 引用错误，通过分析组件渲染顺序和 JS 作用域规则定位并修复
2. **全栈架构** — 前后端分离，同一 Express 端口同时服务 API 和静态文件
3. **Gmail OAuth 2.0** — 完整的 OAuth 授权流程 + IMAP 邮件同步
4. **AI 集成** — DeepSeek API 实现邮件摘要和阶段建议两个实用功能
5. **sql.js** — 轻量级 SQLite，无外部依赖，适合演示和快速部署
6. **Cloudflare Tunnel** — 免费内网穿透，支持临时 URL 公网访问
