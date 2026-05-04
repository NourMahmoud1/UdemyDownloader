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

    // Initialise modern icons
    if (window.lucide) {
      lucide.createIcons();
    }

    UdemyAPI.initFromCookies((isLoggedIn) => {
      if (isLoggedIn) {
        App._setupLoggedIn();
      } else {
        App._showLoginPrompt();
      }
    });

    App._bindBulkDownloadEvents();
    App._bindCancelEvent();
    App._initSidebarToggle();
  },

  /** @private */
  _initSidebarToggle() {
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed || window.innerWidth < 1000) {
      $('#left-side').addClass('collapsed');
      $('#sidebarToggle i').attr('data-lucide', 'chevron-right');
    }

    if (window.lucide) { lucide.createIcons(); }

    $('#sidebarToggle').on('click', () => {
      App.toggleSidebar();
    });

    $(window).on('resize', () => {
      if (window.innerWidth < 1000 && !$('#left-side').hasClass('collapsed')) {
        App.toggleSidebar(true);
      }
    });
  },

  /**
   * Toggles the sidebar state.
   * @param {boolean} [forceCollapse]
   */
  toggleSidebar(forceCollapse) {
    const $sidebar = $('#left-side');
    const $icon = $('#sidebarToggle i');

    if (forceCollapse === true) {
      $sidebar.addClass('collapsed');
    } else {
      $sidebar.toggleClass('collapsed');
    }

    const isNowCollapsed = $sidebar.hasClass('collapsed');
    localStorage.setItem('sidebar_collapsed', isNowCollapsed);

    // Update icon
    $icon.attr('data-lucide', isNowCollapsed ? 'chevron-right' : 'chevron-left');
    if (window.lucide) { lucide.createIcons(); }
  },

  /** @private */
  _setupLoggedIn() {
    // Keep sonar running on the hero — only hide it once the user clicks Analyze
    $('.btn-container').show();

    $('#analyze').html('<i data-lucide="search" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;"></i> My Courses');
    if (window.lucide) { lucide.createIcons(); }

    $('#analyze').on('click', () => {
      $('.btn-container').hide();
      $('#analyze').prop('disabled', true).text('Analyzing…');
      // sonar-wrapper is already visible; keep it showing during load
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

      const courseDetail = App.CourseData && App.CourseData.Data && App.CourseData.Data.results
        ? App.CourseData.Data.results.find((c) => c.id == App.CourseId)
        : null;

      if (!courseDetail) {
        UI.showToast('Course data unavailable. Please re-load the course.', 'alert-circle');
        return;
      }

      const queue = DownloadManager.buildQueue(App.data, courseDetail, {
        quality,
        subtitle,
        assets:   includeAssets,
        folder,
        template,
      });

      // Auto-generate the tracker sheet alongside the bulk download
      SheetGenerator.generate(App.data, courseDetail, folder);

      DownloadManager.startSequential(queue, App.CourseId, () => {
        console.log('[App] Bulk download complete.');
        App._reEnableButtons();
      });
    });

    // "Download Tracker Sheet" — generate xlsx from current playlist
    $('#downloadTrackerSheetBtn').on('click', () => {
      if (!App.data || App.data.length === 0) {
        UI.showToast('Open a course playlist first.', 'alert-circle');
        return;
      }
      const courseDetail = App.CourseData && App.CourseData.Data && App.CourseData.Data.results
        ? App.CourseData.Data.results.find((c) => c.id == App.CourseId)
        : null;
      if (!courseDetail) {
        UI.showToast('Course data unavailable. Please re-load the course.', 'alert-circle');
        return;
      }
      $('#bulkDownloadModal').modal('hide');
      const folder = Storage.getSetting('default_folder');
      SheetGenerator.generate(App.data, courseDetail, folder);
    });

    // "Clear Download Cache" for the current course
    $('#clearCourseLogBtn').on('click', () => {
      if (App.CourseId) {
        Storage.clearDownloadLog(App.CourseId);
        $('#bulkDownloadModal').modal('hide');
        UI.showToast('Download cache cleared for this course.', 'trash-2');
      } else {
        UI.showToast('Open a course first.', 'alert-circle');
      }
    });
  },

  /** Binds the cancel download button. @private */
  _bindCancelEvent() {
    $('#cancelDownloadBtn').on('click', () => {
      DownloadManager.cancelQueue();
    });
  },

  /**
   * Re-enables download buttons after a queue completes.
   * @private
   */
  _reEnableButtons() {
    const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
    rows.find('td').find('[class*="btn-download"]').prop('disabled', false);
    rows.find('td').find('[class*="btn-download"]:contains(Downloaded)')
      .text('Re-Download').removeClass('btn-danger').addClass('btn-success');

    const checked = rows.find('td').find('input').filter('input:checked').length;
    if (checked > 0) $('#SelectedVideos').prop('disabled', false);
  },

  // ── Data loading ──────────────────────────────────────────────────────────

  /**
   * Fetches and renders the subscribed-course list.
   */
  async loadCourses() {
    try {
      UI.showSkeleton(5);
      const data = await UdemyAPI.fetchCourses();
      UI.renderCourseList(data);
      UI.showToast('Courses loaded successfully', 'check-circle');
    } catch (err) {
      console.error('[App] Failed to load courses:', err);
      UI.showToast('Failed to load courses', 'alert-circle');
    }
  },

  /**
   * Fetches and renders the video list for a given course.
   * @param {string|number} courseId
   */
  async loadPlaylist(courseId) {
    App.CourseId = courseId;
    App.errors   = 0;

    UI.showSkeleton(8);
    $('#counter').show();
    UI.updateCounter({ Current: 0, Total: 0 });

    try {
      const videoList = await UdemyAPI.buildVideoList(courseId, (current, total) => {
        UI.updateCounter({ Current: current, Total: total });
      });

      UI.renderPlaylist(videoList);
      UI.showToast('Playlist loaded', 'list');
    } catch (err) {
      console.error('[App] Failed to load playlist:', err);
      UI.showToast('Failed to load playlist', 'x-circle');
    }
  },
};

// ── Initialise after DOM is ready ─────────────────────────────────────────────
$(document).ready(() => {
  App.init();
});
