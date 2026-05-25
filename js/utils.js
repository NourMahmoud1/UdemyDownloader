/**
 * utils.js
 * General-purpose utility helpers used across all modules.
 */

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Async iteration helper — runs an async callback for each element sequentially.
 * @param {Array} array
 * @param {Function} callback
 */
const asyncForEach = async (array, callback) => {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
};

/**
 * Escapes special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
const escapeRegExp = (str) =>
  str.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces all occurrences of `find` in `str` with `replace`.
 * @param {string} str
 * @param {string} find
 * @param {string} replace
 * @returns {string}
 */
const replaceAll = (str, find, replace) =>
  str.replace(new RegExp(escapeRegExp(find), 'g'), replace);

/**
 * Removes characters that are illegal in file/folder names.
 * Returns "Unknown" if the input is falsy.
 * @param {string} str
 * @returns {string}
 */
const sanitizeFilename = (str) => {
  if (!str) return 'Unknown';
  const invalid = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
  let result = str;
  invalid.forEach((char) => {
    result = replaceAll(result, char, '');
  });
  return result;
};

/**
 * Builds the output file path from a naming template and video/course metadata.
 *
 * Supported placeholders:
 *   {instructor}, {course}, {chapter}, {video_index}, {video_title}
 *
 * @param {string} template         - Naming template string
 * @param {object} videoDetails     - Video metadata object (TitleRaw, IndexRaw, Chapter, …)
 * @param {object} courseDetail     - Course metadata object (title, visible_instructors, …)
 * @param {string} [extension]      - File extension, e.g. ".mp4"
 * @param {string} [titleOverride]  - Optional title override (used for asset files)
 * @returns {string}
 */
const buildPath = (template, videoDetails, courseDetail, extension = '.mp4', titleOverride = null) => {
  let path = template || '{instructor}/{course}/{chapter}/{video_index}. {video_title}';

  const instructor =
    courseDetail.visible_instructors && courseDetail.visible_instructors.length > 0
      ? courseDetail.visible_instructors[0].display_name
      : 'Unknown Instructor';

  const course   = courseDetail.title || 'Unknown Course';
  const chapter  = videoDetails.Chapter || '';
  const idx      = videoDetails.IndexRaw || videoDetails.id;
  const title    = titleOverride || (videoDetails.TitleRaw
    ? videoDetails.TitleRaw
    : videoDetails.VideoTitle.replace(/<[^>]*>?/gm, ''));

  // If there is no chapter, remove the "{chapter}/" segment to avoid empty folders
  if (!chapter) {
    path = path.replace(/\{chapter\}\/?/g, '');
  }

  let result = path
    .replace(/\{instructor\}/g, sanitizeFilename(instructor))
    .replace(/\{course\}/g,     sanitizeFilename(course))
    .replace(/\{chapter\}/g,    sanitizeFilename(chapter))
    .replace(/\{video_index\}/g, sanitizeFilename(String(idx)))
    .replace(/\{video_title\}/g, sanitizeFilename(title));

  // Append extension if not already present
  if (!result.endsWith(extension)) {
    result += extension;
  }

  // Clean up any double slashes or leading slashes
  result = result.replace(/\/+/g, '/').replace(/^\/+/, '');
  return result;
};

// ── Download size / speed / ETA formatters ───────────────────────────────────

/**
 * Formats a byte count into a human-readable string (KB, MB, GB).
 * @param {number} bytes
 * @param {number} [decimals=1]
 * @returns {string}
 */
const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes <= 0) return '—';
  const k     = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i     = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
};

/**
 * Formats bytes-per-second into a human-readable speed string.
 * @param {number} bytesPerSec
 * @returns {string}
 */
const formatSpeed = (bytesPerSec) => {
  if (!bytesPerSec || bytesPerSec <= 0) return '—';
  return formatBytes(bytesPerSec) + '/s';
};

/**
 * Formats a seconds value into a human-readable ETA string.
 * @param {number} seconds
 * @returns {string}
 */
const formatETA = (seconds) => {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
  if (seconds < 60)   return Math.round(seconds) + 's remaining';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m + 'm ' + String(s).padStart(2, '0') + 's remaining';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h + 'h ' + String(m).padStart(2, '0') + 'm remaining';
};

// ── Levelled logger ──────────────────────────────────────────────────────────

/**
 * Simple levelled logger.  Set Logger.level to filter output.
 * 0 = debug | 1 = info | 2 = warn | 3 = error
 */
const Logger = {
  level: 1,
  _tag:  '[UDL]',

  debug(...a) { if (this.level <= 0) console.debug(this._tag, ...a); },
  info(...a)  { if (this.level <= 1) console.info(this._tag,  ...a); },
  warn(...a)  { if (this.level <= 2) console.warn(this._tag,  ...a); },
  error(...a) { if (this.level <= 3) console.error(this._tag, ...a); },
};
