"""摄像头或视频实时推理，按 q 退出。"""
import argparse
from pathlib import Path
from ultralytics import YOLO

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--weights", default=str(Path(__file__).resolve().parents[2] / "assets/models/best.pt"))
    p.add_argument("--source", default="0")
    a = p.parse_args()
    if not Path(a.weights).is_file(): p.error("权重不存在，请先运行 train.py")
    source = int(a.source) if a.source.isdigit() else a.source
    for _ in YOLO(a.weights).predict(source=source, stream=True, show=True, verbose=False): pass
if __name__ == "__main__": main()
