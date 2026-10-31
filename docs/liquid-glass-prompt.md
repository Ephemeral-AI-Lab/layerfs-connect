# LayerFS Connect: Apple Liquid Glass（液态玻璃）界面重构与设计实现提示词

> 本提示词专为 **LayerFS Connect**（基于 Electron + React 19 + TypeScript + Tailwind CSS v4 的 AI Agent Copy-on-Write 运行时客户端）深度适配。将通透物理材质、清晰信息层级、光标感应单色流光与克制高效的开发者交互无缝落实到实际代码中。

---

## 当前组件材质约定

- 深色以黑灰画布为基础，参考系统控制中心与桌面小组件的玻璃质感：烟灰半透明表面、细边缘反光、浅投影；禁止给整个工作区覆盖蓝紫色。
- 图标保留现有品牌色和状态色，单独使用 `--icon-accent`，不随灰白主按钮一起去色。
- 导航按钮、输入框与浮层使用同一材质变量，正文和代码区优先保证可读性。背景模糊不作用于文字、图标。深色去掉扫光、彩色光晕和悬停位移。
- 下文光标色相、彩色玻璃与上浮动效仅适用于既有浅色方案；深色遵循本节约定。
- 光标跟随光保留在全局最底层：浅色为淡彩单色，深色为低亮度灰白；卡片与文字始终在上层。静止后减淡，离开窗口后淡出，减少动态效果时关闭；独立预览复用同一组件与分层。

## 任务背景与核心使命

你是一名顶级的前端架构师与 UI/UX 视觉设计师。请在当前 **LayerFS Connect** 项目中设计并落地一套媲美 **Apple Liquid Glass（液态玻璃）** 物理光学质感的界面设计系统。

在现有业务功能（AI 对话、CoW 项目管理、Worktree 挂载、存储与远端 S3/R2 同步、多 Provider 沙箱调度、计算资源监控）的基础上完成界面视觉与交互升级。**沿用项目核心品牌色、图标体系与原生平台习惯，保持纯前端代码改造（无须变动 Host API），实现直观、明了、保留图案而大幅精简提示文字的高级开发者界面。**

---

## 技术栈与工程基石

- **宿主与平台**：Electron 桌面客户端（macOS 优先，标准 Traffic Lights 红黄绿留白；兼顾 Windows / Linux 标题栏与窗口拖拽 `app-drag`）。
- **前端核心**：React 19 + TypeScript 严格模式（Strict Mode，禁止未使用的局部变量与导入）。
- **构建工具**：Vite + `electron-vite`。
- **样式系统**：Tailwind CSS v4（基于 `@theme inline` 声明 Design Tokens）+ 现代原生 CSS 特性（View Transitions、CSS 变量、物理阴影）。
- **图标系统**：Lucide React (`lucide-react`) + LayerFS 专有符号（`ConnectMark`, `LayerfsMark`, `LfsStore`, `LfsBranch`, `LfsCommit`, `LfsWorkspace`, `LfsSandbox`, `LfsWorker`）。
- **排版字体**：系统级 SF Pro / Inter Variable 变量字体 + SF Mono / JetBrains Mono 现代等宽字体。

---

## 一、整体设计方向

1. **轻盈、通透、精致、克制**：
   - 彻底告别廉价灰暗边框与呆板的平面白色填充，建立具有真实物理折射的“透镜感”。
   - 严禁夸张刺眼的街机流光、霓虹描边与晃动果冻特效，保持沉着冷峻的开发者生产力工具调性。
2. **清晰的前后层级系统**：
   - **底层画布（Canvas）**：极净背景，附带透光微点阵网格（Dot Grid），充当光学折射的基准参考系。
   - **左侧导航（Sidebar）**：以 `sidebar-glass` 材质独立悬浮，具备 32px 高斯模糊与高对比度文字识别度，配备液态玻璃滑动镜片指示器（`.sc-pick` / `.indicator`）。
   - **顶部操作栏（PageHeader）**：通透半透明悬浮面板，集成 macOS 信号灯避让区与原生拖拽，滚动时自动凝霜吸顶。
   - **核心内容区**：数据卡片、工作树节点、沙箱卡片采用 `.glass-liquid` 或 `.surface` 材质，搭配 Squircle 连续大圆角（`rounded-2xl`）；表格、文件代码查看器保留稳定、易读的基准背景。
3. **明了直观与精炼化原则（重要）**：
   - **完整保留图案与图元**：必须完整保留所有进度仪表盘（`DiskGauge`）、去重压缩流管道图（`DiskFlow`）、层级堆栈图（`LayerStack`）、分支拓扑图（`BranchTree` / `LineageGraph`）、沙箱槽位指示灯（`Slots`）、传输导线（`sc-wire`）与服务徽标（`Tile`）。
   - **大幅度精简提示文字**：彻底删减冗长、啰嗦的教学说明段落，去除内部未发布工单标签（如 `#446`、`(U4)`、`(U5)`），将口语化长句提炼为精准、干练的开发者指标（例如：以 `● 2 uncommitted` 代替“内存中有未写入存储的修改”；以 `Clean checkpoint` 代替“当前内容与存储检查点完全一致”）。

---

## 二、玻璃材质与物理光影规范

1. **物理双层边缘折射（Dual-Stroke Optical Glass）**：
   解决浅色背景上白边发飘与廉价塑料感的核心机制：
   - **外层微边界（Outer Border）**：
     - 浅色模式：`border: 1px solid rgba(15, 23, 42, 0.08)`（细微冷色暗调，稳固卡片轮廓）；
     - 深色模式：`border: 1px solid rgba(255, 255, 255, 0.12 ~ 0.16)`。
   - **顶边高光倒角（Specular Top Highlight）**：
     - `box-shadow` 内嵌第一层：`inset 0 1px 1.5px 0 rgba(255, 255, 255, 1)`（捕捉顶光形成真实倒角反光）。
   - **内壁漫射环（Ambient Occlusion Ring）**：
     - `box-shadow` 内嵌第二层：`inset 0 0 0 1px rgba(255, 255, 255, 0.75 ~ 0.85)`（模拟厚透镜侧壁的高亮折射）。
   - **贴身柔和层级投影**：
     - `0 1px 2px 0 rgba(0, 0, 0, 0.02), 0 8px 24px -4px rgba(15, 23, 42, 0.05), 0 20px 48px -12px rgba(15, 23, 42, 0.03)`，告别浓重脏黑投影。
2. **垂直流动流体填充（Vertical Fluid Gradient）**：
   - 浅色模式：`linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.78) 100%)`；
   - 深色模式：`linear-gradient(180deg, rgba(26, 30, 44, 0.82) 0%, rgba(18, 22, 34, 0.72) 100%)`；
   - 背景后置模糊：`-webkit-backdrop-filter: blur(28px) saturate(180%)`。
3. **单色动态流光法则（Single-Hue Monochromatic Rule，强制执行）**：
   - **单色原则**：在任何单帧时刻，界面渐变**只允许存在一种纯净单色（Monochromatic）**，由中心单一色相平滑过渡至透明，严禁在同一个渐变内混合多种冲突色彩（坚决杜绝蓝粉紫黄彩虹渐变）。
   - **光标流动色相**：全局通过 `--cursor-hue` CSS 变量（由 `CursorAura` 广播）与光标位置同步，采用最短圆弧插值（Shortest-Arc Lerp）在冰川青（185°）→ 晴空蓝（215°）→ 薰衣草紫（265°）→ 薄荷绿（160°）之间无缝流转。
   - **光照联动**：卡片悬浮高光（`.spotlight`）、流光扫掠（`.sheen-sweep`）、活动进度条（`.sc-bar-brand`）均绑定 `--cursor-hue`，光标静止时呈现温润单色镜面，滑动时流光随之自然变色。

---

## 三、形状、排版与字体系统

1. **统一字体规范（Typography Stack）**：
   - **全局界面字体**：统一读取 `--font-sans`：`"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif`。标题、导航、表单、模型与资源名称、弹窗和统计数字共用这一字体栈。
   - **等宽代码字体**：`"SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, ui-monospace, monospace`
   - **文字层级与字距**：
     - 大数值标头：`text-[26px]` 或 `text-2xl font-medium tracking-tight tabular-nums`；
     - 类别上标（Kicker）：`text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase`；
     - 正文 400，操作与项目名称 500，标题 550，强调 600；说明使用实色 `text-muted-foreground`；
     - 代码与哈希：`font-mono text-xs text-foreground/90`。
2. **Squircle 连续大圆角节奏**：
   - 主卡片 / 模态框 / 容器面板：统一采用 `rounded-2xl`（16px / 1rem）；
   - 内部子组件 / 输入框 / 按钮：统一采用 `rounded-xl`（12px / 0.75rem）；
   - 状态微标 / 胶囊标签 / 进度药丸：统一采用 `rounded-full`。
3. **色彩对比度与可读性**：
   - 保证所有正文文本处于文字层（`z-index` 高于模糊与高光折射伪元素）；
   - 文本与数字采用实色（`text-foreground` / `text-muted-foreground`），禁用低对比度灰字。

---

## 四、交互行为与物理动效

1. **光标悬停响应（Card Hover）**：
   - 卡片在鼠标悬停时平滑上浮 `-2px`，外层微透描边增亮，顶部折射高光扩散，产生透镜折射厚度感。
2. **平滑连续滑动（Liquid Gliding Indicator）**：
   - 侧边栏选定项与存储页列表选定项通过 `useIndicator` 驱动 `.sc-pick` / `.indicator` 悬浮液态透镜，选项切换时在背后平滑滑行吸附，无顿挫跳变。
3. **原生视图过渡（View Transitions）**：
   - 跨页面或跨 Tab 切换调用 `document.startViewTransition`，配合 CSS 缓动曲线完成优雅交叉淡入淡出。
4. **克制动效原则**：
   - 杜绝非交互状态下的无休止呼吸光晕与震颤动画；
   - 完整适配 `@media (prefers-reduced-motion: reduce)`，在用户开启减少动态效果时立即收敛为静态高清晰反馈。

---

## 五、LayerFS Connect 核心业务模块落地清单

在实际代码中，针对下列 9 大模块完成具体的液态玻璃组件改造：

1. **全局侧边栏 (`app-sidebar.tsx`)**：
   - 改造为 `sidebar-glass`，右侧保留 1px 微反光边缘与 32px 背景饱和模糊；
   - 导航激活项由纯粹的液态玻璃滑动药丸（`indicator glass-liquid`）衬底，移除旧版三色细线；
   - macOS 顶部避让 11px（`pt-11`），保证交通灯控制区优雅呼吸。
2. **全局统一页头 (`page-header.tsx`)**：
   - 支持吸顶凝霜模式（`sticky top-0` 结合 IntersectionObserver 监听 `data-stuck` 动态玻璃化）；
   - 集成 Electron 窗口拖拽区域（`app-drag` 与 `app-no-drag` 精准划分）；
   - 标题、面包屑、统计胶囊与右上角动作按钮严格居中对齐。
3. **AI 智能对话主页 (`chat-home.tsx` & `suggestions.tsx`)**：
   - 底部输入框底座采用浮空液态玻璃；
   - 空态引导卡片精炼为 4 个紧凑磁贴（保留专属图标与右上方箭头）：
     - `Explore codebase` · `Architecture & entry points`
     - `Run checks` · `Verify tests & scripts`
     - `Code review` · `Multi-agent inspection`
     - `Git changes` · `Inspect uncommitted diffs`
4. **项目中心主页 (`projects-home.tsx` & `project-card.tsx`)**：
   - 顶部统计光带（`StatsStrip`）升级为横向液态玻璃长条，数值大号等宽对齐；
   - 项目磁贴（`ProjectCard`）保留 `LayerStack` 三维堆叠图元与单色进度指示条；
   - 删减冗长说明，未初始化的展示干练标签 `Pending first session`。
5. **工作区挂载视图 (`worktree-view.tsx`)**：
   - 顶部 4 块指标卡片精炼为单值 + 紧凑词组（`mounted`、`active`、`locked`、`branches`）；
   - 挂载卡片以等宽字体展示挂载路径与分支，底部改用紧凑状态指示点（`● 2 uncommitted` 或 `Clean checkpoint`），保留 `Browse Files` 与 `Commit Changes` 按钮。
6. **项目存储与远端同步 (`project-storage.tsx`)**：
   - 远端 S3 / Cloudflare R2 面板整合为紧凑卡片，支持 `Push` / `Pull` 操作与冲突横幅（`Push Rejected`）；
   - 完整保留 `DiskFlow` 液体管道流向图、去重比与压缩比徽标、`SavedRing` 环形图以及提交柱状图；
   - 删去所有长篇大论的原理解释文字，以精炼指标展现。
7. **多 Provider 沙箱管理 (`sandbox-tiles.tsx`)**：
   - 支持 Docker 容器池与 Native macOS loopback（NFSv3 / FSKit）内核挂载卡片；
   - 完整保留 16 格工作区槽位图（`Slots`）与动态脉冲连接线（`sc-wire`）；
   - 运行态赋予柔和光晕环（`live-border` 与绿/蓝状态微标）。
8. **全局存储中心 (`storage-page.tsx` & `local-detail.tsx`)**：
   - 左侧分类导航精简为 `Storage Engines` 与 `Sync & Remotes`，激活项由液态玻璃镜片（`.sc-pick`）动态捕捉；
   - 聚合磁盘健康面板（`Disk Allocation & Health`），双路仪表盘清晰展示本地主机文件系统与 Docker 存储卷可用量；
   - 状态警告横幅紧凑化，去除冗长口语叙述。
9. **新建项目模态框 (`new-project-dialog.tsx`)**：
   - 弹窗外壳使用 `glass-strong` 材质与 2xl 物理投影；
   - 后端选择器以直观磁贴呈现（`Local SQLite` 单文件模式 vs `PostgreSQL` 集群模式），文字精炼，一目了然。

---

## 六、代码规范与工程约束

1. **纯前端代码重构**：严禁修改任何后端服务逻辑、Node 进程接口或底层数据库结构。
2. **TypeScript 严格零错误**：
   - 严格遵守 `noUnusedLocals` 与类型安全，杜绝 `any` 泛滥与未引用的无用变量。
   - 每次代码变更后必须通过 `pnpm typecheck`（退出码为 0）。
3. **构建无异常**：
   - 执行 `pnpm build` 时 Vite SSR 与 Client 编译必须顺畅完成且无致命警告。
4. **统一 Design Tokens 维护**：
   - 所有液态玻璃样式统一定义在 `src/renderer/src/styles.css` 中（`.glass`, `.glass-strong`, `.glass-liquid`, `.sidebar-glass`, `.surface`, `.card-hover`, `.spotlight`），禁止在各子组件内硬编码参差不齐的半透明背景或深黑阴影。

---

## 七、验收与验证步骤

1. **类型检查与构建验证**：
   ```bash
   cd layerfs-lab/layerfs-connect && pnpm typecheck && pnpm build
   ```
2. **全页面实际运行与截图检查**：
   使用 Electron 自动化截图环境变量在实际窗口中验证视觉呈现：
   - Projects 主页：`CONNECT_VIEW=projects CONNECT_SHOT=shot-projects.png pnpm start`
   - Storage 页面：`CONNECT_VIEW=storage CONNECT_SHOT=shot-storage.png pnpm start`
   - Compute 页面：`CONNECT_VIEW=compute CONNECT_SHOT=shot-compute.png pnpm start`
   - Chat 会话页：`CONNECT_VIEW=chat CONNECT_SHOT=shot-chat.png pnpm start`
   - Worktree 视图：`CONNECT_VIEW=projects/tour/worktrees CONNECT_SHOT=shot-worktrees.png pnpm start`
   - 项目存储详情：`CONNECT_VIEW=projects/tour/storage CONNECT_SHOT=shot-project-storage.png pnpm start`
3. **人工视觉核验标准**：
   - [ ] 浅色背景下卡片边缘清晰，有透镜折射质感，无“发飘发灰”的塑料感；
   - [ ] 光标移动时全屏仅呈现一种纯净单色渐变，且色相平滑变换；
   - [ ] 所有图表、图元、仪表盘完整保留，界面无冗长段落和破损截断文本；
   - [ ] 字体、字阶、字距与代码等宽字体在全局各页面高度统一。
