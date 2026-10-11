"""单独归档已完成的训练；读取原始结果，不启动模型或重新训练。"""
import argparse
import json
from pathlib import Path

import yaml

from .evidence import archive_run

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path, help="包含 results.csv 和 weights/best.pt 的训练目录")
    run_dir = parser.parse_args().run_dir
    try:
        parameters = yaml.safe_load((run_dir / "args.yaml").read_text(encoding="utf-8")) or {}
        if not isinstance(parameters, dict):
            raise ValueError("args.yaml 必须是训练参数字典")
        summary = archive_run(run_dir, parameters=parameters,
                              output_weights=ROOT / "assets/models/best.pt",
                              summary_path=ROOT / "docs/training_result.json",
                              evidence_dir=ROOT / "docs/evidence")
    except (OSError, ValueError, yaml.YAMLError) as exc:
        parser.error(str(exc))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
