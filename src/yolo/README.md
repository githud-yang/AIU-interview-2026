# YOLO训练与推理

- `train.py`：Ultralytics训练入口，保存配置、指标和最佳权重。
- `detect_realtime.py`：摄像头/图像/视频推理CLI，界面与推理在后端。
- `sources.py`：统一来源配置、图像读取与合法路径检查。
- `evidence.py`：训练结果归档、哈希与来源记录。

从仓库根目录验证公开图，不占用摄像头：

```powershell
./.venv/Scripts/python.exe -m src.yolo.detect_realtime --source demo --headless --max-frames 1
```

网页通过`web/managers/`运行一个共享推理worker，经MJPEG推送图像、SSE推送状态。科研尺寸评测在`research/yolo_domain.py`，与本模块一次训练的成果分别记录。

新机器恢复训练权重（CPU可运行；已有本机权重时无需重训）：

```powershell
./.venv/Scripts/python.exe -m src.yolo.train --epochs 30 --imgsz 640 --batch 4 --device cpu
```

命令会下载公开预训练权重和coco8，输出到`runs/detect/`与`assets/models/best.pt`并更新训练摘要。实际GPU训练参数见既有training_result.json；新运行不保证同一性能数值。
