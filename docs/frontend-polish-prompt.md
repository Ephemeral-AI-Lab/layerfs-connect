# Role & Task
你是一名顶尖的高级前端架构师与 UI/UX 设计师。请为 LayerFS Connect（AI Agent Copy-on-Write 运行时的 Electron 客户端）独立重构前端界面，完整实现 GitHub Issue #1 中规划的 U1 ~ U7 模块。

## 核心原则与技术约束
1. **纯前端实现**：严格保持纯前端代码改造，无须变动后端 Host API 与 Node 进程，使用 TypeScript + React 19 + Tailwind CSS。
2. **代码质量保证**：遵循严格模式，清理所有未使用的变量与导入，保证 `pnpm typecheck` 0 错误且 `pnpm build` 打包顺畅。
3. **平台原生契合**：三端原生标题栏适配（macOS 保留 traffic lights 原生红黄绿留白与隐藏式标题，Windows/Linux 动态更新窗口标题）。

---

## 🎨 视觉设计语言与 Design Tokens

### 1. 马卡龙纯净毛玻璃（Macaron Liquid Glass）
- **背景与表面**：页面采用极净浅色背景（纯白色 / 极浅底色搭配柔和微点阵），卡片与容器采用纯色半透明毛玻璃（`glass-liquid`，`backdrop-filter: blur(16px)`，`border: 1px solid rgba(var(--foreground), 0.08)`）。
- **侧边栏色差深度**：左侧导航栏做成独立毛玻璃层次（`glass-sidebar`），与主工作区画布产生适度透明度与色彩深度的色差，既有层次感又保证文字极佳的可读性。
- **大圆角（Squircle）**：全面采用 Squircle 大圆角，主卡片与面板统一采用 `rounded-2xl`，内部组件/控件采用 `rounded-xl`，标签/Pill 采用 `rounded-full`。
- **对比度第一**：严格遵循 WCAG AA/AAA 高对比度规范，文本统一采用实色高对比度（`text-foreground`、`text-muted-foreground`），禁止使用发灰模糊或难以辨认的浅色文字。

### 2. 单色渐变与光标动态变色（Single-Hue Dynamic Spotlight）
- **单色原则（重要）**：渐变本身**在同一时刻只允许呈现单一色彩（Monochromatic Gradient）**，从中心单一色相自然过渡至透明（`hsla(H, S, L, opacity) -> transparent`），**严禁**在同一个渐变内混合多种冲突色彩（去除彩虹碰撞、蓝绿粉黄杂糅）。
- **光标驱动变色**：光标在屏幕移动时，全局色相 `H` 随光标坐标（`clientX / clientY`）与移动轨迹距离平滑流动（冰川青 `185°` → 晴空蓝 `215°` → 薰衣草紫 `265°` → 柔和薄荷 `160°`）。
- **最短圆弧插值**：采用角度插值（Shortest-Arc Lerp）算法，保证跨越 360°/0° 时平滑无抖动。
- **全局色彩同步**：通过 `--cursor-hue` 全局 CSS 变量，使背景光晕（`CursorAura`）、卡片悬浮聚光灯（`.spotlight`）与流光扫掠（`.sheen-sweep`）在全屏保持同一步调的单色变化。

### 3. 克制收敛的执行动效（Conservative Developer UX）
- 拒绝花哨刺眼的街机游戏式流光、激光扫描条（`live-exec-scan`）或剧烈呼吸霓虹光晕（`box-shadow glow`）。
- 项目页使用静态状态点和短状态文字；移除持续光圈、呼吸、流动连线、数字滚动以及逐行入场动画。仅实际等待请求时使用轻量加载指示，并遵循减少动态效果设置。
- 实时页以会话与沙箱列表呈现，空闲时只显示简短空态；不显示装饰性项目中枢和假加载骨架。
- 主对话与子 Agent 对话在任务正常完成后自动收起 Agent 的中间回复和工具执行过程，用户发送的消息与最终回复始终可见；通过「查看过程」展开原始消息与操作。运行、等待子任务、失败和中断保持展开，折叠不改变保存的上下文，不使用高度过渡动画。
- 已开始的主对话与子 Agent 对话使用工作区可用宽度，移除回复头像及为头像预留的缩进；回复、工具、过程入口和输入框共用左右边线，用户气泡靠右。左右留白按工作区宽度为 16 / 24 / 32px，首页欢迎区保留原居中宽度。
- 回复卡片不重复显示 Connect / 作者标题，直接呈现思考入口和正文；子 Agent 名称在对话页头显示。保留液态玻璃材质，底部复制与用量使用轻量单行布局，不加分隔线。
- 导航统一为独立的浅色玻璃圆角按钮。标题只保留项目名称、最近提交与容量，避免在多个卡片中重复统计。
- 同级静态导航与模式页签按当前界面语言的文案长度由短到长排列，等长项保留原顺序；计数不参与排序。动态打开的标签、路径层级和有语义次序的选项保持原有顺序。
- 历史页保留搜索、筛选、分支、提交与详情；视图默认静止，不因后台事件改变用户的滚动位置。回放仅由用户主动启动。
- 存储默认显示核心容量，路径、底层参数和历史图表按需展开；沙箱默认展示状态、挂载与可用操作。移除始终禁用的占位操作。

---

## 🧩 核心功能模块规格（U1 ~ U7）

### U1. 视觉基石与全局规范
- 统一 Design Tokens、字体排印层级与间距节奏，移除原有刺眼的跑马灯边框与多余彩虹渐变。
- 深色模式使用中性黑灰画布和烟灰液态玻璃：侧栏更深，卡片与弹窗采用半透明中性灰、背景模糊和细微的上下沿反光，按钮呈现轻微厚度感。主操作使用灰白色，原有品牌、文件及状态图标保留颜色，图标强调色与操作主色分开。深色不使用蓝紫大底、彩色光晕、扫光和悬停上浮。正文保持实色高对比度，玻璃效果只作用于表面与背景，不模糊文字或图标。深色遮罩使用透明黑，浅色布局和现有功能保持不变。

### U2. 应用外壳与导航栏（App Shell）
- 侧边栏分为 `WORKSPACE`（Chat、Projects）、`RESOURCES`（Storage、Compute）两大分区；Demo 测试样例入口已清理。
- 导航选中态采用柔和圆角毛玻璃微光指示，Projects 主页展示真实项目，提供搜索与刷新。
- Resources 下方展示 Your projects 真实项目列表，与 Projects 页、Chat 工作区共用项目目录；创建成功立即显示，重开应用重新读取，点击项目直接打开。长列表独立滚动，不挤压上方导航。
- 项目行右侧提供独立删除 ×；二次确认显示项目名与删除范围，确认后调用现有删除接口。成功同步侧栏、Projects、Storage 和草稿选择；失败保留弹窗供重试。
- 侧栏项目保留胶囊形液态玻璃标题，对话使用轻量列表：44px 行高、2px 行间距，普通行透明，选中行仅保留 12px 圆角淡玻璃底，不加浮起阴影或描边。对话使用 18px 图标与 15px 单行名称，名称统一使用常规字重 400，选中时不加粗。长标题省略并提供完整悬停提示，不显示模型名称、时间副标题和状态圆点。右侧删除 × 不套圆形底座，保留独立的 28px 点击区，与图标和标题垂直居中，各行横向对齐；悬停时仅图标变浅红。二次确认显示完整对话名；删除成功同步清理列表、相关标签与本地草稿，失败保留弹窗，项目文件与 LayerFS 历史保留。

### U3. 历史与谱系详情（History Page）
- 三栏布局：左侧 Branch Tree（分支层级、发布状态）；中间 Lineage Graph（清晰的 Commit 节点、分叉连线与 Commit 标题）；右侧 Commit & Layer 详情抽屉（展示作者 Agent、时间戳、Commit Hash、Parents 以及变动路径数量与 modified/added 文件标签）。

### U4. 工作树视图（Worktree View）
- 按照 `git worktree list` 规范设计，顶部展示 4 项总览指标（Total Worktrees、Active Executions、Agent Workspaces、Mounted Branches）。
- 卡片式展示每个挂载目录（`/work`、`/app`、`/docs` 等），显示挂载分支、Commit HEAD、宿主沙箱 Provider、锁定 Agent（`root`、`ava`、`unlocked`）、脏文件计数，并提供 `Browse Files`、`Commit Changes` 与 `Unmount` 动作。

### U5. 存储与远端同步（Storage & Remote Sync）
- 识别并标识底层存储介质（SQLite 单文件卷 vs PostgreSQL 关系集群）。
- 显式提供 **Remote Storage & Sync** 控制面板：展示远程 S3/R2 URI、Provider、上次 Push/Pull 时间，提供即时 **[Push]** 与 **[Pull]** 按钮。
- 实现 **Push Rejected (Remote Changed)** 冲突告警横幅：当远端分支存在未同步 Commit 时，展示醒目的冲突说明、远端 HEAD 提交信息，并提供 `Pull & Merge Changes` 与 `Force Push (Overwrite)` 两种冲突解决动作。

### U6. 多 Provider 沙箱管理（Multi-Provider Sandboxes）
- 突破原有单一 Docker 限制，支持多 Provider 并行展示：包括 Docker 容器沙箱池与 Native macOS loopback（NFSv3 / FSKit 宿主内核挂载）。
- 清晰展示沙箱运行状态（Running / Standby）、已挂载工作区、宿主进程 PID 与架构（`darwin-arm64`）。

### U7. 新建 LayerFS 项目弹窗（New Project Dialog）
- 当前接通 **Local SQLite** 的真实初始化接口，提供空项目（Empty project）和文件夹导入（Import folder）。
- Projects 页、侧栏加号和 Chat 工作区提供入口；显示实际初始化阶段、错误和状态重试，成功后打开或选中项目。
- PostgreSQL 创建接口尚未提供，不展示模拟配置或连通性测试。

### 存储界面整洁度与可读性专项优化
- 左侧导航分栏精简为 `Storage Engines` 与 `Sync & Remotes`，去除冗余杂乱的文件路径与重复 5 次的相同备注。
- 右侧聚合为高可读性的 `Disk Allocation & Health` 存储容量与磁盘健康面板，消除重叠碰撞的刻度标签，优化 Worker 容器状态说明。
