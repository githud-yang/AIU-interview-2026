# 运行环境与部署

启元主服务提供智能体、视觉检测、科研工作台和统一展示台；萤火是独立Node应用。下列配置针对本地运行与现场展示，核对日期为2026-10-14。

## 配置依据与性能范围

建议Windows 11 64位、Python 3.11、16GB内存、4核8线程CPU和30GB可用SSD空间作为基础运行档；现场推荐32GB内存、6核12线程CPU、50GB可用SSD空间，以及8GB以上显存的兼容NVIDIA GPU。本地Qwen与YOLO同时驻留建议12GB以上显存。上述内存、CPU、磁盘和显存档位是本项目工程估算，没有在这些不同配置上逐一跑性能基准。

[Ollama模型页](https://ollama.com/library/qwen2.5:7b)列出的Qwen2.5 7B Q4_K_M文件约4.7GB；实际运行还需上下文、缓存与其他进程的内存，不能把下载大小当作全部显存需求。[Ollama FAQ](https://docs.ollama.com/faq)说明模型可在CPU、GPU或混合模式运行，并可通过`ollama ps`查看驻留情况；设备兼容性以[官方GPU说明](https://docs.ollama.com/gpu)为准。

CPU推理可作为低配置方案，但模型回复与视觉帧率可能较慢；本机验收记录不构成其他设备的FPS保证。现场先确认自己的设备表现，单个摄像头由主服务共享一个推理worker。

原13行训练脚本固定`batch=28`、`cache="ram"`；重新训练的资源取决于数据集、模型和设备，不能由演示配置推定一定可训。已有10轮训练成果无需重训。GPU版PyTorch按[官方安装选择器](https://pytorch.org/get-started/locally/)选择匹配Windows、Python及驱动的版本，在安装本仓库依赖前装好；随后用`torch.cuda.is_available()`核对。CPU版同样可运行演示。

完整科研环境的固定依赖scikit-learn 1.9.1要求Python 3.11或以上，本项目建议3.11。萤火锁定Vite 8；[Vite官方要求](https://vite.dev/guide/)为Node 20.19+或22.12+的兼容版本，Node 22.0–22.11不满足要求。本项目建议Node 22.12+的兼容LTS版本，按`package-lock.json`执行`npm ci`。

## 首次准备

1. 安装Python 3.11、Ollama；萤火及前端检查另装兼容Node.js。打开Ollama应用，让本地模型服务运行在11434端口。
2. 在仓库根目录创建`.venv`，安装`requirements-research.txt`。只运行网页/智能体可用`requirements.txt`；增加视觉用`requirements-yolo.txt`，它们是递进依赖。
3. 执行`scripts/setup_yolo_demo.py`安装校验过的OpenCV行人视频，并执行`ollama pull qwen2.5:7b`准备本地语言模型。
4. 首次复制`configs/.env.example`为`configs/.env`；保留已有配置，按需要修改公开配置项。
5. 按下节准备检测权重，再执行`./scripts/start.ps1 -Background`。
6. 另开终端进入`showcases/yinghuo`，执行`npm ci`、`npm run build`、`npm start`，由4318端口提供页面与API。后续启动无需重复安装/构建，除非代码或依赖变化。

完整首次准备命令见[根README](../README.md#快速启动)。初次安装依赖、模型与案例需要联网；准备完成后，本地智能体与YOLO可离线运行。科研文献检索、DeepSeek与外部项目网站需要网络。

## YOLO权重准备

二进制权重不随Git下载，默认网页配置为`YOLO_WEIGHTS=assets/models/best.pt`。新机可复制已有通用检测权重到此路径；没有现成权重时，用Ultralytics下载官方`yolo11n.pt`，仅在目标不存在时复制为`best.pt`。根README提供了不覆盖现有权重的命令。

该新机路径得到的是通用预训练检测模型，能识别人等通用类别；它不等同于本机历史coco8微调权重或四类野生动物`train12`权重。历史训练的参数、CSV、曲线和权重哈希已经归档；精确重现历史模型还需对应的原权重。

网页读取`configs/.env`中的权重路径。CLI不读取该文件，使用默认`assets/models/best.pt`，或显式传入`--weights`：

```powershell
./.venv/Scripts/python.exe -m src.yolo.detect_realtime --weights assets/models/best.pt --source demo --headless --max-frames 30
```

更换或归档训练权重会影响对应的实时检测类别，详见[YOLO模块](../src/yolo/README.md)。

## 摄像头、服务与配置

摄像头通过后端OpenCV打开，属于运行Python服务的电脑。进入统一展示台YOLO区或打开独立`/yolo`页面自动启动；从来源列表选择案例即换成动态行人视频。离开释放本页创建的运行，主动停止后保持停止，直到再次进入或手动启动。该行为与普通自动化测试分别说明。

需要内置或USB摄像头，Windows允许桌面应用访问，且设备未被其他应用独占。未连接摄像头时，页面会报告错误，仍可直接选择“行人视频案例”。默认服务只监听`127.0.0.1`，按本机展示方式使用；远端浏览器不会自动提供自己的摄像头。

| 配置项/服务 | 默认值与用途 |
| --- | --- |
| 主工作台 | `http://127.0.0.1:8000/showcase`，FastAPI页面与API |
| Ollama | `http://127.0.0.1:11434`，需单独运行 |
| 萤火 | `http://127.0.0.1:4318`，需单独运行Node服务 |
| `OLLAMA_MODEL` | `qwen2.5:7b`，需已下载 |
| `YOLO_WEIGHTS` | `assets/models/best.pt`，需本地文件 |
| `YOLO_CAMERA` | `0`，按实际摄像头编号调整 |
| `YOLO_SOURCE` | 后端未指定source时的默认值；网页首次进入固定选摄像头，随后可切换 |
| `YOLO_VIDEO` | 可选本地视频路径，配置后增加自定义来源 |
| 论文模型 | 工作台“论文模型设置”内配置，测试后保存 |
| 萤火模型 | 萤火“AI设置”内独立配置，保存前会做连接测试 |

`./scripts/start.ps1 -Port 8001`可改主端口；打开同端口的`/showcase`即可，同页API沿用该端口。萤火仍按4318连接。只改主端口不能解决萤火端口冲突，先核对占用服务。

主服务日志为`logs/web-stdout.log`和`logs/web-stderr.log`；`./scripts/stop.ps1`只停止记录且身份核对属于本项目的服务。脚本被PowerShell策略阻止时，可对本次进程执行`Set-ExecutionPolicy -Scope Process Bypass`后重试，不需要修改全局策略。

## 历史材料与新电脑

源码仓库保留训练曲线、参数、公开验收JSON与文档；Ollama模型、YOLO权重、视频、完整科研历史、萤火随笔与Key由本机分别保存。

- 完整科研历史在`logs/research/`，包括数据库、检查点、论文版本和产物。只下载Git时，工作台没有这些历史任务；可查看仓库摘要或新建任务。迁移自己的历史需先停止研究和服务，备份原目录，再复制到新机相同相对位置；记录中可能有原机绝对路径，迁移后仍需核对产物可读性，不能称为已经完成跨机重放。
- 萤火随笔位于当前浏览器来源的IndexedDB，新电脑或不同域名/端口不会自动携带；使用应用的备份/导入迁移自己的数据。
- 论文模型与萤火Key各自重新配置；不通过Git迁移个人授权。
- YOLO安装脚本会下载并校验案例视频；已有校验通过的文件直接复用。

原机现场展示可直接使用已有材料。新机完整历史复现和当前基础功能启动是不同验收范围，见[交付核对](submission-readiness.md)。

## 常见启动问题

| 现象 | 处理 |
| --- | --- |
| 文字冒险无法回复 | 确认Ollama应用运行，`ollama list`包含`qwen2.5:7b`，配置地址为11434 |
| 检测提示权重不存在 | 按上节准备权重，并核对`YOLO_WEIGHTS`路径 |
| 摄像头无法打开 | 检查系统权限、设备编号和其他应用占用；切换行人视频继续展示 |
| 行人视频不可用 | 重新执行`scripts/setup_yolo_demo.py`，检查下载与文件校验结果 |
| 萤火无法载入 | 确认4318的Node服务已启动，且已执行`npm run build` |
| Node版本或构建报错 | 核对Node兼容版本，使用`npm ci`按锁文件安装 |
| 科研区没有历史任务 | 新机未携带`logs/research/`；按上节区分查看摘要、迁移历史和新建任务 |
| 云端模型请求失败 | 在对应应用检查模型、Key、账户权限与网络，查看该任务错误记录 |
