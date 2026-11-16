/**
 * @fileoverview Poke Swarm 数据聚合与宝可梦渲染单元测试。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPokeSwarmSnapshot } from './swarm_data.mjs';
import './pokemon.js';

const { POKEMON_CATALOG, getPokemonMeta, renderPokemonSvg, resolvePokemonId } = globalThis.PokeSwarmPokemon;

test('buildPokeSwarmSnapshot 正确解析成员状态、工具动作与上下文百分比', async () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'poke-swarm-test-'));
  try {
    const coordId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const worker1Id = 'bbbbbbbb-1111-2222-3333-444444444444';
    const worker2Id = 'cccccccc-1111-2222-3333-444444444444';
    const brainDir = join(tempHome, '.gemini', 'antigravity', 'brain');

    const swarmDir = join(brainDir, coordId, '.system_generated', 'swarm');
    mkdirSync(swarmDir, { recursive: true });
    mkdirSync(join(brainDir, coordId, '.system_generated', 'logs'), { recursive: true });
    mkdirSync(join(brainDir, worker1Id, '.system_generated', 'logs'), { recursive: true });
    mkdirSync(join(brainDir, worker2Id, '.system_generated', 'logs'), { recursive: true });

    writeFileSync(join(swarmDir, 'members.json'), JSON.stringify({
      title: '测试蜂群任务',
      members: {
        coordinator: { conversation_id: coordId, role: 'coordinator', last_read_seq: 2, model: 'Gemini 4 Hydrogen' },
        'flow-ui': { conversation_id: worker1Id, role: 'worker', last_read_seq: 1, model: 'Gemini 4 Carbon' },
        'flow-docs': { conversation_id: worker2Id, role: 'worker', last_read_seq: 2, killed: false },
      },
    }));

    writeFileSync(join(swarmDir, 'board.jsonl'), [
      JSON.stringify({ seq: 1, agent: 'coordinator', text: '@flow-ui 开始设计页面', time: '2026-11-15 07:00:00' }),
      JSON.stringify({ seq: 2, agent: 'flow-ui', text: '收到，正在读取现有代码', time: '2026-11-15 07:01:00' }),
    ].join('\n'));

    // coordinator 正在调用 swarm 工具，且有 520,000 tokens
    writeFileSync(join(brainDir, coordId, '.system_generated', 'logs', 'transcript.jsonl'), [
      JSON.stringify({
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 500000,
        cache_read_tokens: 15000,
        output_tokens: 5000,
        tool_calls: [{ name: 'swarm', args: { action: '"status"' } }],
      }),
    ].join('\n'));

    // flow-ui 正在思考推理
    writeFileSync(join(brainDir, worker1Id, '.system_generated', 'logs', 'transcript.jsonl'), [
      JSON.stringify({
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 200000,
        cache_read_tokens: 30000,
        output_tokens: 2000,
        thinking: '**分析组件结构**\n准备拆分模块',
        tool_calls: [],
      }),
      JSON.stringify({
        step_index: 1,
        type: 'USER_INPUT',
        status: 'DONE',
      }),
      JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 210000,
        cache_read_tokens: 30000,
        output_tokens: 1000,
        thinking: '**思考推理下一步布局**',
        tool_calls: [{ name: 'read_file', args: { Path: '"/tmp/index.html"' } }],
      }),
    ].join('\n'));

    // flow-docs 已调用 swarm_wait 且结束（待命中）
    writeFileSync(join(brainDir, worker2Id, '.system_generated', 'logs', 'transcript.jsonl'), [
      JSON.stringify({
        step_index: 0,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 100000,
        output_tokens: 500,
        tool_calls: [{ name: 'swarm_wait', args: { since: 2 } }],
      }),
      JSON.stringify({
        step_index: 1,
        type: 'GENERIC',
        status: 'DONE',
      }),
    ].join('\n'));

    const snap = await buildPokeSwarmSnapshot({
      conversationId: coordId,
      overrideHome: tempHome,
    });

    assert.equal(snap.hasSwarm, true);
    assert.equal(snap.matchedBy, 'coordinator');
    assert.equal(snap.swarm.title, '测试蜂群任务');
    assert.equal(snap.members.length, 3);

    const coord = snap.members.find((m) => m.name === 'coordinator');
    assert.equal(coord.isCoordinator, true);
    assert.equal(coord.status, 'working');
    assert.equal(coord.contextPct, 52);
    assert.equal(coord.secondarySource, 'board_sync');
    assert.equal(coord.secondaryPct, 100);
    assert.match(coord.bubbleText, /swarm/);

    const ui = snap.members.find((m) => m.name === 'flow-ui');
    assert.equal(ui.status, 'working');
    assert.equal(ui.contextPct, 24);
    assert.match(ui.bubbleText, /read_file/);

    const docs = snap.members.find((m) => m.name === 'flow-docs');
    assert.equal(docs.status, 'waiting');
    assert.equal(docs.statusLabel, '待命中');
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test('pokemon.js 角色映射与 SVG 渲染正常', () => {
  assert.equal(resolvePokemonId('coordinator'), 'charizard');
  assert.equal(resolvePokemonId('monitor'), 'rotom');
  assert.equal(resolvePokemonId('flow-ui'), 'eevee');
  assert.equal(resolvePokemonId('flow-core'), 'gengar');
  assert.equal(resolvePokemonId('flow-docs'), 'pikachu');
  assert.equal(resolvePokemonId('flow-docs', { 'flow-docs': 'snorlax' }), 'snorlax');

  const svg = renderPokemonSvg('charizard', 'working');
  assert.ok(svg.startsWith('<svg ') && svg.includes('</svg>'));
  const sleepSvg = renderPokemonSvg('pikachu', 'waiting');
  assert.ok(sleepSvg.includes('zZ'));

  for (const poke of POKEMON_CATALOG) {
    assert.match(poke.accent, /^#[0-9a-f]{6}$/i);
    assert.equal(getPokemonMeta(poke.id).accent, poke.accent);
  }
});

test('皮肤颜色自适应变量与宝可梦强调色配置完整', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

  assert.match(css, /--ps-bg:\s*var\(--background/);
  assert.match(css, /--ps-hud-bg:\s*color-mix\(/);
  assert.match(css, /--ps-ring-track:\s*color-mix\(/);
  assert.match(css, /--poke-accent/);
  assert.match(css, /\.hud-strip\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.hud-strip\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.hud-strip\s*\{[^}]*scrollbar-width:\s*none/s);
  assert.match(appJs, /theme-change/);
  assert.match(appJs, /--poke-accent/);
  assert.match(appJs, /var\(--ps-ring-track\)/);
});
