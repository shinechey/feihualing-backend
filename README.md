# 飞花令游戏后端

本项目提供飞花令游戏的 Coze 代理接口，供前端调用。

## 本地运行

```bash
cd backend
npm install
COZE_API_KEY=你的key COZE_BOT_ID=你的bot node server.js
```

## 接口

- `POST /coze/poem`
- `POST /coze/validate`
- `POST /coze/background`

## 部署

可部署在任何支持 Node.js 18+ 的平台（如 Vercel、Render、Railway）。部署时配置环境变量：

- `COZE_API_KEY`
- `COZE_BOT_ID`

