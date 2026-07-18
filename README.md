# FlowFiles · 节点画布文件管理器（v0.3 Web 原型）

**画布即文件夹**：指定一个本机文件夹，里面的文件自动铺成画布节点。你可以拖拽排布、在文件之间拉线建立关系（迭代 / 引用 / 相关）并写备注、点击节点跳转打开真实文件，还可以创建"还没有对应文件"的占位节点，事后再补文件。

v0.2 起支持**混合画布模型**：除了绑定文件夹的「文件夹画布」，还可以创建不绑定任何文件夹的「自由画布」，把任意路径的文件作为外部引用节点放上来组织关系。

v0.3 新增**第二梯队画布能力**：分组框（圈选建组 / 整组拖动）、Cmd+F 搜索定位、类型筛选与「只看相关」、拓扑分层自动整理、左键框选多选 + 批量操作，以及自由画布从 Finder 拖入（复制到受管文件夹并引用）。

本原型用于验证全部交互，后续将用 Tauri 打包为 Mac 原生应用。

## 启动

```bash
npm install
npm run dev -- --port 7100
```

单进程架构：`vite.config.ts` 里的自定义 Vite 插件通过 `server.middlewares` 直接提供 `/api/*` REST 接口（Node `fs` / `child_process`），无需独立后端；端口由 CLI 透传（vite 默认支持 `--port`，配置中无 strictPort 硬编码）。

首次启动会自动创建 `demo-folder/`（6 个示例文件）作为默认受管文件夹，并播种初始画布（5 个文件节点 + 4 条关系连线 + 1 个占位节点 `launch-checklist`）。

## 混合画布模型

- **文件夹画布**：绑定一个受管文件夹，文件夹内容实时铺成节点。左侧栏「文件夹画布」区列出最近使用的文件夹（最多 10 个），点击即切换。
- **自由画布**：不绑定文件夹的空白画布，可新建 / 重命名 / 删除。节点可以引用受管文件夹之外的任意文件（`externalPath` 绝对路径），外部文件消失时节点置灰标「已丢失」，侧栏可「按文件名重新定位」（在最近文件夹里找回）。
- 自由画布激活时：`/api/state` 仍返回当前受管文件夹的 files（便于占位节点"关联已有文件"），但不自动把新文件铺上画布。
- **自由画布拖入语义（v0.3）**：从 Finder 拖文件到自由画布 = 先复制进当前受管文件夹，再以 `externalPath` 引用节点（指向刚写入的副本）直接放到落点，不等轮询；文件夹画布的拖入行为不变。

`graph.json` 的 key 规则：文件夹画布用 `dir:<绝对路径>`，自由画布用 `canvas:<id>`；**向后兼容**：不含前缀的旧 key 一律视为文件夹路径（读取时自动回退，写入时迁移为新 key）。

## 数据持久化

- `server-data/config.json` — `{ dir, recentDirs[], activeCanvas }`；旧格式（只有 `dir`）读取时自动迁移
- `server-data/canvases.json` — `{ canvases: [{ id, name, createdAt }] }`
- `server-data/graph.json` — 按上述 key 规则存储每个画布的图（节点坐标 / 备注 / 外部引用、连线 / 关系 / 备注、`frames[]` 分组框）；旧数据没有 `frames` 字段时按 `[]` 处理
- 新文件自动出现在画布空闲网格位，坐标只在用户拖动确认后才写入 graph

## v0.3 画布能力

- **分组框**：`frames: [{id, name, x, y, w, h}]` 随 graph 一起持久化。多选节点后批量工具栏「建组」自动贴合大小，工具行「新建分组框」在视口中心放空框；拖标题栏整组移动（中心点在框内的节点跟随）、双击标题改名、右上角删除（只删框不动节点）、右下角拖拽调整大小。独立绝对定位图层实现，不用 reactflow 的 parentNode
- **搜索定位**：`Cmd/Ctrl+F` 打开搜索浮层（已 preventDefault 浏览器默认搜索），实时匹配节点文件名 / 节点备注 / 连线备注，选中结果平滑居中并选中目标（Esc 关闭）
- **筛选器**：工具行 chips（全部 / 文档 / 图片 / 表格 / 文件夹 / 占位）用 reactflow `hidden` 隐藏未命中节点及相关边，不删数据；选中节点后「只看相关」只保留该节点 + 直接相连的节点和边
- **自动整理**：自研拓扑分层布局（无 dagre 依赖）——入度为 0 的节点在第 0 列逐层向右，有环时剩余节点兜底到最后一层，孤立节点在最右侧网格排列；分组框跟随其包含节点重新贴合，应用后自动 fitView
- **多选与批量操作**：`selectionOnDrag` + `panOnDrag={[1, 2]}`（左键框选、中/右键平移、Shift 加选）；多选 ≥2 时顶部浮出批量工具栏：建组 / 左对齐 / 顶对齐 / 从画布移除（批量，仅移画布不删文件）

## 功能清单

- **画布**：React Flow + 点阵背景；自定义节点按扩展名显示类型图标（md=文档 / csv=表格 / png=图片等）、文件名、大小 / 修改时间、备注数角标
- **图片缩略图**：图片类节点卡片顶部直接显示缩略图（90px、object-cover）
- **实时同步**：前端每 3 秒轮询，文件夹新增文件自动上画布；被外部删除的文件节点置灰标「已丢失」
- **拖拽排布**：拖拽结束后防抖 500ms 保存坐标
- **拉线建关系**：从节点 handle 拖到另一节点，弹出对话框选择关系类型（迭代 / 引用 / 相关）+ 备注；迭代=实线，引用 / 相关=虚线，边标签显示关系词
- **节点删除**：`Backspace` / `Delete` 键或侧栏「从画布移除」= 仅从画布移除节点，绝不动文件；「移到废纸篓」经确认后调用 Finder 删除文件（可从废纸篓恢复）
- **从 Finder 拖入**：把文件拖到画布上即复制进受管文件夹并落在拖放点（重名自动加 `-1` 后缀）；自由画布上则是复制进受管文件夹后以引用节点落到拖放点
- **空格键预览**：选中节点按空格弹出快速预览（图片大图 / pdf 原生渲染 / 文本前 800 字符摘录 / 其他类型显示文件信息）；焦点在输入框或已有弹窗时不触发。Tauri 阶段将替换为系统 QuickLook
- **详情侧栏**：
  - 文件节点：预览区（图片 / pdf / 文本）、文件信息、备注列表、「打开文件」「在 Finder 中显示」「从画布移除」「移到废纸篓」
  - 外部引用节点：显示完整路径与「外部引用」标识；断线时提供「按文件名重新定位」
  - 占位节点（虚线边框 +「待补文件」标签）：可改目标文件名 →「创建文件并关联」，或从下拉直接关联尚未上画布的文件
  - 连线：显示关系类型 + 备注，可编辑备注、删除连线
- **左侧画布栏**：「文件夹画布」（最近文件夹，高亮当前）+「自由画布」（新建 / 重命名 / 删除，删除有确认）
- **顶栏**：当前路径或自由画布名、「更换文件夹」、「+ 新建占位节点」、文件计数

## API 列表

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | `{ dir, recentDirs, canvases, activeCanvas, files[], graph, externalStatus }`；files 实时扫描当前受管文件夹 |
| POST | `/api/dir` | `{dir}` 切换受管文件夹并推入 recentDirs，返回新 state |
| POST | `/api/graph` | 整体保存当前激活画布的 nodes + edges（前端防抖 500ms 调用） |
| POST | `/api/canvas` | `{name}` 创建自由画布并切换 |
| POST | `/api/canvas/switch` | `{kind, id}` 切换画布；kind='dir' 时 id 为文件夹路径（同时更新 dir / recentDirs） |
| POST | `/api/canvas/rename` | `{id, name}` 重命名自由画布 |
| POST | `/api/canvas/delete` | `{id}` 删除自由画布及其图数据；若正在使用则回退到当前 dir 画布 |
| POST | `/api/open` | `{fileName}`（受管文件夹内）或 `{path}`（外部引用绝对路径）用 `open` 打开 |
| POST | `/api/reveal` | 同上，用 `open -R` 在 Finder 中显示 |
| POST | `/api/locate` | `{fileName}` 在 recentDirs（含当前 dir）一层深度内按文件名搜索，返回 `{path}` 或 404 |
| POST | `/api/trash` | `{fileName}` 经 osascript 调 Finder 移到废纸篓（保留路径校验） |
| POST | `/api/import` | multipart 上传，写入当前受管文件夹（重名加 `-1` 后缀），返回项含写入后的绝对路径 `path`；自由画布同样接受（前端拿 `path` 建引用节点） |
| GET | `/api/thumb` | `?name=` 或 `?path=` 返回文件原始字节（png/jpg/jpeg/gif/webp/svg/bmp/pdf）；path 必须是当前画布已登记的外部引用 |
| GET | `/api/preview` | `?name=` 或 `?path=` 文本类文件返回前 800 字符 JSON `{text, truncated}` |
| POST | `/api/materialize` | `{fileName}` 在受管文件夹创建空文件（已存在返回 409） |

安全：open / reveal / trash / materialize / import 的受管路径均 `path.resolve` 后校验位于受管文件夹内；`/api/thumb`、`/api/preview` 的 `?path=` 仅允许当前画布已登记的外部引用路径，防止任意文件读取。

## 验证

`bash scripts/verify-dev.sh` 会临时启动 dev server，逐项 curl 验证全部 API（含 409 / 400 边界情况），结束后自动停掉服务并还原测试改动。

`bash scripts/verify-v03.sh` 验证 v0.3 新增能力：frames 往返持久化（含非法数据清洗）、自由画布 `/api/import` 返回绝对路径、缩略图 / 文本预览回归；同样临时起停 dev server 并清理测试产物。

## 后续 Tauri 打包

- 前端：`npm run build` 产物在 `dist/`，Tauri 直接指向前端静态资源即可
- 后端：把 `server/api.ts` 的中间件逻辑平移为 Tauri commands（Rust 侧 `std::fs` / `std::process::Command` 实现 open / reveal / trash / import），或短期内保留一个本地 sidecar HTTP 服务
- 空格预览弹窗届时替换为 macOS 系统 QuickLook（QLPreviewPanel），代码中已留 TODO 注释
- `open` / `open -R` 在 macOS 原生可用，Tauri 侧也可用 `opener` / `reveal-item-in-dir` 类 crate
- graph / config / canvases 的 JSON 持久化路径可迁移到 `app_data_dir()`

## 技术栈

React 19 + TypeScript + Vite 7 + React Flow 11 + Tailwind CSS 3 + shadcn/ui + lucide-react + sonner
