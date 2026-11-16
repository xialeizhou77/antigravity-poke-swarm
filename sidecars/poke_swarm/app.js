/**
 * @fileoverview Poke Swarm 前端主控脚本（经典 IIFE 模式，兼容所有 Sidecar iframe 环境）。
 * 负责轮询 /api/poke-swarm、同步宿主明暗主题、渲染双色圆环进度条、
 * 管理宝可梦自定义皮肤及成员会话跳转。
 */
(function initPokeSwarmApp() {
  const { POKEMON_CATALOG, getPokemonMeta, renderPokemonSvg, resolvePokemonId } = globalThis.PokeSwarmPokemon;

  const POLL_MS = 1800;
  const SKIN_STORAGE_KEY = 'poke_swarm_skin_overrides_v1';

  const EMPTY_SNAPSHOT = {
    hasSwarm: false,
    swarm: { id: '', title: 'Poke Swarm', head: 0 },
    availableSwarms: [],
    members: [],
    messages: [],
  };

  const state = {
    selectedSwarmId: '',
    activeTab: 'members',
    snap: null,
    skinOverrides: loadSkinOverrides(),
    editingMember: '',
    lastError: '',
  };

  const $ = (id) => document.getElementById(id);
  let hudOverflowObserver = null;

  function loadSkinOverrides() {
    try {
      return JSON.parse(localStorage.getItem(SKIN_STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveSkinOverrides(next) {
    state.skinOverrides = next;
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  /**
   * 同步 Antigravity 宿主皮肤（浅色/深色主题及自定义配色变量），
   * 解析真实背景色亮度后更新 data-theme 与 color-scheme。
   */
  function syncHostTheme() {
    try {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, var(--card, Canvas))';
      document.documentElement.appendChild(probe);
      let c = getComputedStyle(probe).color;
      probe.remove();

      if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') {
        c = getComputedStyle(document.body).backgroundColor;
      }

      const nums = (c.match(/[\d.]+/g) || []).map(Number);
      if (nums.length >= 3) {
        const scale = c.startsWith('color(') ? 1 : 255;
        const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const theme = lum < 0.5 ? 'dark' : 'light';
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        return;
      }

      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      const fallbackTheme = prefersDark ? 'dark' : 'light';
      document.documentElement.dataset.theme = fallbackTheme;
      document.documentElement.style.colorScheme = fallbackTheme;
    } catch {}
  }

  function polarPoint(cx, cy, radius, degFromBottom) {
    const rad = ((degFromBottom + 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function describeArc(cx, cy, r, startDeg, endDeg, sweepFlag) {
    const start = polarPoint(cx, cy, r, startDeg);
    const end = polarPoint(cx, cy, r, endDeg);
    const diff = Math.abs(endDeg - startDeg);
    const largeArc = diff > 180 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function renderDualRingSvg(ctxPct, secPct, uid) {
    const cx = 46;
    const cy = 46;
    const r = 40;
    const maxSpan = 158;

    const ctxRatio = Math.max(0.04, Math.min(1, (ctxPct || 0) / 100));
    const secRatio = Math.max(0.04, Math.min(1, (secPct || 0) / 100));

    const leftStart = 14;
    const leftFullEnd = leftStart + maxSpan;
    const leftProgEnd = leftStart + maxSpan * ctxRatio;
    const leftDot = polarPoint(cx, cy, r, leftProgEnd);

    const rightStart = 346;
    const rightFullEnd = rightStart - maxSpan;
    const rightProgEnd = rightStart - maxSpan * secRatio;
    const rightDot = polarPoint(cx, cy, r, rightProgEnd);

    return `
      <svg class="ring-svg" viewBox="0 0 92 92" aria-hidden="true">
        <defs>
          <linearGradient id="g-ctx-${uid}" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#f97316"/>
            <stop offset="100%" stop-color="#f43f5e"/>
          </linearGradient>
          <linearGradient id="g-sec-${uid}" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#4ade80"/>
          </linearGradient>
        </defs>
        <path d="${describeArc(cx, cy, r, leftStart, leftFullEnd, 1)}" fill="none" stroke="var(--ps-ring-track)" stroke-width="4.2" stroke-linecap="round"/>
        <path d="${describeArc(cx, cy, r, rightStart, rightFullEnd, 0)}" fill="none" stroke="var(--ps-ring-track)" stroke-width="4.2" stroke-linecap="round"/>
        <path d="${describeArc(cx, cy, r, leftStart, leftProgEnd, 1)}" fill="none" stroke="url(#g-ctx-${uid})" stroke-width="4.5" stroke-linecap="round"/>
        <path d="${describeArc(cx, cy, r, rightStart, rightProgEnd, 0)}" fill="none" stroke="url(#g-sec-${uid})" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="${leftDot.x.toFixed(2)}" cy="${leftDot.y.toFixed(2)}" r="3.6" fill="var(--ps-ctx-color)" stroke="var(--ps-hud-bg)" stroke-width="1.3"/>
        <circle cx="${rightDot.x.toFixed(2)}" cy="${rightDot.y.toFixed(2)}" r="3.6" fill="var(--ps-quota-color)" stroke="var(--ps-hud-bg)" stroke-width="1.3"/>
      </svg>
    `;
  }

  function bubbleIconFor(kind) {
    if (kind === 'tool') return '⚡';
    if (kind === 'thinking') return '💭';
    if (kind === 'waiting') return '💤';
    if (kind === 'error' || kind === 'quota') return '⚠';
    return '✓';
  }

  function crownSvg() {
    return `
      <span class="crown-badge" title="总控协调者 (Coordinator)" aria-label="Coordinator">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#facc15" aria-hidden="true">
          <path d="M3 18h18v2H3v-2zm0-2l2-9 5 4 2-6 2 6 5-4 2 9H3z"/>
        </svg>
      </span>
    `;
  }

  function syncHudEdgeHints(strip) {
    if (hudOverflowObserver) {
      hudOverflowObserver.disconnect();
      hudOverflowObserver = null;
    }
    strip.classList.remove('more-start', 'more-end');

    if (CSS.supports?.('animation-timeline', 'scroll()') || typeof IntersectionObserver !== 'function') {
      return;
    }

    const first = strip.firstElementChild;
    const last = strip.lastElementChild;
    if (!first || !last) return;

    hudOverflowObserver = new IntersectionObserver((entries) => {
      for (const { target, intersectionRatio } of entries) {
        if (target === first) strip.classList.toggle('more-start', intersectionRatio < 1);
        if (target === last) strip.classList.toggle('more-end', intersectionRatio < 1);
      }
    }, { root: strip, threshold: 1, rootMargin: '1px' });

    hudOverflowObserver.observe(first);
    hudOverflowObserver.observe(last);
  }

  function renderHud(snap) {
    const strip = $('hud-strip');
    const members = snap.members || [];
    if (!members.length) {
      if (hudOverflowObserver) {
        hudOverflowObserver.disconnect();
        hudOverflowObserver = null;
      }
      strip.classList.remove('more-start', 'more-end');
      document.documentElement.style.removeProperty('--ps-lead-accent');
      const emptyMsg = state.lastError
        ? `暂时无法读取 Swarm 状态（${esc(state.lastError)}）。`
        : '本机暂无运行中或历史 Swarm 记录，启动蜂群任务后将在此自动同步。';
      strip.innerHTML = `<div style="padding:18px;color:var(--ps-muted);font-size:12px;">${emptyMsg}</div>`;
      return;
    }

    const leadMember = members.find((m) => m.isCoordinator) || members[0];
    if (leadMember) {
      const leadMeta = getPokemonMeta(resolvePokemonId(leadMember.name, state.skinOverrides));
      document.documentElement.style.setProperty('--ps-lead-accent', leadMeta.accent);
    }

    const secLabel = members[0]?.secondarySource === 'board_sync'
      ? '右环：消息板同步率'
      : '右环：模型配额剩余';
    $('legend-secondary-text').textContent = secLabel;

    strip.innerHTML = members.map((m, idx) => {
      const pokeId = resolvePokemonId(m.name, state.skinOverrides);
      const meta = getPokemonMeta(pokeId);
      const tipText = `${m.name} (${meta.name}) · ${m.bubbleFull}\n上下文：${m.contextPct}% (${(m.totalTokens || 0).toLocaleString()} tokens)\n${m.secondarySource === 'board_sync' ? '消息板同步' : '模型剩余配额'}：${m.secondaryPct}%`;

      return `
        <div class="hud-card" role="listitem" style="--poke-accent:${esc(meta.accent)}">
          <div class="activity-pill ${esc(m.bubbleKind)}" title="${esc(m.bubbleFull)}">
            <span class="activity-icon" aria-hidden="true">${bubbleIconFor(m.bubbleKind)}</span>
            <span class="activity-text">${esc(m.bubbleText)}</span>
          </div>
          <div class="avatar-stage" title="${esc(tipText)}">
            ${m.isCoordinator ? crownSvg() : ''}
            ${renderDualRingSvg(m.contextPct, m.secondaryPct, idx)}
            <button
              type="button"
              class="avatar-btn ${esc(m.status)}"
              data-pick-skin="${esc(m.name)}"
              style="background:${meta.bg}"
              aria-label="更换 ${esc(m.name)} 的宝可梦形象"
            >
              ${renderPokemonSvg(pokeId, m.status)}
            </button>
          </div>
          <div class="member-meta">
            <button
              type="button"
              class="member-name-btn"
              data-open-conv="${esc(m.conversationId || '')}"
              title="${m.conversationId ? `点击打开 ${m.name} 对话` : m.name}"
            >${esc(m.name)}</button>
            <div class="member-stats">
              <span class="st-label ${esc(m.status)}">${esc(m.statusLabel)}</span>
              <span class="pct-ctx">${m.contextPct}%</span>
              <span class="pct-sep">/</span>
              <span class="pct-sec">${m.secondaryPct}%</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    syncHudEdgeHints(strip);
  }

  function renderDetails(snap) {
    const membersEl = $('panel-members');
    const boardEl = $('panel-board');
    const members = snap.members || [];
    const msgs = snap.messages || [];

    $('board-count').textContent = String(msgs.length);

    if (!members.length) {
      membersEl.innerHTML = '<div style="padding:12px;color:var(--ps-muted);">暂无成员记录。</div>';
    } else {
      membersEl.innerHTML = `<div class="detail-list">${members.map((m) => {
        const pokeMeta = getPokemonMeta(resolvePokemonId(m.name, state.skinOverrides));
        const secName = m.secondarySource === 'board_sync' ? '消息同步' : '配额剩余';
        return `
          <div class="detail-row" style="--poke-accent:${esc(pokeMeta.accent)}">
            <div class="detail-main">
              <div class="detail-head">
                <span>${esc(m.name)}</span>
                <span class="detail-poke-chip">${esc(pokeMeta.name)}</span>
                <span class="detail-model">${m.model ? esc(m.model) : ''}</span>
              </div>
              <div class="detail-sub">${esc(m.statusLabel)} · ${esc(m.bubbleFull)} · 上下文 ${m.contextPct}% · ${secName} ${m.secondaryPct}%</div>
            </div>
            ${m.conversationId ? `<button type="button" class="ghost-btn" data-open-conv="${esc(m.conversationId)}">进入对话</button>` : ''}
          </div>
        `;
      }).join('')}</div>`;
    }

    if (!msgs.length) {
      boardEl.innerHTML = '<div style="padding:12px;color:var(--ps-muted);">消息板暂无内容。</div>';
    } else {
      boardEl.innerHTML = msgs.map((msg) => `
        <article class="board-msg">
          <div class="board-msg-head">
            <span class="board-msg-agent">#${msg.seq} @${esc(msg.agent)}</span>
            <span>${esc(msg.time)}</span>
          </div>
          <div class="board-msg-text">${esc(msg.text)}</div>
        </article>
      `).join('');
    }
  }

  function renderTopbar(snap) {
    const titleEl = $('swarm-title');
    const pillEl = $('mode-pill');
    const selectEl = $('swarm-select');

    titleEl.textContent = snap.swarm?.title || 'Poke Swarm';
    if (!snap.hasSwarm) {
      pillEl.textContent = state.lastError ? `连接失败 (${state.lastError})` : '暂无 Swarm';
      pillEl.classList.add('empty');
    } else {
      pillEl.textContent = '实时同步';
      pillEl.classList.remove('empty');
    }

    const list = snap.availableSwarms || [];
    if (!list.length) {
      selectEl.innerHTML = '<option value="">本机暂无 Swarm 记录</option>';
      selectEl.disabled = true;
    } else {
      selectEl.disabled = false;
      selectEl.innerHTML = list.map((s) => {
        const selected = snap.swarm?.id === s.id ? 'selected' : '';
        return `<option value="${esc(s.id)}" ${selected}>${esc(s.title)} (${s.memberCount}人)</option>`;
      }).join('');
    }
  }

  function renderAll(snap) {
    state.snap = snap;
    renderTopbar(snap);
    renderHud(snap);
    renderDetails(snap);
  }

  function openSkinPicker(memberName) {
    state.editingMember = memberName;
    const pop = $('skin-popover');
    $('skin-target-name').textContent = `为 ${memberName} 选择宝可梦`;
    const curId = resolvePokemonId(memberName, state.skinOverrides);

    $('skin-grid').innerHTML = POKEMON_CATALOG.map((p) => `
      <button type="button" class="skin-item ${p.id === curId ? 'selected' : ''}" data-skin-id="${esc(p.id)}" style="--poke-accent:${esc(p.accent)}">
        <span class="skin-thumb" style="background:${p.bg}">${renderPokemonSvg(p.id, 'working')}</span>
        <span>${esc(p.name)}</span>
      </button>
    `).join('');

    if (typeof pop.showPopover === 'function') {
      pop.showPopover();
    } else {
      pop.setAttribute('open', '');
      pop.style.display = 'block';
    }
  }

  function closeSkinPicker() {
    const pop = $('skin-popover');
    if (typeof pop.hidePopover === 'function') {
      try { pop.hidePopover(); } catch {}
    } else {
      pop.removeAttribute('open');
      pop.style.display = '';
    }
  }

  async function requestSnapshotJson(url) {
    // 优先使用普通 GET fetch（sidecar GET 免鉴权且避免跨源预检），失败时再试 window.sidecar.fetch
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return await res.json();
    } catch {}
    if (window.sidecar?.fetch) {
      const res = await window.sidecar.fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }
    throw new Error('接口不可达');
  }

  async function fetchSnapshot() {
    try {
      const params = new URLSearchParams(location.search);
      const convId = window.sidecar?.conversationId || params.get('conversationId') || '';
      const qs = new URLSearchParams();
      if (convId) qs.set('conversationId', convId);
      if (state.selectedSwarmId) qs.set('swarmId', state.selectedSwarmId);

      const data = await requestSnapshotJson(`/api/poke-swarm?${qs.toString()}`);
      state.lastError = '';
      if (!data.hasSwarm) {
        renderAll({ ...EMPTY_SNAPSHOT, availableSwarms: data.availableSwarms || [] });
      } else {
        renderAll(data);
      }
    } catch (err) {
      state.lastError = err?.message || '连接失败';
      renderAll(EMPTY_SNAPSHOT);
    }
  }

  function bindEvents() {
    new MutationObserver(syncHostTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'theme-change') {
        queueMicrotask(syncHostTheme);
      }
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', syncHostTheme);
    syncHostTheme();

    document.addEventListener('click', (e) => {
      const skinBtn = e.target.closest('[data-pick-skin]');
      if (skinBtn) {
        openSkinPicker(skinBtn.dataset.pickSkin);
        return;
      }

      const pickItem = e.target.closest('[data-skin-id]');
      if (pickItem && state.editingMember) {
        const next = { ...state.skinOverrides, [state.editingMember]: pickItem.dataset.skinId };
        saveSkinOverrides(next);
        closeSkinPicker();
        if (state.snap) renderAll(state.snap);
        return;
      }

      const convBtn = e.target.closest('[data-open-conv]');
      if (convBtn) {
        const convId = convBtn.dataset.openConv;
        if (convId && window.sidecar?.ui?.toggleConversation) {
          window.sidecar.ui.toggleConversation(convId);
        }
        return;
      }

      const tabBtn = e.target.closest('.subtab');
      if (tabBtn) {
        const targetPanel = tabBtn.dataset.panel;
        state.activeTab = targetPanel;
        document.querySelectorAll('.subtab').forEach((b) => {
          const on = b.dataset.panel === targetPanel;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.subpanel').forEach((p) => {
          p.classList.toggle('active', p.id === `panel-${targetPanel}`);
        });
      }
    });

    $('skin-reset').addEventListener('click', () => {
      if (!state.editingMember) return;
      const next = { ...state.skinOverrides };
      delete next[state.editingMember];
      saveSkinOverrides(next);
      closeSkinPicker();
      if (state.snap) renderAll(state.snap);
    });

    $('swarm-select').addEventListener('change', (e) => {
      state.selectedSwarmId = e.target.value;
      fetchSnapshot();
    });

    // 支持直接用垂直滚轮横向滑动单行成员区（隐藏滚动条时的自然交互补充）
    $('hud-strip').addEventListener('wheel', (e) => {
      const strip = e.currentTarget;
      if (strip.scrollWidth > strip.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  bindEvents();
  fetchSnapshot();
  setInterval(fetchSnapshot, POLL_MS);
})();
