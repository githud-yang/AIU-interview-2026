# 启停与验证脚本

从仓库根目录执行：

```powershell
./scripts/start.ps1 -Background
./scripts/stop.ps1
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
```

- `start.ps1` / `stop.ps1`：组装启动命令、核对本项目进程身份与释放。
- `verify.py`：临时目录中的离线回归；`--live`才调用真实本地模型。
- `run_research.py`：通过公共API启动或观察研究，`--run-id`只观察已有运行。
- `export_research.py`：从冻结测量导出新稿件，不增加模型调用/训练。
- `verify_research_mcp.py`：真实stdio连接和只读证据验证。

完整参数和证据目录见`../docs/research-workbench.md`；运行新研究时使用新的证据路径，保留历史记录。
