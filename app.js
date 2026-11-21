(() => {
  'use strict';

  // CRITICAL FIX: Always pass an ABSOLUTE URL to Vosk.createModel(), because vosk.js
  // spawns a blob: Web Worker where relative "./models/..." loses the "/suflyor-ais/" subpath!
  const ABS_MODEL_URL = new URL('./models/vosk-model-small-ru-0.22.tar.gz', window.location.href).href;
  const MODEL_CACHE = 'suflyor-ais-model-v2';
  const LS_TEXT = 'suflyor_text_v2';
  const LS_CFG = 'suflyor_cfg_v2';
  const LS_VOSK_READY = 'suflyor_vosk_ready_v2';

  const STOP_WORDS = new Set(['и', 'в', 'с', 'к', 'о', 'у', 'а', 'но', 'на', 'по', 'не', 'из', 'за', 'от', 'до', 'то', 'же', 'бы']);

  const DEMO_TEXT = [
    'Добрый день, уважаемые коллеги и друзья!',
    'Сегодня мы говорим о том, как технологии помогают людям с инвалидностью жить свободно и самостоятельно.',
    'Наш главный принцип прост: сначала реальная потребность человека, и только потом — код и алгоритмы.',
    'Когда связь пропадает или телефон в авиарежиме, инструменты должны продолжать работать надёжно и без сбоев.',
    'Спасибо за внимание! Буду рад ответить на ваши вопросы.'
  ].join('\n\n');

  const $ = (id) => document.getElementById(id);

  // Elements
  const editScreen = $('edit-screen');
  const stageScreen = $('stage-screen');
  const speechInput = $('speech-input');
  const textStats = $('text-stats');
  const fileInput = $('file-input');
  const demoBtn = $('demo-btn');
  const clearBtn = $('clear-btn');
  const startBtn = $('start-btn');
  const themeQuickBtn = $('theme-quick-btn');
  const metaThemeColor = $('meta-theme-color');

  const offlineStatusPill = $('offline-status-pill');
  const offlinePct = $('offline-pct');
  const offlineDesc = $('offline-desc');
  const downloadModelBtn = $('download-model-btn');
  const modelProgressFill = $('model-progress-fill');

  const backBtn = $('back-btn');
  const settingsBtn = $('settings-btn');
  const stageDot = $('stage-dot');
  const stageStatusText = $('stage-status-text');
  const stageScroll = $('stage-scroll');
  const stageText = $('stage-text');

  const waveBarsLeftEl = $('wave-bars-left');
  const waveBarsRightEl = $('wave-bars-right');
  const heardCaption = $('heard-caption');

  const metricWpm = $('metric-wpm');
  const metricPara = $('metric-para');
  const metricParaTotal = $('metric-para-total');
  const metricPct = $('metric-pct');

  const prevParaBtn = $('prev-para-btn');
  const nextParaBtn = $('next-para-btn');
  const voiceOrb = $('voice-orb');
  const orbDotsSvg = $('orb-dots-svg');
  const orbLabel = $('orb-label');

  const sheetBackdrop = $('sheet-backdrop');
  const settingsSheet = $('settings-sheet');
  const closeSheetBtn = $('close-sheet-btn');
  const modeSegmented = $('mode-segmented');
  const modeLabel = $('mode-label');
  const fontSizeSlider = $('font-size-slider');
  const fontSizeVal = $('font-size-val');
  const speedRow = $('speed-row');
  const speedSlider = $('speed-slider');
  const speedVal = $('speed-val');
  const toggleClean = $('toggle-clean');
  const toggleHeard = $('toggle-heard');
  const toggleMirror = $('toggle-mirror');
  const toggleTheme = $('toggle-theme');
  const resetPosBtn = $('reset-pos-btn');
  const toastEl = $('toast');

  // Config
  let cfg = {
    mode: 'vosk',       // 'vosk' | 'webspeech' | 'autoscroll'
    fontSize: 36,
    speed: 42,
    clean: false,
    showHeard: true,
    mirror: false,
    theme: 'sage'       // 'sage' (NeuFlx light editorial + sage stage) | 'dark'
  };

  try {
    const saved = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
    cfg = { ...cfg, ...saved };
  } catch (_) {}

  // State
  let words = [];       // { raw, norm, paraIdx, el }
  let paras = [];       // { el, startWordIdx, endWordIdx }
  let curWordIdx = 0;
  let isRunning = false;
  let wordAdvanceLog = []; // timestamps for live WPM

  // Audio & Vosk state
  let voskModel = null;
  let voskRecognizer = null;
  let voskSampleRate = 0;
  let audioCtx = null;
  let mediaStream = null;
  let sourceNode = null;
  let analyserNode = null;
  let processorNode = null;
  let silentGain = null;
  let waveRaf = null;

  // Web Speech & Autoscroll state
  let webRec = null;
  let scrollRaf = null;
  let lastFrameTs = 0;
  let wakeLock = null;

  // ===== BUILD RADIAL HALFTONE VOICE ORB SVG (NeuFlx signature) =====
  function buildHalftoneOrb() {
    const cx = 80;
    const cy = 80;
    const rings = [
      { r: 0,  n: 1,  dot: 3.1, op: 0.95 },
      { r: 12, n: 8,  dot: 2.8, op: 0.92 },
      { r: 24, n: 14, dot: 2.5, op: 0.82 },
      { r: 36, n: 20, dot: 2.1, op: 0.68 },
      { r: 48, n: 26, dot: 1.7, op: 0.48 },
      { r: 60, n: 32, dot: 1.3, op: 0.28 }
    ];
    let circles = '';
    rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const angle = (i / ring.n) * Math.PI * 2 + ri * 0.22;
        const x = (cx + Math.cos(angle) * ring.r).toFixed(1);
        const y = (cy + Math.sin(angle) * ring.r).toFixed(1);
        circles += `<circle cx="${x}" cy="${y}" r="${ring.dot}" fill="currentColor" opacity="${ring.op}"/>`;
      }
    });
    orbDotsSvg.innerHTML = circles;
  }

  // ===== BUILD EQUALIZER WAVEFORM BARS =====
  const leftBars = [];
  const rightBars = [];
  function buildWaveformBars() {
    const patternL = [6, 10, 14, 9, 20, 26, 14, 22, 30, 18, 12, 24, 16, 28, 20, 14, 26, 18];
    const patternR = [12, 8, 6, 10, 7, 5, 8, 6, 5, 7, 5, 4, 6, 4, 5, 4, 4, 4];
    patternL.forEach((h) => {
      const el = document.createElement('span');
      el.className = 'wbar';
      el.style.height = h + 'px';
      el.dataset.base = String(h);
      waveBarsLeftEl.appendChild(el);
      leftBars.push(el);
    });
    patternR.forEach((h) => {
      const el = document.createElement('span');
      el.className = 'wbar';
      el.style.height = h + 'px';
      el.dataset.base = String(h);
      waveBarsRightEl.appendChild(el);
      rightBars.push(el);
    });
  }

  // ===== TOAST =====
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function saveCfg() {
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) {}
  }

  // ===== RUSSIAN TEXT NORMALIZATION & FUZZY MATCHING =====
  function normWord(s) {
    return (s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]/gi, '');
  }

  function editDist1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diffs = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else {
        diffs++;
        if (diffs > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else { i++; j++; }
      }
    }
    return diffs + (a.length - i) + (b.length - j) <= 1;
  }

  function wordsMatch(scriptWord, spokenWord) {
    if (!scriptWord || !spokenWord) return false;
    if (scriptWord === spokenWord) return true;
    // Handle Russian inflections/endings for stems >= 4 chars
    if (scriptWord.length >= 5 && spokenWord.length >= 5) {
      const stemLen = Math.min(scriptWord.length, spokenWord.length) - 1;
      if (stemLen >= 4 && scriptWord.slice(0, stemLen) === spokenWord.slice(0, stemLen)) {
        return true;
      }
      if (editDist1(scriptWord, spokenWord)) return true;
    }
    return false;
  }

  // ===== APPLY SETTINGS & THEME =====
  function applyCfg() {
    document.documentElement.setAttribute('data-theme', cfg.theme);
    metaThemeColor.setAttribute('content', cfg.theme === 'dark' ? '#0f1412' : '#f6f7f6');
    document.documentElement.style.setProperty('--font-size', cfg.fontSize + 'px');

    fontSizeSlider.value = cfg.fontSize;
    fontSizeVal.textContent = cfg.fontSize + ' px';

    speedSlider.value = cfg.speed;
    speedVal.textContent = cfg.speed < 34 ? 'Медленно' : cfg.speed < 68 ? 'Средняя' : 'Быстро';
    speedRow.style.display = cfg.mode === 'autoscroll' ? 'flex' : 'none';

    const modeNames = {
      vosk: 'Офлайн-голос (Vosk)',
      webspeech: 'Браузер (онлайн)',
      autoscroll: 'Автоскролл'
    };
    modeLabel.textContent = modeNames[cfg.mode] || modeNames.vosk;
    modeSegmented.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === cfg.mode);
    });

    stageScreen.classList.toggle('stage-clean', cfg.clean);
    heardCaption.classList.toggle('hidden', !cfg.showHeard);
    stageScroll.classList.toggle('mirrored', cfg.mirror);

    toggleClean.classList.toggle('on', cfg.clean);
    toggleHeard.classList.toggle('on', cfg.showHeard);
    toggleMirror.classList.toggle('on', cfg.mirror);
    toggleTheme.classList.toggle('on', cfg.theme === 'dark');

    updateOrbLabel();
  }

  function updateOrbLabel() {
    if (isRunning) {
      orbLabel.textContent = cfg.mode === 'autoscroll' ? 'Идёт прокрутка' : 'Слушаю · пауза';
    } else {
      orbLabel.textContent = cfg.mode === 'autoscroll' ? 'Старт прокрутки' : 'Нажми и говори';
    }
  }

  // ===== EDITOR =====
  function updateEditorStats() {
    const val = speechInput.value.trim();
    if (!val) {
      textStats.textContent = '0 абз. · 0 слов';
      return;
    }
    const pCount = val.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const wCount = val.split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(wCount / 120));
    textStats.textContent = `${pCount} абз. · ${wCount} слов · ~${mins} мин`;
  }

  speechInput.value = localStorage.getItem(LS_TEXT) || DEMO_TEXT;
  updateEditorStats();

  speechInput.addEventListener('input', () => {
    try { localStorage.setItem(LS_TEXT, speechInput.value); } catch (_) {}
    updateEditorStats();
  });

  demoBtn.addEventListener('click', () => {
    speechInput.value = DEMO_TEXT;
    try { localStorage.setItem(LS_TEXT, DEMO_TEXT); } catch (_) {}
    updateEditorStats();
    showToast('Загружен пример выступления');
  });

  clearBtn.addEventListener('click', () => {
    speechInput.value = '';
    try { localStorage.setItem(LS_TEXT, ''); } catch (_) {}
    updateEditorStats();
    speechInput.focus();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    speechInput.value = text;
    try { localStorage.setItem(LS_TEXT, text); } catch (_) {}
    updateEditorStats();
    showToast('Текст загружен из файла');
  });

  themeQuickBtn.addEventListener('click', () => {
    cfg.theme = cfg.theme === 'dark' ? 'sage' : 'dark';
    saveCfg();
    applyCfg();
  });

  // ===== STAGE BUILD & HIGHLIGHT =====
  function buildStage(text) {
    stageText.innerHTML = '';
    words = [];
    paras = [];
    wordAdvanceLog = [];
    metricWpm.textContent = '0';

    const rawParas = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    rawParas.forEach((pText, pIdx) => {
      const pEl = document.createElement('p');
      pEl.className = 'para';
      pEl.dataset.para = String(pIdx);

      const startWordIdx = words.length;
      const lines = pText.split(/\n/);

      lines.forEach((line, lIdx) => {
        const tokens = line.trim().split(/\s+/).filter(Boolean);
        tokens.forEach((tok, tIdx) => {
          const wIdx = words.length;
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = tok;
          span.dataset.idx = String(wIdx);
          span.addEventListener('click', () => highlightWord(wIdx, true, false));
          pEl.appendChild(span);
          if (tIdx < tokens.length - 1) pEl.appendChild(document.createTextNode(' '));
          words.push({ raw: tok, norm: normWord(tok), paraIdx: pIdx, el: span });
        });
        if (lIdx < lines.length - 1) pEl.appendChild(document.createElement('br'));
      });

      const endWordIdx = words.length - 1;
      stageText.appendChild(pEl);
      paras.push({ el: pEl, startWordIdx, endWordIdx });
    });

    metricParaTotal.textContent = `/ ${paras.length}`;
    curWordIdx = 0;
    highlightWord(0, false, false);
  }

  function highlightWord(idx, smooth = true, trackTempo = false) {
    if (!words.length) return;
    const prevIdx = curWordIdx;
    const clamped = Math.max(0, Math.min(idx, words.length - 1));
    curWordIdx = clamped;

    if (trackTempo && clamped > prevIdx) {
      const now = Date.now();
      const delta = Math.min(clamped - prevIdx, 6);
      for (let k = 0; k < delta; k++) wordAdvanceLog.push(now);
      wordAdvanceLog = wordAdvanceLog.filter((t) => now - t <= 20000);
      if (wordAdvanceLog.length >= 2) {
        const spanSec = Math.max(3, (now - wordAdvanceLog[0]) / 1000);
        const wpm = Math.round((wordAdvanceLog.length / spanSec) * 60);
        metricWpm.textContent = String(Math.min(260, wpm));
      }
    }

    for (let i = 0; i < words.length; i++) {
      const el = words[i].el;
      el.classList.toggle('done', i < clamped);
      el.classList.toggle('cur', i === clamped);
    }

    const activeParaIdx = words[clamped].paraIdx;
    paras.forEach((p, idxP) => {
      p.el.classList.toggle('done-para', idxP < activeParaIdx);
    });

    const pct = words.length > 1 ? Math.round((clamped / (words.length - 1)) * 100) : 100;
    metricPara.textContent = String(activeParaIdx + 1);
    metricPct.textContent = String(pct);

    const statusPrefix = isRunning ? (cfg.mode === 'autoscroll' ? 'Автоскролл' : 'Слушаю') : 'Готов';
    stageStatusText.textContent = `${statusPrefix} · ${activeParaIdx + 1} из ${paras.length}`;

    // Scroll active word comfortably to ~28% of reading area
    const curEl = words[clamped].el;
    const containerRect = stageScroll.getBoundingClientRect();
    const elRect = curEl.getBoundingClientRect();
    const targetTop = stageScroll.scrollTop + (elRect.top - containerRect.top) - containerRect.height * 0.28;
    stageScroll.scrollTo({
      top: Math.max(0, targetTop),
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function stepParagraph(delta) {
    if (!paras.length) return;
    const currentPara = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    const targetPara = Math.max(0, Math.min(paras.length - 1, currentPara + delta));
    highlightWord(paras[targetPara].startWordIdx, true, false);
  }

  // ===== MATCH SPOKEN TRANSCRIPT TO SCRIPT =====
  function matchSpoken(transcript) {
    if (!transcript || !words.length) return;
    const spoken = transcript.trim().split(/\s+/).map(normWord).filter(Boolean);
    if (!spoken.length) return;

    const tail = spoken.slice(-4);
    const maxLookahead = Math.min(words.length - 1, curWordIdx + 22);

    // 1. Two consecutive words match (strongest signal, allows skipping up to 22 words)
    if (tail.length >= 2) {
      const wA = tail[tail.length - 2];
      const wB = tail[tail.length - 1];
      for (let i = curWordIdx; i < maxLookahead; i++) {
        if (wordsMatch(words[i].norm, wA) && wordsMatch(words[i + 1].norm, wB)) {
          if (i + 1 > curWordIdx) {
            highlightWord(i + 1, true, true);
            return;
          }
        }
      }
    }

    // 2. Single word match:
    //    - Near window (+1..+3): any word
    //    - Further window (+4..+12): only non-stop-words length >= 4
    const lastSpoken = tail[tail.length - 1];
    if (!lastSpoken) return;
    const isMeaningful = lastSpoken.length >= 4 && !STOP_WORDS.has(lastSpoken);
    const singleLimit = Math.min(words.length - 1, curWordIdx + (isMeaningful ? 12 : 3));

    for (let i = curWordIdx + 1; i <= singleLimit; i++) {
      if (wordsMatch(words[i].norm, lastSpoken)) {
        highlightWord(i, true, true);
        return;
      }
    }
  }

  // ===== OFFLINE MODEL DOWNLOAD + REAL IDBFS UNPACK =====
  function setHeroProgress(pct, pillText, descText, isReady = false) {
    offlinePct.textContent = `${pct}%`;
    modelProgressFill.style.width = `${pct}%`;
    offlineStatusPill.textContent = pillText;
    offlineStatusPill.classList.toggle('ready', isReady);
    offlineDesc.textContent = descText;
  }

  async function initVoskModel() {
    if (voskModel && voskModel.ready) return voskModel;
    if (typeof Vosk === 'undefined') {
      throw new Error('Библиотека vosk.js не загружена');
    }
    voskModel = await Vosk.createModel(ABS_MODEL_URL);
    if (!voskModel || !voskModel.ready) {
      throw new Error('Модель Vosk не перешла в состояние ready');
    }
    try { localStorage.setItem(LS_VOSK_READY, ABS_MODEL_URL); } catch (_) {}
    return voskModel;
  }

  async function refreshModelBadge() {
    const unpacked = localStorage.getItem(LS_VOSK_READY) === ABS_MODEL_URL;
    if (unpacked) {
      setHeroProgress(
        100,
        'Готово к авиарежиму',
        'Русская модель распакована в память телефона — работает полностью без интернета.',
        true
      );
      downloadModelBtn.innerHTML = '<span>Готово ✓</span>';
      downloadModelBtn.disabled = true;
    } else {
      setHeroProgress(
        0,
        'Не загружен',
        'Нажми по Wi-Fi один раз — скачает и распакует русскую модель (~44 МБ) в память телефона.',
        false
      );
      downloadModelBtn.disabled = false;
    }
  }

  async function prepareOfflineModel() {
    downloadModelBtn.disabled = true;
    downloadModelBtn.innerHTML = '<span>Загрузка…</span>';
    setHeroProgress(4, 'Скачивание…', 'Загружаю архив русской модели речи (44 МБ)…', false);

    try {
      // Step 1: Stream download with real progress into Cache API
      const resp = await fetch(ABS_MODEL_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const total = Number(resp.headers.get('content-length')) || 45500000;
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const pct = Math.min(80, Math.max(5, Math.round((received / total) * 80)));
        const mb = (received / 1048576).toFixed(1);
        setHeroProgress(pct, `${mb} МБ`, 'Сохраняю модель в локальный кеш…', false);
      }

      if ('caches' in window) {
        const blob = new Blob(chunks, { type: 'application/gzip' });
        const cache = await caches.open(MODEL_CACHE);
        await cache.put(ABS_MODEL_URL, new Response(blob, {
          headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(blob.size) }
        }));
      }

      // Step 2: Actually unpack into Vosk's persistent IDBFS right now while online!
      setHeroProgress(88, 'Распаковка…', 'Распаковываю модель в IndexedDB для мгновенного запуска в авиарежиме…', false);
      await initVoskModel();

      await refreshModelBadge();
      showToast('Офлайн-модель готова к авиарежиму');
      return true;
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'Сбой загрузки';
      setHeroProgress(0, 'Ошибка', `Не удалось подготовить модель: ${msg}`, false);
      downloadModelBtn.innerHTML = '<span>Повторить</span>';
      downloadModelBtn.disabled = false;
      showToast('Ошибка: ' + msg);
      return false;
    }
  }

  downloadModelBtn.addEventListener('click', prepareOfflineModel);

  // Expose tiny verification hook for automated health check
  window.__suflyorDebug = {
    absModelUrl: ABS_MODEL_URL,
    initVoskModel,
    getState: () => ({
      curWordIdx,
      wordsCount: words.length,
      parasCount: paras.length,
      voskReady: Boolean(voskModel && voskModel.ready)
    })
  };

  // ===== WAKE LOCK =====
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isRunning) requestWakeLock();
  });

  // ===== LIVE EQUALIZER WAVEFORM =====
  function startWaveLoop() {
    if (!analyserNode) return;
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    const draw = () => {
      if (!isRunning || !analyserNode) return;
      analyserNode.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = sum / data.length / 255;

      leftBars.forEach((bar, i) => {
        const v = data[(i * 2) % data.length] || 0;
        const h = Math.max(4, Math.min(34, 5 + (v / 255) * 30));
        bar.style.height = h + 'px';
      });
      rightBars.forEach((bar, i) => {
        const base = Number(bar.dataset.base);
        const h = Math.max(4, Math.min(18, base + level * 8));
        bar.style.height = h + 'px';
      });
      waveRaf = requestAnimationFrame(draw);
    };
    waveRaf = requestAnimationFrame(draw);
  }

  function resetWave() {
    cancelAnimationFrame(waveRaf);
    leftBars.forEach((b) => { b.style.height = b.dataset.base + 'px'; });
    rightBars.forEach((b) => { b.style.height = b.dataset.base + 'px'; });
  }

  // ===== VOICE / SCROLL ENGINES =====
  async function startVosk() {
    stageDot.className = 'status-dot loading';
    heardCaption.textContent = 'Инициализирую офлайн-модель речи…';

    // Create AudioContext INSIDE user gesture first (critical for iOS Safari / Android Chrome!)
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    const actualSampleRate = audioCtx.sampleRate;

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });

    await initVoskModel();

    if (!voskRecognizer || voskSampleRate !== actualSampleRate) {
      if (voskRecognizer) {
        try { voskRecognizer.remove(); } catch (_) {}
      }
      voskSampleRate = actualSampleRate;
      voskRecognizer = new voskModel.KaldiRecognizer(actualSampleRate);
      voskRecognizer.setWords(true);
      voskRecognizer.on('partialresult', (msg) => {
        const p = msg && msg.result && msg.result.partial;
        if (p) {
          heardCaption.textContent = `«${p}»`;
          matchSpoken(p);
        }
      });
      voskRecognizer.on('result', (msg) => {
        const t = msg && msg.result && msg.result.text;
        if (t) {
          heardCaption.textContent = `«${t}»`;
          matchSpoken(t);
        }
      });
    }

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 128;

    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (ev) => {
      if (!isRunning || !voskRecognizer) return;
      try {
        voskRecognizer.acceptWaveform(ev.inputBuffer);
      } catch (_) {}
    };

    // Route through silent GainNode(0) so onaudioprocess ALWAYS fires with ZERO speaker feedback!
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    sourceNode.connect(analyserNode);
    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    startWaveLoop();
    stageDot.className = 'status-dot listening';
    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Слушаю · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Слушаю офлайн — начинай говорить';
  }

  function startWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('Онлайн-распознавание не поддерживается этим браузером');
    webRec = new SR();
    webRec.lang = 'ru-RU';
    webRec.continuous = true;
    webRec.interimResults = true;

    webRec.onresult = (event) => {
      let text = '';
      for (let i = Math.max(0, event.resultIndex - 1); i < event.results.length; i++) {
        text += ' ' + event.results[i][0].transcript;
      }
      text = text.trim();
      if (text) {
        heardCaption.textContent = `«${text}»`;
        matchSpoken(text);
      }
    };

    webRec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        showToast('Нет доступа к микрофону');
        stopEngine();
      }
    };

    webRec.onend = () => {
      if (isRunning && cfg.mode === 'webspeech') {
        try { webRec.start(); } catch (_) {}
      }
    };

    webRec.start();
    stageDot.className = 'status-dot listening';
    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Слушаю · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Слушаю через браузер — начинай говорить';
  }

  function startAutoscroll() {
    stageDot.className = 'status-dot ready';
    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Автоскролл · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Плавная прокрутка · нажми на сферу для паузы';
    lastFrameTs = performance.now();

    const step = (ts) => {
      if (!isRunning || cfg.mode !== 'autoscroll') return;
      const dt = Math.min(0.1, (ts - lastFrameTs) / 1000);
      lastFrameTs = ts;
      stageScroll.scrollTop += cfg.speed * dt;
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }

  async function startEngine() {
    if (isRunning) return;
    isRunning = true;
    voiceOrb.classList.toggle('listening', cfg.mode !== 'autoscroll');
    voiceOrb.classList.toggle('autoscroll', cfg.mode === 'autoscroll');
    updateOrbLabel();
    await requestWakeLock();

    try {
      if (cfg.mode === 'vosk') await startVosk();
      else if (cfg.mode === 'webspeech') startWebSpeech();
      else startAutoscroll();
    } catch (err) {
      stopEngine();
      stageDot.className = 'status-dot error';
      const msg = (err && err.message) ? err.message : 'Нет доступа к микрофону';
      heardCaption.textContent = `${msg} — используй свайп или Автоскролл`;
      showToast(msg);
    }
  }

  function stopEngine() {
    isRunning = false;
    voiceOrb.classList.remove('listening', 'autoscroll');
    stageDot.className = 'status-dot';
    updateOrbLabel();

    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Пауза · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Пауза · свайпай абзацы или нажми на сферу';

    cancelAnimationFrame(scrollRaf);
    resetWave();
    releaseWakeLock();

    if (webRec) {
      try { webRec.onend = null; webRec.stop(); } catch (_) {}
      webRec = null;
    }
    [processorNode, silentGain, analyserNode, sourceNode].forEach((n) => {
      if (n) { try { n.disconnect(); } catch (_) {} }
    });
    processorNode = silentGain = analyserNode = sourceNode = null;

    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
      audioCtx = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  }

  voiceOrb.addEventListener('click', () => {
    if (isRunning) stopEngine();
    else startEngine();
  });

  // ===== SCREEN TRANSITIONS =====
  startBtn.addEventListener('click', () => {
    const text = speechInput.value.trim();
    if (!text) {
      showToast('Сначала вставь текст выступления');
      speechInput.focus();
      return;
    }
    buildStage(text);
    editScreen.classList.remove('active');
    stageScreen.classList.add('active');
  });

  backBtn.addEventListener('click', () => {
    stopEngine();
    stageScreen.classList.remove('active');
    editScreen.classList.add('active');
  });

  // ===== PARAGRAPH NAVIGATION & SWIPES =====
  prevParaBtn.addEventListener('click', () => stepParagraph(-1));
  nextParaBtn.addEventListener('click', () => stepParagraph(1));

  let touchStartX = 0;
  let touchStartY = 0;
  stageScroll.addEventListener('touchstart', (e) => {
    if (!e.touches.length) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  stageScroll.addEventListener('touchend', (e) => {
    if (!e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      if (dx < 0) stepParagraph(1);
      else stepParagraph(-1);
    }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!stageScreen.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') stepParagraph(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') stepParagraph(-1);
    if (e.key === ' ') {
      e.preventDefault();
      if (isRunning) stopEngine(); else startEngine();
    }
  });

  // ===== SETTINGS SHEET =====
  function openSheet() {
    sheetBackdrop.classList.add('open');
    settingsSheet.classList.add('open');
  }

  function closeSheet() {
    sheetBackdrop.classList.remove('open');
    settingsSheet.classList.remove('open');
  }

  settingsBtn.addEventListener('click', openSheet);
  closeSheetBtn.addEventListener('click', closeSheet);
  sheetBackdrop.addEventListener('click', closeSheet);

  modeSegmented.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const wasRunning = isRunning;
    if (wasRunning) stopEngine();
    cfg.mode = btn.dataset.mode;
    saveCfg();
    applyCfg();
    if (wasRunning) startEngine();
  });

  fontSizeSlider.addEventListener('input', () => {
    cfg.fontSize = Number(fontSizeSlider.value);
    saveCfg();
    applyCfg();
  });

  speedSlider.addEventListener('input', () => {
    cfg.speed = Number(speedSlider.value);
    saveCfg();
    applyCfg();
  });

  toggleClean.addEventListener('click', () => { cfg.clean = !cfg.clean; saveCfg(); applyCfg(); });
  toggleHeard.addEventListener('click', () => { cfg.showHeard = !cfg.showHeard; saveCfg(); applyCfg(); });
  toggleMirror.addEventListener('click', () => { cfg.mirror = !cfg.mirror; saveCfg(); applyCfg(); });
  toggleTheme.addEventListener('click', () => {
    cfg.theme = cfg.theme === 'dark' ? 'sage' : 'dark';
    saveCfg();
    applyCfg();
  });

  resetPosBtn.addEventListener('click', () => {
    highlightWord(0, true, false);
    closeSheet();
  });

  // ===== INIT =====
  buildHalftoneOrb();
  buildWaveformBars();
  applyCfg();
  refreshModelBadge();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
