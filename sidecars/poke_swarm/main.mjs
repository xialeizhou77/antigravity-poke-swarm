/**
 * @fileoverview Poke Swarm Sidecar 服务端入口。
 * 基于 Antigravity sidecar_sdk 托管本地 HTTP 服务，提供静态资源与 /api/poke-swarm 接口。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';
import { buildPokeSwarmSnapshot } from './swarm_data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATIC_FILES = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/pokemon.js': ['pokemon.js', 'application/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const app = new SidecarApp();

app.page('/', () => new Response(readFileSync(join(__dirname, 'index.html'), 'utf-8'), {
  contentType: 'text/html; charset=utf-8',
  headers: CORS_HEADERS,
}));

for (const [route, [fileName, contentType]] of Object.entries(STATIC_FILES)) {
  app.api(
    route,
    () => new Response(readFileSync(join(__dirname, fileName), 'utf-8'), {
      contentType,
      headers: CORS_HEADERS,
    }),
    'GET',
  );
}

app.api(
  '/api/poke-swarm',
  async (data) => {
    const convId = typeof data?.conversationId === 'string' && data.conversationId
      ? data.conversationId
      : (app.config?.conversationId || '');
    const swarmId = typeof data?.swarmId === 'string' ? data.swarmId : '';
    const snap = await buildPokeSwarmSnapshot({ conversationId: convId, swarmId });
    return new Response(JSON.stringify(snap), {
      contentType: 'application/json; charset=utf-8',
      headers: CORS_HEADERS,
    });
  },
  'GET',
);

app.run();
