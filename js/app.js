/**
 * TQE PWA — Main application logic.
 *
 * Handles:
 * - Key validation and activation (same flow as service-worker.js)
 * - Device ID generation and persistence
 * - File picking and reading
 * - Processing orchestration via processor.js
 * - Progress display with ETA calculation
 * - Download via Blob URL / Web Share API
 * - Settings persistence in localStorage
 * - Multi-page navigation (Home, Settings, Guide, Dashboard)
 * - Processing history & dashboard analytics
 * - Topbar status indicator
 * - Animated counters
 */

import { validateKey, isKeyActive, sealKeyState, verifyKeyState } from '../../src/shared/key-validator.js';
import * as storage from './storage-web.js';
import { processVideo, setProgressCallback } from './processor.js';

// --- Constants ---
const HISTORY_KEY = 'tqe_history';
const DOWNLOADS_KEY = 'tqe_downloads';
const MAX_HISTORY = 50;

// --- Service Worker Registration ---

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    console.log('[TQE] Service worker registered');
    // If no controller yet, the SW just installed — auto-reload so it can
    // inject COOP/COEP headers (required for SharedArrayBuffer / FFmpeg.wasm)
    if (!navigator.serviceWorker.controller) {
      if (reg.active) {
        location.reload();
      } else {
        // Wait for the SW to activate, then reload
        const waitForActive = (worker) => {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') {
              location.reload();
            }
          });
        };
        if (reg.installing) waitForActive(reg.installing);
        else if (reg.waiting) waitForActive(reg.waiting);
      }
    }
  }).catch((err) => {
    console.warn('[TQE] SW registration failed:', err);
  });
}

// --- Disable ArrayBuffer transfers (same as offscreen.js) ---
const _NativeWorker = globalThis.Worker;
globalThis.Worker = class extends _NativeWorker {
  postMessage(msg) { return super.postMessage(msg); }
};

// --- DOM References ---

const $lockScreen = document.getElementById('lockScreen');
const $mainApp = document.getElementById('mainApp');
const $keyInput = document.getElementById('keyInput');
const $keyBtn = document.getElementById('keyBtn');
const $keyHint = document.getElementById('keyHint');
const $keyStatusBar = document.getElementById('keyStatusBar');
const $keyStatusLabel = document.getElementById('keyStatusLabel');
const $keyStatusTimer = document.getElementById('keyStatusTimer');
const $fileZone = document.getElementById('fileZone');
const $fileInput = document.getElementById('fileInput');
const $fileInfoRow = document.getElementById('fileInfoRow');
const $fileName = document.getElementById('fileName');
const $fileSize = document.getElementById('fileSize');
const $processMode = document.getElementById('processMode');
const $modeHint = document.getElementById('modeHint');
const $qualityPills = document.getElementById('qualityPills');
const $fpsPills = document.getElementById('fpsPills');
const $processBtn = document.getElementById('processBtn');
const $progressCard = document.getElementById('progressCard');
const $progressDot = document.getElementById('progressDot');
const $progressLabel = document.getElementById('progressLabel');
const $progressFileInfo = document.getElementById('progressFileInfo');
const $progressFill = document.getElementById('progressFill');
const $progressPct = document.getElementById('progressPct');
const $progressStatus = document.getElementById('progressStatus');
const $progressEta = document.getElementById('progressEta');
const $errorBox = document.getElementById('errorBox');
const $resultCard = document.getElementById('resultCard');
const $statMode = document.getElementById('statMode');
const $statSize = document.getElementById('statSize');
const $statTime = document.getElementById('statTime');
const $videoAnalysis = document.getElementById('videoAnalysis');
const $analysisGrid = document.getElementById('analysisGrid');
const $sizeCompare = document.getElementById('sizeCompare');
const $qualityScore = document.getElementById('qualityScore');
const $downloadBtn = document.getElementById('downloadBtn');
const $shareBtn = document.getElementById('shareBtn');
const $resetBtn = document.getElementById('resetBtn');

// Topbar
const $statusDot = document.getElementById('statusDot');
const $statusText = document.getElementById('statusText');
const $topbarSub = document.getElementById('topbarSub');

// Nav
const $bottomNav = document.getElementById('bottomNav');

// Dashboard
const $exportBtn = document.getElementById('exportBtn');
const $clearBtn = document.getElementById('clearBtn');

// Patcher
const $patcherFileZone = document.getElementById('patcherFileZone');
const $patcherFileInput = document.getElementById('patcherFileInput');
const $patcherFileInfoRow = document.getElementById('patcherFileInfoRow');
const $patcherFileName = document.getElementById('patcherFileName');
const $patcherFileSize = document.getElementById('patcherFileSize');
const $patcherQuality = document.getElementById('patcherQuality');
const $patcherResolution = document.getElementById('patcherResolution');
const $patcherFps = document.getElementById('patcherFps');
const $patcherConvertBtn = document.getElementById('patcherConvertBtn');
const $patcherProgressCard = document.getElementById('patcherProgressCard');
const $patcherProgressFill = document.getElementById('patcherProgressFill');
const $patcherProgressPct = document.getElementById('patcherProgressPct');
const $patcherProgressStatus = document.getElementById('patcherProgressStatus');
const $patcherProgressEta = document.getElementById('patcherProgressEta');
const $patcherProgressFileInfo = document.getElementById('patcherProgressFileInfo');
const $patcherErrorBox = document.getElementById('patcherErrorBox');
const $patcherResultCard = document.getElementById('patcherResultCard');
const $patcherStatCodec = document.getElementById('patcherStatCodec');
const $patcherStatSize = document.getElementById('patcherStatSize');
const $patcherStatTime = document.getElementById('patcherStatTime');
const $patcherSizeCompare = document.getElementById('patcherSizeCompare');
const $patcherDownloadBtn = document.getElementById('patcherDownloadBtn');
const $patcherResetBtn = document.getElementById('patcherResetBtn');
const $pqiCrf = document.getElementById('pqiCrf');
const $pqiMaxrate = document.getElementById('pqiMaxrate');
const $pqiPreset = document.getElementById('pqiPreset');
const $pqiAudio = document.getElementById('pqiAudio');

// --- State ---

let currentFile = null;       // { file: File, data: Uint8Array }
let resultBlob = null;        // Blob of processed output
let resultFileName = '';      // Output file name
let processStartTime = 0;
let keyTimerInterval = null;

// Patcher state
let patcherFile = null;
let patcherResultBlob = null;
let patcherResultFileName = '';
let patcherStartTime = 0;

// --- Device ID ---

async function getDeviceId() {
  let deviceId = await storage.getValue('deviceId');
  if (deviceId) return deviceId;
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  deviceId = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  await storage.set({ deviceId });
  return deviceId;
}

// --- Key Management ---

async function checkKeyStatus() {
  const data = await storage.get(['tempKeyState']);
  const ks = data.tempKeyState;

  if (!ks) return { active: false };

  const intact = await verifyKeyState(ks);
  if (!intact) {
    await storage.set({ tempKey: null, tempKeyState: null });
    return { active: false, tampered: true };
  }

  const currentDeviceId = await getDeviceId();
  if (ks.deviceId && ks.deviceId !== currentDeviceId) {
    return { active: false, reason: 'Key locked to another device' };
  }

  if (isKeyActive(ks)) {
    const expiresAt = ks.expiresAt;
    const lifetime = expiresAt === 0;
    const timeRemaining = lifetime ? -1 : Math.max(0, expiresAt - Date.now());
    return { active: true, expiresAt, timeRemaining, lifetime };
  }

  return { active: false, expired: true };
}

async function activateKey(keyString) {
  if (!keyString) return { success: false, reason: 'No key provided' };

  const result = await validateKey(keyString);
  if (!result.valid) return { success: false, reason: result.reason };

  const existingData = await storage.get(['tempKeyState']);
  const existing = existingData.tempKeyState;
  if (existing && existing.keyId === result.payload.id) {
    if (isKeyActive(existing)) {
      return { success: true, expiresAt: existing.expiresAt, alreadyActive: true };
    }
    return { success: false, reason: 'This key has already been used' };
  }

  const activatedAt = Date.now();
  const isLifetime = result.payload.dur === 0;
  const expiresAt = isLifetime ? 0 : activatedAt + result.payload.dur;
  const deviceId = await getDeviceId();
  const keyState = await sealKeyState({
    activatedAt,
    expiresAt,
    keyId: result.payload.id,
    deviceId,
  });

  await storage.set({
    tempKey: keyString,
    tempKeyState: keyState,
  });

  console.log('[TQE] Key activated' + (isLifetime ? ' (lifetime)' : ', expires: ' + new Date(expiresAt).toLocaleString()));
  return { success: true, expiresAt, lifetime: isLifetime };
}

function updateKeyStatusBar(status) {
  if (keyTimerInterval) {
    clearInterval(keyTimerInterval);
    keyTimerInterval = null;
  }

  if (!status.active) {
    $keyStatusBar.hidden = true;
    return;
  }

  $keyStatusBar.hidden = false;

  if (status.lifetime) {
    $keyStatusLabel.textContent = 'Lifetime Key Active';
    $keyStatusTimer.textContent = '';
    return;
  }

  function updateTimer() {
    const remaining = Math.max(0, status.expiresAt - Date.now());
    if (remaining <= 0) {
      $keyStatusLabel.textContent = 'Key Expired';
      $keyStatusTimer.textContent = '';
      clearInterval(keyTimerInterval);
      // Lock the user out immediately
      $mainApp.hidden = true;
      $lockScreen.hidden = false;
      $keyHint.textContent = 'Your key has expired';
      $keyHint.className = 'lock-hint error';
      $keyInput.value = '';
      return;
    }
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    $keyStatusTimer.textContent = `${hours}h ${mins}m ${secs}s remaining`;
  }

  $keyStatusLabel.textContent = 'Key Active';
  updateTimer();
  keyTimerInterval = setInterval(updateTimer, 1000);
}

// --- Topbar Status ---

function setTopbarStatus(state, text) {
  $statusDot.className = 'status-dot status-' + state;
  const labels = { idle: 'LIVE', analyzing: 'ANALYZING', processing: 'PROCESSING', done: 'DONE', error: 'ERROR' };
  $statusText.textContent = labels[state] || 'LIVE';
  if (text) $topbarSub.textContent = text;
}

// --- Navigation ---

function switchPage(targetId) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => {
    p.classList.remove('page-active');
  });

  const target = document.getElementById('page' + targetId.charAt(0).toUpperCase() + targetId.slice(1));
  if (target) {
    target.classList.add('page-active');
    // Re-trigger animations
    target.querySelectorAll('.anim-card').forEach(el => {
      el.style.animation = 'none';
      el.offsetHeight; // reflow
      el.style.animation = '';
    });
  }

  // Update nav
  $bottomNav.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.target === targetId);
  });

  // Refresh data on dashboard open
  if (targetId === 'dashboard') {
    populateDashboard();
  }

  // Refresh quick stats on home open
  if (targetId === 'home') {
    animateQuickStats();
  }
}

// --- Settings ---

async function loadSettings() {
  const data = await storage.get(['processMode', 'qualityPreset', 'fpsTarget']);
  $processMode.value = data.processMode || 'auto';

  setPillActive($qualityPills, data.qualityPreset || 'high');
  setPillActive($fpsPills, data.fpsTarget || '60');

  updateModeHint();
}

async function saveSettings() {
  await storage.set({
    processMode: $processMode.value,
    qualityPreset: getActivePill($qualityPills),
    fpsTarget: getActivePill($fpsPills),
  });
}

function getSettings() {
  return {
    processMode: $processMode.value,
    qualityPreset: getActivePill($qualityPills),
    fpsTarget: getActivePill($fpsPills),
  };
}

// --- Mode Hint ---

function updateModeHint() {
  const hints = {
    auto: 'Auto: itsscale for H.264, re-encode for others',
    itsscale: 'itsscale: Fast timestamp scaling, no re-encode. Best for H.264 files',
    reencode: 'Re-encode: Full CRF encoding for maximum quality control',
    remux: 'Remux: Container swap only, fastest but no quality change',
  };
  $modeHint.textContent = hints[$processMode.value] || hints.auto;
}

// --- Pill Group Helpers ---

function setPillActive(group, value) {
  for (const pill of group.querySelectorAll('.pill')) {
    pill.classList.toggle('active', pill.dataset.value === value);
  }
}

function getActivePill(group) {
  const active = group.querySelector('.pill.active');
  return active ? active.dataset.value : '';
}

function bindPillGroup(group, onChange) {
  group.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    setPillActive(group, pill.dataset.value);
    if (onChange) onChange();
  });
}

// --- File Handling ---

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function handleFileSelect(file) {
  if (!file) return;

  const MAX = 250 * 1024 * 1024;
  if (file.size > MAX) {
    showError(`File too large (${formatSize(file.size)}). Maximum is 250 MB.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    currentFile = {
      file,
      data: new Uint8Array(reader.result),
    };

    $fileInfoRow.hidden = false;
    $fileName.textContent = file.name;
    $fileSize.textContent = formatSize(file.size);
    $processBtn.hidden = false;
    $errorBox.hidden = true;
    $resultCard.hidden = true;

    $fileZone.querySelector('.file-zone-text').textContent = file.name;
    $fileZone.querySelector('.file-zone-hint').textContent = formatSize(file.size);
  };
  reader.onerror = () => {
    showError('Failed to read file');
  };
  reader.readAsArrayBuffer(file);
}

// --- Processing ---

async function startProcessing() {
  if (!currentFile) return;

  // Hide/show UI
  $processBtn.hidden = true;
  $errorBox.hidden = true;
  $resultCard.hidden = true;
  $progressCard.hidden = false;
  $progressFill.style.width = '0%';
  $progressPct.textContent = '0%';
  $progressStatus.textContent = 'Loading FFmpeg...';
  $progressEta.textContent = '';

  // Show file info in progress card
  $progressFileInfo.textContent = `${currentFile.file.name} (${formatSize(currentFile.file.size)})`;

  processStartTime = Date.now();

  // Topbar: analyzing
  setTopbarStatus('analyzing', 'Analyzing video...');

  // Progress callback with ETA
  setProgressCallback((progress) => {
    const pct = Math.round(progress * 100);
    $progressFill.style.width = pct + '%';
    $progressPct.textContent = pct + '%';

    // Status text + topbar state
    if (progress < 0.05) {
      $progressStatus.textContent = 'Loading FFmpeg...';
    } else if (progress < 0.10) {
      $progressStatus.textContent = 'Analyzing video...';
      setTopbarStatus('analyzing', 'Analyzing video...');
    } else if (progress < 0.90) {
      $progressStatus.textContent = 'Processing...';
      setTopbarStatus('processing', 'Processing video...');
    } else if (progress < 0.96) {
      $progressStatus.textContent = 'Scoring quality...';
    } else {
      $progressStatus.textContent = 'Finalizing...';
    }

    // ETA calculation
    if (progress > 0.05 && progress < 1.0) {
      const elapsed = Date.now() - processStartTime;
      const total = elapsed / progress;
      const remaining = total - elapsed;
      if (remaining > 1000) {
        const secs = Math.round(remaining / 1000);
        if (secs >= 60) {
          const mins = Math.floor(secs / 60);
          $progressEta.textContent = `~${mins}m ${secs % 60}s remaining`;
        } else {
          $progressEta.textContent = `~${secs}s remaining`;
        }
      }
    }
  });

  try {
    const settings = getSettings();
    const result = await processVideo(currentFile.data, currentFile.file.name, settings);

    if (result.success) {
      setTopbarStatus('done', 'Processing complete');
      showResult(result);
      addToHistory(result, true);
    } else {
      setTopbarStatus('error', 'Processing failed');
      showError(result.error || 'Processing failed');
      $progressCard.hidden = true;
      addToHistory(result, false);
    }
  } catch (err) {
    setTopbarStatus('error', 'Processing failed');
    showError(err.message || 'Processing failed');
    $progressCard.hidden = true;
    addToHistory({ error: err.message }, false);
  }
}

function showResult(result) {
  $progressCard.hidden = true;

  // Build output filename
  const origName = currentFile.file.name;
  const dotIdx = origName.lastIndexOf('.');
  const baseName = dotIdx > 0 ? origName.substring(0, dotIdx) : origName;
  resultFileName = baseName + '_tqe.mp4';

  // Create blob
  resultBlob = new Blob([result.outputData], { type: 'video/mp4' });

  // Stats
  $statMode.textContent = (result.processMode || '--').toUpperCase();
  $statSize.textContent = formatSize(result.processedSize);

  const secs = Math.round(result.processingTime / 1000);
  if (secs >= 60) {
    $statTime.textContent = Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  } else {
    $statTime.textContent = secs + 's';
  }

  // Video Analysis Details
  buildVideoAnalysis(result);

  // Show share button on devices that support it
  if (navigator.share && navigator.canShare) {
    const testFile = new File([new Uint8Array(1)], 'test.mp4', { type: 'video/mp4' });
    if (navigator.canShare({ files: [testFile] })) {
      $shareBtn.hidden = false;
    }
  }

  $resultCard.hidden = false;
}

function buildVideoAnalysis(result) {
  // Build analysis grid
  const items = [
    { key: 'Codec', val: result.codec || result.videoCodec || 'H.264' },
    { key: 'Resolution', val: result.resolution || '1080x1920' },
    { key: 'FPS', val: result.fps || result.frameRate || '60' },
    { key: 'Duration', val: result.duration ? formatDuration(result.duration) : '--' },
    { key: 'Bitrate', val: result.bitrate ? formatBitrate(result.bitrate) : '--' },
    { key: 'Audio', val: result.audioCodec || 'AAC' },
  ];

  $analysisGrid.innerHTML = items.map(i =>
    `<div class="analysis-item"><span class="analysis-key">${i.key}</span><span class="analysis-val">${i.val}</span></div>`
  ).join('');

  // Size comparison
  const originalSize = currentFile.file.size;
  const processedSize = result.processedSize || (result.outputData && result.outputData.length) || 0;
  const reduction = originalSize > 0 ? ((1 - processedSize / originalSize) * 100).toFixed(1) : 0;
  const arrow = processedSize < originalSize ? '↓' : '↑';

  $sizeCompare.innerHTML = `
    <span class="size-original">${formatSize(originalSize)}</span>
    <span class="size-arrow">→</span>
    <span class="size-processed">${formatSize(processedSize)}</span>
    <span class="size-reduction">${arrow} ${Math.abs(reduction)}%</span>
  `;

  // Quality score (PSNR)
  if (result.psnr && result.psnr > 0) {
    let badgeClass = 'fair';
    let badgeText = 'Fair';
    if (result.psnr > 45) { badgeClass = 'excellent'; badgeText = 'Excellent'; }
    else if (result.psnr > 40) { badgeClass = 'good'; badgeText = 'Good'; }

    $qualityScore.innerHTML = `
      <span class="quality-badge ${badgeClass}">${result.psnr.toFixed(1)} dB — ${badgeText}</span>
    `;
    $qualityScore.hidden = false;
  } else {
    $qualityScore.hidden = true;
  }

  // Mode badge
  const mode = (result.processMode || 'auto').toLowerCase();
  let modeClass = 'mode-itsscale';
  if (mode === 'reencode' || mode === 're-encode') modeClass = 'mode-reencode';
  else if (mode === 'remux') modeClass = 'mode-remux';

  // Append mode badge after quality score
  const existingBadge = $videoAnalysis.querySelector('.mode-badge');
  if (existingBadge) existingBadge.remove();
  const modeBadgeEl = document.createElement('div');
  modeBadgeEl.className = `mode-badge ${modeClass}`;
  modeBadgeEl.textContent = (result.processMode || 'auto').toUpperCase();
  modeBadgeEl.style.marginTop = '8px';
  $videoAnalysis.appendChild(modeBadgeEl);

  $videoAnalysis.hidden = false;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatBitrate(bps) {
  if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
  if (bps >= 1000) return (bps / 1000).toFixed(0) + ' kbps';
  return bps + ' bps';
}

function downloadResult() {
  if (!resultBlob) return;
  const url = URL.createObjectURL(resultBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = resultFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  // Increment download count
  const count = parseInt(localStorage.getItem(DOWNLOADS_KEY) || '0', 10) + 1;
  localStorage.setItem(DOWNLOADS_KEY, String(count));
}

async function shareResult() {
  if (!resultBlob) return;
  try {
    const file = new File([resultBlob], resultFileName, { type: 'video/mp4' });
    await navigator.share({ files: [file] });
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('[TQE] Share failed:', err);
      downloadResult();
    }
  }
}

function showError(msg) {
  $errorBox.textContent = msg;
  $errorBox.hidden = false;
  $progressCard.hidden = true;
}

function resetUI() {
  currentFile = null;
  if (resultBlob) {
    resultBlob = null;
  }
  resultFileName = '';

  $fileInput.value = '';
  $fileInfoRow.hidden = true;
  $processBtn.hidden = true;
  $progressCard.hidden = true;
  $errorBox.hidden = true;
  $resultCard.hidden = true;
  $shareBtn.hidden = true;
  $videoAnalysis.hidden = true;

  $fileZone.querySelector('.file-zone-text').textContent = 'Tap to select a video';
  $fileZone.querySelector('.file-zone-hint').textContent = 'Max 250 MB';

  setTopbarStatus('idle', 'Ready');
}

// --- Patcher ---

const PATCHER_PRESETS = {
  balanced: { crf: '19', maxrate: '15 Mbps', preset: 'veryfast', audio: 'AAC 256k' },
  high: { crf: '17', maxrate: '25 Mbps', preset: 'fast', audio: 'AAC 320k' },
  ultra: { crf: '15', maxrate: '40 Mbps', preset: 'medium', audio: 'AAC 320k' },
};

function updatePatcherQualityInfo() {
  const quality = getActivePill($patcherQuality);
  const info = PATCHER_PRESETS[quality] || PATCHER_PRESETS.high;
  $pqiCrf.textContent = info.crf;
  $pqiMaxrate.textContent = info.maxrate;
  $pqiPreset.textContent = info.preset;
  $pqiAudio.textContent = info.audio;
}

function handlePatcherFileSelect(file) {
  if (!file) return;
  const MAX = 250 * 1024 * 1024;
  if (file.size > MAX) {
    patcherShowError(`File too large (${formatSize(file.size)}). Maximum is 250 MB.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    patcherFile = { file, data: new Uint8Array(reader.result) };
    $patcherFileInfoRow.hidden = false;
    $patcherFileName.textContent = file.name;
    $patcherFileSize.textContent = formatSize(file.size);
    $patcherConvertBtn.hidden = false;
    $patcherErrorBox.hidden = true;
    $patcherResultCard.hidden = true;
    $patcherFileZone.querySelector('.file-zone-text').textContent = file.name;
    $patcherFileZone.querySelector('.file-zone-hint').textContent = formatSize(file.size);
  };
  reader.onerror = () => patcherShowError('Failed to read file');
  reader.readAsArrayBuffer(file);
}

async function startPatcherConversion() {
  if (!patcherFile) return;

  $patcherConvertBtn.hidden = true;
  $patcherErrorBox.hidden = true;
  $patcherResultCard.hidden = true;
  $patcherProgressCard.hidden = false;
  $patcherProgressFill.style.width = '0%';
  $patcherProgressPct.textContent = '0%';
  $patcherProgressStatus.textContent = 'Loading FFmpeg...';
  $patcherProgressEta.textContent = '';
  $patcherProgressFileInfo.textContent = `${patcherFile.file.name} (${formatSize(patcherFile.file.size)})`;

  patcherStartTime = Date.now();
  setTopbarStatus('processing', 'Converting video...');

  setProgressCallback((progress) => {
    const pct = Math.round(progress * 100);
    $patcherProgressFill.style.width = pct + '%';
    $patcherProgressPct.textContent = pct + '%';

    if (progress < 0.05) $patcherProgressStatus.textContent = 'Loading FFmpeg...';
    else if (progress < 0.10) $patcherProgressStatus.textContent = 'Analyzing video...';
    else if (progress < 0.90) $patcherProgressStatus.textContent = 'Encoding...';
    else if (progress < 0.96) $patcherProgressStatus.textContent = 'Scoring quality...';
    else $patcherProgressStatus.textContent = 'Finalizing...';

    if (progress > 0.05 && progress < 1.0) {
      const elapsed = Date.now() - patcherStartTime;
      const total = elapsed / progress;
      const remaining = total - elapsed;
      if (remaining > 1000) {
        const secs = Math.round(remaining / 1000);
        if (secs >= 60) {
          const mins = Math.floor(secs / 60);
          $patcherProgressEta.textContent = `~${mins}m ${secs % 60}s remaining`;
        } else {
          $patcherProgressEta.textContent = `~${secs}s remaining`;
        }
      }
    }
  });

  try {
    const settings = {
      isPatcher: true,
      processMode: 'reencode',
      qualityPreset: getActivePill($patcherQuality),
      fpsTarget: getActivePill($patcherFps),
      targetResolution: getActivePill($patcherResolution),
    };

    const result = await processVideo(patcherFile.data, patcherFile.file.name, settings);

    if (result.success) {
      setTopbarStatus('done', 'Conversion complete');
      showPatcherResult(result);
      addToHistory(result, true);
    } else {
      setTopbarStatus('error', 'Conversion failed');
      patcherShowError(result.error || 'Conversion failed');
      $patcherProgressCard.hidden = true;
    }
  } catch (err) {
    setTopbarStatus('error', 'Conversion failed');
    patcherShowError(err.message || 'Conversion failed');
    $patcherProgressCard.hidden = true;
  }
}

function showPatcherResult(result) {
  $patcherProgressCard.hidden = true;

  const origName = patcherFile.file.name;
  const dotIdx = origName.lastIndexOf('.');
  const baseName = dotIdx > 0 ? origName.substring(0, dotIdx) : origName;
  patcherResultFileName = baseName + '_patched.mp4';

  patcherResultBlob = new Blob([result.outputData], { type: 'video/mp4' });

  $patcherStatCodec.textContent = 'H.264';
  $patcherStatSize.textContent = formatSize(result.processedSize);

  const secs = Math.round(result.processingTime / 1000);
  $patcherStatTime.textContent = secs >= 60
    ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's'
    : secs + 's';

  const originalSize = patcherFile.file.size;
  const processedSize = result.processedSize;
  const reduction = originalSize > 0 ? ((1 - processedSize / originalSize) * 100).toFixed(1) : 0;
  const arrow = processedSize < originalSize ? '\u2193' : '\u2191';
  $patcherSizeCompare.innerHTML = `
    <span class="size-original">${formatSize(originalSize)}</span>
    <span class="size-arrow">\u2192</span>
    <span class="size-processed">${formatSize(processedSize)}</span>
    <span class="size-reduction">${arrow} ${Math.abs(reduction)}%</span>
  `;

  $patcherResultCard.hidden = false;
}

function patcherDownload() {
  if (!patcherResultBlob) return;
  const url = URL.createObjectURL(patcherResultBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = patcherResultFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const count = parseInt(localStorage.getItem(DOWNLOADS_KEY) || '0', 10) + 1;
  localStorage.setItem(DOWNLOADS_KEY, String(count));
}

function patcherShowError(msg) {
  $patcherErrorBox.textContent = msg;
  $patcherErrorBox.hidden = false;
  $patcherProgressCard.hidden = true;
}

function resetPatcherUI() {
  patcherFile = null;
  patcherResultBlob = null;
  patcherResultFileName = '';

  $patcherFileInput.value = '';
  $patcherFileInfoRow.hidden = true;
  $patcherConvertBtn.hidden = true;
  $patcherProgressCard.hidden = true;
  $patcherErrorBox.hidden = true;
  $patcherResultCard.hidden = true;

  $patcherFileZone.querySelector('.file-zone-text').textContent = 'Tap to select a video';
  $patcherFileZone.querySelector('.file-zone-hint').textContent = 'Supports MP4, MOV, MKV, WebM, AVI';

  setTopbarStatus('idle', 'Ready');
}

// --- Processing History ---

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function addToHistory(result, success) {
  const history = getHistory();
  const activeFile = currentFile || patcherFile;
  const entry = {
    fileName: activeFile ? activeFile.file.name : 'unknown',
    mode: result.processMode || 'auto',
    originalSize: activeFile ? activeFile.file.size : 0,
    processedSize: result.processedSize || 0,
    processingTime: result.processingTime || (Date.now() - processStartTime),
    success,
    psnr: result.psnr || null,
    timestamp: Date.now(),
  };
  history.unshift(entry);
  saveHistory(history);
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(DOWNLOADS_KEY);
  populateDashboard();
  animateQuickStats();
}

function exportHistory() {
  const history = getHistory();
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tqe-history.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// --- Quick Stats (animated counters) ---

function animateQuickStats() {
  const history = getHistory();
  const total = history.length;
  const successes = history.filter(h => h.success).length;
  const successRate = total > 0 ? Math.round((successes / total) * 100) : 0;
  const mbOut = history.reduce((sum, h) => sum + (h.processedSize || 0), 0) / (1024 * 1024);
  const downloads = parseInt(localStorage.getItem(DOWNLOADS_KEY) || '0', 10);

  animateCounter('qsProcessed', total);
  animateCounter('qsSuccess', successRate);
  animateCounter('qsMbOut', Math.round(mbOut));
  animateCounter('qsDownloads', downloads);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 800;
  const start = performance.now();
  const from = 0;

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// --- Dashboard ---

function populateDashboard() {
  const history = getHistory();
  const total = history.length;
  const successes = history.filter(h => h.success).length;
  const failures = total - successes;
  const mbIn = history.reduce((sum, h) => sum + (h.originalSize || 0), 0) / (1024 * 1024);
  const mbOut = history.reduce((sum, h) => sum + (h.processedSize || 0), 0) / (1024 * 1024);
  const avgTime = total > 0
    ? history.reduce((sum, h) => sum + (h.processingTime || 0), 0) / total / 1000
    : 0;
  const downloads = parseInt(localStorage.getItem(DOWNLOADS_KEY) || '0', 10);
  const successRate = total > 0 ? Math.round((successes / total) * 100) : 0;
  const psnrs = history.filter(h => h.psnr && h.psnr > 0).map(h => h.psnr);
  const bestPsnr = psnrs.length > 0 ? Math.max(...psnrs) : null;

  // KPIs
  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiSuccess').textContent = successes;
  document.getElementById('kpiFailed').textContent = failures;
  document.getElementById('kpiMbIn').textContent = mbIn.toFixed(1);
  document.getElementById('kpiMbOut').textContent = mbOut.toFixed(1);
  document.getElementById('kpiAvgTime').textContent = avgTime > 0 ? avgTime.toFixed(1) + 's' : '0s';
  document.getElementById('kpiDownloads').textContent = downloads;
  document.getElementById('kpiRate').textContent = successRate + '%';
  document.getElementById('kpiBestPsnr').textContent = bestPsnr ? bestPsnr.toFixed(1) : '--';

  // Quality Proof
  const avgPsnr = psnrs.length > 0 ? (psnrs.reduce((a, b) => a + b, 0) / psnrs.length) : 0;
  document.getElementById('qpAvgVal').textContent = avgPsnr > 0 ? avgPsnr.toFixed(1) : '--';

  const last5 = history.filter(h => h.psnr && h.psnr > 0).slice(0, 5);
  const $qpScores = document.getElementById('qpScores');
  if (last5.length > 0) {
    $qpScores.innerHTML = last5.map(h => {
      let cls = 'fair', txt = 'Fair';
      if (h.psnr > 45) { cls = 'excellent'; txt = 'Excellent'; }
      else if (h.psnr > 40) { cls = 'good'; txt = 'Good'; }
      const name = h.fileName.length > 20 ? h.fileName.substring(0, 20) + '...' : h.fileName;
      return `<div class="qp-score-row"><span class="qp-file">${escapeHtml(name)}</span><span class="quality-badge ${cls}">${h.psnr.toFixed(1)} dB</span></div>`;
    }).join('');
  } else {
    $qpScores.innerHTML = '<div class="qp-empty">No quality data yet</div>';
  }

  // Mode Breakdown
  const modes = { itsscale: 0, reencode: 0, remux: 0 };
  history.forEach(h => {
    const m = (h.mode || '').toLowerCase();
    if (m === 'itsscale') modes.itsscale++;
    else if (m === 'reencode' || m === 're-encode') modes.reencode++;
    else if (m === 'remux') modes.remux++;
  });
  const maxMode = Math.max(modes.itsscale, modes.reencode, modes.remux, 1);

  document.getElementById('mbItsscale').style.width = (modes.itsscale / maxMode * 100) + '%';
  document.getElementById('mbItsscaleCount').textContent = modes.itsscale;
  document.getElementById('mbReencode').style.width = (modes.reencode / maxMode * 100) + '%';
  document.getElementById('mbReencodeCount').textContent = modes.reencode;
  document.getElementById('mbRemux').style.width = (modes.remux / maxMode * 100) + '%';
  document.getElementById('mbRemuxCount').textContent = modes.remux;

  // Recent Activity
  const $activityList = document.getElementById('activityList');
  const recent = history.slice(0, 20);
  if (recent.length > 0) {
    $activityList.innerHTML = recent.map(h => {
      const name = h.fileName.length > 18 ? h.fileName.substring(0, 18) + '...' : h.fileName;
      const mode = (h.mode || 'auto').toLowerCase();
      let badgeBg = 'var(--cyan-d)';
      let badgeColor = 'var(--cyan)';
      if (mode === 'reencode' || mode === 're-encode') { badgeBg = 'var(--purple-d)'; badgeColor = 'var(--purple)'; }
      else if (mode === 'remux') { badgeBg = 'var(--green-d)'; badgeColor = 'var(--green)'; }

      const sizeChange = h.originalSize > 0 && h.processedSize > 0
        ? formatSize(h.originalSize) + ' → ' + formatSize(h.processedSize)
        : '--';
      const status = h.success
        ? '<span class="activity-status ok">OK</span>'
        : '<span class="activity-status fail">FAIL</span>';

      return `<div class="activity-item">
        <span class="activity-name">${escapeHtml(name)}</span>
        <span class="activity-badge" style="background:${badgeBg};color:${badgeColor}">${escapeHtml(h.mode || 'auto')}</span>
        <span class="activity-size">${sizeChange}</span>
        ${status}
        <span class="activity-time">${relativeTime(h.timestamp)}</span>
      </div>`;
    }).join('');
  } else {
    $activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
  }
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  return days + 'd';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---

async function init() {
  // Check if already authenticated
  const status = await checkKeyStatus();
  if (status.active) {
    unlockApp(status);
  }

  // Load settings
  await loadSettings();

  // Bind events
  bindEvents();

  // Animate quick stats on load
  animateQuickStats();

  // Init patcher quality info display
  updatePatcherQualityInfo();
}

function unlockApp(status) {
  $lockScreen.hidden = true;
  $mainApp.hidden = false;
  updateKeyStatusBar(status);
}

function bindEvents() {
  // Key activation
  $keyBtn.addEventListener('click', async () => {
    const key = $keyInput.value.trim();
    if (!key) {
      $keyHint.textContent = 'Please enter a key';
      $keyHint.className = 'lock-hint error';
      return;
    }

    $keyBtn.disabled = true;
    $keyHint.textContent = 'Validating...';
    $keyHint.className = 'lock-hint';

    try {
      const result = await activateKey(key);
      if (result.success) {
        $keyHint.textContent = result.alreadyActive ? 'Key already active' : 'Key activated';
        $keyHint.className = 'lock-hint success';

        const status = await checkKeyStatus();
        setTimeout(() => unlockApp(status), 500);
      } else {
        $keyHint.textContent = result.reason || 'Invalid key';
        $keyHint.className = 'lock-hint error';
      }
    } catch (err) {
      $keyHint.textContent = 'Validation failed';
      $keyHint.className = 'lock-hint error';
    }

    $keyBtn.disabled = false;
  });

  // Enter key on input
  $keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $keyBtn.click();
  });

  // File picker
  $fileZone.addEventListener('click', () => $fileInput.click());
  $fileInput.addEventListener('change', () => {
    if ($fileInput.files.length > 0) {
      handleFileSelect($fileInput.files[0]);
    }
  });

  // Settings
  $processMode.addEventListener('change', () => {
    saveSettings();
    updateModeHint();
  });
  bindPillGroup($qualityPills, saveSettings);
  bindPillGroup($fpsPills, saveSettings);

  // Process button
  $processBtn.addEventListener('click', startProcessing);

  // Download / Share / Reset
  $downloadBtn.addEventListener('click', downloadResult);
  $shareBtn.addEventListener('click', shareResult);
  $resetBtn.addEventListener('click', resetUI);

  // Bottom nav
  $bottomNav.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    switchPage(item.dataset.target);
  });

  // Dashboard actions
  $exportBtn.addEventListener('click', exportHistory);
  $clearBtn.addEventListener('click', () => {
    if (confirm('Clear all processing history?')) {
      clearHistory();
    }
  });

  // Patcher
  $patcherFileZone.addEventListener('click', () => $patcherFileInput.click());
  $patcherFileInput.addEventListener('change', () => {
    if ($patcherFileInput.files.length > 0) handlePatcherFileSelect($patcherFileInput.files[0]);
  });
  bindPillGroup($patcherQuality, updatePatcherQualityInfo);
  bindPillGroup($patcherResolution);
  bindPillGroup($patcherFps);
  $patcherConvertBtn.addEventListener('click', startPatcherConversion);
  $patcherDownloadBtn.addEventListener('click', patcherDownload);
  $patcherResetBtn.addEventListener('click', resetPatcherUI);

  // Copy hashtags button
  const $copyTagsBtn = document.getElementById('copyTagsBtn');
  if ($copyTagsBtn) {
    $copyTagsBtn.addEventListener('click', () => {
      const tags = '#edit #football #fypシ #viral #footballtiktok #mbappe #kylianmbappé #vinicius #rodrygo #bellingham #footballedit #edits';
      navigator.clipboard.writeText(tags).then(() => {
        $copyTagsBtn.classList.add('copied');
        const origText = $copyTagsBtn.innerHTML;
        $copyTagsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
        setTimeout(() => {
          $copyTagsBtn.classList.remove('copied');
          $copyTagsBtn.innerHTML = origText;
        }, 2000);
      }).catch(() => {
        // Fallback: select text
        const textarea = document.createElement('textarea');
        textarea.value = tags;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        $copyTagsBtn.textContent = 'Copied!';
        setTimeout(() => { $copyTagsBtn.textContent = 'Copy All Hashtags'; }, 2000);
      });
    });
  }
}

// --- Start ---
init();
