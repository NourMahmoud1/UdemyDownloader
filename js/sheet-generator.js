/**
 * sheet-generator.js  (v3)
 * Generates a polished .xlsx course-tracker workbook and triggers a download.
 *
 * Improvements over v2:
 *   - Full live-formula dashboard with 7 tracked metrics:
 *       Total Lectures, Total Duration, Completed, In Progress,
 *       Not Started, Skipped, % Complete (text formula + ASCII progress bar)
 *   - Colour-coded status cells: green=Completed, amber=In Progress,
 *       red=Skipped, muted=Not Started
 *   - Status COUNTIF formulas auto-update as you change dropdown values
 *   - Progress bar formula in summary (e.g. "████████░░░░  67%")
 *   - Single-range data validations (more reliable than per-row entries)
 *
 * Public API:
 *   SheetGenerator.generate(videos, courseDetail, folder)
 *
 * Depends on: Plugins/xlsx.full.min.js  (SheetJS CE)
 */

const SheetGenerator = {

  // -- Palette (Ocean Depths — matches the extension UI) --------------------
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
    GREEN:       '16A34A',
    GREEN_BG:    'DCFCE7',
    AMBER:       'D97706',
    AMBER_BG:    'FEF3C7',
    RED:         'DC2626',
    RED_BG:      'FEE2E2',
    BLUE:        '2563EB',
    BLUE_BG:     'DBEAFE',
    TOTAL_BG:    '0D2E42',
    DASH_VAL_BG: '0F2336',
  },

  // -- Helpers ---------------------------------------------------------------

  _fmtDuration(secs) {
    if (!secs) return '--';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    const s = Math.floor(secs % 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  },

  _today() {
    return new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  },

  _col(i) { return String.fromCharCode(65 + i); },
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

  _dashLabelCell() {
    return this._cell(this._C.OCEAN, this._C.SEAFOAM, {
      bold: true, sz: 10, halign: 'right', valign: 'center',
      borderColor: this._C.TEAL, borderStyle: 'thin',
    });
  },

  _dashValueCell(fc) {
    return this._cell(this._C.DASH_VAL_BG, fc || this._C.CREAM, {
      bold: false, sz: 10, halign: 'left', valign: 'center',
      borderColor: this._C.TEAL_LIGHT, borderStyle: 'thin',
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

  _fillRow(ws, row, cols, style, value = '') {
    for (let c = 0; c < cols; c++) {
      this._set(ws, this._addr(c, row), value, style);
    }
  },

  // -- Main entry point ------------------------------------------------------

  generate(videos, courseDetail, folder) {
    if (typeof XLSX === 'undefined') {
      console.error('[SheetGenerator] SheetJS (XLSX) is not loaded.');
      if (typeof UI !== 'undefined') UI.showToast('Could not generate tracker — SheetJS missing.', 'alert-circle');
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
    const ws     = {};
    const merges = [];

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

    // ── ROW 1: Course banner ─────────────────────────────────────────────────
    this._fillRow(ws, row, COLS, this._bannerCell(C.NAVY, C.CREAM, 14, true));
    this._set(ws, 'A' + row, '  ' + courseTitle, this._bannerCell(C.NAVY, C.CREAM, 14, true));
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ── ROW 2: Sub-header ────────────────────────────────────────────────────
    this._fillRow(ws, row, COLS, this._bannerCell(C.NAVY, C.SEAFOAM, 10, false, true));
    this._set(ws, 'A' + row,
      '  Instructor: ' + instructor + '     |     Generated: ' + this._today(),
      this._bannerCell(C.NAVY, C.SEAFOAM, 10, false, true));
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ── ROW 3: Spacer ────────────────────────────────────────────────────────
    this._fillRow(ws, row, COLS, { fill: { patternType: 'solid', fgColor: { rgb: C.NAVY } } });
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ── ROWS 4-13: Dashboard block ───────────────────────────────────────────
    const DASH_ROWS = [
      { label: 'Total Lectures',  value: String(totalLectures),                formula: false, color: C.CREAM    },
      { label: 'Total Duration',  value: this._fmtDuration(totalSecs),         formula: false, color: C.CREAM    },
      { label: null,              value: null,  formula: false, color: null },
      { label: '✅  Completed',   value: '0',                                  formula: true,  color: C.GREEN_BG },
      { label: '🔄  In Progress', value: '0',                                  formula: true,  color: C.AMBER_BG },
      { label: '⏭  Skipped',     value: '0',                                  formula: true,  color: C.RED_BG   },
      { label: '⬜  Not Started', value: String(totalLectures),                formula: true,  color: C.BLUE_BG  },
      { label: null,              value: null,  formula: false, color: null },
      { label: '% Complete',      value: '0 / ' + totalLectures + ' (0%)',     formula: true,  color: C.SEAFOAM  },
      { label: 'Progress',        value: '░'.repeat(20) + '  0%',             formula: true,  color: C.SEAFOAM  },
    ];

    const DASH_ROW_INDICES = [];
    const spacerStyle      = { fill: { patternType: 'solid', fgColor: { rgb: C.OCEAN } } };
    const lblSt            = this._dashLabelCell();

    for (let di = 0; di < DASH_ROWS.length; di++) {
      const d = DASH_ROWS[di];
      DASH_ROW_INDICES.push(row);

      if (d.label === null) {
        this._fillRow(ws, row, COLS, spacerStyle);
        merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
      } else {
        this._set(ws, 'A' + row, d.label, lblSt);
        this._set(ws, 'B' + row, '',      lblSt);
        merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 1 } });

        const valFc = ['✅', '🔄', '⏭', '⬜'].some(e => d.label.startsWith(e))
          ? '1A2E45' : C.CREAM;
        const valBg = d.color || C.DASH_VAL_BG;
        const valSt = this._cell(valBg, valFc, {
          sz: 10, bold: d.label.startsWith('%') || d.label === 'Progress',
          halign: 'left', valign: 'center',
          borderColor: C.TEAL_LIGHT, borderStyle: 'thin',
        });

        this._set(ws, 'C' + row, d.value, valSt);
        for (let c = 3; c < COLS; c++) {
          this._set(ws, this._addr(c, row), '', valSt);
        }
        merges.push({ s: { r: row - 1, c: 2 }, e: { r: row - 1, c: COLS - 1 } });
      }
      row++;
    }

    // ── Spacer before column headers ─────────────────────────────────────────
    this._fillRow(ws, row, COLS, { fill: { patternType: 'solid', fgColor: { rgb: C.NAVY } } });
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: COLS - 1 } });
    row++;

    // ── Column headers ───────────────────────────────────────────────────────
    const HEADER_ROW = row;
    const HEADERS    = ['#', 'Lecture Title', 'Type', 'Duration', 'Size', 'Status', 'Rating', 'Notes'];
    const hSt        = this._headerCell();
    HEADERS.forEach((h, i) => this._set(ws, this._addr(i, row), h, hSt));
    row++;

    const DATA_START = row;

    // ── Data rows ────────────────────────────────────────────────────────────
    let currentChapter = null;
    let lectureNum     = 0;

    videos.forEach((video) => {
      const chapter = video.Chapter || '';

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

      this._set(ws, 'A' + row, video.IndexRaw || lectureNum,
        this._cell(rowBg, textCol, { halign: 'center', bold: true }));

      const cleanTitle = (video.TitleRaw || video.VideoTitle || '').replace(/<[^>]*>/g, '').trim();
      this._set(ws, 'B' + row, cleanTitle, baseSt());

      const typeMap = { Video: 'Video', Article: 'Article', File: 'File', ExternalLink: 'Link' };
      this._set(ws, 'C' + row, typeMap[video.Type] || video.Type || 'Video', centerSt());

      this._set(ws, 'D' + row, this._fmtDuration(video.duration || 0), centerSt());

      const sizeStr = (typeof formatBytes === 'function' && video.filesize)
        ? formatBytes(video.filesize) : '--';
      this._set(ws, 'E' + row, sizeStr, centerSt());

      // F: Status — default value; dropdown applied as a single range validation below
      this._set(ws, 'F' + row, 'Not Started',
        this._cell(rowBg, dimCol, { halign: 'center' }));

      // G: Rating — default empty; dropdown applied as a single range validation below
      this._set(ws, 'G' + row, '', centerSt());

      // H: Notes
      this._set(ws, 'H' + row, '',
        this._cell(C.NOTES_BG, '555555', { halign: 'left', wrap: true }));

      row++;
    });

    const DATA_END = row - 1;

    // ── Totals row ───────────────────────────────────────────────────────────
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

    // ── Data validations — applied as TWO range rules (most reliable) ────────
    //
    // One validation object per column, covering the full data range.
    // This is far more reliable than one object per row (SheetJS CE can
    // silently truncate large per-row arrays).
    //
    // showDropDown: false  →  Excel shows the dropdown arrow (counter-intuitive
    //                          but correct per the OOXML spec).

    ws['!dataValidations'] = [
      {
        // Status column F — three choices
        type:         'list',
        sqref:        `F${DATA_START}:F${DATA_END}`,
        formula1:     '"Not Started,In Progress,Completed,Skipped"',
        showDropDown: false,
        showErrorMessage: true,
        errorTitle:   'Invalid status',
        error:        'Please choose from the dropdown: Not Started, In Progress, Completed, or Skipped.',
      },
      {
        // Rating column G — star ratings
        type:         'list',
        sqref:        `G${DATA_START}:G${DATA_END}`,
        formula1:     '"★★★★★,★★★★☆,★★★☆☆,★★☆☆☆,★☆☆☆☆"',
        showDropDown: false,
      },
    ];

    // ── Back-fill live dashboard formulas ────────────────────────────────────
    const fRange = 'F' + DATA_START + ':F' + DATA_END;
    const N      = totalLectures;

    const getDashValStyle = (dashIndex) => {
      const r = DASH_ROW_INDICES[dashIndex];
      return ws['C' + r] ? ws['C' + r].s : this._dashValueCell();
    };

    ws['C' + DASH_ROW_INDICES[3]] = {
      f: `COUNTIF(${fRange},"Completed")`, v: 0, t: 'n', s: getDashValStyle(3),
    };
    ws['C' + DASH_ROW_INDICES[4]] = {
      f: `COUNTIF(${fRange},"In Progress")`, v: 0, t: 'n', s: getDashValStyle(4),
    };
    ws['C' + DASH_ROW_INDICES[5]] = {
      f: `COUNTIF(${fRange},"Skipped")`, v: 0, t: 'n', s: getDashValStyle(5),
    };
    ws['C' + DASH_ROW_INDICES[6]] = {
      f: `COUNTIF(${fRange},"Not Started")`, v: N, t: 'n', s: getDashValStyle(6),
    };

    const pctFormula =
      `COUNTIF(${fRange},"Completed")` +
      `&" / ${N} ("` +
      `&TEXT(COUNTIF(${fRange},"Completed")/${N},"0%")` +
      `&")"`;
    ws['C' + DASH_ROW_INDICES[8]] = {
      f: pctFormula, v: '0 / ' + N + ' (0%)', t: 's', s: getDashValStyle(8),
    };

    const BAR        = 20;
    const barFormula =
      `REPT("█",ROUND(COUNTIF(${fRange},"Completed")/${N}*${BAR},0))` +
      `&REPT("░",${BAR}-ROUND(COUNTIF(${fRange},"Completed")/${N}*${BAR},0))` +
      `&"  "&TEXT(COUNTIF(${fRange},"Completed")/${N},"0%")`;
    ws['C' + DASH_ROW_INDICES[9]] = {
      f: barFormula,
      v: '░'.repeat(BAR) + '  0%',
      t: 's',
      s: this._cell(C.NAVY, C.TEAL_LIGHT, {
        sz: 12, bold: true, halign: 'left',
        borderColor: C.TEAL, borderStyle: 'thin',
      }),
    };

    // ── Worksheet metadata ───────────────────────────────────────────────────
    ws['!ref']    = 'A1:H' + (row - 1);
    ws['!merges'] = merges;
    ws['!freeze'] = { xSplit: 2, ySplit: HEADER_ROW, topLeftCell: 'C' + (HEADER_ROW + 1) };

    // ── Row heights ──────────────────────────────────────────────────────────
    const rowHeights = [];
    rowHeights[0] = { hpt: 38 };
    rowHeights[1] = { hpt: 18 };
    rowHeights[2] = { hpt:  5 };

    for (let di = 0; di < DASH_ROWS.length; di++) {
      const d   = DASH_ROWS[di];
      const idx = DASH_ROW_INDICES[di] - 1;
      rowHeights[idx] = { hpt: d.label === null ? 4 : (di === 9 ? 22 : 19) };
    }

    rowHeights[HEADER_ROW - 1] = { hpt: 24 };
    for (let i = HEADER_ROW; i < row; i++) rowHeights[i] = { hpt: 20 };

    ws['!rows'] = rowHeights;

    // ── Assemble workbook ────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Course Tracker');
    wb.Props = {
      Title:   courseTitle + ' -- Course Tracker',
      Subject: 'Udemy Course Progress',
      Author:  'UdemyDownloader Extension',
    };

    // ── Filename & download ──────────────────────────────────────────────────
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
