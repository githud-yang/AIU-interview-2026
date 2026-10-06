# Web服务模块

FastAPI后端，提供AI对话和YOLO演示页面。

## 目录分层
- `main.py`：应用入口，只负责模块组装
- `routes/`：路由层，只处理HTTP请求解析和响应
- `services/`：业务服务层，封装核心业务逻辑
- `managers/`：状态管理器，管理子进程和全局状态
- `static/`：前端静态文件（HTML/CSS/JS）

## 启动
```powershell
python -m uvicorn src.web.main:app --port 8000 --reload
```

## 接口
- `GET /`：AI文字冒险游戏页面
- `POST /api/chat`：聊天接口
- `GET /yolo`：YOLO演示页面
- `POST /yolo/start` / `/yolo/stop`：控制摄像头检测
- `GET /yolo/stream`：MJPEG视频流
