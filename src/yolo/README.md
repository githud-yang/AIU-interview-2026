# YOLO训练与推理

- `train.py`：原样保留的`mytrain.py`训练原稿，训练参数直接在文件中修改。
- `archive_training.py`：独立归档已完成的训练，保存摘要和最佳权重。
- `detect_realtime.py`：摄像头/图像/视频推理CLI，界面与推理在后端。
- `sources.py`：统一摄像头、动态视频案例和本地文件读取。
- `evidence.py`：训练结果归档、哈希与来源记录。

从仓库根目录安装并验证公开视频，不占用摄像头：

```powershell
./.venv/Scripts/python.exe scripts/setup_yolo_demo.py
./.venv/Scripts/python.exe -m src.yolo.detect_realtime --source demo --headless --max-frames 30
```

网页通过`web/managers/`运行一个共享推理worker，经MJPEG推送图像、SSE推送状态。科研尺寸评测在`research/yolo_domain.py`，与本模块一次训练的成果分别记录。

`camera` 使用本机摄像头；`demo` 是 OpenCV 官方行人视频，循环读取不断变化的原始帧，由后端逐帧推理；`video` 保留服务器 `YOLO_VIDEO` 配置的文件入口。案例不播放预先绘制的检测框，停止或切换时释放原视频来源。素材来源、固定版本、校验和及许可链接见 [案例说明](../../assets/examples/README.md)。

需要重新训练时，从仓库根目录运行（已有训练成果无需重训）：

```powershell
./.venv/Scripts/python.exe -m src.yolo.train
```

原稿使用`yolo11n.pt`和`african-wildlife.yaml`，训练10轮，图像尺寸640，batch为28，cache为`ram`，workers为1；未指定device、project或name。所需的公开权重和数据集由Ultralytics下载，默认输出目录由Ultralytics决定。

训练完成后，再独立归档；路径替换为本次实际输出目录：

```powershell
./.venv/Scripts/python.exe -m src.yolo.archive_training runs/detect/train
```

归档会生成训练摘要并复制最佳权重到`assets/models/best.pt`，同时更新实时检测使用的模型。

展示台的训练曲线来自原项目同参数`train12`的完整10轮记录，见[野生动物训练摘要](../../docs/wildlife_training_result.json)。原始脚本与参数、CSV和曲线一起归档。保存的验证样图中，已核对的16个文件名均只存在当前训练目录，因此日志分数不作为独立验证成绩；细节见归档中的`validation-sample-audit.json`。

当前摄像头/行人视频演示仍使用此前coco8实验的通用检测权重，其摘要为`docs/training_result.json`；它与四类野生动物训练分别展示。
