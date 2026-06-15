/**
 * Optimal video parameters for TikTok uploads.
 *
 * TikTok always re-encodes server-side. The goal is to provide
 * the highest quality input to minimize quality loss during
 * their re-encoding.
 *
 * Key strategies:
 * - CRF (constant quality) instead of VBR (constant bitrate)
 * - BT.709 color tagging to prevent color shifts
 * - GOP aligned to 2-second intervals for clean keyframe boundaries
 * - Audio loudness normalized to -14 LUFS (TikTok's target)
 * - 60fps targeting (TikTok's native high-fps tier)
 * - Perceptual quality tuning (psy-rd, aq-mode)
 */

// Quality preset configurations
// Presets tuned for WASM speed. CRF drives quality — the preset/speed
// setting just controls how hard the encoder tries to compress.
// TikTok re-encodes server-side anyway, so diminishing returns past "fast".
const PRESETS = {
  balanced: {
    crf: '19',
    preset: 'veryfast',
    maxrate: '15M',
    bufsize: '30M',
    audioBitrate: '256k',
    x264Params: 'ref=2:bframes=2:rc-lookahead=10',
  },
  high: {
    crf: '17',
    preset: 'fast',
    maxrate: '25M',
    bufsize: '50M',
    audioBitrate: '320k',
    x264Params: 'ref=3:bframes=3:rc-lookahead=20',
  },
  ultra: {
    crf: '15',
    preset: 'medium',
    maxrate: '40M',
    bufsize: '80M',
    audioBitrate: '320k',
    x264Params: 'ref=4:bframes=3:me=hex:subme=7:trellis=1:rc-lookahead=30:aq-mode=3',
  },
};

export const TIKTOK_OPTIMAL = {
  codec: 'h264',
  profile: 'high',
  pixelFormat: 'yuv420p',
  maxLongSide: 1920,
  maxShortSide: 1080,
  maxFps: 120,
  audioCodec: 'aac',
  audioSampleRate: 48000,
  audioLoudnessTarget: -14,
  container: 'mp4',
};

export const QUALITY_THRESHOLDS = {
  LOW_BITRATE: 3_000_000,
  HIGH_BITRATE: 8_000_000,
  GOOD_CODECS: ['h264', 'avc1', 'avc'],
  BAD_CODECS: ['vp8', 'vp9', 'av1', 'mpeg4', 'mpeg2', 'hevc', 'h265'],
  NEEDS_REMUX: ['mkv', 'webm', 'avi', 'wmv', 'flv', 'mov'],
};

function exceedsResolution(width, height) {
  if (!width || !height) return false;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  return longSide > TIKTOK_OPTIMAL.maxLongSide || shortSide > TIKTOK_OPTIMAL.maxShortSide;
}

/**
 * Determine processing mode.
 *
 * HQ Upload (auto-intercept): itsscale for H.264 files (lossless timestamp
 * manipulation that tricks TikTok's encoder into using a higher quality profile),
 * reencode only for non-H.264 codecs that TikTok can't handle well.
 *
 * Video Patcher: always re-encodes (settings.isPatcher = true).
 *
 * itsscale applies:
 * - Timestamp doubling via -itsscale 2 (forces TikTok to allocate more bitrate)
 * - Lossless stream copy (no re-encoding, instant)
 * - Faststart + metadata strip
 */
export function determineProcessingMode(info, settings = {}) {
  // Video Patcher always re-encodes (user explicitly wants full processing)
  if (settings.isPatcher) {
    return 'reencode';
  }

  const userMode = (settings.processMode || 'auto').toLowerCase();

  // User explicitly chose a mode — respect it
  if (userMode === 'reencode') return 'reencode';
  if (userMode === 'itsscale') return 'itsscale';
  if (userMode === 'remux') return 'remux';
  if (userMode === 'off') return 'passthrough';

  // Auto mode: pick the best strategy based on codec
  const codec = (info.codec || '').toLowerCase();
  const isH264 = QUALITY_THRESHOLDS.GOOD_CODECS.some(c => codec.includes(c));

  // H.264 files: itsscale (lossless timestamp trick for higher quality)
  if (isH264) {
    return 'itsscale';
  }

  // Non-H.264 (VP9, HEVC, AV1, etc.): must re-encode to H.264
  return 'reencode';
}

/**
 * Build FFmpeg arguments for high-quality re-encoding.
 *
 * Supports quality presets (balanced/high/ultra) and FPS targeting (60/120).
 * 60fps is TikTok's native high-fps tier — uploading at exactly 60fps
 * maximizes the chance TikTok preserves it. 120fps gets dropped to 30.
 */
export function buildReencodeArgs(inputFile, outputFile, info = {}, settings = {}) {
  const qualityPreset = settings.qualityPreset || 'high';
  const fpsTarget = settings.fpsTarget || 'original';
  const originalSize = settings.originalSize || 0;
  const preset = PRESETS[qualityPreset] || PRESETS.high;

  // Use low-memory settings for large files to avoid WASM OOM
  const LARGE_THRESHOLD = 100 * 1024 * 1024; // 100 MB
  const lowMemory = originalSize > LARGE_THRESHOLD;

  const args = ['-i', inputFile];

  // === VIDEO ===
  args.push('-c:v', 'libx264');
  args.push('-profile:v', 'high');
  args.push('-level', '4.2');
  args.push('-pix_fmt', 'yuv420p');

  // CRF mode
  args.push('-crf', preset.crf);
  args.push('-maxrate', preset.maxrate);
  args.push('-bufsize', lowMemory ? '15M' : preset.bufsize);
  args.push('-preset', lowMemory ? 'veryfast' : preset.preset);

  // x264 advanced params — reduce ref frames and lookahead for large files
  if (lowMemory) {
    args.push('-x264-params', 'ref=1:bframes=0:rc-lookahead=5');
  } else {
    args.push('-x264-params', preset.x264Params);
  }

  // BT.709 color tagging
  args.push('-color_primaries', 'bt709');
  args.push('-color_trc', 'bt709');
  args.push('-colorspace', 'bt709');

  // Video filters
  const vFilters = [];

  const { width = 0, height = 0 } = info;
  if (exceedsResolution(width, height)) {
    if (width >= height) {
      vFilters.push(`scale=min(${TIKTOK_OPTIMAL.maxLongSide}\\,iw):min(${TIKTOK_OPTIMAL.maxShortSide}\\,ih):force_original_aspect_ratio=decrease:flags=lanczos`);
    } else {
      vFilters.push(`scale=min(${TIKTOK_OPTIMAL.maxShortSide}\\,iw):min(${TIKTOK_OPTIMAL.maxLongSide}\\,ih):force_original_aspect_ratio=decrease:flags=lanczos`);
    }
    vFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
  }

  if (vFilters.length > 0) {
    args.push('-vf', vFilters.join(','));
  }

  // FPS handling — TikTok natively supports 30fps and 60fps.
  // Uploading at exactly 60fps gives the best chance TikTok serves 60fps.
  // 120fps is non-standard and TikTok typically drops it to 30fps.
  const sourceFps = info.fps || 30;
  const targetFps = fpsTarget === '120' ? 120 : fpsTarget === '60' ? 60 : 0;

  if (targetFps > 0 && sourceFps < targetFps) {
    args.push('-r', String(targetFps));
  } else if (targetFps > 0 && sourceFps > targetFps) {
    // Source is higher than target — conform down (e.g. 120fps source to 60fps)
    args.push('-r', String(targetFps));
  } else if (sourceFps > TIKTOK_OPTIMAL.maxFps) {
    args.push('-r', String(TIKTOK_OPTIMAL.maxFps));
  }

  // GOP: keyframe every 2 seconds based on output fps
  const effectiveFps = targetFps > 0 ? Math.max(sourceFps, targetFps) : sourceFps;
  const cappedFps = Math.min(effectiveFps, TIKTOK_OPTIMAL.maxFps);
  const gopSize = Math.round(cappedFps * 2);
  args.push('-g', String(gopSize));
  args.push('-keyint_min', String(Math.round(gopSize / 2)));

  // === AUDIO ===
  args.push('-c:a', TIKTOK_OPTIMAL.audioCodec);
  args.push('-b:a', preset.audioBitrate);
  args.push('-ar', String(TIKTOK_OPTIMAL.audioSampleRate));
  args.push('-ac', '2');

  // Audio loudness normalization to -14 LUFS
  args.push('-af', `loudnorm=I=${TIKTOK_OPTIMAL.audioLoudnessTarget}:TP=-1.5:LRA=11:print_format=none`);

  // === CONTAINER ===
  args.push('-movflags', '+faststart');
  args.push('-map_metadata', '-1');

  args.push('-y', outputFile);
  return args;
}

/**
 * Build enhanced remux args.
 *
 * Video: lossless copy + BT.709 color metadata injection via bitstream filter.
 * Audio: re-encode to AAC with loudness normalization to -14 LUFS.
 * Container: faststart for streaming, metadata stripped.
 *
 * This ensures every H.264 file gets audio normalization and correct color
 * tagging without any video quality loss.
 */
export function buildRemuxArgs(inputFile, outputFile) {
  return [
    '-i', inputFile,
    // Video: copy stream losslessly
    '-c:v', 'copy',
    // Inject BT.709 color info into H.264 bitstream (lossless SPS edit)
    '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    // Audio: re-encode with loudness normalization
    '-c:a', TIKTOK_OPTIMAL.audioCodec,
    '-b:a', '320k',
    '-ar', String(TIKTOK_OPTIMAL.audioSampleRate),
    '-ac', '2',
    '-af', `loudnorm=I=${TIKTOK_OPTIMAL.audioLoudnessTarget}:TP=-1.5:LRA=11:print_format=none`,
    // Container
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-y', outputFile,
  ];
}

/**
 * Build itsscale remux args.
 *
 * The -itsscale trick manipulates the video's timestamp metadata to make
 * TikTok's server-side encoder allocate more bitrate per frame. This is
 * the same technique used by the "Haze Method" and Editing News extension.
 *
 * How it works:
 * - -itsscale 2 doubles input timestamps → TikTok sees a "slower" video
 * - TikTok's encoder allocates more bits per frame for slow/low-fps content
 * - -c copy means zero re-encoding — lossless, instant operation
 * - Result: TikTok re-encodes with a higher quality profile
 *
 * Scale values: 2 for <=60fps source, 6 for 120fps source (per Haze Method docs)
 */
export function buildItsscaleArgs(inputFile, outputFile, info = {}) {
  const fps = info.fps || 30;
  const scale = fps > 60 ? '6' : '2';

  return [
    '-itsscale', scale,
    '-i', inputFile,
    // Copy both video and audio losslessly (keeps timing in sync)
    '-c', 'copy',
    // Faststart for web streaming
    '-movflags', '+faststart',
    // Strip metadata
    '-map_metadata', '-1',
    '-y', outputFile,
  ];
}

/**
 * Build args to compute PSNR between original and processed.
 */
export function buildQualityCheckArgs(originalFile, processedFile) {
  return [
    '-i', processedFile,
    '-i', originalFile,
    '-lavfi', `ssim=stats_file=-;[0:v][1:v]psnr=stats_file=-`,
    '-f', 'null',
    '-'
  ];
}
