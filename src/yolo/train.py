"""直接训练 YOLO；从仓库根目录运行，按需修改下方参数。"""
from ultralytics import YOLO

if __name__ == "__main__":
    model = YOLO("yolo11n.pt")
    model.train(
        data="coco8.yaml",
        epochs=30, imgsz=640,
        batch=4, device="cpu", workers=0,
        seed=42, deterministic=True,
        project="runs/detect", name="coco8_baseline",
    )
