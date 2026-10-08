# 面试演示（约 5 分钟）

1. 打开 README，说明基础题与进阶题边界，解释为什么一个服务配合原生网页即可覆盖主要要求。
2. `ollama list` 展示模型；`python scripts/verify.py --live` 展示离线回归、真实工具调用和游戏 API。
3. 用 `./scripts/start.ps1` 启动，打开 `http://127.0.0.1:8000`。展示模型“已连接”，点击“看看终端屏幕”，再选择行动推动剧情；刷新保留当前浏览器会话的记录，点“重新开始”开启新局。
4. 打开视觉页，选择“公开静态样例”，点启动，展示真实 YOLO 框、类别及置信度；说明它是静态图，不是摄像头实时场景。点停止，确认状态结束。
5. 现场镜头正常时，切换摄像头展示真实物体；若画面全黑，先检查镜头遮挡、系统隐私开关和光照。仍不能用时清楚说明实物验证未完成，使用公开样例完成软件演示。
6. 展示 `docs/training_result.json`、训练曲线和 best.pt，说明最佳验证指标与最后一轮指标差别，以及 coco8 的 4 张训练图、4 张验证图限制。
7. 打开 `docs/harness-plan.md`，解释 provider、agent loop、session/harness 和 UI 四层，介绍六阶段验收。现有原型与计划分开说明。
8. 展示 Git 提交、工程日志和 AI 使用情况；社交协作经历由本人如实补充。

备用命令：

```powershell
python src/yolo/detect_realtime.py --source demo --headless --max-frames 1 --save logs/demo-detection.jpg
```

准备回答：模型请求如何到达 Ollama？工具输出如何回传？为什么只训练 8 张图？权重如何进入网页？为什么多个客户端共享一次推理？断网和重复点击如何处理？Harness 为什么需要持久化和执行轨迹？

不能把样例指标解释成真实环境准确率，也不能把内存历史解释成长期记忆。硬件及完整 Harness 的完成状态以实际验收为准。
