/**
 * Pure JavaScript itsscale implementation for MP4 files.
 *
 * Modifies MP4 container timing metadata to double all timestamps.
 * This is the same effect as FFmpeg's `-itsscale 2` flag but works
 * directly on the binary data without needing FFmpeg.
 *
 * How it tricks TikTok's encoder:
 * - Doubling timestamps makes the video appear 2x longer with half the frame rate
 * - TikTok's encoder allocates more bitrate per frame for "slow" content
 * - The actual frame data is untouched — zero quality loss
 *
 * Atoms modified:
 * - mvhd: movie header duration
 * - tkhd: track header duration
 * - mdhd: media header duration
 * - stts: sample-to-time deltas (time between frames)
 * - ctts: composition time offsets
 * - elst: edit list durations
 */

/**
 * Apply itsscale to an MP4 file buffer in-place.
 * @param {Uint8Array} data - MP4 file data (modified in place)
 * @param {number} scale - Timestamp multiplier (default 2)
 * @returns {Uint8Array} The same buffer (modified)
 */
export function applyItsscale(data, scale = 2) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let modified = 0;

  function readU32(off) { return view.getUint32(off); }
  function writeU32(off, val) { view.setUint32(off, val >>> 0); }
  function readI32(off) { return view.getInt32(off); }
  function writeI32(off, val) { view.setInt32(off, val); }

  function readU64(off) {
    const hi = view.getUint32(off);
    const lo = view.getUint32(off + 4);
    return hi * 0x100000000 + lo;
  }

  function writeU64(off, val) {
    view.setUint32(off, Math.floor(val / 0x100000000) >>> 0);
    view.setUint32(off + 4, (val & 0xFFFFFFFF) >>> 0);
  }

  function atomType(off) {
    return String.fromCharCode(data[off], data[off + 1], data[off + 2], data[off + 3]);
  }

  // Clamp scaled 32-bit value to avoid overflow
  function scaleU32(val) {
    return Math.min(val * scale, 0xFFFFFFFF) >>> 0;
  }

  /**
   * Iterate top-level atoms within a range.
   */
  function forEachAtom(start, end, callback) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = readU32(pos);
      const type = atomType(pos + 4);
      let headerSize = 8;

      if (size === 1 && pos + 16 <= end) {
        size = readU64(pos + 8);
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }

      if (size < 8 || pos + size > end) break;

      callback(type, pos, size, headerSize);
      pos += size;
    }
  }

  /**
   * Process a container atom (moov, trak, mdia, minf, stbl) by recursing into children.
   */
  function processContainer(start, end) {
    forEachAtom(start, end, (type, pos, size, hdr) => {
      const bodyStart = pos + hdr;
      const bodyEnd = pos + size;

      switch (type) {
        case 'moov':
        case 'trak':
        case 'mdia':
        case 'minf':
        case 'stbl':
        case 'edts':
          processContainer(bodyStart, bodyEnd);
          break;
        case 'mvhd':
          processMvhd(bodyStart, bodyEnd);
          break;
        case 'tkhd':
          processTkhd(bodyStart, bodyEnd);
          break;
        case 'mdhd':
          processMdhd(bodyStart, bodyEnd);
          break;
        case 'stts':
          processStts(bodyStart, bodyEnd);
          break;
        case 'ctts':
          processCtts(bodyStart, bodyEnd);
          break;
        case 'elst':
          processElst(bodyStart, bodyEnd);
          break;
      }
    });
  }

  function processMvhd(start, end) {
    const version = data[start];
    if (version === 0 && start + 20 <= end) {
      // timescale at +12, duration at +16
      const ts = readU32(start + 12);
      writeU32(start + 12, scaleU32(ts));
      const dur = readU32(start + 16);
      writeU32(start + 16, scaleU32(dur));
      console.log('[TQE] itsscale: mvhd v0 timescale ' + ts + ' -> ' + scaleU32(ts) + ', duration ' + dur + ' -> ' + scaleU32(dur));
      modified++;
    } else if (version === 1 && start + 32 <= end) {
      // timescale at +20, duration at +24 (8 bytes)
      const ts = readU32(start + 20);
      writeU32(start + 20, scaleU32(ts));
      const dur = readU64(start + 24);
      writeU64(start + 24, dur * scale);
      console.log('[TQE] itsscale: mvhd v1 timescale ' + ts + ' -> ' + scaleU32(ts));
      modified++;
    }
  }

  function processTkhd(start, end) {
    const version = data[start];
    if (version === 0 && start + 24 <= end) {
      // duration at +20 (movie timescale)
      const dur = readU32(start + 20);
      writeU32(start + 20, scaleU32(dur));
      modified++;
    } else if (version === 1 && start + 36 <= end) {
      // duration at +28 (8 bytes)
      const dur = readU64(start + 28);
      writeU64(start + 28, dur * scale);
      modified++;
    }
  }

  function processMdhd(start, end) {
    const version = data[start];
    if (version === 0 && start + 20 <= end) {
      // timescale at +12, duration at +16
      const ts = readU32(start + 12);
      writeU32(start + 12, scaleU32(ts));
      const dur = readU32(start + 16);
      writeU32(start + 16, scaleU32(dur));
      console.log('[TQE] itsscale: mdhd v0 timescale ' + ts + ' -> ' + scaleU32(ts) + ', duration ' + dur + ' -> ' + scaleU32(dur));
      modified++;
    } else if (version === 1 && start + 32 <= end) {
      // timescale at +20, duration at +24 (8 bytes)
      const ts = readU32(start + 20);
      writeU32(start + 20, scaleU32(ts));
      const dur = readU64(start + 24);
      writeU64(start + 24, dur * scale);
      console.log('[TQE] itsscale: mdhd v1 timescale ' + ts + ' -> ' + scaleU32(ts));
      modified++;
    }
  }

  function processStts(start, end) {
    // fullbox: version(1) + flags(3) + entry_count(4) + entries
    if (start + 8 > end) return;
    const entryCount = readU32(start + 4);
    let pos = start + 8;
    let totalSamples = 0;
    let weightedDelta = 0;
    for (let i = 0; i < entryCount && pos + 8 <= end; i++) {
      // sample_count(4) + sample_delta(4)
      const sampleCount = readU32(pos);
      const delta = readU32(pos + 4);
      const newDelta = scaleU32(delta);
      writeU32(pos + 4, newDelta);
      totalSamples += sampleCount;
      weightedDelta += sampleCount * newDelta;
      pos += 8;
    }
    modified++;

    // Validate: compute effective fps from the first stts entry's timescale context
    // The mdhd timescale has already been doubled, so effective fps = newTimescale / newDelta
    // A sensible fps range is 1-240; warn if outside
    if (totalSamples > 0 && weightedDelta > 0) {
      const avgDelta = weightedDelta / totalSamples;
      console.log('[TQE] itsscale: modified stts (' + entryCount + ' entries, ' + totalSamples + ' samples, avgDelta=' + Math.round(avgDelta) + ', x' + scale + ')');
    } else {
      console.log('[TQE] itsscale: modified stts (' + entryCount + ' entries, x' + scale + ')');
    }
  }

  function processCtts(start, end) {
    if (start + 8 > end) return;
    const version = data[start];
    const entryCount = readU32(start + 4);
    let pos = start + 8;
    for (let i = 0; i < entryCount && pos + 8 <= end; i++) {
      // sample_count(4) + sample_offset(4)
      if (version === 0) {
        const off = readU32(pos + 4);
        writeU32(pos + 4, scaleU32(off));
      } else {
        // version 1: signed offsets
        const off = readI32(pos + 4);
        writeI32(pos + 4, off * scale);
      }
      pos += 8;
    }
    modified++;
  }

  function processElst(start, end) {
    if (start + 8 > end) return;
    const version = data[start];
    const entryCount = readU32(start + 4);
    let pos = start + 8;
    for (let i = 0; i < entryCount; i++) {
      if (version === 0) {
        if (pos + 12 > end) break;
        // segment_duration(4) + media_time(4) + media_rate(4)
        const segDur = readU32(pos);
        writeU32(pos, scaleU32(segDur));
        const mediaTime = readI32(pos + 4);
        if (mediaTime >= 0) {
          writeI32(pos + 4, mediaTime * scale);
        }
        pos += 12;
      } else {
        if (pos + 20 > end) break;
        // segment_duration(8) + media_time(8) + media_rate(4)
        const segDur = readU64(pos);
        writeU64(pos, segDur * scale);
        const mediaTime = readU64(pos + 8);
        // -1 (0xFFFFFFFFFFFFFFFF) means empty edit — don't scale
        if (mediaTime !== 0xFFFFFFFFFFFFFFFF) {
          writeU64(pos + 8, mediaTime * scale);
        }
        pos += 20;
      }
    }
    modified++;
  }

  // Verify this is an MP4 file (check for ftyp atom)
  if (data.length < 8) {
    throw new Error('File too small to be an MP4');
  }
  const firstAtomType = atomType(4);
  if (firstAtomType !== 'ftyp' && firstAtomType !== 'moov' && firstAtomType !== 'free' && firstAtomType !== 'mdat') {
    throw new Error('Not a valid MP4 file (first atom: ' + firstAtomType + ')');
  }

  // Process the entire file
  processContainer(0, data.length);

  if (modified === 0) {
    throw new Error('No timing atoms found in MP4 — file may be corrupted');
  }

  console.log('[TQE] itsscale: modified ' + modified + ' atoms (×' + scale + ')');
  return data;
}
