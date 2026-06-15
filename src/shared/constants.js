/**
 * Shared constants used across the extension.
 */

// Message types for inter-component communication
export const MSG = {
  // Content <-> Background
  FILE_SELECTED: 'file-selected',
  FILE_PROCESSED: 'file-processed',
  PROCESSING_PROGRESS: 'processing-progress',
  PROCESSING_ERROR: 'processing-error',
  GET_STATUS: 'get-status',
  STATUS_UPDATE: 'status-update',

  // Background <-> Offscreen
  OFFSCREEN_READY: 'offscreen-ready',
  PROCESS_VIDEO: 'process-video',
  PROCESS_RESULT: 'process-result',
  PROCESS_PROGRESS: 'process-progress',

  // File transfer (chunked)
  FILE_CHUNK: 'file-chunk',
  FILE_CHUNK_ACK: 'file-chunk-ack',
  FILE_TRANSFER_COMPLETE: 'file-transfer-complete',
  FILE_TRANSFER_START: 'file-transfer-start',

  // Settings
  TOGGLE_ENABLED: 'toggle-enabled',
  GET_SETTINGS: 'get-settings',
  SETTINGS_UPDATED: 'settings-updated',

  // Analytics
  RECORD_UPLOAD: 'record-upload',
  GET_ANALYTICS: 'get-analytics',

  // Scheduling
  SCHEDULE_UPLOAD: 'schedule-upload',
  CANCEL_SCHEDULE: 'cancel-schedule',
  GET_QUEUE: 'get-queue',

  // Content script <-> injector (CustomEvent based)
  INJECTOR_FILE_INTERCEPTED: 'tqe-file-intercepted',
  INJECTOR_INJECT_FILE: 'tqe-inject-file',
  INJECTOR_HD_TOGGLE: 'tqe-hd-toggle',
  INJECTOR_UPLOAD_OBSERVED: 'tqe-upload-observed',
};

// TikTok upload URL patterns
export const TIKTOK_URLS = {
  UPLOAD_PAGE: /https:\/\/www\.tiktok\.com\/(upload|creator)/,
  UPLOAD_API: /https:\/\/.*tiktok\.com.*\/upload\//,
  VIDEO_PUBLISH: /https:\/\/.*tiktok\.com.*\/publish/,
};

// File transfer chunk size (1 MB)
export const CHUNK_SIZE = 1024 * 1024;

// Max file size for re-encoding (500 MB — same as overall limit)
export const MAX_REENCODE_SIZE = 500 * 1024 * 1024;

// Max file size for non-H.264 re-encoding (decode + encode = 2x memory)
export const MAX_REENCODE_SIZE_NON_H264 = 150 * 1024 * 1024;

// Threshold for low-memory encoding mode (reduced ref frames, no B-frames)
export const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;

// Max file size for any processing (500 MB)
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

// Processing modes
export const PROCESS_MODE = {
  REMUX: 'remux',
  REENCODE: 'reencode',
  ITSSCALE: 'itsscale',
  PASSTHROUGH: 'passthrough',
};

// Extension state
export const STATE = {
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  PROCESSING: 'processing',
  INJECTING: 'injecting',
  DONE: 'done',
  ERROR: 'error',
};

// FPS target presets
export const FPS_TARGET = {
  ORIGINAL: 'original',
  FPS_60: '60',
  FPS_120: '120',
};

// Quality presets
export const QUALITY_PRESET = {
  BALANCED: 'balanced',
  HIGH: 'high',
  ULTRA: 'ultra',
};

// Storage keys
export const STORAGE_KEYS = {
  ENABLED: 'enabled',
  AUTO_HD: 'autoHd',
  PROCESS_MODE: 'processMode',
  FPS_TARGET: 'fpsTarget',
  QUALITY_PRESET: 'qualityPreset',
  FPS60: 'fps60',
  ANALYTICS: 'analytics',
  UPLOAD_QUEUE: 'uploadQueue',
  LAST_UPLOAD: 'lastUpload',
  TIKTOK_ACCOUNT: 'tiktokAccount',
  TEMP_KEY: 'tempKey',
  TEMP_KEY_STATE: 'tempKeyState',
  DEVICE_ID: 'deviceId',
};
