/**
 * app.js
 * Main application controller.
 * Orchestrates authentication, course/playlist loading, and bulk-download events.
 *
 * Depends on: utils.js, storage.js, api.js, download-manager.js, ui.js
 * (all loaded before this file via <script> tags in popup.html)
 */

const App = {
  /** Currently selected course ID */
  CourseId: null,

  /** Raw course API data ({ Data: { results: [] } }) */
  CourseData: null,

  /** Normalised video/article objects currently shown in the DataTable */
  data: [],

  /** Current DataTable mode: 'Course' | 'Download' */
  type: null,

  /** Number of API errors encountered during the last playlist fetch */
  errors: 0,

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * Entry point — called once on DOMContentLoaded.
   * Checks login state, then either shows the app or redirects to login.
   */
  init() {
    // Set version string in sidebar
    const manifest = chrome.runtime.getManifest();
    $('.version').text('v' + manifest.version);
    $('title').text(manifest.name + ' v' + manifest.version);

    UdemyAPI.initFromCookies((isLoggedIn) => {
      if (isLoggedIn) {
        App._setupLoggedIn();
      } else {
        App._showLoginPrompt();
      }
    });

    App._bindBulkDownloadEvents();
  },

  /** @private */
  _setupLoggedIn() {
    $('.sonar-wrapper').hide();
    $('.btn-container').show();

    $('#analyze').on('click', () => {
      $('.btn-container').hide();
      $('#analyze').prop('disabled', true).text('Analyzing…');
      $('.sonar-wrapper').show();
      $('#total-text').text('Please wait, analyzing…');
      setTimeout(() => App.loadCourses(), 1000);
    });
  },

  /** @private */
  _showLoginPrompt() {
    $('body').empty().html('<i>Please log in on Udemy and restart the extension.</i>');
    chrome.tabs.create({ url: UdemyAPI.domain + '/join/login-popup/' }, () => {});
  },

  // ── Bulk download events ──────────────────────────────────────────────────

  /** @private */
  _bindBulkDownloadEvents() {
    // "Start Bulk Download" confirms preferences then triggers the queue
    $('#startBulkDownloadBtn').on('click', () => {
      $('#bulkDownloadModal').modal('hide');

      const quality      = $('#bulkQualitySelect').val();
      const subtitle     = $('#bulkSubtitleSelect').val();
      const includeAssets = $('#bulkAssetsCheck').is(':checked');
      const folder       = Storage.getSetting('default_folder');
      const template     = Storage.getSetting('default_naming_template');

      const courseDetail = App.CourseData.Data.results.find((c) => c.id == App.CourseId);

      const queue = DownloadManager.buildQueue(App.data, courseDetail, {
        quality,
        subtitle,
        assets:   includeAssets,
        folder,
        template,
      });

      DownloadManager.startSequential(queue, App.CourseId, () => {
        console.log('[App] Bulk download complete.');
      });
    });

    // "Clear Download Cache" for the current course
    $('#clearCourseLogBtn').on('click', () => {
      if (App.CourseId) {
        Storage.clearDownloadLog(App.CourseId);
        alert('Download history cleared for this course.');
      } else {
        alert('Open a course first.');
      }
    });
  },

  // ── Data loading ──────────────────────────────────────────────────────────

  /**
   * Fetches and renders the subscribed-course list.
   */
  loadCourses() {
    try {
      const data = UdemyAPI.fetchCourses();
      UI.renderCourseList(data);
    } catch (err) {
      console.error('[App] Failed to load courses:', err);
    }
  },

  /**
   * Fetches and renders the video list for a given course.
   * @param {string|number} courseId
   */
  async loadPlaylist(courseId) {
    App.CourseId = courseId;
    App.errors   = 0;

    UI.showLoading();
    $('#example').empty();
    $('#counter').show();
    UI.updateCounter({ Current: 0, Total: 0 });

    try {
      const videoList = await UdemyAPI.buildVideoList(courseId, (current, total) => {
        UI.updateCounter({ Current: current, Total: total });
      });

      UI.renderPlaylist(videoList);
    } catch (err) {
      console.error('[App] Failed to load playlist:', err);
    }
  },
};

// ── Initialise after DOM is ready ─────────────────────────────────────────────
$(document).ready(() => {
  App.init();
});
