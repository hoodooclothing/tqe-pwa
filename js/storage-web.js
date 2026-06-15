/**
 * localStorage wrapper matching src/shared/storage.js API.
 * All keys are prefixed with `tqe_` to avoid collisions.
 */

const PREFIX = 'tqe_';

const DEFAULTS = {
  enabled: true,
  autoHd: true,
  processMode: 'auto',
  fpsTarget: '60',
  qualityPreset: 'high',
  analytics: [],
  uploadQueue: [],
  lastUpload: null,
  tempKey: null,
  tempKeyState: null,
  deviceId: null,
};

function readKey(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeKey(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

/**
 * Get one or more values from storage.
 * @param {string|string[]} keys
 * @returns {Promise<Object>}
 */
export async function get(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const result = {};
  for (const k of keyList) {
    const stored = readKey(k);
    result[k] = stored !== undefined ? stored : (k in DEFAULTS ? DEFAULTS[k] : undefined);
  }
  return result;
}

/**
 * Set one or more values in storage.
 * @param {Object} items
 * @returns {Promise<void>}
 */
export async function set(items) {
  for (const [key, value] of Object.entries(items)) {
    writeKey(key, value);
  }
}

/**
 * Get a single value from storage.
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getValue(key) {
  const result = await get(key);
  return result[key];
}
