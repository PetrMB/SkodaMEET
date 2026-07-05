(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const MAX_EDGE = 2048;
  const JPEG_QUALITY = 0.9;
  const RATIOS = [
    { key: '1:1', value: 1 },
    { key: '4:3', value: 4 / 3 },
    { key: '3:4', value: 3 / 4 },
    { key: '3:2', value: 3 / 2 },
    { key: '2:3', value: 2 / 3 },
    { key: '16:9', value: 16 / 9 },
    { key: '9:16', value: 9 / 16 },
  ];

  let config = null;
  let jobs = [];          // { id, name, status, attempts, costUsd, dataURL, beforeURL, afterURL, error, card }
  let nextId = 1;
  let running = false;
  let totalCost = 0;

  // ---------- config ----------

  async function loadConfig() {
    const res = await fetch('/api/config');
    config = await res.json();

    $('default-prompt').value = config.defaultPrompt;
    $('resolution-select').value = config.resolution || '2K';
    $('concurrency-select').value = String(config.concurrency || 2);

    const sel = $('model-select');
    sel.innerHTML = '';
    for (const m of config.models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
    sel.value = config.model;
    if (!sel.value) sel.selectedIndex = 0;

    $('key-banner').classList.toggle('show', !config.hasApiKey);
  }

  async function saveConfigPatch(patch) {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    config = await res.json();
  }

  // ---------- API key ----------

  $('key-save').addEventListener('click', async () => {
    const key = $('key-input').value.trim();
    $('key-error').textContent = '';
    if (!key) { $('key-error').textContent = 'Vložte klíč.'; return; }
    const res = await fetch('/api/setup-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const json = await res.json();
    if (!res.ok || !json.hasApiKey) {
      $('key-error').textContent = json.error || 'Klíč se nepodařilo uložit.';
      return;
    }
    $('key-banner').classList.remove('show');
  });

  // ---------- settings ----------

  $('settings-toggle').addEventListener('click', () => {
    $('settings-card').classList.toggle('open');
  });

  $('save-prompt').addEventListener('click', async () => {
    await saveConfigPatch({ defaultPrompt: $('default-prompt').value });
    const toast = $('prompt-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  });

  $('model-select').addEventListener('change', e => saveConfigPatch({ model: e.target.value }));
  $('resolution-select').addEventListener('change', e => saveConfigPatch({ resolution: e.target.value }));
  $('concurrency-select').addEventListener('change', e => saveConfigPatch({ concurrency: Number(e.target.value) }));

  // ---------- batch fields (localStorage) ----------

  function defaultBatchName() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_retus`;
  }

  $('batch-name').value = localStorage.getItem('retus-batch') || defaultBatchName();
  $('refine-prompt').value = localStorage.getItem('retus-refine') || '';
  $('batch-name').addEventListener('input', e => localStorage.setItem('retus-batch', e.target.value));
  $('refine-prompt').addEventListener('input', e => localStorage.setItem('retus-refine', e.target.value));

  // ---------- file intake ----------

  const dropzone = $('dropzone');
  const fileInput = $('file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

  ['dragover', 'dragenter'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  async function addFiles(fileList) {
    for (const file of Array.from(fileList)) {
      if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) continue;
      const job = { id: nextId++, name: file.name, status: 'pending', attempts: 0, costUsd: null, card: null };
      jobs.push(job);
      try {
        const { dataURL, blobURL, width, height } = await preprocess(file);
        job.dataURL = dataURL;
        job.beforeURL = blobURL;
        job.aspectRatio = nearestRatio(width, height);
      } catch {
        job.status = 'error';
        job.error = 'Nelze dekódovat (HEIC funguje jen v Safari — použijte JPEG).';
      }
      renderThumbs();
    }
    updateStartRow();
  }

  async function preprocess(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file); // starší prohlížeče bez options
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob selhal')), 'image/jpeg', JPEG_QUALITY));
    const dataURL = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { dataURL, blobURL: URL.createObjectURL(blob), width: w, height: h };
  }

  function nearestRatio(w, h) {
    const r = w / h;
    let best = RATIOS[0];
    for (const cand of RATIOS) {
      if (Math.abs(cand.value - r) < Math.abs(best.value - r)) best = cand;
    }
    return best.key;
  }

  // ---------- thumbs strip ----------

  function renderThumbs() {
    const wrap = $('thumbs');
    wrap.innerHTML = '';
    for (const job of jobs) {
      const div = document.createElement('div');
      div.className = 'thumb' + (job.error && !job.beforeURL ? ' err' : '');
      div.title = job.error ? `${job.name} — ${job.error}` : job.name;
      if (job.beforeURL) {
        const img = document.createElement('img');
        img.src = job.beforeURL;
        div.appendChild(img);
      }
      if (!running) {
        const x = document.createElement('button');
        x.className = 'x';
        x.textContent = '×';
        x.addEventListener('click', e => {
          e.stopPropagation();
          jobs = jobs.filter(j => j !== job);
          if (job.beforeURL) URL.revokeObjectURL(job.beforeURL);
          renderThumbs();
          updateStartRow();
        });
        div.appendChild(x);
      }
      wrap.appendChild(div);
    }
  }

  function updateStartRow() {
    const usable = jobs.filter(j => j.dataURL);
    $('start-btn').disabled = running || usable.length === 0;
    $('file-count').textContent = jobs.length
      ? `${usable.length} fotek připraveno${jobs.length - usable.length ? ` · ${jobs.length - usable.length} s chybou` : ''}`
      : '';
    $('clear-btn').style.display = jobs.length && !running ? '' : 'none';
  }

  $('clear-btn').addEventListener('click', () => {
    for (const j of jobs) if (j.beforeURL) URL.revokeObjectURL(j.beforeURL);
    jobs = [];
    $('results').innerHTML = '';
    renderThumbs();
    updateStartRow();
  });

  // ---------- queue ----------

  $('start-btn').addEventListener('click', startBatch);

  function buildPrompt() {
    const base = $('default-prompt').value.trim();
    const refine = $('refine-prompt').value.trim();
    return refine ? `${base}\n\nAdditional instructions for this batch: ${refine}` : base;
  }

  async function startBatch() {
    if (running) return;
    if (!config.hasApiKey) {
      $('key-banner').classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    running = true;
    updateStartRow();
    renderThumbs();
    $('progress-card').classList.add('show');

    const prompt = buildPrompt();
    const batch = $('batch-name').value.trim() || defaultBatchName();
    const model = $('model-select').value;
    const resolution = $('resolution-select').value;
    const concurrency = Number($('concurrency-select').value) || 2;

    const queue = jobs.filter(j => j.dataURL && j.status !== 'done');
    for (const job of queue) {
      job.status = 'pending';
      job.error = null;
      job.attempts = 0;
      ensureCard(job);
    }
    updateProgress();

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker(queue, { prompt, batch, model, resolution }));
    await Promise.all(workers);

    running = false;
    updateStartRow();
    renderThumbs();
  }

  async function worker(queue, params) {
    while (true) {
      const job = queue.find(j => j.status === 'pending');
      if (!job) return;
      job.status = 'running';
      renderCard(job);
      await processJob(job, params);
      updateProgress();
    }
  }

  async function processJob(job, params) {
    while (true) {
      try {
        const res = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch: params.batch,
            filename: job.name,
            image: job.dataURL,
            prompt: params.prompt,
            model: params.model,
            resolution: params.resolution,
            aspectRatio: job.aspectRatio,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          job.status = 'done';
          job.afterURL = json.url;
          job.costUsd = json.costUsd;
          if (typeof json.costUsd === 'number') {
            totalCost += json.costUsd;
            $('cost-badge').textContent = `Celkem: $${totalCost.toFixed(2)}`;
          }
          renderCard(job);
          return;
        }
        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && job.attempts < 2) {
          job.attempts++;
          await sleep(job.attempts === 1 ? 3000 : 10000);
          continue;
        }
        job.status = 'error';
        job.error = json.error || `HTTP ${res.status}`;
        renderCard(job);
        return;
      } catch (err) {
        if (job.attempts < 2) {
          job.attempts++;
          await sleep(job.attempts === 1 ? 3000 : 10000);
          continue;
        }
        job.status = 'error';
        job.error = 'Síťová chyba — zkontrolujte připojení.';
        renderCard(job);
        return;
      }
    }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function updateProgress() {
    const active = jobs.filter(j => j.dataURL);
    const done = active.filter(j => j.status === 'done').length;
    const errors = active.filter(j => j.status === 'error').length;
    $('progress-fill').style.width = active.length ? `${((done + errors) / active.length) * 100}%` : '0%';
    $('progress-text').textContent = `Hotovo ${done} / ${active.length}` + (errors ? ` · chyb: ${errors}` : '');
    $('progress-cost').textContent = totalCost ? `Útrata dávky: $${totalCost.toFixed(2)}` : '';
  }

  // ---------- result cards ----------

  function ensureCard(job) {
    if (job.card) { renderCard(job); return; }
    const card = document.createElement('div');
    card.className = 'result-card';
    $('results').appendChild(card);
    job.card = card;
    renderCard(job);
  }

  function renderCard(job) {
    if (!job.card) return;
    const card = job.card;
    card.innerHTML = '';

    const compare = document.createElement('div');
    compare.className = 'compare';
    if (job.afterURL) {
      buildCompare(compare, job.beforeURL, job.afterURL);
      compare.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') openLightbox(job);
      });
    } else if (job.beforeURL) {
      const img = document.createElement('img');
      img.src = job.beforeURL;
      compare.appendChild(img);
    }
    card.appendChild(compare);

    const meta = document.createElement('div');
    meta.className = 'result-meta';

    const name = document.createElement('div');
    name.className = 'result-name';
    name.textContent = job.name;
    meta.appendChild(name);

    const row = document.createElement('div');
    row.className = 'result-row';
    const status = document.createElement('span');
    status.className = `status ${job.status}`;
    status.innerHTML = {
      pending: 'Čeká',
      running: '<span class="spinner"></span>Zpracovává se',
      done: 'Hotovo',
      error: 'Chyba',
    }[job.status];
    row.appendChild(status);
    if (typeof job.costUsd === 'number') {
      const cost = document.createElement('span');
      cost.className = 'result-cost';
      cost.textContent = `$${job.costUsd.toFixed(3)}`;
      row.appendChild(cost);
    }
    meta.appendChild(row);

    if (job.error) {
      const err = document.createElement('div');
      err.className = 'result-err';
      err.textContent = job.error;
      meta.appendChild(err);
    }

    const actions = document.createElement('div');
    actions.className = 'result-actions';
    if (job.status === 'done' && job.afterURL) {
      const a = document.createElement('a');
      a.href = job.afterURL;
      a.download = '';
      const btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.textContent = 'Stáhnout';
      a.appendChild(btn);
      actions.appendChild(a);
    }
    if (job.status === 'error' && job.dataURL) {
      const retry = document.createElement('button');
      retry.className = 'btn-sm';
      retry.textContent = 'Zkusit znovu';
      retry.addEventListener('click', async () => {
        job.attempts = 0;
        job.error = null;
        job.status = 'running';
        renderCard(job);
        await processJob(job, {
          prompt: buildPrompt(),
          batch: $('batch-name').value.trim() || defaultBatchName(),
          model: $('model-select').value,
          resolution: $('resolution-select').value,
        });
        updateProgress();
      });
      actions.appendChild(retry);
    }
    if (actions.children.length) meta.appendChild(actions);

    card.appendChild(meta);
  }

  // ---------- before/after slider ----------

  function buildCompare(container, beforeURL, afterURL) {
    container.innerHTML = '';

    const before = document.createElement('img');
    before.src = beforeURL;

    const after = document.createElement('img');
    after.src = afterURL;

    const divider = document.createElement('div');
    divider.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:var(--gold-light);left:50%;pointer-events:none;';

    const tagB = document.createElement('span');
    tagB.className = 'tag before';
    tagB.textContent = 'PŘED';
    const tagA = document.createElement('span');
    tagA.className = 'tag after';
    tagA.textContent = 'PO';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = '50';

    const apply = v => {
      after.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
      divider.style.left = `${v}%`;
    };
    range.addEventListener('input', () => apply(Number(range.value)));
    apply(50);

    container.append(before, after, divider, tagA, tagB, range);
  }

  // ---------- lightbox ----------

  function openLightbox(job) {
    buildCompare($('lightbox-compare'), job.beforeURL, job.afterURL);
    $('lightbox').classList.add('show');
  }
  $('lightbox-close').addEventListener('click', () => $('lightbox').classList.remove('show'));
  $('lightbox').addEventListener('click', e => {
    if (e.target === $('lightbox')) $('lightbox').classList.remove('show');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') $('lightbox').classList.remove('show');
  });

  // ---------- footer ----------

  $('open-folder').addEventListener('click', () => {
    fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: $('batch-name').value.trim() }),
    });
  });

  // ---------- guards ----------

  window.addEventListener('beforeunload', e => {
    if (running) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  loadConfig();
})();
