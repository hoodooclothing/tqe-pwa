/**
 * FFmpeg.wasm video processing engine for the PWA.
 *
 * Adapted from src/offscreen/offscreen.js:
 * - No chrome.runtime messaging — uses callback for progress
 * - No chunked base64 transfer — returns Uint8Array directly
 * - Relative paths for FFmpeg core/WASM files
 * - Mobile-specific file size limits
 */
import { determineProcessingMode, buildReencodeArgs, buildRemuxArgs } from '../../src/shared/video-params.js';
import { applyItsscale } from '../../src/shared/mp4-itsscale.js';
import { PROCESS_MODE } from '../../src/shared/constants.js';

// Mobile-specific limits (lower than extension to prevent WASM OOM on phones)
const MAX_FILE_SIZE = 250 * 1024 * 1024;         // 250 MB overall
const MAX_REENCODE_SIZE = 150 * 1024 * 1024;      // 150 MB for H.264 re-encode
const MAX_REENCODE_SIZE_NON_H264 = 75 * 1024 * 1024; // 75 MB for non-H.264 re-encode
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;   // 100 MB triggers low-memory mode

// Timeouts
const ANALYZE_TIMEOUT = 120_000;
const REENCODE_TIMEOUT = 1_800_000;
const REMUX_TIMEOUT = 120_000;
const QUALITY_TIMEOUT = 120_000;

let ffmpeg = null;
let ffmpegLoaded = false;
let ffmpegLoadPromise = null;
let isEncoding = false;
let progressCallback = null;

/**
 * Set a progress callback.
 * @param {function(number): void} cb - Called with progress 0-1
 */
export function setProgressCallback(cb) {
  progressCallback = cb;
}

function reportProgress(p) {
  if (progressCallback) progressCallback(Math.max(0, Math.min(1, p)));
}

/**
 * Load FFmpeg.wasm.
 */
export async function loadFFmpeg() {
  if (ffmpegLoaded) return;
  if (ffmpegLoadPromise) {
    await ffmpegLoadPromise;
    return;
  }

  ffmpegLoadPromise = (async () => {
    const { FFmpeg } = self.FFmpegWASM;
    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      const p = Math.max(0, Math.min(1, progress));
      const scaled = isEncoding ? 0.10 + p * 0.80 : p;
      reportProgress(scaled);
    });

    // Resolve FFmpeg core/WASM paths relative to this script
    const baseUrl = new URL('.', import.meta.url).href;
    const libBase = new URL('../lib/ffmpeg/', baseUrl).href;

    await ffmpeg.load({
      coreURL: libBase + 'ffmpeg-core.js',
      wasmURL: libBase + 'ffmpeg-core.wasm',
    });

    ffmpegLoaded = true;
    console.log('[TQE] FFmpeg.wasm loaded');
  })();

  try {
    await ffmpegLoadPromise;
  } catch (err) {
    console.error('[TQE] Failed to load FFmpeg:', err);
    ffmpegLoadPromise = null;
    throw err;
  }
}

// --- Video Analysis ---

async function analyzeVideo(inputName, ext) {
  await loadFFmpeg();

  const info = {
    codec: '',
    codecLong: '',
    profile: '',
    container: ext.replace('.', ''),
    bitrate: 0,
    width: 0,
    height: 0,
    fps: 0,
    duration: 0,
    audioCodec: '',
    audioBitrate: 0,
    audioSampleRate: 0,
    colorSpace: '',
  };

  const logLines = [];
  const logHandler = ({ message }) => { logLines.push(message); };
  ffmpeg.on('log', logHandler);

  try {
    await ffmpeg.exec(['-i', inputName, '-f', 'null', '-t', '0.01', '-'], ANALYZE_TIMEOUT);
  } catch (e) { /* expected */ }

  ffmpeg.off('log', logHandler);

  const fullLog = logLines.join('\n');

  const videoLine = logLines.find(l => l.includes('Video:'));
  if (videoLine) {
    const codecMatch = videoLine.match(/Video:\s*(\w+)/);
    if (codecMatch) info.codec = codecMatch[1];

    const profileMatch = videoLine.match(/Video:\s*\w+\s*\((\w+)\)/);
    if (profileMatch) info.profile = profileMatch[1];

    const resMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
    if (resMatch) {
      info.width = parseInt(resMatch[1]);
      info.height = parseInt(resMatch[2]);
    }

    const csMatch = videoLine.match(/(?:bt709|bt470|bt2020|smpte170m|smpte240m)/i);
    if (csMatch) info.colorSpace = csMatch[0];

    const pixMatch = videoLine.match(/yuv\w+/);
    if (pixMatch) info.pixelFormat = pixMatch[0];

    const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
    if (fpsMatch) info.fps = parseFloat(fpsMatch[1]);

    if (!info.fps) {
      const tbrMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*tbr/);
      if (tbrMatch) info.fps = parseFloat(tbrMatch[1]);
    }

    const vbrMatch = videoLine.match(/(\d+)\s*kb\/s/);
    if (vbrMatch) info.bitrate = parseInt(vbrMatch[1]) * 1000;
  }

  if (!info.bitrate) {
    const brMatch = fullLog.match(/bitrate:\s*(\d+)\s*kb\/s/);
    if (brMatch) info.bitrate = parseInt(brMatch[1]) * 1000;
  }

  if (!info.fps) {
    const fpsMatch = fullLog.match(/(\d+(?:\.\d+)?)\s*fps/);
    if (fpsMatch) info.fps = parseFloat(fpsMatch[1]);
  }

  const audioLine = logLines.find(l => l.includes('Audio:'));
  if (audioLine) {
    const acMatch = audioLine.match(/Audio:\s*(\w+)/);
    if (acMatch) info.audioCodec = acMatch[1];

    const abrMatch = audioLine.match(/(\d+)\s*kb\/s/);
    if (abrMatch) info.audioBitrate = parseInt(abrMatch[1]) * 1000;

    const asrMatch = audioLine.match(/(\d{4,6})\s*Hz/);
    if (asrMatch) info.audioSampleRate = parseInt(asrMatch[1]);
  }

  const durMatch = fullLog.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (durMatch) {
    info.duration = parseInt(durMatch[1]) * 3600 +
                    parseInt(durMatch[2]) * 60 +
                    parseInt(durMatch[3]) +
                    parseInt(durMatch[4]) / 100;
  }

  return info;
}

// --- Quality Scoring ---

async function computeQualityScore(originalName, processedName) {
  const logLines = [];
  const logHandler = ({ message }) => { logLines.push(message); };
  ffmpeg.on('log', logHandler);

  try {
    await ffmpeg.exec([
      '-i', processedName,
      '-i', originalName,
      '-lavfi', 'psnr',
      '-f', 'null',
      '-t', '5',
      '-',
    ], QUALITY_TIMEOUT);
  } catch (e) { /* expected */ }

  ffmpeg.off('log', logHandler);

  const fullLog = logLines.join('\n');
  const result = { psnr: null, ssim: null };

  const psnrMatch = fullLog.match(/PSNR.*?average:([\d.]+)/);
  if (psnrMatch) {
    result.psnr = parseFloat(psnrMatch[1]);
  }

  return result;
}

// --- Utility ---

function getExtension(fileName) {
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : '.mp4';
}

/**
 * Process a video file.
 *
 * @param {Uint8Array} fileData - Raw video bytes
 * @param {string} fileName - Original file name
 * @param {Object} settings - Processing settings
 * @returns {Promise<Object>} Processing result
 */
export async function processVideo(fileData, fileName, settings = {}) {
  const startTime = Date.now();
  let videoInfo = {};
  let processMode = PROCESS_MODE.REMUX;
  let qualityScore = null;
  const originalSize = fileData.length;

  // Enforce mobile file size limit
  if (originalSize > MAX_FILE_SIZE) {
    const sizeMB = Math.round(originalSize / 1024 / 1024);
    throw new Error(`File too large (${sizeMB}MB). Maximum is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB for mobile processing.`);
  }

  try {
    await loadFFmpeg();

    const ts = Date.now();
    const ext = getExtension(fileName);
    const inputName = `input_${ts}${ext}`;
    const outputName = `output_${ts}.mp4`;

    reportProgress(0.02);
    await ffmpeg.writeFile(inputName, fileData);
    fileData = null; // allow GC

    // Step 1: Analyze
    let analysisOk = true;
    reportProgress(0.05);
    try {
      videoInfo = await analyzeVideo(inputName, ext);
      console.log('[TQE] Video info:', JSON.stringify(videoInfo));
    } catch (analysisErr) {
      console.warn('[TQE] Analysis failed:', analysisErr.message, '— guessing from extension');
      analysisOk = false;
      const h264Exts = ['.mp4', '.m4v', '.mov'];
      videoInfo = {
        codec: h264Exts.includes(ext) ? 'h264' : '',
        container: ext.replace('.', ''),
        width: 0, height: 0, fps: 0, duration: 0,
        bitrate: 0, audioCodec: '', audioBitrate: 0,
        audioSampleRate: 0, colorSpace: '',
      };
      if (analysisErr.message?.includes('memory') || analysisErr.message?.includes('out of bounds')) {
        ffmpegLoaded = false;
        ffmpegLoadPromise = null;
        ffmpeg = null;
        throw new Error('Video analysis ran out of memory. Try a smaller file.');
      }
    }
    reportProgress(0.08);

    // Step 2: Determine processing mode
    processMode = determineProcessingMode(videoInfo, settings);
    console.log('[TQE] Processing mode:', processMode);

    if (!analysisOk && processMode === PROCESS_MODE.REENCODE) {
      console.log('[TQE] Analysis failed — falling back to remux');
      processMode = PROCESS_MODE.REMUX;
    }

    if (processMode === PROCESS_MODE.REENCODE) {
      const codec = (videoInfo.codec || '').toLowerCase();
      const isH264 = ['h264', 'avc1', 'avc'].some(c => codec.includes(c));

      if (isH264 && originalSize > MAX_REENCODE_SIZE) {
        console.log('[TQE] H.264 file too large for re-encode, falling back to remux');
        processMode = PROCESS_MODE.REMUX;
      } else if (!isH264 && originalSize > MAX_REENCODE_SIZE_NON_H264) {
        console.log('[TQE] Non-H.264 file too large for re-encode, falling back to remux');
        processMode = PROCESS_MODE.REMUX;
      }
    }

    // Step 3: Process
    let args;
    if (processMode === PROCESS_MODE.REENCODE) {
      args = buildReencodeArgs(inputName, outputName, videoInfo, { ...settings, originalSize });
    } else if (processMode === PROCESS_MODE.ITSSCALE) {
      console.log('[TQE] Applying pure JS itsscale...');
      const rawData = await ffmpeg.readFile(inputName);
      const fps = videoInfo.fps || 30;
      const scaleVal = fps > 60 ? 6 : 2;
      try {
        applyItsscale(rawData, scaleVal);
        console.log('[TQE] itsscale applied (x' + scaleVal + ')');
      } catch (itsErr) {
        console.warn('[TQE] JS itsscale failed:', itsErr.message, '— continuing with unmodified data');
      }
      await ffmpeg.writeFile(inputName, rawData);
      args = ['-i', inputName, '-c', 'copy', '-movflags', '+faststart', '-map_metadata', '-1', '-y', outputName];
    } else {
      args = buildRemuxArgs(inputName, outputName);
    }

    const timeout = processMode === PROCESS_MODE.REENCODE ? REENCODE_TIMEOUT : REMUX_TIMEOUT;
    console.log('[TQE] FFmpeg args:', args.join(' '));
    reportProgress(0.10);
    isEncoding = true;
    let exitCode;

    try {
      exitCode = await ffmpeg.exec(args, timeout);
    } catch (execErr) {
      const isMemErr = execErr.message?.includes('memory') || execErr.message?.includes('out of bounds');
      if (processMode === PROCESS_MODE.REENCODE && isMemErr) {
        console.warn('[TQE] Re-encode OOM — reloading FFmpeg and retrying as remux');
        isEncoding = false;
        ffmpegLoaded = false;
        ffmpegLoadPromise = null;
        ffmpeg = null;
        await loadFFmpeg();
        throw new Error('Re-encode ran out of memory. Try using Remux mode, or use a smaller file.');
      }
      throw execErr;
    }

    // Remux fallback without BSF
    if (exitCode !== 0 && processMode === PROCESS_MODE.REMUX) {
      console.warn('[TQE] Remux failed (exit code ' + exitCode + '), retrying without BSF');
      try { await ffmpeg.deleteFile(outputName); } catch (e) {}
      const fallbackArgs = [
        '-i', inputName,
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
        '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=none',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        '-y', outputName,
      ];
      console.log('[TQE] Fallback args:', fallbackArgs.join(' '));
      exitCode = await ffmpeg.exec(fallbackArgs, timeout);
    }

    isEncoding = false;

    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode} — processing may have failed or timed out`);
    }

    // Step 4: Quality scoring (re-encodes only, skip for large files)
    let outputInfo = null;
    const skipScoring = originalSize > LARGE_FILE_THRESHOLD;
    if (processMode === PROCESS_MODE.REENCODE) {
      if (skipScoring) {
        console.log('[TQE] Large file — skipping quality scoring');
        try { await ffmpeg.deleteFile(inputName); } catch (e) {}
      } else {
        reportProgress(0.91);
        try {
          qualityScore = await computeQualityScore(inputName, outputName);
          console.log('[TQE] Quality score:', qualityScore);
        } catch (e) {
          console.warn('[TQE] Quality scoring failed:', e.message);
        }
      }

      reportProgress(0.94);
      try {
        outputInfo = await analyzeVideo(outputName, '.mp4');
      } catch (e) {}
    } else {
      console.log(`[TQE] ${processMode} done — freeing input`);
      try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    }

    // Read output
    reportProgress(0.96);
    let outputData;
    try {
      outputData = await ffmpeg.readFile(outputName);
    } catch (e) {
      throw new Error('Output file not found — FFmpeg likely failed to produce output');
    }
    const processedSize = outputData.length;
    reportProgress(0.97);

    // Clean up
    try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    try { await ffmpeg.deleteFile(outputName); } catch (e) {}

    const processingTime = Date.now() - startTime;
    console.log(`[TQE] Done: ${processMode}, ${originalSize} -> ${processedSize} bytes, ${processingTime}ms`);
    reportProgress(1.0);

    return {
      success: true,
      outputData,
      processMode,
      videoInfo,
      qualityScore,
      outputInfo,
      originalSize,
      processedSize,
      processingTime,
    };

  } catch (err) {
    isEncoding = false;
    let errMsg = err instanceof DOMException
      ? err.name + ': ' + err.message
      : (err.message || String(err));

    if (errMsg.includes('memory access out of bounds') || errMsg.includes('out of memory')) {
      const codec = (videoInfo.codec || '').toLowerCase();
      const extLower = getExtension(fileName);
      const h264ByCodec = ['h264', 'avc1', 'avc'].some(c => codec.includes(c));
      const h264ByExt = ['.mp4', '.m4v'].includes(extLower);
      const isH264 = h264ByCodec || (codec === '' && h264ByExt);
      const sizeMB = Math.round(originalSize / 1024 / 1024);
      if (isH264) {
        errMsg = `File too large for browser processing (${sizeMB}MB). Try a shorter clip or lower bitrate export.`;
      } else {
        errMsg = `File too large to re-encode in the browser (${sizeMB}MB). Export from your editor as H.264 (.mp4) instead.`;
      }

      ffmpegLoaded = false;
      ffmpegLoadPromise = null;
      ffmpeg = null;
    }

    console.error('[TQE] Processing failed:', errMsg, err);
    return {
      success: false,
      error: errMsg,
      processMode,
      videoInfo,
      qualityScore,
      originalSize,
      processedSize: 0,
      processingTime: Date.now() - startTime,
    };
  }
}
