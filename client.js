/**
 * Browser half of dsh-dual-brain (v2).
 *
 * Classic script consumed by the DSH client module loader. React comes from the
 * browser module table; no build step, no extra dependency, no second app root.
 *
 * 精华取自 dsh-codex-subscription / dsh-prompt-polish：
 *  - 模型选择器读宿主真实目录 ctx.llm（含 Codex 订阅通道），不再写死 o1/o3-mini
 *  - 工作区选择器读 ctx.workspaceRegistry，git 感知围绕所选工作区
 *  - 派发执行走 sessionController：在目标工作区新建会话 + 选模型 + 注入指令
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-dual-brain',
  factory: function (require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useMemo, useRef } = React;

    const PANEL_ID = 'dsh-dual-brain';
    const NS = 'dualBrain';
    const API = '/api/dual-brain';

    const DICT = {
      zh: {
        'panel': '双脑协同',
        'title': '双脑协同工作台',
        'subtitle': '思考脑规划复查 · DSH 模型执行',
        'tab.workbench': '任务工作台',
        'tab.history': '任务历史',
        'tab.settings': '连接配置',
        'ws.label': '目标工作区',
        'ws.hint': '规划上下文、git 感知与执行派发都围绕该工作区',
        'ws.none': '未发现工作区',
        'stage.plan': '阶段一 · 深度思考与任务规划',
        'stage.exec': '阶段二 · DSH 模型落地执行',
        'stage.review': '阶段三 · 独立复查与验收',
        'goal.placeholder': '输入高层目标或工程需求，例如：“给这个仓库补上错误处理与单元测试，并保持现有 API 不变”',
        'plan.includeWs': '载入工作区文件与 git 状态作为思考依据',
        'plan.brain': '思考脑',
        'plan.run': '启动深度思考与规划',
        'plan.running': '思考中…',
        'plan.reasoning': '思考过程',
        'plan.copy': '复制规划全文',
        'exec.dispatch': '派发到 DSH 执行',
        'exec.dispatching': '派发中…',
        'exec.dispatched': '已派发到会话',
        'exec.open': '打开执行会话',
        'exec.notes': '执行日志 / 成果说明（送交复查脑审计）',
        'exec.followDefault': '执行脑: 未指定，派发时使用会话默认模型',
        'exec.notesPlaceholder': '粘贴 DSH 执行结果、测试输出，或直接留空由复查脑读取 git diff',
        'review.diff': '附带工作区 git diff 送审',
        'review.run': '启动复查验收',
        'review.running': '审计中…',
        'review.report': '验收审查报告',
        'settings.channel': '通道',
        'settings.channel.dsh': 'DSH 已接入模型（含 Codex 订阅）',
        'settings.channel.api': 'OpenAI / 兼容 API',
        'settings.model': '模型',
        'settings.effort': '推理档位',
        'settings.loadModels': '刷新模型目录',
        'settings.loading': '加载中…',
        'settings.planner': '思考脑（规划）',
        'settings.reviewer': '复查脑（验收）',
        'settings.executor': '执行脑（DSH 本地模型）',
        'settings.apiBase': 'API Base URL',
        'settings.apiKey': 'API Key',
        'settings.test': '测试 API 连接',
        'settings.save': '保存配置',
        'settings.saved': '已保存',
        'settings.codexReady': 'Codex 订阅可用：{n} 个模型',
        'settings.codexDown': 'Codex 订阅不可用：{msg}',
        'settings.codexHint': '未登录时可在 设置 → Codex 订阅 登录 ChatGPT 账号，或改用 API 通道',
        'settings.pickProvider': '选择 Provider',
        'settings.pickModel': '选择模型',
        'settings.effortFollow': '跟随模型默认',
        'settings.effortGeneric': '该 provider 未公布档位目录，已提供通用 low/medium/high',
        'history.empty': '暂无历史任务',
        'history.restore': '载入工作台',
        'history.delete': '删除',
        'status.planned': '已规划',
        'status.executing': '执行中',
        'status.completed': '验收通过',
        'status.needs-fix': '需补充修复',
        'status.failed': '验收未达标',
        'toast.needGoal': '请先输入任务目标',
        'toast.needModel': '请先在连接配置中选择模型',
        'checklist.progress': '清单进度 {done}/{total}',
      },
      en: {
        'panel': 'Dual-Brain',
        'title': 'Dual-Brain Orchestrator',
        'subtitle': 'Reasoning brain plans & reviews · DSH models execute',
        'tab.workbench': 'Workbench',
        'tab.history': 'History',
        'tab.settings': 'Connection',
        'ws.label': 'Target workspace',
        'ws.hint': 'Planning context, git awareness and dispatch all follow this workspace',
        'ws.none': 'No workspace found',
        'stage.plan': 'Stage 1 · Deep thinking & planning',
        'stage.exec': 'Stage 2 · Execute with DSH model',
        'stage.review': 'Stage 3 · Independent review',
        'goal.placeholder': 'Describe the high-level goal, e.g. “add error handling and unit tests, keep the public API stable”',
        'plan.includeWs': 'Feed workspace files and git status into the planner',
        'plan.brain': 'Planner',
        'plan.run': 'Plan the task',
        'plan.running': 'Thinking…',
        'plan.reasoning': 'Reasoning trace',
        'plan.copy': 'Copy plan',
        'exec.dispatch': 'Dispatch to DSH',
        'exec.dispatching': 'Dispatching…',
        'exec.dispatched': 'Dispatched to session',
        'exec.open': 'Open execution session',
        'exec.notes': 'Execution log for the reviewer',
        'exec.followDefault': 'Executor: not set — the dispatch uses the session default model',
        'exec.notesPlaceholder': 'Paste DSH output or test results; leave empty and the reviewer reads git diff',
        'review.diff': 'Include workspace git diff',
        'review.run': 'Run review',
        'review.running': 'Auditing…',
        'review.report': 'Review report',
        'settings.channel': 'Channel',
        'settings.channel.dsh': 'DSH-registered models (incl. Codex subscription)',
        'settings.channel.api': 'OpenAI / compatible API',
        'settings.model': 'Model',
        'settings.effort': 'Reasoning effort',
        'settings.loadModels': 'Refresh model catalog',
        'settings.loading': 'Loading…',
        'settings.planner': 'Planner brain',
        'settings.reviewer': 'Reviewer brain',
        'settings.executor': 'Executor (DSH local model)',
        'settings.apiBase': 'API Base URL',
        'settings.apiKey': 'API Key',
        'settings.test': 'Test API',
        'settings.save': 'Save',
        'settings.saved': 'Saved',
        'settings.codexReady': 'Codex subscription ready: {n} models',
        'settings.codexDown': 'Codex subscription unavailable: {msg}',
        'settings.codexHint': 'Sign in at Settings → Codex subscription, or switch to the API channel',
        'settings.pickProvider': 'Provider',
        'settings.pickModel': 'Model',
        'settings.effortFollow': 'Model default',
        'settings.effortGeneric': 'This provider publishes no effort catalog; generic low/medium/high offered',
        'history.empty': 'No tasks yet',
        'history.restore': 'Load into workbench',
        'history.delete': 'Delete',
        'status.planned': 'planned',
        'status.executing': 'executing',
        'status.completed': 'passed',
        'status.needs-fix': 'needs fix',
        'status.failed': 'failed',
        'toast.needGoal': 'Enter a task goal first',
        'toast.needModel': 'Pick a model in Connection settings first',
        'checklist.progress': 'Checklist {done}/{total}',
      },
    };

    // ---------------------------------------------------------------- icons

    function BrainGlyph({ size = 18, active = false }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'inherit' },
      },
        h('path', { d: 'M9.5 3.5A2.5 2.5 0 0 0 7 6a2.6 2.6 0 0 0-1.9 4.3A2.6 2.6 0 0 0 6 15.4 2.5 2.5 0 0 0 9.5 18a2.4 2.4 0 0 0 3-1.6V6a2.5 2.5 0 0 0-3-2.5z' }),
        h('path', { d: 'M14.5 3.5A2.5 2.5 0 0 1 17 6a2.6 2.6 0 0 1 1.9 4.3A2.6 2.6 0 0 1 18 15.4 2.5 2.5 0 0 1 14.5 18a2.4 2.4 0 0 1-3-1.6' }),
        h('path', { d: 'M12 18v2.5' }),
      );
    }

    // ---------------------------------------------------------------- styles

    const css = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' },
      header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', flexWrap: 'wrap' },
      brand: { display: 'flex', alignItems: 'center', gap: 10 },
      brandMark: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'var(--dsw-alias-brand-primary)', color: '#fff' },
      brandText: { fontSize: 15, fontWeight: 600 },
      brandSub: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 1 },
      tabs: { display: 'flex', gap: 6 },
      body: { flex: 1, overflowY: 'auto', padding: 20 },
      card: { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: 16, marginBottom: 16 },
      cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' },
      cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 },
      stageNo: { fontSize: 12, fontWeight: 700, color: 'var(--dsw-alias-brand-primary)' },
      row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      col: { display: 'flex', flexDirection: 'column', gap: 4 },
      label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      select: { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: 12.5, minWidth: 180 },
      input: { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: 12.5, width: '100%', boxSizing: 'border-box' },
      textarea: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', minHeight: 72 },
      btn: (kind, disabled) => ({
        padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1, border: kind === 'ghost' ? '1px solid var(--dsw-alias-border-l2)' : '1px solid transparent',
        background: kind === 'ghost' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: kind === 'ghost' ? 'var(--dsw-alias-label-primary)' : '#fff',
      }),
      pill: (tone) => ({
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11,
        border: `1px solid ${tone}55`, color: tone, background: `${tone}18`,
      }),
      pre: { margin: 0, padding: 12, borderRadius: 8, background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflowY: 'auto' },
      step: (done) => ({ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)', fontSize: 12.5, opacity: done ? 0.6 : 1 }),
      toast: { position: 'fixed', top: 16, right: 20, zIndex: 9999, padding: '8px 14px', borderRadius: 8, background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', fontSize: 12.5, boxShadow: '0 6px 24px rgba(0,0,0,.18)' },
      hint: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 },
    };

    const TONE = {
      planned: 'var(--dsw-alias-brand-primary)',
      executing: 'var(--dsw-alias-state-warn-primary)',
      completed: 'var(--dsw-alias-state-success-primary)',
      'needs-fix': 'var(--dsw-alias-state-warn-primary)',
      failed: 'var(--dsw-alias-state-error-primary)',
    };

    // ---------------------------------------------------------------- helpers

    async function getJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    }
    async function postJson(url, body) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `${res.status}`);
      return data;
    }

    // ---------------------------------------------------------------- settings block

    // 每个 provider/model 的推理档位是精确模型元数据，按需拉取并缓存，
    // 避免刷新目录时对 200+ 模型逐个 resolveModelInfo。
    const effortCache = new Map();

    function RoutePicker({ title, hint, catalog, codex, value, onChange, t }) {
      const safe = value || {};
      const providerIds = catalog.map(g => g.id);
      const provider = safe.provider || providerIds[0] || '';
      const group = catalog.find(g => g.id === provider);
      const models = group ? group.models : [];
      const model = safe.model || (models[0] ? models[0].id : '');

      const [effortState, setEffortState] = useState(null);
      const [loadingEffort, setLoadingEffort] = useState(false);

      // 档位来自 llm.resolveModelInfo()：listModels() 不带 exact-model 元数据。
      useEffect(() => {
        let alive = true;
        if (!provider || !model) { setEffortState(null); return undefined; }
        const key = `${provider}/${model}`;
        if (effortCache.has(key)) { setEffortState(effortCache.get(key)); return undefined; }
        setLoadingEffort(true);
        getJson(`${API}/model-info?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`)
          .then(data => {
            const info = { efforts: data.efforts || [], defaultEffort: data.defaultEffort ?? null, degraded: Boolean(data.degraded) };
            effortCache.set(key, info);
            if (alive) setEffortState(info);
          })
          .catch(() => {
            const info = { efforts: [], defaultEffort: null, degraded: true };
            effortCache.set(key, info);
            if (alive) setEffortState(info);
          })
          .finally(() => { if (alive) setLoadingEffort(false); });
        return () => { alive = false; };
      }, [provider, model]);

      const efforts = effortState ? effortState.efforts : [];
      const effortOptions = efforts.length > 0
        ? efforts
        : (provider ? [{ id: 'low', name: 'low', description: '' }, { id: 'medium', name: 'medium', description: '' }, { id: 'high', name: 'high', description: '' }] : []);
      const chosen = safe.effort || '';
      // 已保存档位不在目录里时仍显示它，避免下拉把用户的选择吞掉。
      const listed = effortOptions.some(e => e.id === chosen);
      const currentModel = models.find(m => m.id === model);

      return h('div', { style: css.card },
        h('div', { style: css.cardHead },
          h('div', { style: css.cardTitle }, title),
          hint ? h('span', { style: css.hint }, hint) : null,
        ),
        codex && provider === 'openai-codex' && !codex.ready
          ? h('div', { style: { ...css.pill('var(--dsw-alias-state-error-primary)'), marginBottom: 10 } }, t('settings.codexDown', { msg: codex.error || codex.hint || '' }))
          : null,
        h('div', { style: { ...css.row, marginTop: 10 } },
          h('div', { style: css.col },
            h('span', { style: css.label }, t('settings.pickProvider')),
            h('select', {
              style: css.select, value: provider,
              onChange: (e) => onChange({ provider: e.target.value, model: '', effort: '' }),
            }, providerIds.length === 0 ? h('option', { value: '' }, t('settings.loading')) : providerIds.map(id => h('option', { key: id, value: id }, (catalog.find(g => g.id === id) || {}).name || id))),
          ),
          h('div', { style: css.col },
            h('span', { style: css.label }, t('settings.model')),
            h('select', {
              style: { ...css.select, minWidth: 240 }, value: model,
              onChange: (e) => onChange({ provider, model: e.target.value, effort: '' }),
            }, models.map(m => h('option', { key: m.id, value: m.id }, m.name || m.id))),
          ),
          h('div', { style: css.col },
            h('span', { style: css.label }, t('settings.effort')),
            h('select', {
              style: css.select, value: chosen,
              disabled: !model,
              onChange: (e) => onChange({ provider, model, effort: e.target.value }),
            },
              h('option', { value: '' }, t('settings.effortFollow') + (effortState && effortState.defaultEffort ? ` (${effortState.defaultEffort})` : '')),
              listed || !chosen ? null : h('option', { key: chosen, value: chosen }, `${chosen} *`),
              effortOptions.map(lv => h('option', { key: lv.id, value: lv.id }, lv.description ? `${lv.name} — ${lv.description}` : lv.name)),
              loadingEffort && effortOptions.length === 0 ? h('option', { value: '', disabled: true }, t('settings.loading')) : null,
            ),
            effortState && effortState.degraded && efforts.length === 0
              ? h('span', { style: css.hint }, t('settings.effortGeneric'))
              : null,
            currentModel && currentModel.contextWindow
              ? h('span', { style: css.hint }, `ctx ${currentModel.contextWindow.toLocaleString()}`)
              : null,
          ),
        ),
      );
    }

    // ---------------------------------------------------------------- main panel

    // 错误边界：任何一个 Tab 渲染抛错时，只在面板内显示错误文本，
    // 绝不让整个 slot 变成空白（宿主 console 同时会报 slot entry crashed）。
    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch(error, info) { console.error('[dsh-dual-brain] render error', error, info); }
      render() {
        if (!this.state.error) return this.props.children;
        return h('div', { style: { padding: 20 } },
          h('div', { style: css.pill('var(--dsw-alias-state-error-primary)') }, '面板渲染出错'),
          h('pre', { style: { ...css.pre, marginTop: 12 } }, String(this.state.error?.stack || this.state.error)),
          h('button', { style: css.btn('ghost'), onClick: () => this.setState({ error: null }) }, '重试'));
      }
    }

    function MainPanel({ ctx, t }) {
      const [tab, setTab] = useState('workbench');
      const [config, setConfig] = useState(null);
      const [draft, setDraft] = useState(null);
      const [catalog, setCatalog] = useState([]);
      const [codex, setCodex] = useState(null);
      const [loadingCatalog, setLoadingCatalog] = useState(false);
      const [workspaces, setWorkspaces] = useState([]);
      const [workspaceId, setWorkspaceId] = useState('');
      const [wsStatus, setWsStatus] = useState(null);
      const [tasks, setTasks] = useState([]);
      const [task, setTask] = useState(null);
      const [goal, setGoal] = useState('');
      const [includeWs, setIncludeWs] = useState(true);
      const [notes, setNotes] = useState('');
      const [includeDiff, setIncludeDiff] = useState(true);
      const [busy, setBusy] = useState('');
      const [toastMsg, setToastMsg] = useState('');
      const [testMsg, setTestMsg] = useState('');
      const [savedMsg, setSavedMsg] = useState('');
      const toastTimer = useRef(null);

      const toast = useCallback((msg) => {
        setToastMsg(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastMsg(''), 3600);
      }, []);

      const loadCatalog = useCallback(async () => {
        setLoadingCatalog(true);
        try {
          const data = await getJson(`${API}/model-catalog`);
          setCatalog(data.catalog || []);
        } catch (e) { toast(`模型目录读取失败: ${e.message}`); }
        finally { setLoadingCatalog(false); }
      }, [toast]);

      useEffect(() => {
        (async () => {
          try {
            const [cfg, ws, tk, cx] = await Promise.all([
              getJson(`${API}/config`),
              getJson(`${API}/workspaces`),
              getJson(`${API}/tasks`),
              getJson(`${API}/codex-status`).catch(() => null),
            ]);
            setConfig(cfg); setDraft(JSON.parse(JSON.stringify(cfg)));
            setWorkspaces(ws.workspaces || []);
            setWorkspaceId((ws.workspaces && ws.workspaces[0] ? ws.workspaces[0].id : ''));
            setTasks(tk.tasks || []);
            if (tk.tasks && tk.tasks[0]) { setTask(tk.tasks[0]); setNotes(tk.tasks[0].executionNotes || ''); }
            setCodex(cx);
            loadCatalog();
          } catch (e) { toast(`初始化失败: ${e.message}`); }
        })();
        return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
      }, [loadCatalog, toast]);

      useEffect(() => {
        if (!workspaceId) { setWsStatus(null); return; }
        getJson(`${API}/workspace-status?workspaceId=${encodeURIComponent(workspaceId)}`)
          .then(setWsStatus).catch(() => setWsStatus(null));
      }, [workspaceId]);

      const brainLabel = (routeField, sourceField) => {
        if (!config) return '';
        if (config[sourceField] === 'openai-api') return `API · ${sourceField === 'plannerSource' ? config.apiPlannerModel : config.apiReviewerModel}`;
        const r = config[routeField] || {};
        if (!r.model) return t('toast.needModel');
        return `${r.provider}/${r.model}${r.effort && r.effort !== 'follow' ? ` · ${r.effort}` : ''}`;
      };

      // 执行脑没有 API 备选通道，且未选模型时明确显示“跟随会话默认”。
      const executorLabel = () => {
        const r = (config && config.executorRoute) || {};
        if (!r.model) return t('exec.followDefault');
        return `${t('settings.executor')}: ${r.provider}/${r.model}${r.effort && r.effort !== 'follow' ? ` · ${r.effort}` : ''}`;
      };

      // ---- actions
      async function runPlan() {
        if (!goal.trim()) { toast(t('toast.needGoal')); return; }
        const src = config ? config.plannerSource : 'dsh-llm';
        if (src === 'dsh-llm' && config && !config.plannerRoute.model) { toast(t('toast.needModel')); setTab('settings'); return; }
        setBusy('plan');
        try {
          const data = await postJson(`${API}/plan`, { userGoal: goal, workspaceId, includeWorkspaceContext: includeWs });
          setTask(data.task);
          setNotes('');
          setTasks(prev => [data.task, ...prev.filter(x => x.id !== data.task.id)]);
          toast('规划完成');
        } catch (e) { toast(`规划失败: ${e.message}`); }
        finally { setBusy(''); }
      }

      async function runDispatch() {
        if (!task) return;
        setBusy('dispatch');
        try {
          const data = await postJson(`${API}/dispatch`, { taskId: task.id, workspaceId, extraNotes: notes || undefined });
          const fresh = { ...task, dispatchSessionId: data.sessionId, status: 'executing' };
          setTask(fresh);
          setTasks(prev => prev.map(x => (x.id === fresh.id ? fresh : x)));
          toast(`${t('exec.dispatched')} · ${data.sessionId.slice(0, 8)}`);
        } catch (e) { toast(`派发失败: ${e.message}`); }
        finally { setBusy(''); }
      }

      async function runReview() {
        if (!task) return;
        const src = config ? config.reviewerSource : 'dsh-llm';
        if (src === 'dsh-llm' && config && !config.reviewerRoute.model) { toast(t('toast.needModel')); setTab('settings'); return; }
        setBusy('review');
        try {
          const data = await postJson(`${API}/review`, { taskId: task.id, workspaceId, executionNotes: notes, includeGitDiff: includeDiff });
          const fresh = { ...task, reviewReport: data.reviewReport, reasoning: data.reasoning, status: data.status, executionNotes: notes };
          setTask(fresh);
          setTasks(prev => prev.map(x => (x.id === fresh.id ? fresh : x)));
          toast('复查完成');
        } catch (e) { toast(`复查失败: ${e.message}`); }
        finally { setBusy(''); }
      }

      async function toggleStep(id) {
        if (!task) return;
        const checklist = (task.checklist || []).map(s => (s.id === id ? { ...s, done: !s.done } : s));
        const fresh = { ...task, checklist };
        setTask(fresh);
        setTasks(prev => prev.map(x => (x.id === fresh.id ? fresh : x)));
        try { await postJson(`${API}/tasks`, fresh); } catch { /* ignore */ }
      }

      async function saveDraft() {
        setSavedMsg('');
        try {
          const data = await postJson(`${API}/config`, draft);
          setConfig(data.config);
          setDraft(JSON.parse(JSON.stringify(data.config)));
          setSavedMsg(t('settings.saved'));
          const cx = await getJson(`${API}/codex-status`).catch(() => null);
          setCodex(cx);
        } catch (e) { toast(`保存失败: ${e.message}`); }
      }

      async function testApi() {
        setTestMsg('');
        try {
          const data = await postJson(`${API}/test-connection`, { apiKey: draft.apiKey, model: draft.apiPlannerModel, baseUrl: draft.baseUrl });
          setTestMsg(`✅ ${data.message}`);
        } catch (e) { setTestMsg(`❌ ${e.message}`); }
      }

      const doneCount = task && task.checklist ? task.checklist.filter(s => s.done).length : 0;

      // ---- renderers
      function StageBar({ no, title, right }) {
        return h('div', { style: css.cardHead },
          h('div', { style: css.cardTitle }, h('span', { style: css.stageNo }, no), title),
          right || null);
      }

      function Workbench() {
        return h('div', null,
          // workspace selector strip
          h('div', { style: { ...css.card, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' } },
            h('div', { style: css.col },
              h('span', { style: css.label }, t('ws.label')),
              h('select', { style: css.select, value: workspaceId, onChange: (e) => setWorkspaceId(e.target.value) },
                workspaces.length === 0 ? h('option', { value: '' }, t('ws.none')) :
                workspaces.map(w => h('option', { key: w.id, value: w.id }, `${w.title} (${w.sessionCount})`))),
            ),
            wsStatus ? h('div', { style: css.col },
              h('span', { style: css.label }, 'Git'),
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                wsStatus.branch ? h('span', { style: css.pill('var(--dsw-alias-brand-primary)') }, `⎇ ${wsStatus.branch}`) : null,
                h('span', { style: css.pill(wsStatus.gitStatus && wsStatus.gitStatus !== '(干净)' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)') },
                  (wsStatus.gitStatus || '').split('\n').filter(Boolean).slice(0, 4).join(' · ') || 'clean'),
              ),
            ) : null,
            h('div', { style: { flex: 1 } }),
            h('div', { style: css.col },
              h('span', { style: css.label }, t('plan.brain')),
              h('span', { style: { fontSize: 12.5, fontFamily: 'Consolas, monospace' } }, brainLabel('plannerRoute', 'plannerSource')),
            ),
          ),

          // stage 1
          h('div', { style: css.card },
            StageBar('【1】', t('stage.plan'), h('span', { style: css.pill('var(--dsw-alias-brand-primary)') }, brainLabel('plannerRoute', 'plannerSource'))),
            h('textarea', { style: css.textarea, placeholder: t('goal.placeholder'), value: goal, onChange: (e) => setGoal(e.target.value) }),
            h('div', { style: { ...css.row, marginTop: 10, justifyContent: 'space-between' } },
              h('label', { style: { ...css.hint, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: includeWs, onChange: (e) => setIncludeWs(e.target.checked) }), t('plan.includeWs')),
              h('div', { style: css.row },
                task && task.planText ? h('button', { style: css.btn('ghost'), onClick: () => { navigator.clipboard.writeText(task.planText); toast('已复制'); } }, t('plan.copy')) : null,
                h('button', { style: css.btn('primary', busy === 'plan'), disabled: busy === 'plan', onClick: runPlan }, busy === 'plan' ? t('plan.running') : t('plan.run')),
              ),
            ),
            task && task.planReasoning ? h('details', { style: { marginTop: 12 } },
              h('summary', { style: { ...css.label, cursor: 'pointer' } }, t('plan.reasoning')),
              h('pre', { style: { ...css.pre, marginTop: 8 } }, task.planReasoning)) : null,
            task && task.planText ? h('pre', { style: { ...css.pre, marginTop: 12 } }, task.planText) : null,
          ),

          // stage 2
          task && task.planText ? h('div', { style: css.card },
            StageBar('【2】', t('stage.exec'), h('div', { style: css.row },
              task.checklist && task.checklist.length
                ? h('span', { style: css.pill('var(--dsw-alias-label-secondary)') }, t('checklist.progress', { done: doneCount, total: task.checklist.length })) : null,
              h('span', { style: css.pill(TONE[task.status] || 'var(--dsw-alias-label-secondary)') }, t(`status.${task.status}`) || task.status),
            )),
            task.checklist && task.checklist.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              task.checklist.map(s => h('label', { key: s.id, style: css.step(s.done) },
                h('input', { type: 'checkbox', checked: s.done, onChange: () => toggleStep(s.id), style: { marginTop: 2 } }),
                h('span', null, s.title))),
            ) : null,
            h('textarea', { style: { ...css.textarea, marginTop: 12, minHeight: 84 }, placeholder: t('exec.notesPlaceholder'), value: notes, onChange: (e) => setNotes(e.target.value) }),
            h('div', { style: { ...css.label, marginTop: 6 } }, t('exec.notes')),
            h('div', { style: { ...css.row, marginTop: 12 } },
              h('button', { style: css.btn('primary', busy === 'dispatch'), disabled: busy === 'dispatch', onClick: runDispatch }, busy === 'dispatch' ? t('exec.dispatching') : t('exec.dispatch')),
              h('span', { style: css.hint }, executorLabel()),
              task.dispatchSessionId ? h('button', {
                style: css.btn('ghost'),
                onClick: () => {
                  const workspace = ctx.get && ctx.get('remote.workspace');
                  toast(`执行会话 ${task.dispatchSessionId.slice(0, 8)} — 在左侧会话列表打开跟踪进度`);
                  try { window.dispatchEvent(new CustomEvent('dsh-dual-brain:open-session', { detail: task.dispatchSessionId })); } catch { /* ignore */ }
                },
              }, `${t('exec.open')} (${task.dispatchSessionId.slice(0, 8)})`) : null,
            ),
            h('div', { style: { ...css.hint, marginTop: 8 } }, t('ws.hint')),
          ) : null,

          // stage 3
          task && task.planText ? h('div', { style: css.card },
            StageBar('【3】', t('stage.review'), h('span', { style: css.pill('var(--dsw-alias-state-success-primary)') }, brainLabel('reviewerRoute', 'reviewerSource'))),
            h('div', { style: { ...css.row, justifyContent: 'space-between' } },
              h('label', { style: { ...css.hint, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: includeDiff, onChange: (e) => setIncludeDiff(e.target.checked) }), t('review.diff')),
              h('button', { style: css.btn('primary', busy === 'review'), disabled: busy === 'review', onClick: runReview }, busy === 'review' ? t('review.running') : t('review.run')),
            ),
            task.reviewReport ? h('pre', { style: { ...css.pre, marginTop: 12 } }, task.reviewReport) : null,
          ) : null,
        );
      }

      function Settings() {
        if (!draft) return h('div', { style: css.hint }, t('settings.loading'));
        return h('div', null,
          h('div', { style: css.card },
            h('div', { style: css.cardTitle }, 'Codex / ChatGPT 通道状态'),
            h('div', { style: { ...css.row, marginTop: 10 } },
              codex && codex.ready
                ? h('span', { style: css.pill('var(--dsw-alias-state-success-primary)') }, t('settings.codexReady', { n: codex.modelCount }))
                : codex ? h('span', { style: css.pill('var(--dsw-alias-state-error-primary)') }, t('settings.codexDown', { msg: codex.error || '' })) : null,
              h('button', { style: css.btn('ghost'), onClick: loadCatalog, disabled: loadingCatalog }, loadingCatalog ? t('settings.loading') : t('settings.loadModels')),
            ),
            h('div', { style: { ...css.hint, marginTop: 8 } }, t('settings.codexHint')),
          ),

          h(RoutePicker, {
            title: t('settings.planner'), catalog, codex, t,
            value: draft.plannerRoute,
            onChange: (v) => setDraft({ ...draft, plannerSource: 'dsh-llm', plannerRoute: v }),
          }),
          h(RoutePicker, {
            title: t('settings.reviewer'), catalog, codex, t,
            value: draft.reviewerRoute,
            onChange: (v) => setDraft({ ...draft, reviewerSource: 'dsh-llm', reviewerRoute: v }),
          }),
          h(RoutePicker, {
            title: t('settings.executor'), hint: 'DSH 会话中实际动手改代码的模型', catalog, codex, t,
            value: draft.executorRoute,
            onChange: (v) => setDraft({ ...draft, executorRoute: v }),
          }),

          h('div', { style: css.card },
            h('div', { style: css.cardTitle }, t('settings.channel.api')),
            h('div', { style: { ...css.row, marginTop: 10 } },
              h('div', { style: { ...css.col, flex: 2 } },
                h('span', { style: css.label }, t('settings.apiBase')),
                h('input', { style: css.input, value: draft.baseUrl, onChange: (e) => setDraft({ ...draft, baseUrl: e.target.value }) }),
              ),
              h('div', { style: { ...css.col, flex: 2 } },
                h('span', { style: css.label }, t('settings.apiKey')),
                h('input', { style: css.input, type: 'password', placeholder: draft.hasApiKey ? draft.apiKeyMasked : 'sk-...', value: draft.apiKey || '', onChange: (e) => setDraft({ ...draft, apiKey: e.target.value }) }),
              ),
            ),
            h('div', { style: { ...css.row, marginTop: 10 } },
              h('div', { style: { ...css.col, flex: 1 } },
                h('span', { style: css.label }, `${t('settings.planner')} · model`),
                h('input', { style: css.input, value: draft.apiPlannerModel, onChange: (e) => setDraft({ ...draft, apiPlannerModel: e.target.value }) }),
              ),
              h('div', { style: { ...css.col, flex: 1 } },
                h('span', { style: css.label }, `${t('settings.reviewer')} · model`),
                h('input', { style: css.input, value: draft.apiReviewerModel, onChange: (e) => setDraft({ ...draft, apiReviewerModel: e.target.value }) }),
              ),
            ),
            h('div', { style: css.row },
              h('label', { style: { ...css.hint, display: 'flex', gap: 6, alignItems: 'center' } },
                h('input', { type: 'checkbox', checked: draft.plannerSource === 'openai-api', onChange: (e) => setDraft({ ...draft, plannerSource: e.target.checked ? 'openai-api' : 'dsh-llm', reviewerSource: e.target.checked ? 'openai-api' : 'dsh-llm' }) }),
                '规划与复查都改用 API 通道'),
            ),
            h('div', { style: { ...css.row, marginTop: 12 } },
              h('button', { style: css.btn('primary'), onClick: saveDraft }, t('settings.save')),
              h('button', { style: css.btn('ghost'), onClick: testApi }, t('settings.test')),
              savedMsg && !testMsg ? h('span', { style: { ...css.hint, color: 'var(--dsw-alias-state-success-primary)' } }, savedMsg) : null,
              testMsg ? h('span', { style: css.hint }, testMsg) : null,
            ),
          ),
        );
      }

      function History() {
        if (!tasks.length) return h('div', { style: { ...css.hint, textAlign: 'center', padding: 40 } }, t('history.empty'));
        return h('div', null, tasks.map(item => h('div', { key: item.id, style: css.card },
          h('div', { style: css.cardHead },
            h('div', { style: css.cardTitle }, item.title),
            h('span', { style: css.pill(TONE[item.status] || 'var(--dsw-alias-label-secondary)') }, t(`status.${item.status}`) || item.status),
          ),
          h('div', { style: css.hint }, `${new Date(item.createdAt).toLocaleString()} · ${item.brainProvider || ''}/${item.brainModel || ''}`),
          h('div', { style: { ...css.row, marginTop: 10 } },
            h('button', { style: css.btn('ghost'), onClick: () => { setTask(item); setGoal(item.userGoal || ''); setNotes(item.executionNotes || ''); setTab('workbench'); } }, t('history.restore')),
            h('button', { style: css.btn('ghost'), onClick: async () => { try { await fetch(`${API}/tasks`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id }) }); } catch { /* ignore */ } setTasks(p => p.filter(x => x.id !== item.id)); if (task && task.id === item.id) setTask(null); } }, t('history.delete')),
          ),
        )));
      }

      return h('div', { style: css.root },
        h('div', { style: css.header },
          h('div', { style: css.brand },
            h('div', { style: css.brandMark }, h(BrainGlyph, { size: 18 })),
            h('div', null,
              h('div', { style: css.brandText }, t('title')),
              h('div', { style: css.brandSub }, t('subtitle')),
            ),
          ),
          h('div', { style: css.tabs },
            [['workbench', t('tab.workbench')], ['history', `${t('tab.history')} (${tasks.length})`], ['settings', t('tab.settings')]].map(([id, label]) =>
              h('button', {
                key: id,
                style: {
                  padding: '6px 12px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer',
                  border: tab === id ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid transparent',
                  background: tab === id ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
                  color: tab === id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
                  fontWeight: tab === id ? 600 : 400,
                },
                onClick: () => setTab(id),
              }, label)),
          ),
        ),
        toastMsg ? h('div', { style: css.toast }, toastMsg) : null,
        h('div', { style: css.body }, h(Boundary, null, tab === 'workbench' ? Workbench() : tab === 'settings' ? Settings() : History())),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'dual-brain: copy');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, () => h(MainPanel, { ctx, t })));
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 15, locale: NS, label: () => t('panel') },
            ({ size, active }) => h(BrainGlyph, { size: size || 18, active })));
      },
    };
  },
});
