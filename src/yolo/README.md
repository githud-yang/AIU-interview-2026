# YOLO训练与推理

- `train.py`：简短的Ultralytics训练脚本，训练参数直接在文件中修改。
- `archive_training.py`：独立归档已完成的训练，保存摘要和最佳权重。
- `detect_realtime.py`：摄像头/图像/视频推理CLI，界面与推理在后端。
- `sources.py`：统一来源配置、图像读取与合法路径检查。
- `evidence.py`：训练结果归档、哈希与来源记录。

从仓库根目录验证公开图，不占用摄像头：

```powershell
./.venv/Scripts/python.exe -m src.yolo.detect_realtime --source demo --headless --max-frames 1
```

网页通过`web/managers/`运行一个共享推理worker，经MJPEG推送图像、SSE推送状态。科研尺寸评测在`research/yolo_domain.py`，与本模块一次训练的成果分别记录。

需要重新训练时，从仓库根目录运行（已有训练成果无需重训）：

```powershell
./.venv/Scripts/python.exe -m src.yolo.train
```

默认使用`yolo11n.pt`和`coco8.yaml`，训练30轮，图像尺寸640，batch为4，使用CPU，workers为0，seed为42。新机器所需的公开权重和数据集由Ultralytics下载，训练输出在`runs/detect/`。

训练完成后，再独立归档；路径替换为本次实际输出目录：

```powershell
./.venv/Scripts/python.exe -m src.yolo.archive_training runs/detect/coco8_baseline
```

归档会生成训练摘要并复制最佳权重到`assets/models/best.pt`。既有GPU训练参数见`training_result.json`；新运行不保证同一性能数值。
