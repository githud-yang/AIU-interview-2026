"""
YOLO进程管理器
==============
统一管理YOLO检测子进程的启动、停止和状态查询，与路由层完全解耦。
"""
from __future__ import annotations

import subprocess
from pathlib import Path


class YoloProcessManager:
    """单例模式管理YOLO摄像头检测进程"""

    def __init__(self) -> None:
        self._proc: subprocess.Popen | None = None
        project_root = Path(__file__).resolve().parents[3]
        self._yolo_script = project_root / "src" / "yolo" / "detect_realtime.py"

    @property
    def is_running(self) -> bool:
        """检测当前是否有运行中的YOLO进程"""
        return self._proc is not None and self._proc.poll() is None

    def start(self) -> dict:
        """启动YOLO检测进程，返回操作结果"""
        if self.is_running:
            return {"ok": True, "msg": "检测已经在运行中"}

        try:
            self.stop()  # 先清理残留进程
            self._proc = subprocess.Popen(
                ["conda", "run", "-n", "yolo", "python", str(self._yolo_script)],
                cwd=str(Path(__file__).resolve().parents[3]),
            )
            return {"ok": True, "msg": "已启动摄像头检测窗口"}
        except Exception as e:  # noqa: BLE001
            self._proc = None
            return {"ok": False, "msg": f"启动失败：{str(e)}"}

    def stop(self) -> dict:
        """停止YOLO检测进程，返回操作结果"""
        if not self.is_running:
            self._proc = None
            return {"ok": True, "msg": "当前没有运行中的检测"}

        try:
            subprocess.run(
                ["taskkill", "/PID", str(self._proc.pid), "/T", "/F"],
                capture_output=True
            )
            self._proc = None
            return {"ok": True, "msg": "已停止检测"}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "msg": f"停止失败：{str(e)}"}
