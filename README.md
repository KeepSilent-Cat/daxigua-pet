# 大夕瓜桌宠 · DaXiGua Pet (`daxigua-pet`)

一个 Windows 桌面宠物：透明窗口、分层插画、会呼吸会眨眼、能拖能摸，可以换皮套、换主题，
接上大模型后还能聊天。

基于 [surfpet](https://github.com/Mieksido/surfpet)（MIT）二次开发，
在它的基础上加了**主题系统**、**分层皮套工具链**、**本地语音桥**和**启动器**。

> **素材声明**：`app/skins/` 下的四套皮套均由 **AI 生成**（作者自制）。
> 代码 MIT；素材授权与来源见 [NOTICE.md](NOTICE.md)。仓库内**不含任何官方游戏素材**。

---

## 功能

| 功能 | 状态 | 说明 |
|---|---|---|
| 透明置顶窗口 / 拖拽 / 托盘 | ✅ | 拖动时走动动画，松手回弹 |
| 分层皮套（眨眼、视线、口型、呼吸、摇摆） | ✅ | 角色拆成 PNG 图层，靠 `manifest.json` 驱动 |
| 摸头 / 戳一戳 / 跳一下 | ✅ | 鼠标悬停在头部/身体不同响应 |
| 皮套切换 | ✅ | 右键菜单「穿什么呢」 |
| **主题切换** | ✅ | 右键菜单「换主题」，三套内置：墨竹 / 青瓷 / 素墨 |
| 气泡说话 / 打字机 | ✅ | 无 AI 也能作为纯装饰桌宠运行 |
| 接大模型对话 | ⚙️ 可选 | 需要额外装 [SurfCore](https://github.com/Mieksido/surfcore) 插件 |
| 语音朗读 | ⚙️ 可选 | 附带本地 SAPI 语音桥，零依赖零联网 |
| 桌宠皮肤自定义 | ✅ | 见 [docs/换皮套指南.md](docs/换皮套指南.md) |

---

## 快速开始（Windows 10/11）

```powershell
# 1. 下载 Electron 运行时（约 150 MB，只需一次）
.\scripts\fetch-electron.ps1

# 2. 启动
.\scripts\start.ps1
```

右键桌宠或用托盘图标可以打开菜单。

**依赖**：Windows 10/11 ×64。不需要装 Node.js、不需要装 Python（运行时已自带）。
如果你想自己构建 `tools/` 里的 C# 工具，才需要 .NET 9 SDK。

---

## 目录结构

```
app/                  Electron 应用（可直接运行）
  dist/               主进程与渲染器（已打包，无需 node_modules）
  assets/             图标
  themes/             主题 CSS（可自己加）
  skins/              皮套（每套一个目录）
docs/                 文档
  换皮套指南.md        怎么做自己的皮套
  桌宠美术素材清单.md   每张图层要画什么、尺寸、对照图
  桌宠对话与模型设置.md 怎么接大模型
scripts/
  fetch-electron.ps1  下载运行时
  start.ps1           启动
tools/                辅助工具（C# 源码，可选）
  MakeSkin/           皮套生成 + 校验（对齐、包围盒、分层检查）
  AutoSplit/          整张立绘尝试自动拆层（实验性，准确率有限）
  VoiceBridge/        本地语音桥（Windows SAPI，监听 127.0.0.1:8765）
  PetLauncher/        启动器（打包成单个 exe）
```

---

## 皮套系统（核心）

一套皮套 = 一个目录：

```
app/skins/<id>/
  manifest.json      画布尺寸、缩放、图层顺序、动画参数
  art/*.png          所有图层，**同尺寸、同位置**、透明底
  preview.png        可选，列表预览
```

关键概念：

- `canvas`：所有 PNG 必须同尺寸（本仓库都是 1280×1280），图层之间靠**像素位置对齐**，不靠坐标字段
- `layers[]`：**数组第一项是最底层**，往上叠
- `role`：告诉程序"这一层是什么"（`face` / `eye.white.l` / `mouth` / `hair.back` / `tail` …）
- `rigOptions`：`headPivot`（头的旋转轴，放在脖子根部）、`tailPivot`、`blinkLash`（眨眼时睫毛下移多少）、`eyeCenters`、`gazeMax` …

⚠️ 最常见的两个坑：

1. **`tailPivot` 不写 → 尾巴整体上移半个画布**（渲染层每帧会用这个值覆盖容器 y）
2. **头做成独立图层但没调 `headPivot` → 摸头/视线移动时五官相对脸滑动**

详见 [docs/换皮套指南.md](docs/换皮套指南.md)。

---

## 主题

`app/themes/*.css` 会在窗口加载后注入，覆盖气泡和对话框的配色。

- 右键菜单「换主题」即时切换
- 自己加：复制一份改颜色，文件名前缀数字决定排序
- `_base.css.tpl` 是完整模板（所有可覆盖的选择器都在里面）

---

## 接大模型对话（可选）

桌宠**不接 AI 也能正常用**（当纯装饰挂件：会呼吸、会眨眼、能拖能摸）。

要聊天需要：

1. 安装 [SurfCore](https://github.com/Mieksido/surfcore) 插件到你的宿主环境
2. 桌宠会读取 `~/.dsh/surfcore/pet/host.json`（或用环境变量 `SURFCORE_PET_HOST` 指定）
3. 在 SurfCore 设置里把本桌宠装成"宠物"

详细步骤见 [docs/桌宠对话与模型设置.md](docs/桌宠对话与模型设置.md)。

---

## 语音（可选）

`tools/VoiceBridge` 是一个 60 KB 的小服务，用 Windows 自带 SAPI（中文音色：Microsoft Huihui）
把文字合成 WAV，监听 `127.0.0.1:8765`：

```powershell
# 构建
dotnet build tools/VoiceBridge/VoiceBridge.csproj -c Release
# 运行（无窗口，日志在 state/voice-bridge.log）
.\tools\VoiceBridge\bin\Release\net9.0-windows\大夕瓜语音.exe
```

接口（对齐 SurfCore 的 `src/voice-tts.js`）：

```
POST /v1/speak/file   {"text":"...","format":"wav","sr":24000}
                      → 200 + WAV 字节（含 x-duration-ms 头）
GET  /health          → {"ok":true}
```

想换成云端 TTS 或本地神经 TTS（GPT-SoVITS / CosyVoice 等）：
**只改这个桥内部，桌宠那边一个字段都不用动**。

---

## 致谢

- [surfpet](https://github.com/Mieksido/surfpet) —— 桌宠框架、图层渲染、皮套 schema
- [SurfCore](https://github.com/Mieksido/surfcore) —— 对话/记忆/情绪层
- [PixiJS](https://pixijs.com/) —— 2D 渲染
- [Electron](https://www.electronjs.org/) —— 跨平台桌面运行时

## 许可

代码 [MIT](LICENSE)；素材见 [NOTICE.md](NOTICE.md)。
