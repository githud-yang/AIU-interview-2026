"""Install the pinned OpenCV pedestrian clip; verify bytes before replacing it."""
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEMO_URL = "https://raw.githubusercontent.com/opencv/opencv/5728f796f6860246134066b4338c31c612adde77/samples/data/vtest.avi"
DEMO_SHA256 = "45cddc9490be69345cbdab64ca583be65987e864ca408038e648db99e10516cf"
DEMO_BYTES = 8_131_690
DEFAULT_TARGET = ROOT / "assets" / "examples" / "vtest.avi"


def install_demo(target=DEFAULT_TARGET):
    """Keep a verified local copy and reject truncated or unexpected downloads."""
    target = Path(target)
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == DEMO_SHA256:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        digest, total = hashlib.sha256(), 0
        request = Request(DEMO_URL, headers={"User-Agent": "AIU-YOLO-demo-setup"})
        with urlopen(request, timeout=30) as response, tempfile.NamedTemporaryFile(
            dir=target.parent, prefix="vtest-", suffix=".part", delete=False
        ) as output:
            temporary = Path(output.name)
            while chunk := response.read(64 * 1024):
                total += len(chunk)
                if total > DEMO_BYTES:
                    raise ValueError("案例下载大小异常，已拒绝保存")
                digest.update(chunk)
                output.write(chunk)
        if total != DEMO_BYTES or digest.hexdigest() != DEMO_SHA256:
            raise ValueError("案例视频校验失败，保留原文件；请检查网络后重试")
        temporary.replace(target)
        return target
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        print(f"行人视频案例已就绪：{install_demo()}")
    except (OSError, ValueError) as error:
        raise SystemExit(f"安装失败：{error}") from error
