(() => {
  'use strict';

  const ABS_MODEL_URL = new URL('./models/vosk-model-small-ru-0.22.tar.gz', window.location.href).href;
  const MODEL_CACHE = 'suflyor-ais-model-v2';
  const LS_TEXT = 'suflyor_text_v3';
  const LS_CFG = 'suflyor_cfg_v3';
  const LS_VOSK_READY = 'suflyor_vosk_ready_v2';

  const STOP_WORDS = new Set(['и', 'в', 'с', 'к', 'о', 'у', 'а', 'но', 'на', 'по', 'не', 'из', 'за', 'от', 'до', 'то', 'же', 'бы']);
  const MOODS = ['sage', 'orchid', 'lime', 'night'];
  const MOOD_NAMES = { sage: 'Мята', orchid: 'Орхидея', lime: 'Лайм', night: 'Ночь' };

  const DEMO_TEXT = [
    'Добрый день, уважаемые коллеги и друзья!',
    'Сегодня мы говорим о том, как технологии помогают людям жить свободно и самостоятельно.',
    'Наш главный принцип прост: сначала реальная потребность человека, и только потом — код и алгоритмы.',
    'Когда связь пропадает или телефон в авиарежиме, суфлёр продолжает работать легко и без сбоев.',
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
  const moodCycleBtn = $('mood-cycle-btn');
  const activityBarsEl = $('activity-bars');

  const desktopMoodPills = $('desktop-mood-pills');
  const toggleShellBtn = $('toggle-shell-btn');
  const phoneChrome = document.querySelector('.phone-chrome');
  const dynamicIsland = document.querySelector('.dynamic-island');
  const chromeTime = $('chrome-time');

  const offlineStatusPill = $('offline-status-pill');
  const offlinePct = $('offline-pct');
  const offlineDesc = $('offline-desc');
  const downloadModelBtn = $('download-model-btn');
  const modelProgressFill = $('model-progress-fill');
  const capTextFill = $('cap-text-fill');
  const capReadyFill = $('cap-ready-fill');

  const backBtn = $('back-btn');
  const settingsBtn = $('settings-btn');
  const stageStatusPill = $('stage-status-pill');
  const stageDot = $('stage-dot');
  const stageStatusText = $('stage-status-text');
  const stageScroll = $('stage-scroll');
  const stageText = $('stage-text');
  const glowA = $('glow-a');
  const glowB = $('glow-b');

  const waveBarsLeftEl = $('wave-bars-left');
  const heardCaption = $('heard-caption');

  const metricWpm = $('metric-wpm');
  const metricPara = $('metric-para');
  const metricParaTotal = $('metric-para-total');
  const metricPct = $('metric-pct');
  const tilePara = $('tile-para');
  const tilePct = $('tile-pct');

  const prevParaBtn = $('prev-para-btn');
  const nextParaBtn = $('next-para-btn');
  const voiceOrb = $('voice-orb');
  const domeCanvas = $('dome-canvas');
  const orbLabel = $('orb-label');

  const sheetBackdrop = $('sheet-backdrop');
  const settingsSheet = $('settings-sheet');
  const closeSheetBtn = $('close-sheet-btn');
  const sheetMoodRow = $('sheet-mood-row');
  const moodName = $('mood-name');
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
  const resetPosBtn = $('reset-pos-btn');
  const toastEl = $('toast');

  // Config
  let cfg = {
    mood: 'sage',
    shell: 'phone',
    mode: 'vosk',
    fontSize: 34,
    speed: 42,
    clean: false,
    showHeard: true,
    mirror: false
  };

  try {
    const saved = JSON.parse(localStorage.getItem(LS_CFG) || '{}');
    cfg = { ...cfg, ...saved };
  } catch (_) {}

  // State
  let words = [];
  let paras = [];
  let curWordIdx = 0;
  let isRunning = false;
  let wordAdvanceLog = [];
  let liveVoiceLevel = 0;

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

  let webRec = null;
  let scrollRaf = null;
  let lastFrameTs = 0;
  let wakeLock = null;

  // ===== LIVE CLOCK IN PHONE CHROME =====
  function updateClock() {
    if (!chromeTime) return;
    const d = new Date();
    chromeTime.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  updateClock();
  setInterval(updateClock, 30000);

  // ===== PLAYFUL COLORED ACTIVITY MINI-BARS ON SETUP SCREEN =====
  const actBars = [];
  const actColors = ['#eaf372', '#e88cc8', '#8ec0a1', '#eaf372', '#e88cc8', '#8ec0a1', '#8ec0a1', '#e88cc8', '#eaf372', '#8ec0a1', '#e88cc8', '#eaf372', '#8ec0a1', '#e88cc8', '#eaf372', '#8ec0a1'];
  function buildActivityBars() {
    actColors.forEach((color, idx) => {
      const el = document.createElement('span');
      el.className = 'act-bar';
      el.style.background = color;
      el.style.height = (8 + ((idx * 7) % 16)) + 'px';
      activityBarsEl.appendChild(el);
      actBars.push(el);
    });
  }

  function danceActivityBars(seed) {
    actBars.forEach((bar, idx) => {
      const h = 6 + Math.abs(Math.sin(seed * 0.35 + idx * 0.7)) * 19;
      bar.style.height = Math.round(h) + 'px';
    });
  }

  // ===== HIGH-CONTRAST NEUFLX WAVEFORM BARS =====
  const leftBars = [];
  const waveBaseHeights = [10, 18, 12, 34, 54, 24, 16, 46, 26, 62, 34, 42, 22, 52, 28, 16, 38, 22, 48, 30, 18, 36, 24, 14];
  function buildWaveformBars() {
    waveBaseHeights.forEach((h) => {
      const el = document.createElement('span');
      el.className = 'wbar';
      el.style.height = h + 'px';
      waveBarsLeftEl.appendChild(el);
      leftBars.push(el);
    });
  }

  // ===== LIVING CANVAS HALFTONE DOME + AMBIENT ANIMATION LOOP =====
  const domeCtx = domeCanvas.getContext('2d');
  let animPhase = 0;

  function renderLivingStage() {
    animPhase += isRunning ? 0.055 : 0.02;

    // Smoothly decay or sample microphone amplitude
    let targetLevel = 0;
    if (isRunning && analyserNode) {
      const freq = new Uint8Array(analyserNode.frequencyBinCount);
      analyserNode.getByteFrequencyData(freq);
      let sum = 0;
      for (let i = 0; i < freq.length; i++) sum += freq[i];
      targetLevel = Math.min(1, (sum / freq.length) / 95);

      leftBars.forEach((bar, i) => {
        const v = freq[(i * 2) % freq.length] || 0;
        const h = Math.max(6, Math.min(68, 8 + (v / 255) * 62));
        bar.style.height = h.toFixed(0) + 'px';
      });
    } else if (isRunning && cfg.mode === 'autoscroll') {
      targetLevel = 0.25 + 0.12 * Math.sin(animPhase * 1.4);
      leftBars.forEach((bar, i) => {
        const base = waveBaseHeights[i];
        const h = Math.max(6, base * (0.65 + 0.35 * Math.sin(animPhase * 1.5 + i * 0.45)));
        bar.style.height = h.toFixed(0) + 'px';
      });
    } else {
      // Gentle playful idle breathing on waveform
      leftBars.forEach((bar, i) => {
        const base = waveBaseHeights[i];
        const h = Math.max(5, base * (0.72 + 0.22 * Math.sin(animPhase + i * 0.4)));
        bar.style.height = h.toFixed(0) + 'px';
      });
    }

    liveVoiceLevel += (targetLevel - liveVoiceLevel) * 0.22;

    // Ambient blobs gently pulse with voice
    if (glowA && glowB) {
      const s = 1 + liveVoiceLevel * 0.28;
      glowA.style.transform = `scale(${s.toFixed(3)})`;
      glowB.style.transform = `scale(${(1 + liveVoiceLevel * 0.34).toFixed(3)})`;
    }

    // Draw NeuFlx Diagonal Halftone Shimmer on Rising Dome
    const w = domeCanvas.width;
    const h = domeCanvas.height;
    domeCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h + 74;
    const maxR = 196;
    const step = 9.5;
    const dotColor = cfg.mood === 'night' ? '234, 243, 114' : '255, 255, 255';

    for (let y = 16; y < h - 6; y += step) {
      for (let x = 20; x < w - 20; x += step) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > maxR || dist < 96) continue;

        // Concentrate shimmer on the upper-right arc just like NeuFlx!
        const rightBias = Math.max(0, (dx + 75) / 190);
        const edgeFade = 1 - Math.abs(dist - 156) / 56;
        const waveRipple = 0.5 + 0.5 * Math.sin(dist * 0.085 - animPhase * 2.1);
        const intensity = Math.max(0, edgeFade * (0.35 + rightBias * 0.85) * (0.65 + waveRipple * 0.35 + liveVoiceLevel * 0.6));

        if (intensity < 0.08) continue;
        const radius = Math.min(3.2, 0.8 + intensity * 2.1);
        domeCtx.fillStyle = `rgba(${dotColor}, ${Math.min(0.92, intensity * 0.85).toFixed(2)})`;
        domeCtx.beginPath();
        domeCtx.arc(x, y, radius, 0, Math.PI * 2);
        domeCtx.fill();
      }
    }

    requestAnimationFrame(renderLivingStage);
  }

  // ===== TOAST & POP HELPERS =====
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  function popTile(el) {
    if (!el) return;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 260);
  }

  function saveCfg() {
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) {}
  }

  // ===== RUSSIAN WORD MATCHING =====
  function normWord(s) {
    return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/gi, '');
  }

  function editDist1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, diffs = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else {
        if (++diffs > 1) return false;
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
    if (scriptWord.length >= 5 && spokenWord.length >= 5) {
      const stemLen = Math.min(scriptWord.length, spokenWord.length) - 1;
      if (stemLen >= 4 && scriptWord.slice(0, stemLen) === spokenWord.slice(0, stemLen)) return true;
      if (editDist1(scriptWord, spokenWord)) return true;
    }
    return false;
  }

  // ===== APPLY SETTINGS & MOODS =====
  function applyCfg() {
    document.documentElement.setAttribute('data-mood', cfg.mood);
    document.documentElement.setAttribute('data-shell', cfg.shell);
    document.documentElement.style.setProperty('--font-size', cfg.fontSize + 'px');

    moodName.textContent = MOOD_NAMES[cfg.mood] || 'Мята';
    toggleShellBtn.textContent = cfg.shell === 'phone' ? 'Во весь экран' : 'В рамке телефона';

    document.querySelectorAll('.mood-dot, .mood-chip').forEach((el) => {
      el.classList.toggle('active', el.dataset.mood === cfg.mood);
    });

    fontSizeSlider.value = cfg.fontSize;
    fontSizeVal.textContent = cfg.fontSize + ' px';

    speedSlider.value = cfg.speed;
    speedVal.textContent = cfg.speed < 34 ? 'Медленно' : cfg.speed < 68 ? 'Средняя' : 'Быстро';
    speedRow.style.display = cfg.mode === 'autoscroll' ? 'flex' : 'none';

    const modeNames = { vosk: 'Офлайн-голос', webspeech: 'Браузер (онлайн)', autoscroll: 'Автоскролл' };
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

    updateOrbLabel();
  }

  function cycleMood() {
    const idx = MOODS.indexOf(cfg.mood);
    cfg.mood = MOODS[(idx + 1) % MOODS.length];
    saveCfg();
    applyCfg();
    showToast(`Настроение: ${MOOD_NAMES[cfg.mood]}`);
  }

  function updateOrbLabel() {
    if (isRunning) {
      orbLabel.textContent = cfg.mode === 'autoscroll' ? 'Идёт прокрутка · пауза' : 'Слушаю · нажми для паузы';
    } else {
      orbLabel.textContent = cfg.mode === 'autoscroll' ? 'Запустить прокрутку' : 'Нажми и говори';
    }
  }

  // ===== EDITOR =====
  function updateEditorStats() {
    const val = speechInput.value.trim();
    if (!val) {
      textStats.textContent = '0 абз. · 0 слов';
      capTextFill.style.width = '8%';
      return;
    }
    const pCount = val.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const wCount = val.split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(wCount / 120));
    textStats.textContent = `${pCount} абз. · ${wCount} слов · ~${mins} мин`;
    capTextFill.style.width = `${Math.min(100, Math.max(20, Math.round((wCount / 120) * 100)))}%`;
    danceActivityBars(val.length);
  }

  speechInput.value = localStorage.getItem(LS_TEXT) || DEMO_TEXT;

  speechInput.addEventListener('input', () => {
    try { localStorage.setItem(LS_TEXT, speechInput.value); } catch (_) {}
    updateEditorStats();
  });

  demoBtn.addEventListener('click', () => {
    speechInput.value = DEMO_TEXT;
    try { localStorage.setItem(LS_TEXT, DEMO_TEXT); } catch (_) {}
    updateEditorStats();
    showToast('Загружен пример текста');
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

  moodCycleBtn.addEventListener('click', cycleMood);
  stageStatusPill.addEventListener('click', cycleMood);

  desktopMoodPills.addEventListener('click', (e) => {
    const btn = e.target.closest('.mood-dot');
    if (!btn) return;
    cfg.mood = btn.dataset.mood;
    saveCfg();
    applyCfg();
  });

  sheetMoodRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.mood-chip');
    if (!btn) return;
    cfg.mood = btn.dataset.mood;
    saveCfg();
    applyCfg();
  });

  toggleShellBtn.addEventListener('click', () => {
    cfg.shell = cfg.shell === 'phone' ? 'full' : 'phone';
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

    const rawParas = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    rawParas.forEach((pText, pIdx) => {
      const pEl = document.createElement('p');
      pEl.className = 'para';
      const startWordIdx = words.length;
      const lines = pText.split(/\n/);

      lines.forEach((line, lIdx) => {
        const tokens = line.trim().split(/\s+/).filter(Boolean);
        tokens.forEach((tok, tIdx) => {
          const wIdx = words.length;
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = tok;
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
    const prevPara = words[prevIdx] ? words[prevIdx].paraIdx : 0;
    const clamped = Math.max(0, Math.min(idx, words.length - 1));
    curWordIdx = clamped;

    if (trackTempo && clamped > prevIdx) {
      const now = Date.now();
      const delta = Math.min(clamped - prevIdx, 6);
      for (let k = 0; k < delta; k++) wordAdvanceLog.push(now);
      wordAdvanceLog = wordAdvanceLog.filter((t) => now - t <= 20000);
      if (wordAdvanceLog.length >= 2) {
        const spanSec = Math.max(3, (now - wordAdvanceLog[0]) / 1000);
        metricWpm.textContent = String(Math.min(260, Math.round((wordAdvanceLog.length / spanSec) * 60)));
      }
    }

    for (let i = 0; i < words.length; i++) {
      const el = words[i].el;
      el.classList.toggle('done', i < clamped);
      el.classList.toggle('cur', i === clamped);
    }

    const activeParaIdx = words[clamped].paraIdx;
    paras.forEach((p, idxP) => p.el.classList.toggle('done-para', idxP < activeParaIdx));

    const pct = words.length > 1 ? Math.round((clamped / (words.length - 1)) * 100) : 100;
    metricPara.textContent = String(activeParaIdx + 1);
    metricPct.textContent = String(pct);

    if (activeParaIdx !== prevPara) {
      popTile(tilePara);
      popTile(tilePct);
    }

    const statusPrefix = isRunning ? (cfg.mode === 'autoscroll' ? 'Автоскролл' : 'Слушаю') : 'Готов';
    stageStatusText.textContent = `${statusPrefix} · ${activeParaIdx + 1} из ${paras.length}`;

    const curEl = words[clamped].el;
    const containerRect = stageScroll.getBoundingClientRect();
    const elRect = curEl.getBoundingClientRect();
    const targetTop = stageScroll.scrollTop + (elRect.top - containerRect.top) - containerRect.height * 0.30;
    stageScroll.scrollTo({ top: Math.max(0, targetTop), behavior: smooth ? 'smooth' : 'auto' });
  }

  function stepParagraph(delta) {
    if (!paras.length) return;
    const currentPara = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    const targetPara = Math.max(0, Math.min(paras.length - 1, currentPara + delta));
    highlightWord(paras[targetPara].startWordIdx, true, false);
  }

  function matchSpoken(transcript) {
    if (!transcript || !words.length) return;
    const spoken = transcript.trim().split(/\s+/).map(normWord).filter(Boolean);
    if (!spoken.length) return;

    const tail = spoken.slice(-4);
    const maxLookahead = Math.min(words.length - 1, curWordIdx + 22);

    if (tail.length >= 2) {
      const wA = tail[tail.length - 2];
      const wB = tail[tail.length - 1];
      for (let i = curWordIdx; i < maxLookahead; i++) {
        if (wordsMatch(words[i].norm, wA) && wordsMatch(words[i + 1].norm, wB)) {
          if (i + 1 > curWordIdx) { highlightWord(i + 1, true, true); return; }
        }
      }
    }

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

  // ===== OFFLINE VOSK MODEL =====
  function setHeroProgress(pct, pillText, descText, isReady = false) {
    offlinePct.textContent = `${pct}%`;
    modelProgressFill.style.width = `${Math.max(10, pct)}%`;
    capReadyFill.style.width = isReady ? '100%' : `${Math.max(20, Math.round(pct * 0.8))}%`;
    offlineStatusPill.textContent = pillText;
    offlineStatusPill.classList.toggle('ready', isReady);
    offlineDesc.textContent = descText;
  }

  async function initVoskModel() {
    if (voskModel && voskModel.ready) return voskModel;
    if (typeof Vosk === 'undefined') throw new Error('vosk.js не загружен');
    voskModel = await Vosk.createModel(ABS_MODEL_URL);
    if (!voskModel || !voskModel.ready) throw new Error('Модель Vosk не готова');
    try { localStorage.setItem(LS_VOSK_READY, ABS_MODEL_URL); } catch (_) {}
    return voskModel;
  }

  function refreshModelBadge() {
    const unpacked = localStorage.getItem(LS_VOSK_READY) === ABS_MODEL_URL;
    if (unpacked) {
      setHeroProgress(100, 'Готово к авиарежиму', 'Русская модель в памяти телефона — работает полностью без сети.', true);
      downloadModelBtn.innerHTML = '<span>Готово ✓</span>';
      downloadModelBtn.disabled = true;
    } else {
      setHeroProgress(0, 'Ждёт загрузки', 'Один раз по Wi-Fi — и суфлёр работает полностью в авиарежиме (~44 МБ).', false);
      downloadModelBtn.disabled = false;
    }
  }

  async function prepareOfflineModel() {
    downloadModelBtn.disabled = true;
    downloadModelBtn.innerHTML = '<span>Качаю…</span>';
    setHeroProgress(6, 'Скачивание…', 'Загружаю русскую модель речи (44 МБ)…', false);

    try {
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
        const pct = Math.min(80, Math.max(8, Math.round((received / total) * 80)));
        setHeroProgress(pct, `${(received / 1048576).toFixed(1)} МБ`, 'Сохраняю модель в память…', false);
      }

      if ('caches' in window) {
        const blob = new Blob(chunks, { type: 'application/gzip' });
        const cache = await caches.open(MODEL_CACHE);
        await cache.put(ABS_MODEL_URL, new Response(blob, {
          headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(blob.size) }
        }));
      }

      setHeroProgress(88, 'Распаковка…', 'Распаковываю модель в IndexedDB для авиарежима…', false);
      await initVoskModel();
      refreshModelBadge();
      showToast('Готово! Можно включать авиарежим');
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'Сбой загрузки';
      setHeroProgress(0, 'Ошибка', `Не удалось загрузить: ${msg}`, false);
      downloadModelBtn.innerHTML = '<span>Повторить</span>';
      downloadModelBtn.disabled = false;
      showToast('Ошибка: ' + msg);
    }
  }

  downloadModelBtn.addEventListener('click', prepareOfflineModel);

  // ===== WAKE LOCK =====
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  // ===== VOICE / AUTOSCROLL ENGINES =====
  async function startVosk() {
    stageDot.className = 'status-dot loading';
    heardCaption.textContent = 'Запускаю офлайн-голос…';

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const actualSampleRate = audioCtx.sampleRate;

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    });

    await initVoskModel();

    if (!voskRecognizer || voskSampleRate !== actualSampleRate) {
      if (voskRecognizer) { try { voskRecognizer.remove(); } catch (_) {} }
      voskSampleRate = actualSampleRate;
      voskRecognizer = new voskModel.KaldiRecognizer(actualSampleRate);
      voskRecognizer.setWords(true);
      voskRecognizer.on('partialresult', (msg) => {
        const p = msg && msg.result && msg.result.partial;
        if (p) { heardCaption.textContent = `«${p}»`; matchSpoken(p); }
      });
      voskRecognizer.on('result', (msg) => {
        const t = msg && msg.result && msg.result.text;
        if (t) { heardCaption.textContent = `«${t}»`; matchSpoken(t); }
      });
    }

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 128;

    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (ev) => {
      if (!isRunning || !voskRecognizer) return;
      try { voskRecognizer.acceptWaveform(ev.inputBuffer); } catch (_) {}
    };

    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    sourceNode.connect(analyserNode);
    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    stageDot.className = 'status-dot listening';
    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Слушаю · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Слушаю офлайн — просто говори';
  }

  function startWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('Онлайн-распознавание не поддерживается');
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
      if (text) { heardCaption.textContent = `«${text}»`; matchSpoken(text); }
    };
    webRec.onerror = (e) => {
      if (e.error === 'not-allowed') { showToast('Нет доступа к микрофону'); stopEngine(); }
    };
    webRec.onend = () => {
      if (isRunning && cfg.mode === 'webspeech') { try { webRec.start(); } catch (_) {} }
    };
    webRec.start();
    stageDot.className = 'status-dot listening';
    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Слушаю · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Слушаю через браузер — говори';
  }

  function startAutoscroll() {
    stageDot.className = 'status-dot ready';
    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Автоскролл · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Плавная прокрутка · тап по куполу = пауза';
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
    voiceOrb.classList.add('listening');
    if (dynamicIsland) dynamicIsland.classList.add('active');
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
      heardCaption.textContent = `${msg} — листай свайпом или Автоскроллом`;
      showToast(msg);
    }
  }

  function stopEngine() {
    isRunning = false;
    voiceOrb.classList.remove('listening');
    if (dynamicIsland) dynamicIsland.classList.remove('active');
    stageDot.className = 'status-dot';
    updateOrbLabel();

    const activeParaIdx = words[curWordIdx] ? words[curWordIdx].paraIdx : 0;
    stageStatusText.textContent = `Пауза · ${activeParaIdx + 1} из ${paras.length}`;
    heardCaption.textContent = 'Пауза · свайп по тексту или тап по куполу';

    cancelAnimationFrame(scrollRaf);
    releaseWakeLock();

    if (webRec) { try { webRec.onend = null; webRec.stop(); } catch (_) {} webRec = null; }
    [processorNode, silentGain, analyserNode, sourceNode].forEach((n) => {
      if (n) { try { n.disconnect(); } catch (_) {} }
    });
    processorNode = silentGain = analyserNode = sourceNode = null;
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  }

  voiceOrb.addEventListener('click', () => {
    if (isRunning) stopEngine();
    else startEngine();
  });

  // ===== SCREEN TRANSITIONS =====
  startBtn.addEventListener('click', () => {
    const text = speechInput.value.trim();
    if (!text) { showToast('Сначала вставь текст выступления'); speechInput.focus(); return; }
    buildStage(text);
    editScreen.classList.remove('active');
    stageScreen.classList.add('active');
    if (phoneChrome) phoneChrome.classList.add('on-stage');
  });

  backBtn.addEventListener('click', () => {
    stopEngine();
    stageScreen.classList.remove('active');
    editScreen.classList.add('active');
    if (phoneChrome) phoneChrome.classList.remove('on-stage');
  });

  // ===== PARAGRAPH NAVIGATION & SWIPES =====
  prevParaBtn.addEventListener('click', () => stepParagraph(-1));
  nextParaBtn.addEventListener('click', () => stepParagraph(1));

  let touchStartX = 0, touchStartY = 0;
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
      if (dx < 0) stepParagraph(1); else stepParagraph(-1);
    }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!stageScreen.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') stepParagraph(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') stepParagraph(-1);
    if (e.key === ' ') { e.preventDefault(); if (isRunning) stopEngine(); else startEngine(); }
  });

  // ===== SETTINGS SHEET =====
  function openSheet() { sheetBackdrop.classList.add('open'); settingsSheet.classList.add('open'); }
  function closeSheet() { sheetBackdrop.classList.remove('open'); settingsSheet.classList.remove('open'); }

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

  fontSizeSlider.addEventListener('input', () => { cfg.fontSize = Number(fontSizeSlider.value); saveCfg(); applyCfg(); });
  speedSlider.addEventListener('input', () => { cfg.speed = Number(speedSlider.value); saveCfg(); applyCfg(); });
  toggleClean.addEventListener('click', () => { cfg.clean = !cfg.clean; saveCfg(); applyCfg(); });
  toggleHeard.addEventListener('click', () => { cfg.showHeard = !cfg.showHeard; saveCfg(); applyCfg(); });
  toggleMirror.addEventListener('click', () => { cfg.mirror = !cfg.mirror; saveCfg(); applyCfg(); });
  resetPosBtn.addEventListener('click', () => { highlightWord(0, true, false); closeSheet(); });

  // ===== INIT =====
  buildActivityBars();
  buildWaveformBars();
  updateEditorStats();
  applyCfg();
  refreshModelBadge();
  requestAnimationFrame(renderLivingStage);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
