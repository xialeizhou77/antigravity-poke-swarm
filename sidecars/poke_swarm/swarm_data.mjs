/**
 * @fileoverview Poke Swarm 数据聚合模块。
 * 只读解析 Antigravity 本地的 Swarm 目录（members.json、board.jsonl）与
 * 成员对话记录（transcript.jsonl），并结合 Language Server 的 GetUserStatus 接口
 * 获取模型配额剩余率与上下文窗口占用百分比。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const ID_RE = /^[0-9a-f-]{8,}$/i;
const QUOTA_ERR_RE = /RESOURCE_EXHAUSTED|quota|\b429\b|exhausted your capacity|rate.?limit/i;
const DEFAULT_CONTEXT_LIMIT = 1_000_000;
const QUOTA_CACHE_TTL_MS = 20_000;
const SWARM_SCAN_TTL_MS = 3_000;
const STEP_ERROR_SETTLE_MS = 60_000;

/** 常见工具的中文动作标签映射 */
const TOOL_ZH_MAP = {
  swarm: '编排蜂群',
  post_message: '发送广播',
  read_board: '读取消息板',
  swarm_wait: '等待消息',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑代码',
  run_command: '执行命令',
  search_web: '联网检索',
  search_marketplace: '检索插件',
  invoke_subagent: '调用子代理',
  send_message: '发送消息',
  code_search: '搜索代码',
  list_dir: '浏览目录',
  grep_search: '文本搜索',
  find_by_name: '查找文件',
};

const fileCache = new Map();
const transcriptCache = new Map();
let swarmScanCache = { at: 0, list: [] };
let quotaCache = { at: 0, byModel: new Map(), defaultFraction: null, pending: null };

/**
 * 安全读取目录条目。
 * @param {string} dirPath 目录路径
 * @returns {string[]}
 */
function safeReaddir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

/**
 * 获取文件修改时间与字节大小。
 * @param {string} filePath 文件路径
 * @returns {{mtime: number, size: number}}
 */
function statOf(filePath) {
  try {
    const s = statSync(filePath);
    return { mtime: s.mtimeMs, size: s.size };
  } catch {
    return { mtime: 0, size: -1 };
  }
}

/**
 * 带 mtime/size 缓存读取文本文件。
 * @param {string} filePath 文件路径
 * @returns {{text: string | null, mtime: number, size: number}}
 */
function readCached(filePath) {
  const st = statOf(filePath);
  if (st.size < 0) return { text: null, ...st };
  const key = `${st.mtime}:${st.size}`;
  const hit = fileCache.get(filePath);
  if (hit && hit.key === key) return { text: hit.text, ...st };
  try {
    const text = readFileSync(filePath, 'utf-8');
    if (fileCache.size > 400) fileCache.clear();
    fileCache.set(filePath, { key, text });
    return { text, ...st };
  } catch {
    return { text: null, ...st };
  }
}

/**
 * 查找本地 Antigravity appData 目录列表。
 * @param {string} [overrideHome] 可选的自定义主目录（用于测试）
 * @returns {string[]}
 */
export function findAppDataDirs(overrideHome) {
  if (!overrideHome) {
    const appDir = process.env.ANTIGRAVITY_APP_DATA_DIR?.trim();
    if (appDir && existsSync(join(appDir, 'brain'))) return [appDir];

    const execDataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR?.trim();
    if (execDataDir) {
      for (let d = execDataDir; d !== dirname(d); d = dirname(d)) {
        if (basename(d) !== 'sidecar_data') continue;
        const appData = dirname(d);
        return existsSync(join(appData, 'brain')) ? [appData] : [];
      }
    }
  }

  const root = join(overrideHome || homedir(), '.gemini');
  return safeReaddir(root)
    .sort()
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, 'brain')));
}

const swarmDirOf = (appData, convId) => join(appData, 'brain', convId, '.system_generated', 'swarm');
const transcriptPathOf = (appData, convId) => join(appData, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRoster(text) {
  const obj = parseJsonSafe(text || '');
  if (!obj || typeof obj !== 'object') return null;
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    members: obj.members && typeof obj.members === 'object' ? obj.members : {},
  };
}

function parseBoard(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    if (!line.trim()) continue;
    const item = parseJsonSafe(line);
    if (item && typeof item === 'object') out.push(item);
  }
  return out;
}

function unquote(val) {
  if (typeof val !== 'string') return val == null ? '' : String(val);
  const s = val.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const parsed = parseJsonSafe(s);
    return parsed != null ? String(parsed) : s.slice(1, -1);
  }
  return s;
}

function oneLine(str, maxLen = 72) {
  const clean = String(str || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1).trimEnd()}…` : clean;
}

/**
 * 提取工具调用的中文短标签与完整描述。
 * @param {object} tc 工具调用对象
 * @returns {{tool: string, shortText: string, fullText: string} | null}
 */
function describeToolCall(tc) {
  const name = tc?.name || '';
  if (!name) return null;
  const zhAction = TOOL_ZH_MAP[name] || name;
  const args = tc.args && typeof tc.args === 'object' ? tc.args : {};
  const summary = unquote(args.toolSummary) || unquote(args.toolAction);
  const pathVal = unquote(args.Path || args.AbsolutePath || args.TargetFile);
  const fileLabel = pathVal ? basename(pathVal) : '';

  let detail = '';
  if (name === 'swarm' && args.action) {
    const act = unquote(args.action);
    const target = unquote(args.name);
    detail = target ? `${act} ${target}` : act;
  } else if (summary) {
    detail = summary;
  } else if (fileLabel) {
    detail = fileLabel;
  } else if (args.Query) {
    detail = unquote(args.Query);
  }

  const fullText = detail ? `${name} · ${zhAction}（${detail}）` : `${name} · ${zhAction}`;
  const shortText = `${name} · ${zhAction}`;
  return { tool: name, shortText: oneLine(shortText, 32), fullText: oneLine(fullText, 120) };
}

function thinkingHeading(thinking) {
  if (typeof thinking !== 'string') return '';
  const matches = [...thinking.matchAll(/(?:^|\n)\s*\*\*([^*\n]{2,96})\*\*\s*(?=\n|$)/g)];
  if (matches.length) return oneLine(matches[matches.length - 1][1], 48);
  const firstLine = thinking.split('\n').find((l) => l.trim().length > 0);
  return firstLine ? oneLine(firstLine, 40) : '';
}

function turnEnded(lines) {
  const results = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const step = parseJsonSafe(lines[i]);
    if (!step || typeof step !== 'object') return false;
    if (step.type === 'GENERIC') {
      results.unshift(step);
      continue;
    }
    if (step.type !== 'PLANNER_RESPONSE') return false;
    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    if (calls.length === 0) return results.length === 0;
    const waitIdx = calls.findIndex((c) => c?.name === 'swarm_wait');
    return waitIdx >= 0 && results.length >= calls.length && results[waitIdx]?.status === 'DONE';
  }
  return false;
}

/**
 * 解析成员的 transcript.jsonl，获取步数、当前实时动作、token 消耗与空闲状态。
 * @param {string} appData appData 根目录
 * @param {string} convId 成员会话 ID
 */
export function summarizeMemberTranscript(appData, convId) {
  if (!appData || !convId || !ID_RE.test(convId)) return null;
  const path = transcriptPathOf(appData, convId);
  const st = statOf(path);
  if (st.size < 0) return null;

  const key = `${st.mtime}:${st.size}`;
  const cached = transcriptCache.get(path);
  if (cached && cached.key === key) return cached.summary;

  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }

  const lines = text.split('\n').filter((l) => l.trim());
  let steps = lines.length;
  let activity = '';
  let activityFull = '';
  let activityKind = '';
  let last = null;
  let totalTokens = 0;

  // 提取最新一次模型响应中的 token 占用（用于上下文百分比）
  for (let i = lines.length - 1; i >= 0; i--) {
    const step = parseJsonSafe(lines[i]);
    if (!step || typeof step !== 'object') continue;
    if (i === lines.length - 1 && Number.isFinite(step.step_index)) {
      steps = Math.max(steps, step.step_index + 1);
    }
    if (!last) {
      last = {
        type: String(step.type || ''),
        status: String(step.status || ''),
        error: typeof step.error === 'string' ? oneLine(step.error, 200) : '',
      };
    }
    if (!totalTokens && step.type === 'PLANNER_RESPONSE') {
      const inTok = Number(step.input_tokens) || 0;
      const cacheTok = Number(step.cache_read_tokens) || 0;
      const outTok = Number(step.output_tokens) || 0;
      if (inTok + cacheTok + outTok > 0) {
        totalTokens = inTok + cacheTok + outTok;
      }
    }
    if (totalTokens && last) break;
  }

  // 提取当前轮次的最新活动（工具调用或思考推理）
  for (let i = lines.length - 1; i >= 0; i--) {
    const step = parseJsonSafe(lines[i]);
    if (!step || typeof step !== 'object') continue;
    if (step.type === 'USER_INPUT') break;
    if (step.type !== 'PLANNER_RESPONSE') continue;
    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    if (calls.some((tc) => tc?.name === 'swarm_wait')) break;

    const labeled = calls.map((tc) => describeToolCall(tc)).filter(Boolean).pop();
    if (labeled) {
      activity = labeled.shortText;
      activityFull = labeled.fullText;
      activityKind = 'tool';
      break;
    }
    const heading = thinkingHeading(step.thinking);
    if (heading) {
      activity = heading;
      activityFull = `思考推理：${heading}`;
      activityKind = 'thinking';
      break;
    }
  }

  const idle = turnEnded(lines);
  const summary = {
    steps,
    activity,
    activityFull,
    activityKind,
    last,
    idle,
    totalTokens,
    mtime: st.mtime,
  };
  if (transcriptCache.size > 400) transcriptCache.clear();
  transcriptCache.set(path, { key, summary });
  return summary;
}

/**
 * 扫描本地所有包含 members.json 的 Swarm 目录，按修改时间倒序排列。
 * @param {string} [overrideHome] 可选主目录
 */
export function listLocalSwarms(overrideHome) {
  const now = Date.now();
  if (!overrideHome && now - swarmScanCache.at < SWARM_SCAN_TTL_MS) {
    return swarmScanCache.list;
  }

  const results = [];
  const seen = new Set();
  for (const appData of findAppDataDirs(overrideHome)) {
    const brainDir = join(appData, 'brain');
    for (const convId of safeReaddir(brainDir)) {
      if (!ID_RE.test(convId) || seen.has(convId)) continue;
      const membersPath = join(swarmDirOf(appData, convId), 'members.json');
      const st = statOf(membersPath);
      if (st.size < 0) continue;
      seen.add(convId);
      const roster = parseRoster(readCached(membersPath).text);
      const boardSt = statOf(join(swarmDirOf(appData, convId), 'board.jsonl'));
      const updatedAt = Math.max(st.mtime, boardSt.mtime);
      results.push({
        id: convId,
        appData,
        title: roster?.title || `Swarm ${convId.slice(0, 8)}`,
        memberCount: Object.keys(roster?.members || {}).length,
        updatedAt,
      });
    }
  }
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  if (!overrideHome) {
    swarmScanCache = { at: now, list: results };
  }
  return results;
}

/**
 * 从 Language Server 拉取并缓存模型剩余配额信息。
 */
async function refreshQuotaCache() {
  const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!lsAddr || !csrf) return quotaCache;

  const now = Date.now();
  if (now - quotaCache.at < QUOTA_CACHE_TTL_MS) return quotaCache;
  if (quotaCache.pending) return quotaCache.pending;

  quotaCache.pending = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://${lsAddr}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf,
        },
        body: '{}',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return quotaCache;
      const data = await res.json();
      const configs = data?.userStatus?.cascadeModelConfigData?.clientModelConfigs;
      if (!Array.isArray(configs)) return quotaCache;

      const byModel = new Map();
      const fractions = [];
      for (const cfg of configs) {
        const frac = cfg?.quotaInfo?.remainingFraction;
        if (typeof frac !== 'number' || !Number.isFinite(frac)) continue;
        fractions.push(frac);
        const modelKey = cfg?.modelOrAlias?.model;
        const label = cfg?.label;
        if (modelKey) byModel.set(String(modelKey).toLowerCase(), frac);
        if (label) byModel.set(String(label).toLowerCase(), frac);
      }
      const defaultFraction = fractions.length
        ? fractions.reduce((a, b) => a + b, 0) / fractions.length
        : null;
      quotaCache = { at: Date.now(), byModel, defaultFraction, pending: null };
    } catch {
      quotaCache.pending = null;
    }
    return quotaCache;
  })();

  return quotaCache.pending;
}

function resolveQuotaFraction(modelName, qCache) {
  if (!qCache || qCache.byModel.size === 0) return null;
  const key = String(modelName || '').trim().toLowerCase();
  if (key && qCache.byModel.has(key)) return qCache.byModel.get(key);
  if (key) {
    for (const [k, v] of qCache.byModel.entries()) {
      if (k.includes(key) || key.includes(k)) return v;
    }
  }
  return qCache.defaultFraction;
}

function resolveSwarmTarget(convId, requestedSwarmId, overrideHome) {
  const swarms = listLocalSwarms(overrideHome);
  if (requestedSwarmId) {
    const explicit = swarms.find((s) => s.id === requestedSwarmId);
    if (explicit) return { target: explicit, matchedBy: 'selected', swarms };
  }
  if (convId && ID_RE.test(convId)) {
    const owned = swarms.find((s) => s.id === convId);
    if (owned) return { target: owned, matchedBy: 'coordinator', swarms };
    for (const s of swarms) {
      const roster = parseRoster(readCached(join(swarmDirOf(s.appData, s.id), 'members.json')).text);
      const hit = Object.values(roster?.members || {}).some((m) => m?.conversation_id === convId);
      if (hit) return { target: s, matchedBy: 'member', swarms };
    }
  }
  return { target: swarms[0] || null, matchedBy: swarms.length ? 'latest' : 'none', swarms };
}

/**
 * 推断成员的前端展示状态（工作中 / 思考中 / 待命中 / 已结束 / 异常）。
 */
function computeDisplayState(m, tr, now) {
  if (m.killed) {
    return { code: 'killed', label: '已结束' };
  }
  const last = tr?.last;
  const hasModelErr = last?.type === 'ERROR_MESSAGE';
  const hasSettledToolErr = last?.status === 'ERROR' && now - (tr?.mtime || 0) >= STEP_ERROR_SETTLE_MS;
  if (hasModelErr || hasSettledToolErr) {
    const isQuota = QUOTA_ERR_RE.test(last?.error || '');
    return {
      code: isQuota ? 'quota' : 'error',
      label: isQuota ? '配额受限' : '执行异常',
      errorDetail: last?.error || '',
    };
  }

  const isIdle = typeof tr?.idle === 'boolean'
    ? tr.idle
    : (m.wake_mode === 'mentions' || m.wake_mode === 'anything');

  if (isIdle) {
    return { code: 'waiting', label: '待命中' };
  }
  if (tr?.activityKind === 'thinking' || !tr?.activity) {
    return { code: 'thinking', label: '思考中' };
  }
  return { code: 'working', label: '工作中' };
}

/**
 * 构建 Poke Swarm 完整快照数据。
 * @param {{conversationId?: string, swarmId?: string, overrideHome?: string}} [opts]
 */
export async function buildPokeSwarmSnapshot(opts = {}) {
  const { conversationId = '', swarmId = '', overrideHome } = opts;
  const qCache = overrideHome ? null : await refreshQuotaCache();
  const { target, matchedBy, swarms } = resolveSwarmTarget(conversationId, swarmId, overrideHome);

  const availableSwarms = swarms.slice(0, 20).map((s) => ({
    id: s.id,
    title: s.title,
    memberCount: s.memberCount,
    updatedAt: s.updatedAt,
  }));

  if (!target) {
    return {
      hasSwarm: false,
      matchedBy: 'none',
      conversationId: conversationId || null,
      swarm: null,
      availableSwarms,
      members: [],
      messages: [],
    };
  }

  const dir = swarmDirOf(target.appData, target.id);
  const roster = parseRoster(readCached(join(dir, 'members.json')).text) || { title: target.title, members: {} };
  const msgs = parseBoard(readCached(join(dir, 'board.jsonl')).text);
  const head = msgs.length ? (Number(msgs[msgs.length - 1].seq) || msgs.length) : 0;
  const now = Date.now();

  const members = Object.entries(roster.members)
    .filter(([, m]) => m && typeof m === 'object')
    .map(([name, m]) => {
      const tr = summarizeMemberTranscript(target.appData, m.conversation_id);
      const role = typeof m.role === 'string' && m.role ? m.role : (name === 'coordinator' ? 'coordinator' : 'worker');
      const stateInfo = computeDisplayState(m, tr, now);

      const totalTokens = tr?.totalTokens || 0;
      const contextPct = totalTokens > 0
        ? Math.min(100, Math.max(1, Math.round((totalTokens / DEFAULT_CONTEXT_LIMIT) * 100)))
        : 0;

      const quotaFrac = resolveQuotaFraction(m.model, qCache);
      const lastRead = Number(m.last_read_seq) || 0;
      const boardSyncPct = head > 0 ? Math.min(100, Math.round((lastRead / head) * 100)) : 100;

      const hasQuota = typeof quotaFrac === 'number' && Number.isFinite(quotaFrac);
      const secondaryPct = hasQuota ? Math.min(100, Math.max(0, Math.round(quotaFrac * 100))) : boardSyncPct;
      const secondarySource = hasQuota ? 'quota' : 'board_sync';

      let bubbleText = '';
      let bubbleKind = stateInfo.code;
      if (stateInfo.code === 'error' || stateInfo.code === 'quota') {
        bubbleText = stateInfo.label;
      } else if (stateInfo.code === 'waiting') {
        bubbleText = '等待消息唤醒…';
        bubbleKind = 'waiting';
      } else if (stateInfo.code === 'killed') {
        bubbleText = '任务已结束';
        bubbleKind = 'killed';
      } else if (tr?.activityKind === 'tool' && tr.activity) {
        bubbleText = tr.activity;
        bubbleKind = 'tool';
      } else if (tr?.activityKind === 'thinking' && tr.activity) {
        bubbleText = tr.activity;
        bubbleKind = 'thinking';
      } else {
        bubbleText = '思考推理中…';
        bubbleKind = 'thinking';
      }

      return {
        name,
        role,
        isCoordinator: role === 'coordinator' || name === 'coordinator',
        conversationId: m.conversation_id || '',
        model: m.model || '',
        killed: !!m.killed,
        steps: tr?.steps || 0,
        status: stateInfo.code,
        statusLabel: stateInfo.label,
        errorDetail: stateInfo.errorDetail || '',
        bubbleKind,
        bubbleText,
        bubbleFull: tr?.activityFull || bubbleText,
        contextPct,
        totalTokens,
        contextLimit: DEFAULT_CONTEXT_LIMIT,
        secondaryPct,
        secondarySource,
        lastReadSeq: lastRead,
        unread: Math.max(0, head - lastRead),
      };
    });

  // 排序规则：coordinator 排最前，其余优先活跃成员再按名称排序
  members.sort((a, b) => {
    if (a.isCoordinator !== b.isCoordinator) return a.isCoordinator ? -1 : 1;
    if (a.killed !== b.killed) return a.killed ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  const recentMessages = msgs.slice(-30).reverse().map((m) => ({
    seq: Number(m.seq) || 0,
    agent: String(m.agent || ''),
    text: String(m.text || ''),
    time: String(m.time || ''),
  }));

  return {
    hasSwarm: true,
    matchedBy,
    conversationId: conversationId || null,
    swarm: {
      id: target.id,
      title: roster.title || target.title,
      head,
    },
    availableSwarms,
    members,
    messages: recentMessages,
  };
}
