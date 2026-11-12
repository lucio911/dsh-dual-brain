# 双脑协同 · dsh-dual-brain

> 思考脑规划复查 · DSH 模型执行 —— 一个 [DeepSeek Harness (DSH)](https://github.com) 插件。

把「深度思考/架构规划」和「落地执行」拆给两个不同的脑：

- **思考脑**：走宿主已接入的推理模型（含 Codex 订阅通道，如 GPT-6.1-Sol），负责拆解目标、出执行清单；执行完后做独立验收审查。
- **执行脑**：DSH 本地模型，在工作区里真正改代码、跑测试。

三步工作流：**规划 → 派发执行 → 复查验收**，全过程可在 Web 工作台勾选清单进度、留档历史。

## 界面

安装后在 DSH Web GUI 侧边栏出现 **双脑协同** 面板，三个标签页：

| 标签 | 作用 |
| --- | --- |
| 任务工作台 | 输入目标 → 启动深度思考与规划 → 派发到 DSH 执行 → 启动复查验收 |
| 任务历史 | 历史任务留档，可一键载入工作台或复查 |
| 连接配置 | 选择思考脑 / 复查脑 / 执行脑模型、推理档位、API 备选通道 |

## 安装

### 方式一：作为 npm 包安装

```bash
npm install -g @lucio911/dsh-dual-brain
```

### 方式二：直接放进插件目录

```bash
git clone https://github.com/lucio911/dsh-dual-brain.git
# 拷到 DSH 插件目录
cp -r dsh-dual-brain ~/.dsh/plugins/dsh-dual-brain
```

### 启用 patch

DSH 通过 `cordis.patch.yml` 装载插件。在 `~/.dsh/cordis.patch.yml` 里追加：

```yaml
- insert:
    - id: dsh-dual-brain
      name: 'dsh-dual-brain'
```

然后重启 DSH。

## 配置

配置落盘在 `~/.dsh/dual-brain/config.json`（也可全部在「连接配置」页里改）。

| 键 | 说明 | 默认 |
| --- | --- | --- |
| `plannerSource` / `reviewerSource` | 通道：`dsh-llm`（宿主已接入模型）或 `openai-api` | `dsh-llm` |
| `plannerRoute` / `reviewerRoute` | `{ provider, model, effort }` 路由 | `openai-codex` + medium |
| `executorRoute` | 派发执行时新建会话选择的模型；留空则用会话默认模型 | 空 |
| `baseUrl` / `apiKey` | API 备选通道（OpenAI 或兼容网关） | api.openai.com / 空 |
| `apiPlannerModel` / `apiReviewerModel` | API 通道下的模型名 | `o3-mini` / `gpt-4o` |
| `customPromptPlanner` / `customPromptReviewer` | 自定义系统提示词，留空使用内置模板 | 空 |
| `showReasoning` | 是否展示思考过程 | `true` |

> 未登录 Codex 订阅时，先在 DSH「设置 → Codex 订阅」登录 ChatGPT 账号，或改走 API 通道。

## Agent 工具

插件向 DSH 会话注册了一个工具，任何会话里的模型都可以直接咨询思考脑：

```ts
dual_brain_consult({ mode: 'plan' | 'review', prompt: string })
```

- `plan`：对目标做深度拆解，返回结构化执行方案
- `review`：对结果（附 diff 或执行日志）做验收审计，返回 PASS / CHANGES REQUESTED / FAIL

## HTTP 路由

插件在 `ctx.webServer` 上注册以下接口，供工作台前端调用：

```
GET  /api/dual-brain/model-catalog      宿主模型目录
GET  /api/dual-brain/model-info         某 provider 的推理档位
GET  /api/dual-brain/config             读取配置（apiKey 脱敏）
POST /api/dual-brain/config             保存配置
GET  /api/dual-brain/workspaces         工作区枚举
GET  /api/dual-brain/workspace-status   工作区 git 状态与文件概览
POST /api/dual-brain/plan               阶段一：思考脑规划
POST /api/dual-brain/dispatch           阶段二：派发 DSH 会话执行
GET  /api/dual-brain/session-progress   执行会话进度
POST /api/dual-brain/review             阶段三：复查脑验收
GET/POST/DELETE /api/dual-brain/tasks   任务历史
POST /api/dual-brain/test-connection    API 通道连通测试
GET  /api/dual-brain/codex-status       Codex 订阅可用性
```

## 数据位置

| 路径 | 内容 |
| --- | --- |
| `~/.dsh/dual-brain/config.json` | 连接与模型配置 |
| `~/.dsh/dual-brain/tasks.json` | 任务历史 |

## 本地开发

无构建步骤，`index.js`（Host，ESM）与 `client.js`（浏览器 classic script，React 由宿主模块表提供）直接可读。

```bash
node --check index.js
```

## 许可

MIT © lucio911
