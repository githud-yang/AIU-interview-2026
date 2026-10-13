# 公开视频案例

从仓库根目录安装一次，之后离线运行：

```powershell
./.venv/Scripts/python.exe scripts/setup_yolo_demo.py
```

`vtest.avi` 是 [OpenCV 官方样例](https://github.com/opencv/opencv/blob/5728f796f6860246134066b4338c31c612adde77/samples/data/vtest.avi)中的行人视频，768×576、10 FPS。选择网页「行人视频案例」后，后端循环解码视频并逐帧运行当前 YOLO 模型，框和置信度均由本次推理生成。它不是摄像头现场画面，也不是已录制的检测结果。

固定源提交：`5728f796f6860246134066b4338c31c612adde77`。原文件为 8,131,690 字节，SHA256：`45cddc9490be69345cbdab64ca583be65987e864ca408038e648db99e10516cf`。安装脚本限制下载大小并核对完整哈希，失败时保留原文件。视频不随 Git 提交；不在运行时下载。

源仓库该提交的[许可文本](https://github.com/opencv/opencv/blob/5728f796f6860246134066b4338c31c612adde77/LICENSE)为 BSD 3-Clause，并保留第三方权利声明。来源记录仅说明官方样例位置，不将素材描述为本项目采集或自有数据。
