/**
 * dsh-dual-brain v2 — 双脑协同 Host 端
 *
 * 取其精华（参考 dsh-codex-subscription / dsh-prompt-polish / awesome-dsh-plugin 生态）：
 *  1. 思考/审查模型不再写死 o1/o3-mini —— 默认走宿主 `ctx.llm` 已注册的 provider
 *     （包含 openai-codex 订阅通道：GPT-6-Luna / GPT-5.6-Sol 等），API 通道降级为备选。
 *  2. 工作区通过 `ctx.workspaceRegistry.list()` 真实枚举，git 感知全部围绕所选工作区。
 *  3. "派发执行"通过 `ctx.sessionController` 在目标工作区创建 DSH 会话、选定执行模型、
 *     注入执行指令 —— 半自动：用户在工作台确认后才派发，执行日志回流后可发起复查。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const name = 'dsh-dual-brain';
export const inject = ['llm', 'tools', 'webServer', 'workspaceRegistry', 'sessionController'];

const DATA_DIR = path.join(os.homedir(), '.dsh', 'dual-brain');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

const DEFAULT_CONFIG = {
  // 思考脑通道：'dsh-llm'（宿主已接入模型，含 Codex 订阅） | 'openai-api'（API Key 直连）
  plannerSource: 'dsh-llm',
  reviewerSource: 'dsh-llm',
  // dsh-llm 通道路由 { provider, model, effort }
  plannerRoute: { provider: 'openai-codex', model: '', effort: 'medium' },
  reviewerRoute: { provider: 'openai-codex', model: '', effort: 'medium' },
  // 执行脑（DSH 本地模型）路由
  executorRoute: { provider: '', model: '' },
  // openai-api 备选通道
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiPlannerModel: 'o3-mini',
  apiReviewerModel: 'gpt-4o',
  // 自定义系统提示词（留空用内置精华模板）
  customPromptPlanner: '',
  customPromptReviewer: '',
  // 思考过程展示开关
  showReasoning: true,
};

const PLANNER_PROMPT = `你是一位顶尖的架构师与技术规划专家。你只负责【深度思考】、【全局架构规划】和【严密任务拆解】，不要亲自写代码执行，而是生成一份清晰严谨、可直接由下层执行 Agent（DSH 本地模型）逐步落实的执行方案。

请严格按以下 Markdown 结构输出：

## 1. 深度思考与架构设计
- 目标剖析与核心诉求
- 技术方案选型与可行性分析
- 潜在风险、边界情况与防御策略

## 2. 文件与改动清单
- 预期新增、修改或删除的文件列表及核心改动点

## 3. 分步执行清单 (Execution Checklist)
每个步骤必须以此格式独立成行，便于系统解析勾选：
- [ ] **步骤: <步骤标题>**
  - **目标**: <该步骤具体做什么>
  - **指令/工具**: <推荐命令或文件修改要点>
  - **验证标准**: <如何确认本步骤已成功>

## 4. 下发给 DSH 执行者的指令草案
直接给 DSH 本地执行 Agent 的完整 Prompt（含上下文、约束与验收口径），用户可一键派发。`;

const REVIEWER_PROMPT = `你是一位严谨的代码审查官与验收审计专家。对比最初的【用户目标】、【思考规划方案】以及【实际执行情况与工作区改动】，进行全面严格的验收审查。

请严格按以下 Markdown 结构输出审查报告：

## 1. 计划覆盖度与完整性评估
- 规划中的关键步骤是否完整落实？是否存在遗漏？

## 2. 代码质量、安全性与潜在隐患
- 语法错误 / 逻辑漏洞 / 未捕获异常 / 边界情况失效
- 风格与架构是否严谨

## 3. 环境与副作用核验
- 残留临时文件、调试信息、依赖破坏风险

## 4. 最终验收结论
- **评审判定**: [✅ PASS 验收通过] 或 [⚠️ CHANGES REQUESTED 需补充修复] 或 [❌ FAIL 验收未达标]
- **总结与后续建议**`;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  ensureDataDir();
  let saved = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { /* ignore */ }
  }
  const merged = { ...DEFAULT_CONFIG, ...saved };
  merged.plannerRoute = { ...DEFAULT_CONFIG.plannerRoute, ...(saved.plannerRoute || {}) };
  merged.reviewerRoute = { ...DEFAULT_CONFIG.reviewerRoute, ...(saved.reviewerRoute || {}) };
  merged.executorRoute = { ...DEFAULT_CONFIG.executorRoute, ...(saved.executorRoute || {}) };
  return merged;
}

function saveConfig(patch) {
  const current = loadConfig();
  let apiKey = patch.apiKey;
  if (typeof apiKey === 'string' && apiKey.includes('****')) apiKey = current.apiKey;
  const merged = { ...current, ...patch, apiKey: apiKey ?? current.apiKey };
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function loadTasks() {
  ensureDataDir();
  if (fs.existsSync(TASKS_FILE)) {
    try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')); } catch { /* ignore */ }
  }
  return [];
}

function saveTasks(tasks) {
  ensureDataDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

function maskKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key.length <= 8 ? '****' : key.slice(0, 4) + '****' + key.slice(-4);
}

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(json);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

async function runGit(cwd, args, timeoutMs = 6000) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: String(stdout).trim() };
  } catch (error) {
    return { ok: false, out: '', error: String(error?.message || error) };
  }
}

function safeRealpath(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

// Codex 官方目录实测档位（low/medium/high/xhigh/max）；provider 不暴露 exact-model
// 元数据时用它兜底，保证档位下拉永远可用而不是空白。
const EFFORT_FALLBACKS = {
  'openai-codex': ['minimal', 'low', 'medium', 'high', 'xhigh'],
};

function fallbackEfforts(provider) {
  const ids = EFFORT_FALLBACKS[provider] || ['low', 'medium', 'high'];
  return ids.map(id => ({ id, name: id, description: '' }));
}

function workspaceFilesOverview(dir, limit = 40) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
      .slice(0, limit)
      .map(e => ({ name: e.name, isDir: e.isDirectory() }));
  } catch { return []; }
}

export function apply(ctx, _config) {
  // ---------- 1. Agent 工具：让 DSH 会话内模型可咨询思考脑 ----------
  ctx.tools.register({
    name: 'dual_brain_consult',
    description: 'Consult the Dual-Brain reasoning model (Codex subscription / ChatGPT / DSH-registered model) for deep planning or independent review. Returns the model verdict text.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['plan', 'review'], description: 'plan = think & decompose the task; review = audit result quality against goal.' },
        prompt: { type: 'string', description: 'The goal / context to consult about. Include relevant code or diffs for review mode.' },
      },
      required: ['mode', 'prompt'],
    },
    execute: async ({ mode, prompt }) => {
      try {
        const result = await consultBrain(ctx, mode, prompt);
        return { ok: true, provider: result.provider, model: result.model, result: result.text, ...(result.reasoning ? { reasoning: result.reasoning } : {}) };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          provider: { type: 'string' },
          model: { type: 'string' },
          result: { type: 'string' },
          reasoning: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, result) => [{ type: 'text', text: result.ok ? (result.result || '') : `错误: ${result.error || '未知错误'}` }],
    },
  });

  // ---------- 2. 脑通道核心：优先宿主 llm.stream（含 Codex 订阅），备选 OpenAI API ----------
  // DSH 的 Message.content 必须是 block 数组（适配器的 flattenText 对 content 调 .some/.filter），
  // 传裸字符串会抛 "content.some is not a function"。
  function brainMessage(role, text) {
    return { id: `dual-brain-${randomUUID()}`, role, content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: name } };
  }

  async function callDshLlm(route, messages, { effort } = {}) {
    if (!route?.provider || !route?.model) throw new Error('思考脑模型未选择：请在「连接配置」中挑选宿主已接入的模型');
    let text = '';
    let reasoning = '';
    let terminal;
    const options = { provider: route.provider, model: route.model, messages };
    const useEffort = effort ?? route.effort;
    if (useEffort && useEffort !== 'follow') options.reasoningEffort = useEffort;
    for await (const chunk of ctx.llm.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text ?? '';
      else if (chunk.type === 'reasoning-delta') reasoning += chunk.text ?? '';
      else if (chunk.type === 'finish') terminal = chunk;
      else if (chunk.type === 'error') throw new Error(`模型流错误: ${chunk.text || JSON.stringify(chunk).slice(0, 400)}`);
    }
    if (terminal?.reason?.kind && terminal.reason.kind !== 'stop') {
      throw new Error(`模型调用未完成: ${JSON.stringify(terminal.reason).slice(0, 500)}`);
    }
    if (!text && !reasoning) throw new Error('模型没有返回任何内容');
    return { text, reasoning, provider: route.provider, model: route.model };
  }

  async function callOpenAiApi(cfg, routeModel, messages) {
    if (!cfg.apiKey) throw new Error('OpenAI API Key 未配置');
    const cleanBase = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const isReasoningModel = /^(o1|o3|o4)/i.test(routeModel);
    const payload = { model: routeModel, messages, stream: false };
    if (!isReasoningModel) payload.temperature = 0.6;
    const response = await fetch(`${cleanBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${(await response.text()).slice(0, 400)}`);
    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      reasoning: data.choices?.[0]?.message?.reasoning_content ?? '',
      provider: 'openai-api',
      model: routeModel,
    };
  }

  async function consultBrain(ctx2, mode, prompt, opts = {}) {
    const cfg = loadConfig();
    const source = opts.source || (mode === 'review' ? cfg.reviewerSource : cfg.plannerSource);
    const systemText = (mode === 'review' ? (cfg.customPromptReviewer || REVIEWER_PROMPT) : (cfg.customPromptPlanner || PLANNER_PROMPT));
    if (source === 'openai-api') {
      const model = opts.model || (mode === 'review' ? cfg.apiReviewerModel : cfg.apiPlannerModel);
      return callOpenAiApi(cfg, model, [
        { role: 'system', content: systemText },
        { role: 'user', content: prompt },
      ]);
    }
    const route = opts.route || (mode === 'review' ? cfg.reviewerRoute : cfg.plannerRoute);
    return callDshLlm(route, [brainMessage('system', systemText), brainMessage('user', prompt)], { effort: opts.effort });
  }

  // ---------- 3. Web 路由 ----------
  const route = (spec) => { ctx.effect(() => ctx.webServer.register(spec), `dualBrain${spec.path}`); };
  const corsPreflight = (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return true;
    }
    return false;
  };

  // 3.1 宿主模型目录：真实枚举 ctx.llm 里已接入的一切（Codex 订阅 / DeepSeek / 其他）
  route({
    kind: 'exact', path: '/api/dual-brain/model-catalog',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      try {
        const providers = ctx.llm.listProviders();
        const catalog = [];
        for (const provider of providers) {
          const entry = { id: provider.id, name: provider.name || provider.id, models: [] };
          try {
            const models = await ctx.llm.listModels(provider.id);
            entry.models = models.map(m => ({
              id: m.id,
              name: m.name || m.id,
              contextWindow: m.contextWindow,
              effortLevels: Array.isArray(m.reasoning?.efforts) ? m.reasoning.efforts.map(e => e.id ?? e) : [],
              defaultEffort: m.reasoning?.defaultEffort,
            }));
          } catch { /* provider 无模型目录时跳过 */ }
          if (entry.models.length > 0) catalog.push(entry);
        }
        sendJson(res, 200, { ok: true, catalog });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    },
  });

  // 3.2 单模型精确元数据：推理档位只在 llm.resolveModelInfo() 上，listModels() 不带。
  route({
    kind: 'exact', path: '/api/dual-brain/model-info',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const provider = url.searchParams.get('provider');
      const model = url.searchParams.get('model');
      if (!provider || !model) { sendJson(res, 400, { ok: false, error: 'provider 与 model 必填' }); return; }
      try {
        const info = await ctx.llm.resolveModelInfo(provider, model, AbortSignal.timeout(15000));
        const raw = Array.isArray(info?.reasoning?.efforts) ? info.reasoning.efforts : [];
        sendJson(res, 200, {
          ok: true,
          efforts: raw.map(e => ({ id: e.id, name: e.name || e.id, description: e.description })),
          defaultEffort: info?.reasoning?.defaultEffort ?? null,
          contextWindow: info?.contextWindow,
        });
      } catch (error) {
        // provider 不提供 exact-model 元数据时退回已知档位表，档位下拉仍可用。
        sendJson(res, 200, {
          ok: true, degraded: true,
          efforts: fallbackEfforts(provider),
          defaultEffort: null,
          error: String(error?.message || error),
        });
      }
    },
  });

  // 3.3 配置读写
  route({
    kind: 'exact', path: '/api/dual-brain/config',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      if (req.method === 'GET') {
        const cfg = loadConfig();
        sendJson(res, 200, { ...cfg, apiKeyMasked: maskKey(cfg.apiKey), hasApiKey: Boolean(cfg.apiKey) });
        return;
      }
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          delete body.apiKeyMasked; delete body.hasApiKey;
          const saved = saveConfig(body);
          sendJson(res, 200, { ok: true, config: { ...saved, apiKeyMasked: maskKey(saved.apiKey), hasApiKey: Boolean(saved.apiKey) } });
        } catch (error) { sendJson(res, 400, { ok: false, error: String(error?.message || error) }); }
        return;
      }
      sendJson(res, 405, { error: 'Method Not Allowed' });
    },
  });

  // 3.3 工作区列表（精华来源：dsh-codex-subscription 手机远控的项目解析方式）
  route({
    kind: 'exact', path: '/api/dual-brain/workspaces',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      const list = ctx.workspaceRegistry.list().map(w => ({
        id: w.id, title: w.title, path: w.path, sessionCount: (w.sessionIds || []).length,
      }));
      sendJson(res, 200, { ok: true, workspaces: list });
    },
  });

  // 3.4 指定工作区的 git / 文件感知
  route({
    kind: 'exact', path: '/api/dual-brain/workspace-status',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const workspaceId = url.searchParams.get('workspaceId');
      const cfg = loadConfig();
      let ws = null;
      if (workspaceId) ws = ctx.workspaceRegistry.list().find(w => String(w.id) === String(workspaceId)) || null;
      if (!ws) ws = ctx.workspaceRegistry.list()[0] || null;
      if (!ws) { sendJson(res, 404, { ok: false, error: '没有可用工作区' }); return; }
      const cwd = safeRealpath(ws.path);
      const [status, diffStat] = await Promise.all([
        runGit(cwd, ['status', '--short']),
        runGit(cwd, ['diff', '--stat', 'HEAD']),
      ]);
      const branch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      sendJson(res, 200, {
        ok: true,
        workspace: { id: ws.id, title: ws.title, path: cwd },
        branch: branch.ok ? branch.out : '',
        gitStatus: status.ok ? (status.out || '(干净)') : '(非 git 仓库)',
        diffStat: diffStat.ok ? diffStat.out : '',
        files: workspaceFilesOverview(cwd),
        defaultPlannerSource: cfg.plannerSource,
      });
    },
  });

  // 3.5 规划（阶段一）
  route({
    kind: 'exact', path: '/api/dual-brain/plan',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }
      try {
        const body = await readJson(req);
        const cfg = loadConfig();
        const goal = String(body.userGoal || '').trim();
        if (!goal) { sendJson(res, 400, { error: '任务目标不能为空' }); return; }

        let contextBlock = '';
        if (body.includeWorkspaceContext && body.workspaceId) {
          const ws = ctx.workspaceRegistry.list().find(w => String(w.id) === String(body.workspaceId));
          if (ws) {
            const cwd = safeRealpath(ws.path);
            const status = await runGit(cwd, ['status', '--short']);
            contextBlock = [
              `\n【目标工作区】：${ws.title} (${cwd})`,
              status.ok && status.out ? `【Git 状态】：\n${status.out.slice(0, 4000)}` : '',
              `【顶层文件】：${workspaceFilesOverview(cwd, 30).map(f => f.name).join(', ')}`,
            ].filter(Boolean).join('\n');
          }
        }

        const brain = await consultBrain(ctx, 'plan', `【任务目标】：\n${goal}${contextBlock}`, {
          source: body.source || cfg.plannerSource,
          route: body.route ? { provider: body.route.provider, model: body.route.model, effort: body.route.effort } : undefined,
        });

        const checklist = [];
        let stepId = 1;
        for (const line of brain.text.split('\n')) {
          const match = line.match(/^\s*-\s*\[\s*\]\s*(.*)$/);
          if (match && match[1]) {
            const title = (match[1].match(/\*\*(.*?)\*\*/) || [])[1] || match[1].replace(/[*`]/g, '').trim();
            if (title) checklist.push({ id: stepId++, title: title.replace(/^步骤\s*[:：]?\s*/, '').trim(), done: false });
          }
        }

        const tasks = loadTasks();
        const task = {
          id: `task-${Date.now()}`,
          title: goal.slice(0, 48) + (goal.length > 48 ? '…' : ''),
          userGoal: goal,
          workspaceId: body.workspaceId || null,
          brainProvider: brain.provider, brainModel: brain.model,
          planText: brain.text,
          planReasoning: cfg.showReasoning ? brain.reasoning : '',
          checklist,
          executionNotes: '', reviewReport: '', dispatchSessionId: '',
          status: 'planned',
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        tasks.unshift(task);
        saveTasks(tasks);
        sendJson(res, 200, { ok: true, task });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    },
  });

  // 3.6 派发执行（阶段二核心：真正创建 DSH 会话并注入执行指令）
  route({
    kind: 'exact', path: '/api/dual-brain/dispatch',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }
      try {
        const body = await readJson(req);
        const cfg = loadConfig();
        const tasks = loadTasks();
        const task = tasks.find(t => t.id === body.taskId);
        if (!task) { sendJson(res, 404, { error: '任务不存在' }); return; }

        const ws = ctx.workspaceRegistry.list().find(w => String(w.id) === String(body.workspaceId || task.workspaceId))
          || ctx.workspaceRegistry.list()[0];
        if (!ws) { sendJson(res, 400, { error: '没有可用工作区' }); return; }

        // 创建该工作区内的新 DSH 会话
        const created = await ctx.sessionController.create({ workspaceId: ws.id });
        const sessionId = created.sessionId;

        // 选定执行模型（DSH 接入的本地模型）。用户在下拉里选的推理档位必须一起传下去，
        // 否则执行脑会退回模型默认档，与面板显示不一致。
        const execRoute = body.executor || cfg.executorRoute;
        if (execRoute?.provider && execRoute?.model) {
          const base = { sessionId, provider: execRoute.provider, model: execRoute.model };
          const withEffort = execRoute.effort && execRoute.effort !== 'follow'
            ? { ...base, reasoningEffort: execRoute.effort } : base;
          try {
            await ctx.sessionController.selectModel(withEffort);
          } catch {
            // 该 provider 不接受档位字段时降级为仅选模型，并记下原因供面板提示。
            try { await ctx.sessionController.selectModel(base); } catch { /* 保持会话默认模型 */ }
          }
        }

        const checklistText = (task.checklist || []).map(s => `- [ ] ${s.title}`).join('\n');
        const executorPrompt = [
          `【双脑协同 · 执行任务】你负责将高阶思考脑生成的方案落地到工作区「${ws.title}」。`,
          '',
          `## 原始目标`, task.userGoal, '',
          `## 高阶脑完整规划`, task.planText, '',
          checklistText ? `## 执行清单（按顺序落实）\n${checklistText}` : '',
          body.extraNotes ? `\n## 用户补充说明\n${body.extraNotes}` : '',
          '',
          `要求：逐项执行并在完成每项后简要汇报进度与验证结果；遇到与规划冲突的实际情况时先说明再调整。全部完成后输出「执行完毕总结」列出实际改动文件与验证方式，供复查脑审计。`,
        ].filter(line => line !== undefined).join('\n');

        const accepted = await ctx.sessionController.prompt(
          { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: executorPrompt }] },
          AbortSignal.timeout(30000),
        );
        if (accepted?.accepted === false) throw new Error('DSH 拒绝了执行指令注入');

        task.dispatchSessionId = sessionId;
        task.status = 'executing';
        task.updatedAt = Date.now();
        saveTasks(tasks);
        sendJson(res, 200, { ok: true, sessionId, workspace: { id: ws.id, title: ws.title } });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    },
  });

  // 3.7 执行会话进展查询（供面板轮询显示，不自动推进，保持半自动）
  route({
    kind: 'exact', path: '/api/dual-brain/session-progress',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const sessionId = url.searchParams.get('sessionId');
      const session = ctx.sessionController ? (await ctx.sessionController.state({ sessionId }, AbortSignal.timeout(8000)).catch(() => null)) : null;
      sendJson(res, 200, { ok: true, state: session });
    },
  });

  // 3.8 复查验收（阶段三）
  route({
    kind: 'exact', path: '/api/dual-brain/review',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }
      try {
        const body = await readJson(req);
        const cfg = loadConfig();
        const tasks = loadTasks();
        const task = tasks.find(t => t.id === body.taskId) || null;
        const userGoal = body.userGoal || task?.userGoal || '';
        const planText = body.planText || task?.planText || '';

        let diffContent = '';
        if (body.includeGitDiff) {
          const ws = ctx.workspaceRegistry.list().find(w => String(w.id) === String(body.workspaceId || task?.workspaceId));
          const cwd = ws ? safeRealpath(ws.path) : safeRealpath(ctx.workspaceRegistry.list()[0]?.path || process.cwd());
          const diff = await runGit(cwd, ['diff', 'HEAD'], 10000);
          const status = await runGit(cwd, ['status', '--short']);
          const parts = [];
          if (diff.ok && diff.out) parts.push(diff.out.slice(0, 20000));
          if (status.ok && status.out) parts.push(`[git status]\n${status.out.slice(0, 3000)}`);
          diffContent = parts.join('\n');
        }

        let prompt = `【最初用户目标】：\n${userGoal}\n\n【执行规划方案】：\n${planText}\n`;
        if (body.executionNotes) prompt += `\n【执行日志与成果说明】：\n${body.executionNotes}\n`;
        if (diffContent) prompt += `\n【工作区改动 (git diff HEAD)】：\n${diffContent}\n`;

        const brain = await consultBrain(ctx, 'review', prompt, {
          source: body.source || cfg.reviewerSource,
          route: body.route ? { provider: body.route.provider, model: body.route.model, effort: body.route.effort } : undefined,
        });

        let status = 'completed';
        if (/FAIL|未达标/.test(brain.text)) status = 'failed';
        else if (/CHANGES REQUESTED|需补充/.test(brain.text)) status = 'needs-fix';

        if (task) {
          task.executionNotes = body.executionNotes || task.executionNotes;
          task.reviewReport = brain.text;
          task.reviewReasoning = cfg.showReasoning ? brain.reasoning : '';
          task.status = status;
          task.updatedAt = Date.now();
          saveTasks(tasks);
        }
        sendJson(res, 200, { ok: true, reviewReport: brain.text, reasoning: brain.reasoning, status, model: `${brain.provider}/${brain.model}` });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    },
  });

  // 3.9 任务 CRUD
  route({
    kind: 'exact', path: '/api/dual-brain/tasks',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      if (req.method === 'GET') { sendJson(res, 200, { ok: true, tasks: loadTasks() }); return; }
      if (req.method === 'POST') {
        try {
          const body = await readJson(req);
          const tasks = loadTasks();
          const index = tasks.findIndex(t => t.id === body.id);
          if (index >= 0) tasks[index] = { ...tasks[index], ...body, updatedAt: Date.now() };
          else tasks.unshift({ ...body, createdAt: Date.now(), updatedAt: Date.now() });
          saveTasks(tasks);
          sendJson(res, 200, { ok: true });
        } catch (error) { sendJson(res, 400, { error: String(error?.message || error) }); }
        return;
      }
      if (req.method === 'DELETE') {
        try {
          const body = await readJson(req);
          saveTasks(loadTasks().filter(t => t.id !== body.id));
          sendJson(res, 200, { ok: true });
        } catch (error) { sendJson(res, 400, { error: String(error?.message || error) }); }
        return;
      }
      sendJson(res, 405, { error: 'Method Not Allowed' });
    },
  });

  // 3.10 OpenAI API 通道测试（备选通道仍保留）
  route({
    kind: 'exact', path: '/api/dual-brain/test-connection',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }
      try {
        const body = await readJson(req);
        const cfg = loadConfig();
        let apiKey = body.apiKey;
        if (!apiKey || apiKey.includes('****')) apiKey = cfg.apiKey;
        if (!apiKey) { sendJson(res, 400, { ok: false, error: 'API Key 不能为空' }); return; }
        const result = await callOpenAiApi({ ...cfg, apiKey }, body.model || cfg.apiPlannerModel, [
          { role: 'user', content: 'Reply with exactly: OK' },
        ]);
        sendJson(res, 200, { ok: true, message: `连接成功，响应: ${(result.text || 'OK').slice(0, 80)}` });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) });
      }
    },
  });

  // 3.11 Codex 订阅健康探测：提示 openai-codex provider 是否已登录可用
  route({
    kind: 'exact', path: '/api/dual-brain/codex-status',
    handler: async (req, res) => {
      if (corsPreflight(req, res)) return;
      const provider = ctx.llm.listProviders().find(p => p.id === 'openai-codex');
      let models = [];
      let error = '';
      try { models = provider ? await ctx.llm.listModels('openai-codex') : []; }
      catch (e) { error = String(e?.message || e); }
      sendJson(res, 200, {
        ok: true,
        installed: Boolean(provider),
        ready: models.length > 0,
        modelCount: models.length,
        error: error || undefined,
        hint: models.length > 0 ? undefined : 'Codex 订阅未登录或目录不可用：可在「连接配置」切换到 API 通道，或先到 设置 → Codex 订阅 登录 ChatGPT 账号。',
      });
    },
  });
}
