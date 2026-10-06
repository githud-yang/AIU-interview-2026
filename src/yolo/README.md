# YOLO模块

目标检测训练和实时推理代码。

## 文件
- `train.py`：模型训练脚本，使用coco8示例数据集
- `detect_realtime.py`：摄像头实时检测脚本

## 训练参数
- epochs: 30
- batch: 4
- imgsz: 640
- 输出权重：`yolo/runs/detect/coco8_baseline/weights/best.pt`

## 运行
```powershell
# 训练
python src/yolo/train.py

# 实时检测
python src/yolo/detect_realtime.py
```
