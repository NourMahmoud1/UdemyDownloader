/**
 * ui.js
 * All DOM rendering and DataTables configuration.
 *
 * Depends on: utils.js, storage.js, download-manager.js
 * Global state it reads: App.CourseId, App.CourseData, App.data, App.errors
 */

const UI = {
  // ── Counter ───────────────────────────────────────────────────────────────

  /**
   * Updates the progress counter shown while the playlist is loading.
   * Safe to call with an empty / falsy object.
   * @param {object} obj  - { Current?: string|number, Total?: string|number }
   */
  updateCounter(obj = {}) {
    if (!obj || !obj.Current) return;
    $('#current-text').show().text(obj.Current);
    if (obj.Total) {
      $('#total-text').show().text(' in ' + obj.Total + ' | Errors: ' + (App.errors || 0));
    }
  },

  // ── Loading spinner ───────────────────────────────────────────────────────

  showLoading()  { $('.sonar-wrapper').show(); },
  hideLoading()  { $('.sonar-wrapper').hide(); },

  // ── Thumbnail renderers ───────────────────────────────────────────────────

  /**
   * Returns an <img> tag that uses CSS sprite positioning.
   */
  getSprite(data) {
    return (
      '<img src="img_trans.gif" width="1" height="1" style="width:120px; height:67.5px; ' +
      'border:2px solid var(--dark); background: url(' + data + ') -120px 0; background-size:400%">'
    );
  },

  /**
   * Returns a plain <img> tag.
   */
  getImage(data) {
    return '<img src="' + data + '" style="border: 2px solid var(--dark);"/>';
  },

  // ── DataTable ─────────────────────────────────────────────────────────────

  /**
   * Destroys any existing DataTable and rebuilds it from `config`.
   * @param {object} config  - Same shape as the `Application` object passed previously
   */
  createTable(config) {
    $('#example').empty().append(
      '<table id="linkTable" class="table" cellspacing="0" width="100%"></table>'
    );

    const table = $('#linkTable').DataTable({
      dom:           'Blftip',
      data:          config.data,
      rowId:         'id',
      ordering:      false,
      lengthChange:  config.lengthChange,
      lengthMenu:    [5],
      scrollY:       500,
      scrollX:       true,
      scrollCollapse: true,
      iDisplayLength: config.DisplayLength,
      paging:        config.Paging,
      bFilter:       true,
      columns:       config.columns,
      buttons:       config.buttons,
      columnDefs:    config.columnDefs,
      language: {
        info:             'searched : _TOTAL_ | Errors: ' + (App.errors || 0),
        search:           '_INPUT_',
        searchPlaceholder: 'Search by name',
        infoFiltered:     'in _MAX_',
      },
      initComplete() {
        // Position length & filter controls
        $('#linkTable_length').attr('style', 'position:relative; display:inline; left:2%;');
        $('#linkTable_length label').attr('style', 'padding-top: 5px;');
        $('#linkTable_filter').attr('style', 'position:absolute; display:inline; right:1.4%;');
        $('.dataTables_scrollBody').attr(
          'style',
          'position: relative; overflow: auto; width: 100%; max-height:472px; height:472px;'
        );
        $('.dataTables_length').addClass('bs-select');

        // Attach progress bars and checkbox listeners
        const rows      = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
        const checkboxes = rows.find('td').find('input');

        // Add hidden progress bars to the action column
        rows.find('td').filter('[class*="td-4"]')
          .append("<div class='progress' style='margin-top:3px; height:1.2rem;'>" +
                  "<div class='progress-bar' role='progressbar' style='width: 0%; background-color:var(--secondary)!important' " +
                  "aria-valuenow='50' aria-valuemin='0' aria-valuemax='100'>0%</div></div>");
        rows.find('td').filter('[class*="td-4"]').find('[class*="progress"]').hide();

        // Checkbox change handler
        checkboxes.on('change', (e) => {
          const checkedCount = checkboxes.filter('input:checked').length;
          if (checkedCount > 0) {
            $('#SelectedVideos').prop('disabled', false);
            $('#SelectAll span').text('Select All');
            $('#SelectedVideos').text('Download ' + checkedCount + ' ' + (checkedCount === 1 ? 'Video' : 'Videos'));
          } else {
            $('#SelectedVideos').prop('disabled', true).text('Download Selected Videos');
          }

          // Row highlight
          const row = $(e.target).parent(0).parent(0).parent(0);
          if ($(e.target).is(':checked')) {
            row.addClass('selected-td');
          } else {
            row.removeClass('selected-td');
          }
        });
      },
    });

    // Row button click handler
    $('#linkTable tbody').on('click', 'button', function () {
      const rowId = $(this).parents('tr').attr('id');
      UI._onRowButtonClick(rowId, $(this));
    });
  },

  /** @private */
  _onRowButtonClick(rowId, $btn) {
    if (App.type === 'Course') {
      // "Get Video List" button on the course list
      UI.showLoading();
      $('#example').empty();
      $('#counter').show();
      UI.updateCounter({ Current: 0, Total: 0 });
      App.loadPlaylist(rowId);

    } else if (App.type === 'Download') {
      // "Download" button on the video list
      const $row       = $btn.closest('tr');
      const video      = App.data.find((v) => v.id == rowId);
      const course     = App.CourseData.Data.results.find((c) => c.id == App.CourseId);
      const template   = Storage.getSetting('default_naming_template');
      const ext        = video.Type === 'Article' ? '.html' : '.mp4';
      const folder     = Storage.getSetting('default_folder');

      const selectedUrl  = $row.find('.quality-select').length > 0
        ? $row.find('.quality-select').val()
        : video.VideoUrl;
      const selectedSub  = $row.find('.subtitle-select').length > 0
        ? $row.find('.subtitle-select').val()
        : '';

      const queue = [{
        trid:       rowId,
        fileurl:    selectedUrl,
        foldername: folder,
        filename:   buildPath(template, video, course, ext),
      }];

      if (selectedSub) {
        queue.push({
          trid:       rowId + '_sub',
          fileurl:    selectedSub,
          foldername: folder,
          filename:   buildPath(template, video, course, '.vtt'),
        });
      }

      DownloadManager.startSequential(queue, App.CourseId, () => {
        // Re-enable buttons and refresh "Downloaded" labels
        const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
        rows.find('td').find('[class*="btn-download"]').prop('disabled', false);
        rows.find('td').find('[class*="btn-download"]:contains(Downloaded)')
          .text('Re-Download').removeClass('btn-danger').addClass('btn-success');

        const checked = rows.find('td').find('input').filter('input:checked').length;
        if (checked > 0) $('#SelectedVideos').prop('disabled', false);
      });
    } else {
      alert('Malformed data, please try again.');
    }
  },

  // ── View renderers ────────────────────────────────────────────────────────

  /**
   * Renders the subscribed-course list DataTable.
   * @param {object} apiData  - Raw API object with `.results` array
   */
  renderCourseList(apiData) {
    $('#counter').hide();
    UI.hideLoading();
    $('.btn-container').hide();

    App.type        = 'Course';
    App.CourseData  = { Data: apiData };
    App.data        = apiData.results;

    const config = {
      data:          apiData.results,
      lengthChange:  false,
      DisplayLength: 5,
      Paging:        true,
      columns: [
        { data: 'image_125_H', className: 'td-1', render: (d) => UI.getImage(d) },
        { data: 'title',       className: 'td-3' },
        { data: null,          className: 'td-4' },
      ],
      buttons: [
        {
          text:      'Re-Analyze course list',
          className: 'btn-sm btn-danger btn-width-100',
          action() {
            $('#example').empty();
            UI.showLoading();
            $('#counter').show();
            $('#message').hide();
            Storage.remove('LoadedAllCourses');
            Storage.remove('LoadedData');
            App.loadCourses();
          },
        },
      ],
      columnDefs: [
        {
          targets:        -1,
          data:           null,
          className:      'minumum',
          defaultContent: '<button class="btn btn-secondary btn-sm btn-success" type="button" style="width:100%;"><span>Get Video List</span></button>',
        },
      ],
    };

    UI.createTable(config);
  },

  /**
   * Renders the video/playlist DataTable.
   * @param {Array} videoList  - Normalised video objects from UdemyAPI
   */
  renderPlaylist(videoList) {
    $('#counter').hide();
    UI.hideLoading();
    $('.btn-container').hide();

    App.type = 'Download';
    App.data = videoList;

    const userQuality  = Storage.getSetting('default_quality');
    const userSubtitle = Storage.getSetting('default_subtitle');

    const config = {
      data:          videoList,
      lengthChange:  true,
      DisplayLength: 5,
      Paging:        true,
      columns: [
        { data: null, className: 'td-1' },
        {
          data:      'VideoThumbnail',
          className: 'td-2',
          render(data, type, row) {
            if (row.Type === 'Article') {
              return '<div style="width:120px; height:67.5px; border:2px solid var(--dark); display:flex; align-items:center; justify-content:center; background:#eee; font-weight:bold; font-size:12px; color:#555;">HTML Article</div>';
            }
            return UI.getSprite(data);
          },
        },
        {
          data:      'VideoTitle',
          className: 'td-3',
          render(data, type, row) {
            let result = data;

            // Quality selector
            if (row.Streams && row.Streams.length > 0) {
              let sel = '<div style="margin-top: 5px;"><select class="form-control form-control-sm quality-select" style="width: auto; display: inline-block;">';
              row.Streams.forEach((stream) => {
                const isHighest  = userQuality === 'highest' && Math.max(...row.Streams.map((s) => parseInt(s.label))) === parseInt(stream.label);
                const isLowest   = userQuality === 'lowest'  && Math.min(...row.Streams.map((s) => parseInt(s.label))) === parseInt(stream.label);
                const isExact    = stream.label === userQuality;
                const selected   = (isExact || isHighest || isLowest) ? 'selected' : '';
                sel += '<option value="' + stream.file + '" ' + selected + '>' + stream.label + '</option>';
              });
              sel += '</select></div>';
              result += sel;
            }

            // Subtitle selector
            if (row.Captions && row.Captions.length > 0) {
              let sub = '<div style="margin-top: 5px;"><select class="form-control form-control-sm subtitle-select" style="width: auto; display: inline-block;">';
              sub += '<option value="">No Subtitle</option>';
              row.Captions.forEach((cap) => {
                const match    = (userSubtitle.trim() && cap.locale_id.toLowerCase().includes(userSubtitle.toLowerCase())) ? 'selected' : '';
                sub += '<option value="' + cap.url + '" ' + match + '>' + cap.title + ' (' + cap.locale_id + ')</option>';
              });
              sub += '</select></div>';
              result += sub;
            }

            return result;
          },
        },
        { data: null, className: 'td-4' },
      ],
      buttons: UI._playlistButtons(),
      columnDefs: [
        {
          targets:        0,
          data:           null,
          defaultContent: '<div style="position:absolute;height:67.5px;"><input type="checkbox" style="position:relative;top: 35%; width:20px; height:20px;"></div>',
        },
        {
          targets:        -1,
          data:           null,
          className:      'minumum',
          defaultContent: '<button class="btn btn-secondary btn-sm btn-success pd-0 btn-download" type="button" style="width:100%;"><span>Download</span></button>',
        },
      ],
    };

    UI.createTable(config);
  },

  /** Returns the button definitions for the playlist DataTable toolbar. @private */
  _playlistButtons() {
    return [
      {
        text:      '&laquo;',
        className: 'btn-sm btn-danger btn-width-5 btn-right',
        action() {
          UI.showLoading();
          $('#example').empty();
          App.loadCourses();
        },
      },
      {
        text:      'Select All',
        className: 'btn-sm btn-danger btn-width-25 btn-right',
        attr:      { id: 'SelectAll' },
        action() {
          const rows       = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
          const checkboxes = rows.find('td').find('input');
          const allChecked = checkboxes.length === checkboxes.filter('input:checked').length;

          if (allChecked) {
            checkboxes.prop('checked', false);
            $('#SelectedVideos').prop('disabled', true).text('Download Selected Videos');
            $('#SelectAll span').text('Select All');
          } else {
            checkboxes.prop('checked', true);
            $('#SelectAll span').text('DeSelect All');
            const count = checkboxes.filter('input:checked').length;
            $('#SelectedVideos').prop('disabled', false)
              .text('Download ' + count + ' ' + (count === 1 ? 'Video' : 'Videos'));
          }
        },
      },
      {
        text:      'Re-Analyze Videos',
        className: 'btn-sm btn-danger btn-width-35 btn-right',
        action() {
          $('#example').empty();
          UI.showLoading();
          $('#counter').show();
          $('#message').hide();
          Storage.remove('LoadedVideoList');
          App.loadPlaylist(App.CourseId);
        },
      },
      {
        text:      'Bulk Course Download',
        className: 'btn-sm btn-info btn-width-35 btn-right',
        attr:      { id: 'BulkDownload' },
        action() {
          if (window.location.pathname.includes('popup.html')) {
            const defQuality  = Storage.getSetting('default_quality');
            const defSubtitle = localStorage.getItem('default_subtitle');
            const defAssets   = localStorage.getItem('default_assets');

            if (defQuality)          $('#bulkQualitySelect').val(defQuality);
            if (defSubtitle !== null) $('#bulkSubtitleSelect').val(defSubtitle);
            if (defAssets !== null)   $('#bulkAssetsCheck').prop('checked', defAssets === 'true');

            $('#bulkDownloadModal').modal('show');
          }
        },
      },
      {
        text:      'Download Selected Videos',
        className: 'btn-sm btn-success btn-width-35 btn-right',
        attr:      { id: 'SelectedVideos', disabled: 'disabled' },
        action() {
          $('#linkTable').dataTable().fnPageChange(0);

          const folder   = Storage.getSetting('default_folder');
          const template = Storage.getSetting('default_naming_template');
          const rows     = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
          const queue    = [];

          rows.find('td').find('input').filter('input:checked').each(function () {
            const rowId  = $(this).parents('td').parents('tr').attr('id');
            const $row   = $(this).parents('tr');
            const video  = App.data.find((v) => v.id == rowId);
            const course = App.CourseData.Data.results.find((c) => c.id == App.CourseId);
            const ext    = video.Type === 'Article' ? '.html' : '.mp4';

            const selectedUrl  = $row.find('.quality-select').length > 0 ? $row.find('.quality-select').val() : video.VideoUrl;
            const selectedSub  = $row.find('.subtitle-select').length > 0 ? $row.find('.subtitle-select').val() : '';

            queue.push({
              trid:       rowId,
              fileurl:    selectedUrl,
              foldername: folder,
              filename:   buildPath(template, video, course, ext),
            });

            if (selectedSub) {
              queue.push({
                trid:       rowId + '_sub',
                fileurl:    selectedSub,
                foldername: folder,
                filename:   buildPath(template, video, course, '.vtt'),
              });
            }
          });

          DownloadManager.startSequential(queue, App.CourseId, () => {
            const rows = $('#linkTable').dataTable().$('tr', { filter: 'applied' });
            rows.find('td').find('[class*="btn-download"]').prop('disabled', false);
            rows.find('td').find('[class*="btn-download"]:contains(Downloaded)')
              .text('Re-Download').removeClass('btn-danger').addClass('btn-success');
            const checked = rows.find('td').find('input').filter('input:checked').length;
            if (checked > 0) $('#SelectedVideos').prop('disabled', false);
          });
        },
      },
    ];
  },
};
