# 飞花令游戏后端

本项目提供飞花令游戏的 Coze 代理接口，供前端调用。`api/` 目录下的文件可直接部署到 Vercel 等 Serverless 平台。

## 本地运行

```bash
cd backend
npm install
COZE_API_KEY=你的key COZE_BOT_ID=你的bot node server.js   # 本地调试
```

## 接口

- `POST /coze/poem`
- `POST /coze/validate`
- `POST /coze/background`

## 部署

可部署在任何支持 Node.js 18+ 的平台：

- **Vercel**：直接导入仓库，Build Command 用 `npm install`，Output Directory 留空，函数入口位于 `api/*.js`（访问路径 `/api/poem` 等）。
- **Render / Railway**：也可以运行 `node server.js`，按需修改启动命令。

部署时配置环境变量：

- `COZE_API_KEY`
- `COZE_BOT_ID`

