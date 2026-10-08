# 运行证据

- `coco8_baseline_*/`：由实际训练目录归档的 CSV、曲线、配置、验证图片、哈希与环境快照；最新位置见 `../training_result.json` 的 evidence_dir。
- `yolo-public-sample.jpg` 及对应 JSON：本机 best.pt 对 Ultralytics 安装包公开 bus.jpg 的真实检测。公交车与行人是公开样例，非用户摄像头图。
- `yolo-runtime-smoke.json`：真实 HTTP 双视频流、停止和三帧本地视频释放核验。

原摄像头黑帧只保留在本机并被 Git 忽略。此处没有网页截图，浏览器可视验收未完成，不能用接口测试代替布局检查。归档时间、最佳权重验证指标、最后一轮指标与归档时环境各自记录。
