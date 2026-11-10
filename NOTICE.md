# 授权与素材来源说明（NOTICE）· daxigua-pet

本仓库**不是完全自由的软件包**：代码是 MIT，但美术素材有各自的来源和限制。
公开发布前请把这一页看完，尤其是「**不能分发的内容**」一节。

---

## 一、代码

| 部分 | 来源 | 许可证 |
|---|---|---|
| `app/dist/*.js`（Electron 主进程 / 渲染器） | [surfpet](https://github.com/Mieksido/surfpet) v0.2.3 | **MIT** |
| 对话/记忆/情绪层（前端调用协议） | [SurfCore](https://github.com/Mieksido/surfcore) | **MIT** |
| `tools/MakeSkin`（分层皮套生成/校验） | 本项目新写 | MIT |
| `tools/AutoSplit`（整图自动拆分实验） | 本项目新写 | MIT |
| `tools/VoiceBridge`（本地 SAPI 语音桥） | 本项目新写 | MIT |
| `tools/PetLauncher`（启动器） | 本项目新写 | MIT |
| `app/themes/*.css` | 本项目新写 | MIT |

MIT 要求：**保留原作者的版权声明**。本仓库根目录 `LICENSE` 已同时列出原作者与本项目作者，请勿删除。

### 对上游代码的修改

`app/dist/main.js`、`app/dist/renderer.js`、`app/dist/dialog.js`、`dialog.html`、`bubble.html`
在原版基础上做了以下改动（均为本项目新增）：

1. `main.js`：主题系统（`themes/*.css` 注入、托盘菜单切换）
2. `main.js`：窗口定位增加有限值/范围守卫（修 `win.setPosition` 崩溃）
3. `main.js`：窗口标题、托盘提示改为「大夕瓜」
4. `renderer.js`：每只眼睛独立视线增益 `gazeMax`、`irisOffset`（瞳孔静止偏移）
5. `renderer.js`：后发独立摆动 `backHairSway`
6. `dialog.html` / `bubble.html` / `dialog.js`：头像从 emoji 改为图片（`assets/icon.png`）

---

## 二、美术素材

`app/skins/` 下四套皮套**全部为 AI 生成**（作者自制，随仓库以 MIT 之外的许可提供：
**允许转载与二次创作，禁止商用售卖**——若你希望改成更宽松的许可，自行改这一节即可）。

| 皮套 | 图层数 | 说明 |
|---|---|---|
| `xi-01-wenrou`（恬·温柔） | 13 | 分层完整：眨眼、视线、说话口型、后发摆动 |
| `xi-03-ooc` | 1 | 单层（暂未拆分） |
| `xi-04-dongzhuang`（冬装） | 1 | 单层（暂未拆分） |
| `xi-05-shuiyi`（睡衣） | 17 | 分层：眨眼、转头、部件独立 |

> 关于 AI 生成内容的合规：中国大陆《生成式人工智能服务管理暂行办法》要求对 AI 生成内容
> 进行标识；GitHub 等平台也建议在 README 里声明素材为 AI 生成。本项目已在 README 声明。

---

## 三、不能分发的内容（已从本仓库剔除）

以下内容**不在本仓库内**，也请不要在你自己的 fork 里加入：

| 内容 | 原因 |
|---|---|
| 官方游戏的角色立绘 / 语音包（含本项目开发期用的「精一」那套） | 版权属于游戏厂商与配音演员。**做二创视频可以（合理使用），二次分发素材不行** |
| `feiyu-01` ~ `feiyu-05`（surfpet 自带示例皮套） | 上游仓库未授权再分发美术资源；如需使用请到原仓库自行下载 |
| `pets/whale-moe-v1` | 上游明确标注 **no relicense**（不可再许可） |
| 任何游戏语音、角色配音、Live2D 原画 | 同上 |

**判断标准很简单**：素材是不是你自己（或用 AI）做的？
不是的话，只放**下载/安装说明**，不要把文件放进仓库。

---

## 四、第三方组件

| 组件 | 许可证 | 备注 |
|---|---|---|
| [Electron](https://www.electronjs.org/) | MIT | 运行时**不随仓库分发**，由 `scripts/fetch-electron.ps1` 下载 |
| [PixiJS](https://pixijs.com/) v8 | MIT | 已打包进 `app/dist/renderer.js` |
| .NET 9（`tools/` 需要） | MIT | 仅构建工具需要 |
| Windows SAPI 语音（Huihui 等） | 随 Windows 提供 | 仅调用系统接口，不分发语音引擎 |

---

## 五、商标

本项目与「DeepSeek」「明日方舟」「Arknights」等名称、商标**没有任何隶属或背书关系**。
README 中提到这些名词仅用于说明兼容性或技术栈，不构成商标使用许可。
