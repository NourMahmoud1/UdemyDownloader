/**
 * sheet-generator.js  (v2)
 * Generates a polished .xlsx course-tracker workbook and triggers a download.
 *
 * Design highlights:
 *   - 8-column layout: # | Title | Type | Duration | Size | Status | Rating | Notes
 *   - Named style factories -- no inline duplication
 *   - Frozen header row (row 9) + first two columns
 *   - % Complete formula (auto-updates in Excel as you tick rows)
 *   - Bold totals row at the bottom
 *   - Data validations for Status and Rating columns
 *
 * Public API:
 *   SheetGenerator.generate(videos, courseDetail, folder)
 *
 * Depends on: Plugins/xlsx.full.min.js  (SheetJS CE)
 */

const SheetGenerator = {

  // -- Palette (Ocean Depths -- matches the extension UI) --------------------
  _C: {
    NAVY:        '0D1B2A',
    OCEAN:       '1A2E45',
    TEAL:        '2D8B8B',
    TEAL_LIGHT:  '3AAFAF',
    SEAFOAM:     'A8DADC',
    SEAFOAM_DIM: '6CB4B6',
    CREAM:       'F1FAEE',
    DIM:         '4A7A94',
    CHAPTER_BG:  '0D3D56',
    HEADER_BG:   '1E3A55',
    NOTES_BG:    'FFF8E1',
    ROW_EVEN:    'F0F7F7',
    ROW_ODD:     'FFFFFF',
    BORDER:      'BBCCCC',
    BORDER_DARK: '2D8B8B',
    GREEN:       '22C55E',
    AMBER:       'F59E0B',
    RED:         'EF4444',
    TOTAL_BG:    '0D2E42',
  },

  // -- Helpers ---------------------------------------------------------------

  _fmtDuration(secs) {
    if (!secs) return '--';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  },

  _today() {
    return new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  },

  /** Column letter from 0-based index */
  _col(i) { return String.fromCharCode(65 + i); },

  /** Build a full cell address */
  _addr(col, row) {
    return (typeof col === 'number' ? this._col(col) : col) + row;
  },

  // -- Style factories -------------------------------------------------------

  _border(color, style = 'thin') {
    const s = { style, color: { rgb: color } };
    return { top: s, bottom: s, left: s, right: s };
  },

  _cell(fg, fc, opts = {}) {
    const {
      bold = false, sz = 10, italic = false,
      halign = 'left', valign = 'center',
      wrap = false, borderColor = this._C.BORDER,
      borderStyle = 'thin',
    } = opts;
    return {
      font:      { name: 'Calibri', sz, bold, italic, color: { rgb: fc } },
      fill:      { patternType: 'solid', fgColor: { rgb: fg } },
      alignment: { horizontal: halign, vertical: valign, wrapText: wrap },
      border:    this._border(borderColor, borderStyle),
    };
  },

  _bannerCell(fg, fc, sz = 14, bold = true, italic = false) {
    return {
      font:      { name: 'Calibri', sz, bold, italic, color: { rgb: fc } },
      fill:      { patternType: 'solid', fgColor: { rgb: fg } },
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    };
  },

  _headerCell() {
    return this._cell(this._C.HEADER_BG, this._C.CREAM, {
      bold: true, sz: 10, halign: 'center',
      borderColor: this._C.TEAL, borderStyle: 'medium',
    });
  },

  _chapterCell() {
    return {
      font:      { name: 'Calibri', sz: 10, bold: true, italic: true, color: { rgb: this._C.SEAFOAM } },
      fill:      { patternType: 'solid', fgColor: { rgb: this._C.CHAPTER_BG } },
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
      border:    this._border(this._C.TEAL_LIGHT),
    };
  },

  _totalCell(fc, halign = 'center') {
    return this._cell(this._C.TOTAL_BG, fc, {
      bold: true, sz: 10, halign,
      borderColor: this._C.TEAL, borderStyle: 'medium',
    });
  },

  // -- Cell writer -----------------------------------------------------------

  _set(ws, addr, value, style, isFormula = false) {
    ws[addr] = {
      v: value,
      t: isFormula ? 'n' : (typeof value === 'number' ? 'n' : 's'),
      s: style,
    };
    if (isFormula) {
      ws[addr].f = value;
      ws[addr].v = undefined;
    }
  },

  /** Fill every cell in a row with the same style */
  _fillRow(ws, row, cols, style, value = '') {
    for (let c = 0; c < cols; c++) {
      this._set(ws, this._addr(c, row), value, style);
    }
  },

  // -- Main entry point ------------------------------------------------------

  /**
   * Builds and downloads the course-tracker .xlsx file.
   *
   * Column layout (8 cols, A-H):
   *   A  #       B  Lecture Title   C  Type    D  Duration
   *   E  Size    F  Status          G  Rating  H  Notes
   *
   * @param {Array}  videos        - Normalised video list from App.data
   * @param {object} courseDetail  - Course API object
   * @param {string} folder        - Base download folder (for filename hint)
   */
  generate(videos, courseDetail, folder) {
    if (typeof XLSX === 'undefined') {
      console.error('[SheetGenerator] SheetJS (XLSX) is not loaded.');
      if (typeof UI !== 'undefined') UI.showToast('Could not generate tracker -- SheetJS missing.', 'alert-circle');
      return;
    }

    const C    = this._C;
    const COLS = 8;

    // -- Metadata -------------------------------------------------------------
    const courseTitle = courseDetail.title || 'Unknown Course';
    const instructor  = courseDetail.visible_instructors && courseDetail.visible_instructors.length > 0
      ? courseDetail.visible_instructors[0].display_name
      : 'Unknown Instructor';

    const totalLectures = videos.length;
    const totalSecs     = videos.reduce((sum, v) => sum + (v.duration || 0), 0);

    // -- Build worksheet object -----------------------------------------------
    const ws          = {};
    const merges      = [];
    const validations = [];

    // Column widths (chars)
    ws['!cols'] = [
      { wch:  5 },  // A  #
      { wch: 50 },  // B  Lecture Title
      { wch: 10 },  // C  Type
      { wch: 11 },  // D  Duration
      { wch: 12 },  // E  Size
      { wch: 16 },  // F  Status
      { wch: 10 },  // G  Rating
      { wch: 38 },  // H  Notes
    ];

    let row = 1;

    // ROW 1: Course banner
    this._fillRow(ws, row, COLS, this._bannerCell(C.NAVY, C.CREAM, 14, true));
    this._set(ws, 'A' + row, '  ' + courseTitle, this._bannerCell(C.NAVY, C.CREAM, 14, true));
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ROW 2: Sub-header
    this._fillRow(ws, row, COLS, this._bannerCell(C.NAVY, C.SEAFOAM, 10, false, true));
    this._set(ws, 'A' + row,
      '  Instructor: ' + instructor + '     |     Generated: ' + this._today(),
      this._bannerCell(C.NAVY, C.SEAFOAM, 10, false, true));
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ROW 3: Spacer
    this._fillRow(ws, row, COLS, { fill: { patternType: 'solid', fgColor: { rgb: C.NAVY } } });
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ROWS 4-7: Summary block
    const lblSt = this._cell(C.OCEAN, C.SEAFOAM, { bold: true });
    const valSt = this._cell(C.OCEAN, C.CREAM);

    const summaryRows = [
      ['Total Lectures', String(totalLectures)],
      ['Total Duration', this._fmtDuration(totalSecs)],
      ['Completed',      '0  --  update as you watch'],
      ['% Complete',     ''],  // will hold live formula
    ];

    summaryRows.forEach(([label, val], i) => {
      const r = row + i;
      this._set(ws, 'A' + r, label, lblSt);
      this._set(ws, 'B' + r, '',    lblSt);
      merges.push({ s: { r: r - 1, c: 0 }, e: { r: r - 1, c: 1 } });
      for (let c = 2; c < COLS; c++) {
        this._set(ws, this._addr(c, r), c === 2 ? val : '', valSt);
      }
      merges.push({ s: { r: r - 1, c: 2 }, e: { r: r - 1, c: COLS - 1 } });
    });

    const pctRow = row + 3;
    row += 4;

    // ROW 8: Spacer
    this._fillRow(ws, row, COLS, { fill: { patternType: 'solid', fgColor: { rgb: C.NAVY } } });
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ROW 9: Column headers
    const HEADER_ROW = row;
    const HEADERS    = ['#', 'Lecture Title', 'Type', 'Duration', 'Size', 'Status', 'Rating', 'Notes'];
    const hSt        = this._headerCell();
    HEADERS.forEach((h, i) => this._set(ws, this._addr(i, row), h, hSt));
    row++;

    const DATA_START = row;

    // -- Data rows ------------------------------------------------------------
    let currentChapter = null;
    let lectureNum     = 0;

    videos.forEach((video) => {
      const chapter = video.Chapter || '';

      // Chapter divider
      if (chapter && chapter !== currentChapter) {
        currentChapter = chapter;
        const chSt = this._chapterCell();
        this._fillRow(ws, row, COLS, chSt);
        this._set(ws, 'A' + row, '  >> ' + chapter, chSt);
        merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
        row++;
      }

      lectureNum++;
      const rowBg   = (lectureNum % 2 === 0) ? C.ROW_EVEN : C.ROW_ODD;
      const textCol = '1A2E45';
      const dimCol  = '4A7A94';

      const baseSt   = (ha = 'left') => this._cell(rowBg, textCol, { halign: ha });
      const centerSt = ()            => this._cell(rowBg, dimCol,  { halign: 'center' });

      // A: index
      this._set(ws, 'A' + row, video.IndexRaw || lectureNum,
        this._cell(rowBg, textCol, { halign: 'center', bold: true }));

      // B: title
      const cleanTitle = (video.TitleRaw || video.VideoTitle || '').replace(/<[^>]*>/g, '').trim();
      this._set(ws, 'B' + row, cleanTitle, baseSt());

      // C: type
      const typeMap = { Video: 'Video', Article: 'Article', File: 'File', ExternalLink: 'Link' };
      this._set(ws, 'C' + row, typeMap[video.Type] || video.Type || 'Video', centerSt());

      // D: duration
      this._set(ws, 'D' + row, this._fmtDuration(video.duration || 0), centerSt());

      // E: size (populated from video.filesize if available)
      const sizeStr = (typeof formatBytes === 'function' && video.filesize)
        ? formatBytes(video.filesize) : '--';
      this._set(ws, 'E' + row, sizeStr, centerSt());

      // F: Status dropdown
      this._set(ws, 'F' + row, 'Not Started',
        this._cell(rowBg, dimCol, { halign: 'center', italic: true }));
      validations.push({
        type: 'list', sqref: 'F' + row,
        formula1: '"Not Started,In Progress,Completed,Skipped"',
        showDropDown: false,
      });

      // G: Rating dropdown
      this._set(ws, 'G' + row, '', centerSt());
      validations.push({
        type: 'list', sqref: 'G' + row,
        formula1: '"\u2B505,\u2B504,\u2B503,\u2B502,\u2B501"',
      });

      // H: Notes
      this._set(ws, 'H' + row, '',
        this._cell(C.NOTES_BG, '555555', { halign: 'left', wrap: true }));

      row++;
    });

    const DATA_END = row - 1;

    // -- Totals row -----------------------------------------------------------
    const totSt  = this._totalCell(C.SEAFOAM, 'center');
    const totLbl = this._totalCell(C.CREAM,   'right');
    this._set(ws, 'A' + row, 'TOTAL',                      this._totalCell(C.CREAM, 'center'));
    this._set(ws, 'B' + row, totalLectures + ' lectures',  totLbl);
    this._set(ws, 'C' + row, '',                           totSt);
    this._set(ws, 'D' + row, this._fmtDuration(totalSecs), totSt);
    this._set(ws, 'E' + row, '--',                         totSt);
    this._set(ws, 'F' + row, '--',                         totSt);
    this._set(ws, 'G' + row, '--',                         totSt);
    this._set(ws, 'H' + row, '--',                         totSt);
    row++;

    // -- Back-fill % Complete formula -----------------------------------------
    const pctFormula =
      'COUNTIF(F' + DATA_START + ':F' + DATA_END + ',"Completed")' +
      '&" / "' +
      '&' + totalLectures +
      '&" ("' +
      '&TEXT(COUNTIF(F' + DATA_START + ':F' + DATA_END + ',"Completed")/' + totalLectures + ',"0%")' +
      '&")"';
    ws['C' + pctRow] = { f: pctFormula, v: '0 / ' + totalLectures + ' (0%)', t: 's', s: valSt };

    // -- Worksheet metadata ---------------------------------------------------
    ws['!ref']             = 'A1:H' + (row - 1);
    ws['!merges']          = merges;
    ws['!dataValidations'] = validations;
    ws['!freeze']          = { xSplit: 2, ySplit: HEADER_ROW, topLeftCell: 'C' + (HEADER_ROW + 1) };

    // -- Row heights ----------------------------------------------------------
    const rowHeights = [];
    rowHeights[0] = { hpt: 38 };  // banner
    rowHeights[1] = { hpt: 18 };  // sub-header
    rowHeights[2] = { hpt:  6 };  // spacer
    for (let i = 3; i <= 6; i++) rowHeights[i] = { hpt: 19 };  // summary
    rowHeights[7] = { hpt:  6 };  // spacer
    rowHeights[8] = { hpt: 24 };  // column header
    for (let i = 9; i < row; i++) rowHeights[i] = { hpt: 20 };
    ws['!rows'] = rowHeights;

    // -- Assemble workbook ----------------------------------------------------
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Course Tracker');
    wb.Props = {
      Title:   courseTitle + ' -- Course Tracker',
      Subject: 'Udemy Course Progress',
      Author:  'UdemyDownloader Extension',
    };

    // -- Filename & download --------------------------------------------------
    const safeName = courseTitle.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
    const filename = safeName + ' -- Course Tracker.xlsx';

    try {
      XLSX.writeFile(wb, filename, { bookType: 'xlsx', bookSST: false, type: 'binary', cellStyles: true });
      if (typeof UI !== 'undefined') UI.showToast('Course tracker spreadsheet downloaded!', 'table');
    } catch (err) {
      console.error('[SheetGenerator] Failed to write xlsx:', err);
      if (typeof UI !== 'undefined') UI.showToast('Spreadsheet generation failed.', 'alert-circle');
    }
  },
};
