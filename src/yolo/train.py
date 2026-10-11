from ultralytics import YOLO

if __name__ == "__main__":
    model = YOLO("yolo11n.pt")
    model.train(
        data="african-wildlife.yaml",
        epochs=10,
        imgsz=640,
        batch=28,
        cache="ram",
        workers=1,

    )
