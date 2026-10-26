/* 影格拼圖：錄影、挑畫面、拼圖、設定、更新 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const VERSION = self.APP_VERSION;

  // ---------- 設定 ----------
  const SETTINGS_KEY = 'frameSheet.settings';
  const DEFAULTS = { mode: 'auto', count: 12, cols: 4, width: 480, cursor: true, theme: 'system', autoUpdate: true };
  let settings = loadSettings();

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === 'light' || settings.theme === 'dark') root.dataset.theme = settings.theme;
    else delete root.dataset.theme;
  }

  // ---------- 小工具 ----------
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), Math.max(2200, msg.length * 90));
  }
  function setProgress(label, ratio) {
    $('progressCard').hidden = false;
    $('progressLabel').textContent = label;
    $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
  }
  function hideProgress() { $('progressCard').hidden = true; }
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtSec = (t) => t.toFixed(2) + 's';
  const fmtPct = (v) => (v == null ? '—' : v.toFixed(1) + '%');
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const canvasToBlob = (c, type = 'image/png', quality) => new Promise((res) => c.toBlob(res, type, quality));
  const fmtSize = (bytes) => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');

  // ---------- 錄影 ----------
  let recorder = null;
  let recordStart = 0;
  let recordTimer = null;
  let rawVideo = null; // { blob, ext } 原始錄影
  let source = null; // { blob, name, knownDuration } 目前處理中的影片

  function pickMime() {
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: settings.cursor ? 'always' : 'never', frameRate: 30 },
        audio: false,
      });
    } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        toast('沒有取得錄影權限。Mac 請到「系統設定 → 隱私權與安全性 → 螢幕錄製」允許瀏覽器。');
      } else {
        toast('無法開始錄影：' + (e && e.message ? e.message : e));
      }
      return;
    }
    const mime = pickMime();
    const chunks = [];
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recordTimer);
      const elapsed = (performance.now() - recordStart) / 1000;
      const type = recorder.mimeType || mime || 'video/webm';
      recorder = null;
      setRecordingUI(false);
      const blob = new Blob(chunks, { type });
      if (!blob.size) { toast('錄影是空的，請再試一次'); return; }
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      rawVideo = { blob, ext };
      source = { blob, name: '螢幕錄影', knownDuration: elapsed };
      process();
    };
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    });
    recorder.start(1000);
    recordStart = performance.now();
    setRecordingUI(true);
    recordTimer = setInterval(updateRecordLabel, 250);
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function setRecordingUI(on) {
    const btn = $('recordBtn');
    btn.classList.toggle('recording', on);
    $('fileInput').disabled = on;
    if (on) updateRecordLabel();
    else $('recordLabel').textContent = '開始錄影';
  }
  function updateRecordLabel() {
    const s = Math.floor((performance.now() - recordStart) / 1000);
    $('recordLabel').textContent = `停止錄影　${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  }

  // ---------- 載入影片 ----------
  function handleFile(file) {
    if (!file) return;
    const okType = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
    if (!okType) { toast('請選擇影片檔（mp4、webm、mov）'); return; }
    if (recorder) return;
    rawVideo = null;
    source = { blob: file, name: file.name.replace(/\.[^.]+$/, ''), knownDuration: null };
    process();
  }

  // iPhone / iPad 的 Safari 不會讀取沒放進頁面的影片，所以要放進頁面（藏起來）並先播一下
  function loadVideo(blob) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.defaultMuted = true;
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
      document.body.appendChild(v);
      let settled = false;
      const ok = () => {
        if (settled || v.readyState < 2) return;
        settled = true;
        clearTimeout(timer);
        v.pause();
        resolve(v);
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        URL.revokeObjectURL(v.src);
        v.remove();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('timeout')), 20000);
      v.addEventListener('loadeddata', ok);
      v.addEventListener('canplay', ok);
      v.addEventListener('error', () => fail(new Error('decode')));
      v.src = URL.createObjectURL(blob);
      v.load();
      const p = v.play();
      if (p && p.then) p.then(() => { v.pause(); ok(); }).catch(() => {});
    });
  }

  // MediaRecorder 錄出來的 webm 常常沒有長度資訊，用跳到最後的方式讓瀏覽器算出來
  function ensureDuration(v, fallback) {
    if (isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration);
    return new Promise((resolve) => {
      const done = (d) => {
        v.removeEventListener('durationchange', onChange);
        clearTimeout(timer);
        v.currentTime = 0;
        resolve(d);
      };
      const onChange = () => { if (isFinite(v.duration) && v.duration > 0) done(v.duration); };
      const timer = setTimeout(() => done(fallback || 0), 4000);
      v.addEventListener('durationchange', onChange);
      v.currentTime = 1e101;
    });
  }

  function seek(v, t) {
    return new Promise((resolve) => {
      const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 3000);
      // 已經在這個位置時，部分瀏覽器不會再通知「跳轉完成」
      if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return done();
      v.addEventListener('seeked', done);
      v.currentTime = t;
    });
  }

  // ---------- 挑畫面 ----------
  const THUMB_W = 96;

  function grayThumb(v, ctx, w, h) {
    ctx.drawImage(v, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return g;
  }
  function diff(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return (s / a.length / 255) * 100; // 0–100%
  }

  // 依「累積變化量」平均切段：變化多的地方格子密，靜止的地方格子疏
  function pickByChange(diffs, n) {
    const m = diffs.length;
    const avg = diffs.reduce((a, b) => a + b, 0) / Math.max(1, m - 1);
    const floor = avg * 0.15 + 1e-6; // 留一點時間均勻度，靜止片段也不會完全沒格子
    const cum = new Float64Array(m);
    for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + diffs[i] + floor;
    const total = cum[m - 1];
    const used = new Set();
    const picks = [];
    for (let k = 0; k < n; k++) {
      const target = (k / (n - 1)) * total;
      let i = 0;
      while (i < m - 1 && cum[i] < target - 1e-9) i++;
      while (used.has(i) && i < m - 1) i++;
      while (used.has(i) && i > 0) i--;
      used.add(i);
      picks.push(i);
    }
    return [...new Set(picks)].sort((a, b) => a - b);
  }

  // ---------- 主流程 ----------
  // 手機和平板的瀏覽器不開放錄螢幕
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let canRecord = false;

  let result = null; // { frames, sheetCanvas, sheetBlob, prompt, timeline, duration, name }
  let busy = false;

  async function process() {
    if (!source || busy) return;
    busy = true;
    $('resultCard').hidden = true;
    $('recordBtn').disabled = true;
    setProgress('讀取影片…', 0);
    let v;
    try {
      v = await loadVideo(source.blob);
    } catch (e) {
      busy = false;
      $('recordBtn').disabled = !canRecord;
      hideProgress();
      toast(e && e.message === 'timeout'
        ? '讀取影片太久沒有反應，請再試一次，或換一段比較短的影片。'
        : '打不開這個影片。如果是 iPhone 錄的 .mov（HEVC），請先轉成 mp4 再試。');
      return;
    }
    try {
      const duration = await ensureDuration(v, source.knownDuration);
      if (!duration) throw new Error('無法取得影片長度');
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!vw || !vh) throw new Error('無法讀取畫面大小');

      const n = Math.max(2, settings.count);
      const end = Math.max(0, duration - 0.05);
      const tw = THUMB_W, th = Math.max(1, Math.round((THUMB_W * vh) / vw));
      const tc = document.createElement('canvas');
      tc.width = tw; tc.height = th;
      const tctx = tc.getContext('2d', { willReadFrequently: true });

      let times, thumbs;
      if (settings.mode === 'auto') {
        const m = Math.round(Math.min(240, Math.max(n * 4, duration * 8)));
        const cand = [];
        for (let i = 0; i < m; i++) cand.push((i * end) / (m - 1));
        const cThumbs = [];
        const diffs = [0];
        for (let i = 0; i < m; i++) {
          await seek(v, cand[i]);
          cThumbs.push(grayThumb(v, tctx, tw, th));
          if (i > 0) diffs.push(diff(cThumbs[i], cThumbs[i - 1]));
          setProgress(`分析畫面變化… ${i + 1}/${m}`, ((i + 1) / m) * 0.7);
        }
        const idx = pickByChange(diffs, Math.min(n, m));
        times = idx.map((i) => cand[i]);
        thumbs = idx.map((i) => cThumbs[i]);
      } else {
        times = [];
        for (let k = 0; k < n; k++) times.push((k * end) / (n - 1));
        thumbs = null;
      }

      // 取每格原圖
      const W = Number(settings.width);
      const H = Math.round((W * vh) / vw);
      const frames = [];
      for (let k = 0; k < times.length; k++) {
        await seek(v, times[k]);
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(v, 0, 0, W, H);
        const thumb = thumbs ? thumbs[k] : grayThumb(v, tctx, tw, th);
        const change = k === 0 ? null : diff(thumb, frames[k - 1].thumb);
        frames.push({ index: k + 1, time: times[k], canvas: c, thumb, change });
        const base = settings.mode === 'auto' ? 0.7 : 0;
        setProgress(`擷取畫面… ${k + 1}/${times.length}`, base + ((k + 1) / times.length) * (0.95 - base));
      }

      setProgress('拼圖中…', 0.97);
      const sheetCanvas = drawSheet(frames, duration, W, H);
      const sheetBlob = await canvasToBlob(sheetCanvas);
      const sheetJpg = await canvasToBlob(sheetCanvas, 'image/jpeg', 0.82);
      const timeline = buildTimeline(frames, duration);
      result = { frames, sheetCanvas, sheetBlob, sheetJpg, duration, name: source.name, vw, vh, W, H };
      result.prompt = buildPrompt(result);
      result.timeline = timeline;
      showResult();
    } catch (e) {
      console.error(e);
      toast('處理失敗：' + (e && e.message ? e.message : e));
    } finally {
      URL.revokeObjectURL(v.src);
      v.remove();
      busy = false;
      $('recordBtn').disabled = !canRecord;
      hideProgress();
    }
  }

  // ---------- 畫拼圖 ----------
  function drawSheet(frames, duration, W, H) {
    const cols = Math.min(settings.cols, frames.length);
    const rows = Math.ceil(frames.length / cols);
    const s = W / 480; // 字和間距跟著格子大小縮放
    const gap = Math.round(10 * s);
    const margin = Math.round(20 * s);
    const labelH = Math.round(30 * s);
    const headerH = Math.round(46 * s);
    const tlH = Math.round(90 * s);
    const cellH = H + labelH;
    const width = margin * 2 + cols * W + (cols - 1) * gap;
    const height = margin + headerH + rows * cellH + (rows - 1) * gap + gap * 2 + tlH + margin;
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d');
    const font = (px, weight = 400) => `${weight} ${Math.round(px * s)}px -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    const mono = (px, weight = 600) => `${weight} ${Math.round(px * s)}px ui-monospace, Menlo, Consolas, monospace`;

    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);

    // 標題
    g.fillStyle = '#111111';
    g.font = font(22, 700);
    g.textBaseline = 'middle';
    g.fillText('影格拼圖', margin, margin + headerH / 2 - 4 * s);
    g.fillStyle = '#555555';
    g.font = font(15);
    const info = `總長 ${duration.toFixed(2)} 秒 · ${frames.length} 格 · 由左到右、由上到下閱讀`;
    g.fillText(info, margin + g.measureText('影格拼圖').width * (22 / 15) + 16 * s, margin + headerH / 2 - 4 * s);

    // 格子
    frames.forEach((f, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = margin + col * (W + gap);
      const y = margin + headerH + row * (cellH + gap);
      g.fillStyle = '#111111';
      g.fillRect(x, y, W, labelH);
      g.textBaseline = 'middle';
      g.font = mono(15);
      g.fillStyle = '#ffd60a';
      const num = '#' + pad2(f.index);
      g.fillText(num, x + 8 * s, y + labelH / 2);
      const numW = g.measureText(num).width;
      g.fillStyle = '#ffffff';
      g.fillText(fmtSec(f.time), x + 8 * s + numW + 12 * s, y + labelH / 2);
      g.font = mono(13, 400);
      g.fillStyle = '#b8b8c0';
      const ch = 'Δ ' + fmtPct(f.change);
      g.fillText(ch, x + W - 8 * s - g.measureText(ch).width, y + labelH / 2);
      g.drawImage(f.canvas, x, y + labelH, W, H);
      g.strokeStyle = '#111111';
      g.lineWidth = Math.max(1, 2 * s);
      g.strokeRect(x + g.lineWidth / 2, y + g.lineWidth / 2, W - g.lineWidth, cellH - g.lineWidth);
    });

    // 時間軸
    const ty = margin + headerH + rows * cellH + (rows - 1) * gap + gap * 2;
    const tx0 = margin + 10 * s, tx1 = width - margin - 10 * s;
    const lineY = ty + tlH * 0.55;
    g.fillStyle = '#555555';
    g.font = font(13);
    g.textBaseline = 'top';
    g.fillText('時間軸', margin, ty);
    g.strokeStyle = '#999999';
    g.lineWidth = Math.max(1, 2 * s);
    g.beginPath(); g.moveTo(tx0, lineY); g.lineTo(tx1, lineY); g.stroke();
    // 頭尾刻度
    g.font = mono(12, 400);
    g.fillStyle = '#777777';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText('0s', tx0, lineY + 14 * s);
    g.textAlign = 'right';
    g.fillText(fmtSec(duration), tx1, lineY + 14 * s);
    // 每格的位置
    g.textAlign = 'center';
    frames.forEach((f, i) => {
      const x = tx0 + (duration ? (f.time / duration) : 0) * (tx1 - tx0);
      g.fillStyle = '#e5484d';
      g.beginPath(); g.arc(x, lineY, 5 * s, 0, Math.PI * 2); g.fill();
      g.font = mono(12, 700);
      g.fillStyle = '#111111';
      g.textBaseline = 'bottom';
      const up = i % 2 === 0 ? 8 : 24; // 交錯兩排，避免數字疊在一起
      g.fillText(String(f.index), x, lineY - up * s);
    });
    g.textAlign = 'left';
    return c;
  }

  // ---------- 文字 ----------
  function buildTimeline(frames, duration) {
    const lines = [
      '# 時間軸',
      '',
      `影片總長：${duration.toFixed(2)} 秒　格數：${frames.length}`,
      '',
      '| 格 | 時間 | 與上一格相差 | 與上一格的變化量 |',
      '|---|---|---|---|',
    ];
    frames.forEach((f, i) => {
      const gapT = i === 0 ? '—' : (f.time - frames[i - 1].time).toFixed(2) + 's';
      lines.push(`| ${pad2(f.index)} | ${fmtSec(f.time)} | ${gapT} | ${fmtPct(f.change)} |`);
    });
    lines.push('', '變化量：這一格和上一格畫面差了多少（0% 完全一樣，數字越大差越多）。');
    return lines.join('\n') + '\n';
  }

  function buildPrompt(r) {
    const goal = $('goalInput').value.trim();
    const modeText = settings.mode === 'auto'
      ? '格子是依「畫面變化量」挑的：變化多的時段格子比較密，靜止的時段比較疏，所以格子之間的時間間隔不一定相同。'
      : '格子是用固定時間間隔挑的，每格之間的時間間隔相同。';
    const rows = r.frames.map((f, i) => {
      const gapT = i === 0 ? '' : `（距上一格 ${(f.time - r.frames[i - 1].time).toFixed(2)}s）`;
      return `- #${pad2(f.index)}　${fmtSec(f.time)}${gapT}　變化量 ${fmtPct(f.change)}`;
    }).join('\n');
    return [
      '我附上一張「影格拼圖」：把一段影片拆成好幾格關鍵畫面，排成漫畫格子。請先讀懂這段動作，再幫我做出來。',
      '',
      '## 怎麼看這張圖',
      `- 影片總長 ${r.duration.toFixed(2)} 秒，共 ${r.frames.length} 格，原始畫面 ${r.vw}×${r.vh}。`,
      `- 閱讀順序：由左到右、由上到下，每排 ${Math.min(settings.cols, r.frames.length)} 格。`,
      '- 每格上方黑條：黃色 #編號、白色秒數（這格在影片中的時間點）、右邊 Δ 是和上一格相比的畫面變化量（0% 代表完全沒變）。',
      `- ${modeText}`,
      '- 最下方的時間軸標出每一格在整段影片中的位置。',
      '',
      '## 每格時間',
      rows,
      '',
      '## 請你做的事',
      goal ? `1. 我的目標：${goal}` : '1. 用 HTML + CSS + JavaScript 做出一樣的效果（單一檔案即可）。',
      '2. 先用條列描述你看到的動作：哪些元素在動、從哪裡到哪裡、大約幾秒開始和結束、速度是先快後慢還是等速。',
      '3. 依照上面的時間點來設定動畫時間；格子之間看不到的部分請合理補齊，並告訴我哪些是你推測的。',
      '4. 如果有看不清楚或不確定的地方，直接問我。',
      '',
    ].join('\n');
  }

  // ---------- 結果 ----------
  let sheetUrl = null;
  function showResult() {
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
    sheetUrl = URL.createObjectURL(result.sheetBlob);
    $('sheetImg').src = sheetUrl;
    $('promptText').value = result.prompt;
    $('sizeOriginal').textContent = `PNG，畫質完全不變（${fmtSize(result.sheetBlob.size)}）`;
    $('sizeCompressed').textContent = result.sheetJpg
      ? `JPG，檔案比較小（${fmtSize(result.sheetJpg.size)}）`
      : 'JPG，檔案比較小';
    $('downloadRaw').hidden = !rawVideo;
    $('resultCard').hidden = false;
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copySheet() {
    if (!result) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.sheetBlob })]);
      toast('已複製拼圖，可以直接貼給 AI');
    } catch (e) {
      toast('這個瀏覽器不能複製圖片，請改用「下載拼圖 PNG」');
    }
  }
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText($('promptText').value);
      toast('已複製說明文字');
    } catch (e) {
      $('promptText').select();
      toast('請按 ⌘C / Ctrl+C 複製');
    }
  }
  function baseName() { return `影格拼圖_${today()}`; }

  // withText=false：只放圖片（拼圖 + 每格原圖）
  async function downloadZip(withText, btn) {
    if (!result || !window.JSZip) return;
    btn.disabled = true;
    try {
      const zip = new JSZip();
      const name = withText ? baseName() : baseName() + '_圖片';
      const root = zip.folder(name);
      root.file('sheet.png', result.sheetBlob);
      const fdir = root.folder('frames');
      for (const f of result.frames) {
        fdir.file(`${pad2(f.index)}_${fmtSec(f.time)}.png`, await canvasToBlob(f.canvas));
      }
      if (withText) {
        root.file('timeline.md', result.timeline);
        root.file('prompt.md', $('promptText').value);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, name + '.zip');
    } catch (e) {
      toast('打包失敗：' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- 設定畫面 ----------
  function initSettingsUI() {
    const dlg = $('settingsDialog');
    const form = dlg.querySelector('form');
    const setRadio = (name, val) => {
      form.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === String(val); });
    };
    const fill = () => {
      setRadio('mode', settings.mode);
      setRadio('width', settings.width);
      setRadio('theme', settings.theme);
      $('countInput').value = settings.count; $('countOut').textContent = settings.count;
      $('colsInput').value = settings.cols; $('colsOut').textContent = settings.cols;
      $('cursorInput').checked = settings.cursor;
      $('autoUpdateInput').checked = settings.autoUpdate;
    };
    fill();

    form.addEventListener('input', (e) => {
      const t = e.target;
      if (t.name === 'mode') settings.mode = t.value;
      else if (t.name === 'width') settings.width = Number(t.value);
      else if (t.name === 'theme') { settings.theme = t.value; applyTheme(); }
      else if (t.id === 'countInput') { settings.count = Number(t.value); $('countOut').textContent = t.value; }
      else if (t.id === 'colsInput') { settings.cols = Number(t.value); $('colsOut').textContent = t.value; }
      else if (t.id === 'cursorInput') settings.cursor = t.checked;
      else if (t.id === 'autoUpdateInput') settings.autoUpdate = t.checked;
      saveSettings();
    });

    $('openSettings').addEventListener('click', () => { fill(); $('updateStatus').textContent = ''; dlg.showModal(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    $('settingsVersion').textContent = 'v' + VERSION;
    $('headerVersion').textContent = 'v' + VERSION;

    const list = $('changelogList');
    (self.APP_CHANGELOG || []).forEach((entry) => {
      const h = document.createElement('h3');
      h.textContent = 'v' + entry.version;
      const small = document.createElement('small');
      small.textContent = entry.date;
      h.appendChild(small);
      const ul = document.createElement('ul');
      entry.changes.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        ul.appendChild(li);
      });
      list.append(h, ul);
    });

    $('checkUpdate').addEventListener('click', () => checkForUpdate(true));
  }

  // ---------- 更新 ----------
  let swReg = null;
  let latestVersion = null;

  async function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    try {
      swReg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    } catch (e) {
      console.warn('Service Worker 註冊失敗', e);
    }
  }

  async function fetchRemoteVersion() {
    const res = await fetch('version.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const m = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!m) throw new Error('讀不到版本號');
    return m[1];
  }

  async function checkForUpdate(manual) {
    const status = $('updateStatus');
    if (manual) status.textContent = '檢查中…';
    try {
      const remote = await fetchRemoteVersion();
      if (remote !== VERSION) {
        latestVersion = remote;
        if (swReg) swReg.update().catch(() => {});
        $('updateText').textContent = `有新版本 v${remote}`;
        $('updateBanner').hidden = false;
        if (manual) status.textContent = `有新版本 v${remote}，請按畫面上方的「立即更新」`;
      } else if (manual) {
        status.textContent = `已是最新版本 v${VERSION}`;
      }
    } catch (e) {
      if (manual) status.textContent = navigator.onLine ? '檢查失敗，請稍後再試' : '目前離線，無法檢查更新';
    }
  }

  function waitForWaitingWorker(timeout) {
    return new Promise((resolve) => {
      if (!swReg) return resolve(null);
      if (swReg.waiting) return resolve(swReg.waiting);
      const timer = setTimeout(() => resolve(swReg.waiting || null), timeout);
      const watch = (w) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed') { clearTimeout(timer); resolve(w); }
        });
      };
      watch(swReg.installing);
      swReg.addEventListener('updatefound', () => watch(swReg.installing));
      swReg.update().catch(() => {});
    });
  }

  async function applyUpdate() {
    if (busy || recorder) { toast('處理完成後再更新'); return; }
    $('updateNow').disabled = true;
    $('updateText').textContent = `正在下載 v${latestVersion || ''}…`;
    const waiting = await waitForWaitingWorker(15000);
    if (waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      waiting.postMessage('SKIP_WAITING');
      setTimeout(() => location.reload(), 3000);
    } else {
      location.reload();
    }
  }

  // ---------- 啟動 ----------
  function init() {
    applyTheme();
    initSettingsUI();

    canRecord = !isMobile && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
    if (!canRecord) {
      $('recordBtn').disabled = true;
      $('inputHint').textContent = '這個裝置的瀏覽器不支援錄螢幕（iPhone、iPad 只能上傳影片）。也可以把影片檔直接拖進來。';
    }
    $('recordBtn').addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
    $('fileInput').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });

    // 拖放
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      $('dropOverlay').hidden = true;
      handleFile(e.dataTransfer.files[0]);
    });

    $('copySheet').addEventListener('click', copySheet);
    $('copyPrompt').addEventListener('click', copyPrompt);
    // 下載拼圖：原始 PNG 或壓縮 JPG
    const menu = $('downloadMenu');
    const setMenu = (open) => { menu.hidden = !open; $('downloadPng').setAttribute('aria-expanded', String(open)); };
    $('downloadPng').addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    $('downloadOriginal').addEventListener('click', () => {
      setMenu(false);
      if (result) downloadBlob(result.sheetBlob, baseName() + '.png');
    });
    $('downloadCompressed').addEventListener('click', () => {
      setMenu(false);
      if (result && result.sheetJpg) downloadBlob(result.sheetJpg, baseName() + '.jpg');
    });
    $('downloadZip').addEventListener('click', (e) => downloadZip(true, e.currentTarget));
    $('downloadImages').addEventListener('click', (e) => downloadZip(false, e.currentTarget));
    $('downloadRaw').addEventListener('click', () => rawVideo && downloadBlob(rawVideo.blob, `螢幕錄影_${today()}.${rawVideo.ext}`));
    $('reprocess').addEventListener('click', process);
    $('goalInput').addEventListener('change', () => {
      if (result) { result.prompt = buildPrompt(result); $('promptText').value = result.prompt; }
    });

    $('updateNow').addEventListener('click', applyUpdate);
    $('updateLater').addEventListener('click', () => { $('updateBanner').hidden = true; });

    registerSW().then(() => { if (settings.autoUpdate) checkForUpdate(false); });

    // 給自動化測試用
    window.__frameSheet = { handleFile, get result() { return result; } };
  }

  init();
})();
