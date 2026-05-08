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

  /** Whether the user has requested cancellation of the current queue */
  _cancelled: false,

  /** Maximum number of retry attempts for a failed download */
  MAX_RETRIES: 3,

  /** State shared with the progress poller */
  _poll: {
    downId:       null,
    tid:          -1,
    progressBar:  null,
    videoRowIndex: null,
    currentPage:  null,
    MS:           500,
  },

  /** Overall queue progress state */
  _progress: {
    current: 0,
    total:   0,
  },

  /** Cached DOM references for the currently downloading row (avoids repeated jQuery lookups) */
  _cachedRow: {
    trid:        null,
    progressDiv: null,
    progressBar: null,
    downloadBtn: null,
    row:         null,
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
        const query = opts.subtitle.toLowerCase();
        const sub = video.Captions.find((c) => c.locale_id.toLowerCase() === query) ||
                    video.Captions.find((c) => c.locale_id.toLowerCase().includes(query)) || 
                    video.Captions[0];

        if (sub) {
          queue.push({
            trid:       video.id + '_sub',
            fileurl:    sub.url,
            foldername: opts.folder,
            filename:   buildPath(opts.template, video, courseDetail, '.' + sub.locale_id + '.vtt'),
          });
        }
      }

      // ── Supplementary assets ────────────────────────────────────────────
      if (opts.assets && video.Assets && video.Assets.length > 0) {
        video.Assets.forEach((asset) => {
          // Resolve download URL from any recognised key in download_urls
          let assetUrl = null;
          const assetFilename = asset.filename || 'resource';

          if (asset.download_urls) {
            const urlSources =
              asset.download_urls.File         ||
              asset.download_urls.SourceCode   ||
              asset.download_urls.Presentation ||
              asset.download_urls.Image        ||
              (Object.keys(asset.download_urls).length > 0
                ? asset.download_urls[Object.keys(asset.download_urls)[0]]
                : null);
            if (urlSources && urlSources.length > 0) assetUrl = urlSources[0].file;
          }

          // Fall back to external_url for linked resources
          if (!assetUrl && asset.external_url) assetUrl = asset.external_url;

          if (!assetUrl) return; // nothing to download

          const extMatch     = assetFilename.match(/(\.[^.]+)$/);
          const aExt         = extMatch ? extMatch[1] : '';
          const titleWithout = extMatch ? assetFilename.replace(/(\.[^.]+)$/, '') : assetFilename;

          queue.push({
            trid:       video.id + '_asset_' + asset.id,
            fileurl:    assetUrl,
            foldername: opts.folder,
            filename:   buildPath(opts.template, video, courseDetail, aExt, '{video_title} - ' + titleWithout),
          });
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
    // ── FIX #2: Clean up any previous listener to prevent stacking ────────
    if (DownloadManager._onChangedListener) {
      chrome.downloads.onChanged.removeListener(DownloadManager._onChangedListener);
      DownloadManager._onChangedListener = null;
    }

    let index           = 0;
    let retryCount      = 0;
    const downloadDelay = parseInt(Storage.getSetting('download_delay'), 10);

    // Reset cancellation flag and overall progress
    DownloadManager._cancelled = false;
    DownloadManager._progress.current = 0;
    DownloadManager._progress.total   = queue.length;
    DownloadManager._updateOverallProgress();

    // Show the cancel button
    $('#cancelDownloadBtn').show().prop('disabled', false);

    // The onChanged listener closes over `currentItem` so it always reads
    // the correct reference, not a snapshot taken at registration time.
    let currentItem = null;

    function onChanged({ id, state }) {
      if (id !== DownloadManager._currentId) return;

      if (state && state.current !== 'in_progress') {
        // ── FIX #14: Distinguish complete vs interrupted ────────────────
        if (state.current === 'complete') {
          // ── FIX #4: Use captured `currentItem` instead of index arithmetic
          if (currentItem) {
            Storage.markDownloaded(currentItem.foldername + currentItem.filename, courseId);
          }
          DownloadManager._onDownloadFinished('complete');
          retryCount = 0;
          DownloadManager._progress.current++;
          DownloadManager._updateOverallProgress();
          setTimeout(next, downloadDelay);

        } else if (state.current === 'interrupted') {
          // ── FIX #11: Retry up to MAX_RETRIES before giving up ─────────
          retryCount++;
          if (retryCount <= DownloadManager.MAX_RETRIES && currentItem) {
            console.warn(
              `[DownloadManager] Download interrupted, retrying (${retryCount}/${DownloadManager.MAX_RETRIES}):`,
              currentItem.foldername + currentItem.filename
            );
            DownloadManager._onDownloadFinished('retrying');
            // Retry the same item — decrement index so `next()` re-processes it
            index--;
            setTimeout(next, downloadDelay * 2);
          } else {
            console.error('[DownloadManager] Download failed after retries:', currentItem?.filename);
            DownloadManager._onDownloadFinished('failed');
            retryCount = 0;
            DownloadManager._progress.current++;
            DownloadManager._updateOverallProgress();
            setTimeout(next, downloadDelay);
          }
        }
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
      // ── FIX #10: Check cancellation flag ──────────────────────────────
      if (DownloadManager._cancelled) {
        cleanup('Download cancelled by user.');
        return;
      }

      if (index >= queue.length) {
        cleanup('Finished ' + queue.length + ' file(s).');
        return;
      }

      const item        = queue[index];
      const fullPath    = item.foldername + item.filename;
      const alreadyDone = Storage.isDownloaded(fullPath, courseId);

      if (alreadyDone) {
        console.log('[DownloadManager] Skipping already downloaded:', fullPath);
        index++;
        DownloadManager._progress.current++;
        DownloadManager._updateOverallProgress();
        setTimeout(next, 0); // yield control, then continue
        return;
      }

      // ── FIX #4: Capture item reference BEFORE incrementing ────────────
      currentItem = item;
      index++;

      // ── FIX #1: Handle falsy fileurl — skip instead of hanging ────────
      if (!item.fileurl) {
        console.warn('[DownloadManager] No URL for item, skipping:', fullPath);
        DownloadManager._progress.current++;
        DownloadManager._updateOverallProgress();
        setTimeout(next, 0);
        return;
      }

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
          // ── FIX #3: Handle chrome.downloads.download() failure ────────
          if (chrome.runtime.lastError || !id) {
            console.error(
              '[DownloadManager] Download API error:',
              chrome.runtime.lastError?.message || 'unknown error'
            );
            DownloadManager._onDownloadFinished('failed');
            DownloadManager._progress.current++;
            DownloadManager._updateOverallProgress();
            setTimeout(next, downloadDelay);
            return;
          }
          DownloadManager._currentId = id;
        }
      );
    }

    function cleanup(message) {
      chrome.downloads.onChanged.removeListener(onChanged);
      DownloadManager._onChangedListener = null;
      DownloadManager._currentId = null;

      // Hide cancel button
      $('#cancelDownloadBtn').hide();

      // Clear overall progress display
      $('#overallProgress').hide();

      chrome.notifications.create({
        type:     'basic',
        iconUrl:  'logo.png',
        title:    DownloadManager._cancelled ? 'Download Cancelled' : 'Download Complete!',
        message:  message,
      });

      onComplete();
    }
  },

  /**
   * Cancels the current download queue. The active download is also cancelled.
   */
  cancelQueue() {
    DownloadManager._cancelled = true;
    $('#cancelDownloadBtn').prop('disabled', true).text('Cancelling…');

    // Cancel the active chrome download if one is in progress
    if (DownloadManager._currentId) {
      chrome.downloads.cancel(DownloadManager._currentId, () => {
        console.log('[DownloadManager] Active download cancelled.');
      });
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

    DownloadManager._poll.progressBar   = trid;
    DownloadManager._poll.videoRowIndex = rowIndex;

    // Robust active-page detection — data-dt-idx is unreliable in Bootstrap pagination.
    // Use DataTables' own fnPagingInfo() first, then fall back to row-index math.
    let currentPage = 0;
    try {
      const info = $('#linkTable').dataTable().fnPagingInfo();
      currentPage = (info && !isNaN(info.iPage)) ? info.iPage : 0;
    } catch (e) {
      const pageSize = $('#linkTable').dataTable().fnSettings()._iDisplayLength || 5;
      currentPage = rowIndex !== null ? Math.floor(rowIndex / pageSize) : 0;
    }
    DownloadManager._poll.currentPage = currentPage;

    // ── FIX #15: Cache DOM references for the current row ────────────────
    DownloadManager._cacheRowElements(trid);
  },

  /**
   * Caches jQuery references for the row being downloaded to avoid
   * repeated DOM lookups in the hot polling path.
   * @private
   */
  _cacheRowElements(trid) {
    const rows  = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
    const sel   = '[id*=' + trid + ']';
    const $row  = rows.filter(sel);

    DownloadManager._cachedRow = {
      trid,
      row:         $row,
      progressDiv: $row.find('td').eq(3).find('div').filter('[class="progress"]'),
      progressBar: $row.find('td').eq(3).find('div').filter('[class="progress-bar"]'),
      downloadBtn: $row.find('td').eq(3).find('button'),
    };
  },

  /**
   * Updates the overall progress indicator (X of Y).
   * @private
   */
  _updateOverallProgress() {
    const { current, total } = DownloadManager._progress;
    let $el = $('#overallProgress');

    if ($el.length === 0) {
      // Create the element if it doesn't exist
      $('#example').before(
        '<div id="overallProgress" class="overall-progress-bar">' +
        '<span id="overallProgressText"></span>' +
        '<div class="progress" style="height:6px; flex:1; background:var(--glass-border);">' +
        '<div id="overallProgressFill" class="progress-bar" role="progressbar" ' +
        'style="width:0%; background: var(--brand-primary-light);"></div></div></div>'
      );
      $el = $('#overallProgress');
    }

    $el.show();
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    $('#overallProgressText').text(`Downloading ${current} of ${total}`);
    $('#overallProgressFill').css('width', pct + '%');
  },

  /** Updates the UI after a download finishes, is interrupted, or fails. @private */
  _onDownloadFinished(status = 'complete') {
    const { row, downloadBtn, progressBar } = DownloadManager._cachedRow;

    if (!row || row.length === 0) {
      // Fallback to uncached lookup
      const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
      const bar  = DownloadManager._poll.progressBar;
      const sel  = '[id*=' + bar + ']';
      DownloadManager._cachedRow.row         = rows.filter(sel);
      DownloadManager._cachedRow.downloadBtn = rows.filter(sel).find('td').eq(3).find('button');
      DownloadManager._cachedRow.progressBar = rows.filter(sel).find('td').eq(3).find('div').filter('[class="progress-bar"]');
    }

    const $btn = DownloadManager._cachedRow.downloadBtn;
    const $bar = DownloadManager._cachedRow.progressBar;
    const $row = DownloadManager._cachedRow.row;

    if (status === 'complete') {
      $btn.text('Downloaded');
      $btn.removeClass('btn-warning btn-success').addClass('btn-danger');
      $bar.css('width', '100%').css('background-color', 'var(--warning)').prop('disabled', true);
    } else if (status === 'failed') {
      $btn.text('Failed');
      $btn.removeClass('btn-warning btn-success').addClass('btn-danger');
      $bar.css('width', '100%').css('background-color', '#dc3545').prop('disabled', true);
    } else if (status === 'retrying') {
      $btn.text('Retrying…');
      $btn.removeClass('btn-success').addClass('btn-warning');
    }

    $row.removeClass('blink');

    // Uncheck the checkbox if it was selected
    const inputChecked = $row.find('td').eq(0).find('input').filter('input:checked');
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

        const pct = parseInt((item.bytesReceived / item.totalBytes) * 100, 10);

        // ── FIX #15: Use cached DOM references ──────────────────────────
        const cached = DownloadManager._cachedRow;
        let pDiv, pBar, dlBtn;

        if (cached.trid === poll.progressBar && cached.progressDiv) {
          pDiv  = cached.progressDiv;
          pBar  = cached.progressBar;
          dlBtn = cached.downloadBtn;
        } else {
          // Fallback to DOM lookup and re-cache
          const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
          const sel  = '[id*=' + poll.progressBar + ']';
          pDiv  = rows.filter(sel).find('td').eq(3).find('div').filter('[class="progress"]');
          pBar  = rows.filter(sel).find('td').eq(3).find('div').filter('[class="progress-bar"]');
          dlBtn = rows.filter(sel).find('td').eq(3).find('button');

          DownloadManager._cachedRow.progressDiv = pDiv;
          DownloadManager._cachedRow.progressBar = pBar;
          DownloadManager._cachedRow.downloadBtn = dlBtn;
        }

        // First-time show
        if (pDiv.is(':hidden')) {
          pDiv.show();
          pBar.show().css('background-color', 'var(--secondary)');
          dlBtn.prop('disabled', true).text('Downloading').removeClass('btn-success').addClass('btn-warning');
        }

        // Update bar
        pBar.css('width', pct + '%').text(pct + '%');

        if (cached.row) cached.row.addClass('blink');

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
