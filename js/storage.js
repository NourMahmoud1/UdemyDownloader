/**
 * storage.js
 * Centralised LocalStorage wrapper and settings defaults.
 */

const Storage = {
  /**
   * Default values for all user-configurable settings.
   * Always extend this object instead of scattering magic strings throughout the code.
   */
  DEFAULTS: {
    default_folder:           'Udemy Download/',
    default_naming_template:  '{instructor}/{course}/{chapter}/{video_index}. {video_title}',
    default_quality:          '1080',
    default_subtitle:         'en_US',
    default_assets:           'true',
    api_delay:                '500',
    download_delay:           '2000',
  },

  /**
   * Persist any serialisable value under `key`.
   * @param {string} key
   * @param {*} data
   */
  save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },

  /**
   * Retrieve and deserialise a value from LocalStorage.
   * Returns `null` when the key does not exist.
   * @param {string} key
   * @returns {*|null}
   */
  load(key) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Retrieve a user setting, falling back to the value defined in `DEFAULTS`.
   * @param {string} key
   * @returns {string}
   */
  getSetting(key) {
    let val = localStorage.getItem(key) || Storage.DEFAULTS[key] || '';
    if (key === 'default_folder' && val && !val.match(/[\/\\]$/)) {
      val += '/';
    }
    return val;
  },

  /**
   * Remove a key from LocalStorage.
   * @param {string} key
   */
  remove(key) {
    localStorage.removeItem(key);
  },

  // ── Download-history helpers ───────────────────────────────────────────────

  /**
   * Returns the list of already-downloaded file paths for a given course.
   * @param {string|number} courseId
   * @returns {string[]}
   */
  getDownloadLog(courseId) {
    const raw = localStorage.getItem('CompletedDownloads_' + courseId);
    return JSON.parse(raw || '[]');
  },

  /**
   * Checks whether a particular file path has already been downloaded.
   * @param {string} filePath
   * @param {string|number} courseId
   * @returns {boolean}
   */
  isDownloaded(filePath, courseId) {
    return Storage.getDownloadLog(courseId).includes(filePath);
  },

  /**
   * Records a file path as downloaded for a given course.
   * @param {string} filePath
   * @param {string|number} courseId
   */
  markDownloaded(filePath, courseId) {
    const log = Storage.getDownloadLog(courseId);
    if (!log.includes(filePath)) {
      log.push(filePath);
      localStorage.setItem('CompletedDownloads_' + courseId, JSON.stringify(log));
    }
  },

  /**
   * Clears the download history for a course (allows re-downloading everything).
   * @param {string|number} courseId
   */
  clearDownloadLog(courseId) {
    localStorage.removeItem('CompletedDownloads_' + courseId);
  },
};
