# YOLO模型权重

默认网页读取`assets/models/best.pt`。本机此文件对应此前coco8通用检测实验，来源与哈希见[历史记录](../../docs/training_result.json)；野生动物`train12`是另一项训练成果。

二进制不随Git提交。新电脑按[根README](../../README.md#快速启动)复制已有通用权重，或下载官方`yolo11n.pt`并在目标缺失时复制；无需重训。新下载的官方模型不等同于历史微调权重，不冒称同一哈希的复现。

原训练脚本只负责训练，归档由独立工具完成。四类野生动物权重和通用行人检测模型分别保留，通过`YOLO_WEIGHTS`选择，详见[视觉模块](../../src/yolo/README.md)。
