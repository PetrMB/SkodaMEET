#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8095;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const ENV_PATH = path.join(ROOT, '.env');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const MAX_BODY = 50 * 1024 * 1024; // 50 MB

const DEFAULT_PROMPT = `Lightly and realistically retouch this real-estate exterior photo. The main task is exposure balancing: gently lift the deep shadows so the building's façade, entrances and details become clearly visible, while recovering detail in the brightest sunlit areas. Keep the natural daylight character and direction — do not flatten it into a fake HDR look; some natural shadow and contrast must remain. Remove any people anywhere in the frame and seamlessly fill the gaps with the surrounding background. Keep everything else exactly as it is — do not add, remove, recolor or restyle any objects, surfaces or vegetation. Keep colors true-to-life with a neutral white balance; no oversaturation, no glow, no artificial polish. The result should look like a single well-exposed photo taken by a good camera, not an edited render.`;

const MODELS = [
  { id: 'openai/gpt-5.4-image-2', label: 'GPT Image 2 — nejlepší kvalita (výchozí)' },
  { id: 'openai/gpt-5-image', label: 'GPT-5 Image' },
  { id: 'openai/gpt-5-image-mini', label: 'GPT-5 Image Mini — levný test' },
  { id: 'google/gemini-2.5-flash-image', label: 'Gemini Flash Image — levný test' },
];

const DEFAULTS = {
  defaultPrompt: DEFAULT_PROMPT,
  model: MODELS[0].id,
  resolution: '2K',
  concurrency: 2,
  outputDir: path.join(ROOT, 'output'),
};

// ---------- .env ----------

let apiKey = null;

function loadEnv() {
  apiKey = null;
  try {
    const text = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key === 'OPENROUTER_API_KEY' && val && !val.endsWith('...')) apiKey = val;
    }
  } catch { /* .env zatím neexistuje */ }
}

// ---------- config ----------

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* první start */ }
  return { ...DEFAULTS, ...cfg };
}

function saveConfig(cfg) {
  const allowed = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (cfg[key] !== undefined) allowed[key] = cfg[key];
  }
  const merged = { ...loadConfig(), ...allowed };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// ---------- helpers ----------

function sanitizeName(name, fallback) {
  const clean = String(name || '')
    .replace(/\.[^.]+$/u, m => m) // ponechat příponu, čistí se níže
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\.\./g, '_')
    .trim();
  return clean || fallback;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Tělo požadavku je příliš velké'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jsonl': 'text/plain; charset=utf-8',
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nenalezeno');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- OpenRouter ----------

async function callOpenRouter({ prompt, image, model, resolution, aspectRatio }) {
  const body = {
    model,
    prompt,
    input_references: [
      { type: 'image_url', image_url: { url: image } },
    ],
    output_format: 'jpeg',
  };
  if (resolution) body.resolution = resolution;
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const resp = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:' + PORT,
      'X-Title': 'Retus - davkova retus fotek',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ne-JSON odpověď */ }

  if (!resp.ok) {
    const msg = json?.error?.message || json?.error || text.slice(0, 500) || `HTTP ${resp.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = resp.status;
    throw err;
  }

  const item = json?.data?.[0];
  let b64 = item?.b64_json || null;
  if (!b64 && typeof item?.url === 'string' && item.url.startsWith('data:')) {
    b64 = item.url.slice(item.url.indexOf(',') + 1);
  }
  if (!b64 && typeof item?.image === 'string') b64 = item.image;
  if (!b64) {
    const err = new Error('Odpověď API neobsahuje obrázek');
    err.status = 502;
    throw err;
  }

  const usage = json?.usage || {};
  const costUsd = typeof usage.cost === 'number' ? usage.cost
    : typeof usage.total_cost === 'number' ? usage.total_cost
    : typeof usage.cost_details?.upstream_inference_cost === 'number' ? usage.cost_details.upstream_inference_cost
    : null;

  return { buffer: Buffer.from(b64, 'base64'), costUsd };
}

// ---------- API handlers ----------

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const cfg = loadConfig();
    sendJSON(res, 200, { ...cfg, hasApiKey: !!apiKey, models: MODELS });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/config') {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const saved = saveConfig(body);
    sendJSON(res, 200, { ...saved, hasApiKey: !!apiKey, models: MODELS });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/setup-key') {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const key = String(body.key || '').trim();
    if (!key || /\s/.test(key)) {
      sendJSON(res, 400, { error: 'Neplatný klíč' });
      return;
    }
    fs.writeFileSync(ENV_PATH, `OPENROUTER_API_KEY=${key}\n`, { mode: 0o600 });
    loadEnv();
    sendJSON(res, 200, { ok: true, hasApiKey: !!apiKey });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/edit') {
    if (!apiKey) {
      sendJSON(res, 401, { error: 'Chybí API klíč — vložte ho v aplikaci nebo do souboru .env' });
      return;
    }
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const { image, prompt, model, resolution, aspectRatio } = body;
    if (!image || !String(image).startsWith('data:image/') || !prompt) {
      sendJSON(res, 400, { error: 'Chybí obrázek nebo prompt' });
      return;
    }
    const batch = sanitizeName(body.batch, 'davka');
    const filename = sanitizeName(body.filename, 'foto.jpg');

    try {
      const { buffer, costUsd } = await callOpenRouter({
        prompt,
        image,
        model: model || loadConfig().model,
        resolution,
        aspectRatio,
      });

      const cfg = loadConfig();
      const batchDir = path.join(cfg.outputDir, batch);
      fs.mkdirSync(batchDir, { recursive: true });
      const base = filename.replace(/\.[^.]+$/u, '') || 'foto';
      const outName = `${base}_retus.jpg`;
      fs.writeFileSync(path.join(batchDir, outName), buffer);
      fs.appendFileSync(path.join(batchDir, 'log.jsonl'), JSON.stringify({
        filename, outName, model: model || cfg.model, resolution, costUsd,
        time: new Date().toISOString(),
      }) + '\n');

      sendJSON(res, 200, {
        url: `/output/${encodeURIComponent(batch)}/${encodeURIComponent(outName)}`,
        costUsd,
      });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      sendJSON(res, status, { error: err.message || 'Neznámá chyba' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/open-folder') {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const cfg = loadConfig();
    const batch = body.batch ? sanitizeName(body.batch, '') : '';
    let target = batch ? path.join(cfg.outputDir, batch) : cfg.outputDir;
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(cfg.outputDir))) {
      sendJSON(res, 400, { error: 'Neplatná cesta' });
      return;
    }
    if (!fs.existsSync(resolved)) target = cfg.outputDir;
    fs.mkdirSync(target, { recursive: true });
    execFile('open', [target], () => {});
    sendJSON(res, 200, { ok: true });
    return;
  }

  sendJSON(res, 404, { error: 'Neznámý endpoint' });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/output/')) {
      const cfg = loadConfig();
      const rel = decodeURIComponent(url.pathname.slice('/output/'.length));
      const filePath = path.resolve(path.join(cfg.outputDir, rel));
      if (!filePath.startsWith(path.resolve(cfg.outputDir))) {
        res.writeHead(403); res.end();
        return;
      }
      serveFile(res, filePath);
      return;
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filePath = path.resolve(path.join(PUBLIC_DIR, rel));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); res.end();
      return;
    }
    serveFile(res, filePath);
  } catch (err) {
    sendJSON(res, 500, { error: err.message || 'Chyba serveru' });
  }
});

server.requestTimeout = 10 * 60 * 1000; // generování obrázku může trvat minuty
server.headersTimeout = 11 * 60 * 1000;

loadEnv();
fs.mkdirSync(loadConfig().outputDir, { recursive: true });
if (!fs.existsSync(CONFIG_PATH)) saveConfig({});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Retuš běží na http://localhost:${PORT}`);
  console.log(apiKey ? 'API klíč: nalezen v .env' : 'API klíč: CHYBÍ — vložte ho v aplikaci (uloží se do .env)');
});
