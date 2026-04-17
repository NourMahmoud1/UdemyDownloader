/**
 * download-manager.js
 * Handles building download queues, triggering chrome.downloads, tracking
 * progress via polling, and persisting completion state.
 *
 * Depends on: utils.js, storage.js
 */

const DownloadManager = {
  /** Currently active chrome.downloads ID */
  _currentId: null,

  /** Reference to the onChanged listener so it can be removed */
  _onChangedListener: null,

  /** State shared with the progress poller */
  _poll: {
    downId:       null,
    tid:          -1,
    progressBar:  null,
    videoRowIndex: null,
    currentPage:  null,
    MS:           10,
  },

  // ── Queue builder ──────────────────────────────────────────────────────────

  /**
   * Assembles a flat download queue from the video list using the user's
   * quality/subtitle/assets preferences.
   *
   * @param {Array}  videos          - Normalised video objects from UdemyAPI
   * @param {object} courseDetail    - Course metadata (for path building)
   * @param {object} opts
   * @param {string} opts.quality    - 'highest' | 'lowest' | '1080' | '720' | …
   * @param {string} opts.subtitle   - locale string, e.g. 'en_US', or ''
   * @param {boolean} opts.assets    - whether to include supplementary assets
   * @param {string} opts.folder     - base download folder
   * @param {string} opts.template   - naming template
   * @returns {Array}  Queue items: { trid, fileurl, foldername, filename }
   */
  buildQueue(videos, courseDetail, opts) {
    const queue = [];

    videos.forEach((video) => {
      // ── Resolve video URL based on quality preference ──────────────────
      let videoUrl = video.VideoUrl;
      if (video.Streams && video.Streams.length > 0) {
        videoUrl = DownloadManager._resolveQuality(video.Streams, opts.quality);
      }

      const ext      = video.Type === 'Article' ? '.html' : '.mp4';
      const filename = buildPath(opts.template, video, courseDetail, ext);

      queue.push({
        trid:       video.id,
        fileurl:    videoUrl,
        foldername: opts.folder,
        filename,
      });

      // ── Subtitle ────────────────────────────────────────────────────────
      if (opts.subtitle && opts.subtitle.trim() && video.Captions && video.Captions.length > 0) {
        const sub = video.Captions.find(
          (c) => c.locale_id.toLowerCase().includes(opts.subtitle.toLowerCase())
        ) || video.Captions[0];

        if (sub) {
          queue.push({
            trid:       video.id + '_sub',
            fileurl:    sub.url,
            foldername: opts.folder,
            filename:   buildPath(opts.template, video, courseDetail, '.vtt'),
          });
        }
      }

      // ── Supplementary assets ────────────────────────────────────────────
      if (opts.assets && video.Assets && video.Assets.length > 0) {
        video.Assets.forEach((asset) => {
          if (asset.download_urls && asset.download_urls.File) {
            const extMatch      = asset.filename.match(/(\.[^.]+)$/);
            const aExt          = extMatch ? extMatch[1] : '';
            const titleWithout  = extMatch ? asset.filename.replace(/(\.[^.]+)$/, '') : asset.filename;

            queue.push({
              trid:       video.id + '_asset_' + asset.id,
              fileurl:    asset.download_urls.File[0].file,
              foldername: opts.folder,
              filename:   buildPath(opts.template, video, courseDetail, aExt, '{video_title} - ' + titleWithout),
            });
          }
        });
      }
    });

    return queue;
  },

  /**
   * Picks the best stream URL from a Streams array based on the quality setting.
   * @private
   */
  _resolveQuality(streams, quality) {
    if (quality === 'highest') {
      return streams.reduce((a, b) => parseInt(a.label) > parseInt(b.label) ? a : b).file;
    }
    if (quality === 'lowest') {
      return streams.reduce((a, b) => parseInt(a.label) < parseInt(b.label) ? a : b).file;
    }
    // Specific resolution
    const exact = streams.find((s) => parseInt(s.label) === parseInt(quality));
    return exact
      ? exact.file
      : streams.reduce((a, b) => parseInt(a.label) > parseInt(b.label) ? a : b).file;
  },

  // ── Sequential downloader ─────────────────────────────────────────────────

  /**
   * Downloads items in the queue one-by-one, showing progress for each.
   * Previously-completed files (tracked in LocalStorage) are skipped.
   *
   * @param {Array}          queue      - Items built by `buildQueue()`
   * @param {string|number}  courseId   - Used for the completion log
   * @param {Function}       onComplete - Called after all items finish
   */
  startSequential(queue, courseId, onComplete) {
    let index         = 0;
    const downloadDelay = parseInt(Storage.getSetting('download_delay'), 10);

    // The onChanged listener must close over `index` so it always reads the
    // current value, not a snapshot taken at registration time.
    function onChanged({ id, state }) {
      if (id !== DownloadManager._currentId) return;

      if (state && state.current !== 'in_progress') {
        // Download finished (complete or interrupted)
        if (state.current === 'complete') {
          const item = queue[index - 1];
          if (item) Storage.markDownloaded(item.foldername + item.filename, courseId);
        }

        DownloadManager._onDownloadFinished();
        setTimeout(next, downloadDelay);
      } else if (id > 0) {
        // Still downloading — start progress polling
        setTimeout(() => DownloadManager._pollProgress(id), 250);
        DownloadManager._disableDownloadButtons();

        // Navigate to the correct DataTable page while downloading
        const { videoRowIndex, currentPage } = DownloadManager._poll;
        if (currentPage !== parseInt(videoRowIndex / 5)) {
          $('#linkTable').dataTable().fnPageChange(parseInt(videoRowIndex / 5));
        }
      }
    }

    DownloadManager._onChangedListener = onChanged;
    chrome.downloads.onChanged.addListener(onChanged);

    next();

    function next() {
      if (index >= queue.length) {
        chrome.downloads.onChanged.removeListener(onChanged);

        chrome.notifications.create({
          type:     'basic',
          iconUrl:  'logo.png',
          title:    'Download Complete!',
          message:  'Finished ' + queue.length + ' file(s).',
        });

        onComplete();
        return;
      }

      const item        = queue[index];
      const fullPath    = item.foldername + item.filename;
      const alreadyDone = Storage.isDownloaded(fullPath, courseId);

      if (alreadyDone) {
        console.log('[DownloadManager] Skipping already downloaded:', fullPath);
        index++;
        setTimeout(next, 0); // yield control, then continue
        return;
      }

      index++;

      if (item.fileurl) {
        console.log('[DownloadManager] Downloading:', fullPath);

        // Find the DataTable row for UI feedback
        DownloadManager._locateTableRow(item.trid);

        chrome.downloads.download(
          {
            url:            item.fileurl,
            filename:       fullPath,
            saveAs:         false,
            conflictAction: 'overwrite',
          },
          (id) => {
            DownloadManager._currentId = id;
          }
        );
      }
      // If fileurl is falsy, we simply don't initiate a download.
      // The onChanged listener won't fire, so this item is effectively skipped.
    }
  },

  /**
   * Finds the DataTable row that corresponds to a download item and caches
   * the row index and the current pagination page for UI updates.
   * @private
   */
  _locateTableRow(trid) {
    const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
    let rowIndex = null;
    rows.each((k, v) => {
      if (v.id == trid) rowIndex = k;
    });

    DownloadManager._poll.progressBar  = trid;
    DownloadManager._poll.videoRowIndex = rowIndex;
    DownloadManager._poll.currentPage   = parseInt(
      $('.pagination').find('[class*="active"] a').attr('data-dt-idx')
    ) - 1;
  },




  /** Updates the UI after a download finishes or is interrupted. @private */
  _onDownloadFinished() {
    const rows          = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
    const bar           = DownloadManager._poll.progressBar;
    const downloadBtn   = rows.filter('[id*=' + bar + ']').find('td').eq(3).find('button');
    const progressBar   = rows.filter('[id*=' + bar + ']').find('td').eq(3).find('div').filter('[class="progress-bar"]');
    const inputChecked  = rows.filter('[id*=' + bar + ']').find('td').eq(0).find('input').filter('input:checked');

    downloadBtn.text('Downloaded');
    downloadBtn.removeClass('btn-warning').addClass('btn-danger');
    progressBar.css('width', '100%').css('background-color', 'var(--warning)').prop('disabled', true);
    rows.filter('[id*=' + bar + ']').removeClass('blink');

    if (inputChecked.length === 1) {
      inputChecked.prop('checked', false);
      inputChecked.parent(0).parent(0).parent(0).removeClass('selected-td');
      DownloadManager._refreshSelectedCount();
    }
  },

  /** Disables all download/select buttons while a download is in progress. @private */
  _disableDownloadButtons() {
    const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
    rows.find('td').find('[class*="btn-download"]').prop('disabled', true);
    $('#SelectedVideos').prop('disabled', true);
  },

  /** Re-syncs the "Download X Videos" button count. @private */
  _refreshSelectedCount() {
    const rows           = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
    const checkedCount   = rows.find('td').find('input').filter('input:checked').length;
    if (checkedCount > 0) {
      $('#SelectedVideos').prop('disabled', false);
      $('#SelectedVideos').text('Download ' + checkedCount + ' ' + (checkedCount === 1 ? 'Video' : 'Videos'));
    } else {
      $('#SelectedVideos').prop('disabled', true).text('Download Selected Videos');
    }
  },

  // ── Progress polling ──────────────────────────────────────────────────────

  /**
   * Queries chrome.downloads repeatedly while a download is active and
   * updates the DataTable progress bar.
   * @private
   */
  _pollProgress(downId) {
    const poll = DownloadManager._poll;
    if (downId !== undefined) poll.downId = downId;
    poll.tid = -1;

    chrome.downloads.search({ id: poll.downId }, (items) => {
      items.forEach((item) => {
        if (item.state !== 'in_progress') return;

        if (!item.totalBytes) return;

        const pct    = parseInt((item.bytesReceived / item.totalBytes) * 100, 10);
        const rows   = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
        const sel    = '[id*=' + poll.progressBar + ']';
        const pDiv   = rows.filter(sel).find('td').eq(3).find('div').filter('[class="progress"]');
        const pBar   = rows.filter(sel).find('td').eq(3).find('div').filter('[class="progress-bar"]');
        const dlBtn  = rows.filter(sel).find('td').eq(3).find('button');

        // First-time show
        if (pDiv.is(':hidden')) {
          pDiv.show();
          pBar.show().css('background-color', 'var(--secondary)');
          dlBtn.prop('disabled', true).text('Downloading').removeClass('btn-success').addClass('btn-warning');
        }

        // Update bar
        pBar.css('width', pct + '%').text(pct + '%');
        rows.filter(sel).addClass('blink');

        // Schedule next poll
        if (poll.tid < 0) {
          poll.tid = setTimeout(() => {
            poll.tid = -1;
            DownloadManager._pollProgress();
          }, poll.MS);
        }
      });
    });
  },
};
