(() => {
  'use strict';

  const MODEL_URL = './models/vosk-model-small-ru-0.22.tar.gz';
  const MODEL_CACHE = 'suflyor-ais-model-v1';
  const LS_TEXT = 'suflyor_text_v1';
  const LS_CFG = 'suflyor_cfg_v1';

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

  const offlineDot = $('offline-dot');
  const offlineTitle = $('offline-title');
  const offlineDesc = $('offline-desc');
  const downloadModelBtn = $('download-model-btn');
  const modelProgressTrack = $('model-progress-track');
  const modelProgressFill = $('model-progress-fill');

  const backBtn = $('back-btn');
  const settingsBtn = $('settings-btn');
  const paraCounter = $('para-counter');
  const stageDot = $('stage-dot');
  const topProgressFill = $('top-progress-fill');
  const stageScroll = $('stage-scroll');
  const stageText = $('stage-text');
  const heardStrip = $('heard-strip');
  const heardText = $('heard-text');
  const waveBars = Array.from(document.querySelectorAll('.wave-bar'));

  const prevParaBtn = $('prev-para-btn');
  const nextParaBtn = $('next-para-btn');
  const voiceOrb = $('voice-orb');

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
    speed: 45,          // px/sec for autoscroll
    clean: false,
    showHeard: true,
    mirror: false,
    theme: 'dark'
  };

  try {
    const savedCfg = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
    cfg = { ...cfg, ...savedCfg };
  } catch (_) {}

  // State
  let words = [];        // { raw, norm, paraIdx, el }
  let paras = [];        // { el, startWordIdx, endWordIdx }
  let curWordIdx = 0;
  let isRunning = false;

  // Vosk state
  let voskModel = null;
  let voskRecognizer = null;
  let audioCtx = null;
  let mediaStream = null;
  let processorNode = null;
  let sourceNode = null;
  let analyserNode = null;
  let waveRaf = null;

  // Web Speech state
  let webRec = null;

  // Autoscroll state
  let scrollRaf = null;
  let lastFrameTs = 0;

  // Wake Lock
  let wakeLock = null;

  // Toast helper
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function saveCfg() {
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) {}
  }

  // ===== NORMALIZE RUSSIAN WORDS =====
  function normWord(s) {
    return (s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]/gi, '');
  }

  function wordsSimilar(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4) {
      if (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))) return true;
    }
    return false;
  }

  // ===== APPLY SETTINGS & THEME =====
  function applyCfg() {
    document.documentElement.setAttribute('data-theme', cfg.theme);
    document.documentElement.style.setProperty('--font-size', cfg.fontSize + 'px');
    fontSizeSlider.value = cfg.fontSize;
    fontSizeVal.textContent = cfg.fontSize + ' px';

    speedSlider.value = cfg.speed;
    speedVal.textContent = cfg.speed < 35 ? 'Медленно' : cfg.speed < 70 ? 'Средняя' : 'Быстро';
    speedRow.style.display = cfg.mode === 'autoscroll' ? 'flex' : 'none';

    const modeNames = {
      vosk: 'Офлайн-голос',
      webspeech: 'Браузер (онлайн)',
      autoscroll: 'Автоскролл'
    };
    modeLabel.textContent = modeNames[cfg.mode] || 'Офлайн-голос';
    modeSegmented.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === cfg.mode);
    });

    stageScreen.classList.toggle('stage-screen-clean', cfg.clean);
    heardStrip.classList.toggle('hidden', !cfg.showHeard);
    stageScroll.classList.toggle('mirrored', cfg.mirror);

    setTile(toggleClean, cfg.clean);
    setTile(toggleHeard, cfg.showHeard);
    setTile(toggleMirror, cfg.mirror);
    setTile(toggleTheme, cfg.theme === 'light');
  }

  function setTile(el, on) {
    el.classList.toggle('on', on);
    el.lastElementChild.textContent = on ? '●' : '○';
  }

  // ===== EDITOR LOGIC =====
  function updateEditorStats() {
    const val = speechInput.value.trim();
    if (!val) {
      textStats.textContent = '0 абзацев · 0 слов';
      return;
    }
    const pCount = val.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const wCount = val.split(/\s+/).filter(Boolean).length;
    textStats.textContent = `${pCount} абз. · ${wCount} слов`;
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
    cfg.theme = cfg.theme === 'dark' ? 'light' : 'dark';
    saveCfg();
    applyCfg();
  });

  // ===== BUILD STAGE PARAGRAPHS & WORDS =====
  function buildStage(text) {
    stageText.innerHTML = '';
    words = [];
    paras = [];

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
          span.addEventListener('click', () => {
            jumpToWord(wIdx, true);
          });
          pEl.appendChild(span);
          if (tIdx < tokens.length - 1) {
            pEl.appendChild(document.createTextNode(' '));
          }
          words.push({
            raw: tok,
            norm: normWord(tok),
            paraIdx: pIdx,
            el: span
          });
        });
        if (lIdx < lines.length - 1) {
          pEl.appendChild(document.createElement('br'));
        }
      });

      const endWordIdx = words.length - 1;
      stageText.appendChild(pEl);
      paras.push({ el: pEl, startWordIdx, endWordIdx });
    });

    curWordIdx = 0;
    highlightWord(0, false);
  }

  function highlightWord(idx, smooth = true) {
    if (!words.length) return;
    const clamped = Math.max(0, Math.min(idx, words.length - 1));
    curWordIdx = clamped;

    for (let i = 0; i < words.length; i++) {
      const el = words[i].el;
      el.classList.toggle('done', i < clamped);
      el.classList.toggle('cur', i === clamped);
    }

    const activeParaIdx = words[clamped].paraIdx;
    paras.forEach((p, idxP) => {
      p.el.classList.toggle('active-para', idxP === activeParaIdx);
      p.el.classList.toggle('done-para', idxP < activeParaIdx);
    });

    paraCounter.textContent = `${activeParaIdx + 1} / ${paras.length}`;
    const pct = words.length > 1 ? Math.round((clamped / (words.length - 1)) * 100) : 100;
    topProgressFill.style.width = pct + '%';

    // Scroll active word to ~30% from top of viewport
    const curEl = words[clamped].el;
    const containerRect = stageScroll.getBoundingClientRect();
    const elRect = curEl.getBoundingClientRect();
    const targetTop = stageScroll.scrollTop + (elRect.top - containerRect.top) - containerRect.height * 0.30;
    stageScroll.scrollTo({
      top: Math.max(0, targetTop),
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function jumpToWord(idx, smooth = true) {
    highlightWord(idx, smooth);
  }

  function stepParagraph(delta) {
    if (!paras.length) return;
    const currentPara = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    const targetPara = Math.max(0, Math.min(paras.length - 1, currentPara + delta));
    jumpToWord(paras[targetPara].startWordIdx, true);
  }

  // ===== MATCH SPOKEN PHRASE TO SCRIPT =====
  function matchSpoken(transcript) {
    if (!transcript || !words.length) return;
    const spoken = transcript.trim().split(/\s+/).map(normWord).filter(Boolean);
    if (!spoken.length) return;

    const tail = spoken.slice(-4);
    const windowStart = Math.max(0, curWordIdx - 2);
    const windowEnd = Math.min(words.length - 1, curWordIdx + 28);

    // Try 2-word match first for higher accuracy
    if (tail.length >= 2) {
      const wA = tail[tail.length - 2];
      const wB = tail[tail.length - 1];
      for (let i = windowStart; i < windowEnd; i++) {
        if (wordsSimilar(words[i].norm, wA) && wordsSimilar(words[i + 1].norm, wB)) {
          if (i + 1 > curWordIdx) {
            highlightWord(i + 1, true);
            return;
          }
        }
      }
    }

    // Fallback: single last meaningful word (>= 3 chars, or any if short)
    const lastSpoken = tail[tail.length - 1];
    if (!lastSpoken) return;
    for (let i = curWordIdx; i <= windowEnd; i++) {
      if (wordsSimilar(words[i].norm, lastSpoken)) {
        if (i > curWordIdx) {
          highlightWord(i, true);
          return;
        }
      }
    }
  }

  // ===== OFFLINE MODEL DOWNLOAD & CACHE =====
  async function checkModelCached() {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open(MODEL_CACHE);
      const match = await cache.match(MODEL_URL);
      return Boolean(match);
    } catch (_) {
      return false;
    }
  }

  async function refreshModelBadge() {
    const cached = await checkModelCached();
    if (cached) {
      offlineDot.className = 'status-dot ready';
      offlineTitle.textContent = 'Модель готова к авиарежиму';
      offlineDesc.textContent = 'Русская речь сохранена в памяти телефона';
      downloadModelBtn.textContent = 'Готово ✓';
      downloadModelBtn.disabled = true;
    } else {
      offlineDot.className = 'status-dot';
      offlineTitle.textContent = 'Офлайн-модель речи (RU)';
      offlineDesc.textContent = 'Нажми «Скачать» по Wi-Fi перед авиарежимом (~45 МБ)';
      downloadModelBtn.textContent = 'Скачать';
      downloadModelBtn.disabled = false;
    }
  }

  async function downloadModelToCache() {
    if (!('caches' in window)) {
      showToast('Кеширование недоступно в этом браузере');
      return false;
    }
    downloadModelBtn.disabled = true;
    downloadModelBtn.textContent = 'Качаю…';
    offlineDot.className = 'status-dot loading';
    modelProgressTrack.classList.add('visible');
    modelProgressFill.style.width = '5%';

    try {
      const resp = await fetch(MODEL_URL);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const total = Number(resp.headers.get('content-length')) || 45000000;
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const pct = Math.min(99, Math.round((received / total) * 100));
        modelProgressFill.style.width = pct + '%';
        offlineDesc.textContent = `Загружено ${Math.round(received / 1048576)} МБ (${pct}%)`;
      }

      const blob = new Blob(chunks, { type: 'application/gzip' });
      const cache = await caches.open(MODEL_CACHE);
      await cache.put(MODEL_URL, new Response(blob, {
        headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(blob.size) }
      }));

      modelProgressFill.style.width = '100%';
      setTimeout(() => modelProgressTrack.classList.remove('visible'), 700);
      await refreshModelBadge();
      showToast('Модель сохранена для авиарежима');
      return true;
    } catch (err) {
      offlineDot.className = 'status-dot error';
      offlineDesc.textContent = 'Не удалось скачать. Проверь интернет и повтори.';
      downloadModelBtn.textContent = 'Повторить';
      downloadModelBtn.disabled = false;
      modelProgressTrack.classList.remove('visible');
      return false;
    }
  }

  downloadModelBtn.addEventListener('click', downloadModelToCache);

  // ===== WAKE LOCK =====
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // ===== WAVEFORM ANIMATION =====
  function startWaveLoop() {
    if (!analyserNode) return;
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    const draw = () => {
      if (!isRunning || !analyserNode) return;
      analyserNode.getByteFrequencyData(data);
      const step = Math.floor(data.length / waveBars.length);
      waveBars.forEach((bar, i) => {
        const v = data[i * step] || 0;
        const h = Math.max(4, Math.min(18, 4 + (v / 255) * 16));
        bar.style.height = h + 'px';
      });
      waveRaf = requestAnimationFrame(draw);
    };
    waveRaf = requestAnimationFrame(draw);
  }

  function resetWave() {
    cancelAnimationFrame(waveRaf);
    waveBars.forEach((b) => { b.style.height = '4px'; });
  }

  // ===== START / STOP ENGINE =====
  async function startVosk() {
    if (typeof Vosk === 'undefined') {
      throw new Error('Библиотека vosk.js не загрузилась');
    }
    stageDot.className = 'status-dot loading';
    heardText.textContent = 'Загружаю офлайн-модель…';

    // Ensure cached if online
    const cached = await checkModelCached();
    if (!cached && navigator.onLine) {
      await downloadModelToCache();
    }

    if (!voskModel) {
      voskModel = await Vosk.createModel(MODEL_URL);
    }

    if (!voskRecognizer) {
      voskRecognizer = new voskModel.KaldiRecognizer(16000);
      voskRecognizer.setWords(true);
      voskRecognizer.on('partialresult', (msg) => {
        const p = msg && msg.result && msg.result.partial;
        if (p) {
          heardText.textContent = p;
          matchSpoken(p);
        }
      });
      voskRecognizer.on('result', (msg) => {
        const t = msg && msg.result && msg.result.text;
        if (t) {
          heardText.textContent = t;
          matchSpoken(t);
        }
      });
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1
      },
      video: false
    });

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC({ sampleRate: 16000 });
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;

    // ScriptProcessor is still the broadest mobile-compatible PCM tap (iOS Safari + Android Chrome)
    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (ev) => {
      if (!isRunning || !voskRecognizer) return;
      try {
        voskRecognizer.acceptWaveform(ev.inputBuffer);
      } catch (_) {}
    };

    sourceNode.connect(analyserNode);
    sourceNode.connect(processorNode);
    processorNode.connect(audioCtx.destination);

    startWaveLoop();
    stageDot.className = 'status-dot listening';
    heardText.textContent = 'Слушаю (офлайн)… говорите';
  }

  function startWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error('Браузерное распознавание здесь не поддерживается');
    }
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
        heardText.textContent = text;
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
    heardText.textContent = 'Слушаю (браузер)… говорите';
  }

  function startAutoscroll() {
    stageDot.className = 'status-dot ready';
    heardText.textContent = 'Автоскролл включён · тап по кругу = пауза';
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
    voiceOrb.textContent = '⏸';
    await requestWakeLock();

    try {
      if (cfg.mode === 'vosk') {
        await startVosk();
      } else if (cfg.mode === 'webspeech') {
        startWebSpeech();
      } else {
        startAutoscroll();
      }
    } catch (err) {
      isRunning = false;
      voiceOrb.classList.remove('listening', 'autoscroll');
      voiceOrb.textContent = '🎙';
      stageDot.className = 'status-dot error';
      const msg = (err && err.message) ? err.message : 'Ошибка микрофона';
      heardText.textContent = msg + ' — используй свайп или Автоскролл';
      showToast(msg);
    }
  }

  function stopEngine() {
    isRunning = false;
    voiceOrb.classList.remove('listening', 'autoscroll');
    voiceOrb.textContent = cfg.mode === 'autoscroll' ? '▶' : '🎙';
    stageDot.className = 'status-dot';
    heardText.textContent = 'Пауза · свайпай или нажми на круг';

    cancelAnimationFrame(scrollRaf);
    resetWave();
    releaseWakeLock();

    if (webRec) {
      try { webRec.onend = null; webRec.stop(); } catch (_) {}
      webRec = null;
    }

    if (processorNode) {
      try { processorNode.disconnect(); } catch (_) {}
      processorNode = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (_) {}
      sourceNode = null;
    }
    if (analyserNode) {
      try { analyserNode.disconnect(); } catch (_) {}
      analyserNode = null;
    }
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
    voiceOrb.textContent = cfg.mode === 'autoscroll' ? '▶' : '🎙';
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
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) stepParagraph(1);
      else stepParagraph(-1);
    }
  }, { passive: true });

  // Keyboard support for quick testing on Mac
  document.addEventListener('keydown', (e) => {
    if (!stageScreen.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') stepParagraph(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') stepParagraph(-1);
    if (e.key === ' ') {
      e.preventDefault();
      if (isRunning) stopEngine(); else startEngine();
    }
  });

  // ===== SETTINGS BOTTOM SHEET =====
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
    voiceOrb.textContent = cfg.mode === 'autoscroll' ? '▶' : '🎙';
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

  toggleClean.addEventListener('click', () => {
    cfg.clean = !cfg.clean;
    saveCfg();
    applyCfg();
  });

  toggleHeard.addEventListener('click', () => {
    cfg.showHeard = !cfg.showHeard;
    saveCfg();
    applyCfg();
  });

  toggleMirror.addEventListener('click', () => {
    cfg.mirror = !cfg.mirror;
    saveCfg();
    applyCfg();
  });

  toggleTheme.addEventListener('click', () => {
    cfg.theme = cfg.theme === 'dark' ? 'light' : 'dark';
    saveCfg();
    applyCfg();
  });

  resetPosBtn.addEventListener('click', () => {
    jumpToWord(0, true);
    closeSheet();
  });

  // ===== INIT =====
  applyCfg();
  refreshModelBadge();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
