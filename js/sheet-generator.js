/**
 * sheet-generator.js
 * Generates a styled .xlsx course-tracker workbook and triggers a download.
 *
 * The sheet is built entirely in the browser using the SheetJS (xlsx) library
 * loaded from the Plugins folder, so no Python / native code is required.
 *
 * Public API:
 *   SheetGenerator.generate(videos, courseDetail, folder)
 *
 * Depends on: Plugins/xlsx.full.min.js  (SheetJS CE)
 */

const SheetGenerator = {

  // ── Palette (Ocean Depths — matches the extension UI) ───────────────────
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
    NOTES_BG:    'FFFDE7',
    ROW_ALT:     'F4F9F9',
    BORDER:      'BBCCCC',
    WHITE:       'FFFFFF',
  },

  // ── Duration formatter ───────────────────────────────────────────────────
  _fmtDuration(secs) {
    if (!secs) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  },

  // ── Today's date as "DD Month YYYY" ─────────────────────────────────────
  _today() {
    return new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  },

  // ── Cell style builders ──────────────────────────────────────────────────
  _style(fg, fontColor, bold = false, sz = 10, italic = false, halign = 'left', valign = 'center', wrapText = false) {
    return {
      font:      { name: 'Calibri', sz, bold, italic, color: { rgb: fontColor } },
      fill:      { patternType: 'solid', fgColor: { rgb: fg } },
      alignment: { horizontal: halign, vertical: valign, wrapText },
      border: {
        top:    { style: 'thin', color: { rgb: this._C.BORDER } },
        bottom: { style: 'thin', color: { rgb: this._C.BORDER } },
        left:   { style: 'thin', color: { rgb: this._C.BORDER } },
        right:  { style: 'thin', color: { rgb: this._C.BORDER } },
      },
    };
  },

  _bannerStyle(fg, fontColor, sz = 14, bold = true) {
    return {
      font:      { name: 'Calibri', sz, bold, color: { rgb: fontColor } },
      fill:      { patternType: 'solid', fgColor: { rgb: fg } },
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    };
  },

  _chapterStyle() {
    return {
      font:      { name: 'Calibri', sz: 10, bold: true, color: { rgb: this._C.SEAFOAM } },
      fill:      { patternType: 'solid', fgColor: { rgb: this._C.CHAPTER_BG } },
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
      border: {
        top:    { style: 'thin', color: { rgb: this._C.TEAL_LIGHT } },
        bottom: { style: 'thin', color: { rgb: this._C.TEAL_LIGHT } },
        left:   { style: 'thin', color: { rgb: this._C.TEAL_LIGHT } },
        right:  { style: 'thin', color: { rgb: this._C.TEAL_LIGHT } },
      },
    };
  },

  _headerStyle() {
    return {
      font:      { name: 'Calibri', sz: 10, bold: true, color: { rgb: this._C.CREAM } },
      fill:      { patternType: 'solid', fgColor: { rgb: this._C.HEADER_BG } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top:    { style: 'medium', color: { rgb: this._C.TEAL } },
        bottom: { style: 'medium', color: { rgb: this._C.TEAL } },
        left:   { style: 'thin',   color: { rgb: this._C.TEAL } },
        right:  { style: 'thin',   color: { rgb: this._C.TEAL } },
      },
    };
  },

  // ── SheetJS helper: set a cell with value + style ────────────────────────
  _setCell(ws, addr, value, style) {
    if (!ws[addr]) ws[addr] = {};
    ws[addr].v = value;
    ws[addr].t = typeof value === 'number' ? 'n' : 's';
    ws[addr].s = style;
  },

  // ── Main entry point ─────────────────────────────────────────────────────

  /**
   * Builds and downloads the course-tracker .xlsx file.
   *
   * @param {Array}  videos        - Normalised video list from App.data
   * @param {object} courseDetail  - Course API object (title, visible_instructors)
   * @param {string} folder        - Base download folder (for the filename hint)
   */
  generate(videos, courseDetail, folder) {
    if (typeof XLSX === 'undefined') {
      console.error('[SheetGenerator] SheetJS (XLSX) is not loaded.');
      UI.showToast('Could not generate tracker — SheetJS missing.', 'alert-circle');
      return;
    }

    const C = this._C;

    // ── Metadata ────────────────────────────────────────────────────────────
    const courseTitle  = courseDetail.title || 'Unknown Course';
    const instructor   = courseDetail.visible_instructors && courseDetail.visible_instructors.length > 0
      ? courseDetail.visible_instructors[0].display_name
      : 'Unknown Instructor';

    const totalLectures = videos.length;
    const totalSecs     = videos.reduce((sum, v) => sum + (v.duration || 0), 0);

    // ── Build worksheet manually ────────────────────────────────────────────
    const ws  = {};
    const ref = { minR: 1, minC: 1, maxR: 1, maxC: 7 };

    // Column widths (in SheetJS character units)
    ws['!cols'] = [
      { wch: 5  },   // A  #
      { wch: 52 },   // B  Title
      { wch: 10 },   // C  Type
      { wch: 11 },   // D  Duration
      { wch: 16 },   // E  Watched
      { wch: 10 },   // F  Rating
      { wch: 38 },   // G  Notes
    ];

    let row = 1;

    // ── ROW 1: Course banner ────────────────────────────────────────────────
    this._setCell(ws, `A${row}`, `  ${courseTitle}`, this._bannerStyle(C.NAVY, C.CREAM, 14, true));
    ws['!merges'] = ws['!merges'] || [];
    ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 6 } });
    ws[`A${row}`].h = 36; // row height hint (not all renderers honour this)
    row++;

    // ── ROW 2: Sub-header ───────────────────────────────────────────────────
    this._setCell(ws, `A${row}`,
      `  Instructor: ${instructor}     |     Generated: ${this._today()}`,
      this._bannerStyle(C.NAVY, C.SEAFOAM, 10, false));
    // apply italic
    ws[`A${row}`].s.font.italic = true;
    ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 6 } });
    row++;

    // ── ROW 3: Spacer ───────────────────────────────────────────────────────
    this._setCell(ws, `A${row}`, '', { fill: { patternType: 'solid', fgColor: { rgb: C.NAVY } } });
    ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 6 } });
    row++;

    // ── ROWS 4-6: Summary block ─────────────────────────────────────────────
    const summaryItems = [
      ['Total Lectures',  String(totalLectures)],
      ['Total Duration',  this._fmtDuration(totalSecs)],
      ['Completed',       '0  —  update as you watch'],
    ];

    const labelSt = this._style(C.OCEAN, C.SEAFOAM, true,  10, false, 'left');
    const valSt   = this._style(C.OCEAN, C.CREAM,   false, 10, false, 'left');

    summaryItems.forEach(([label, val]) => {
      this._setCell(ws, `A${row}`, label, labelSt);
      this._setCell(ws, `B${row}`, '',    labelSt);
      ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 1 } });
      this._setCell(ws, `C${row}`, val, valSt);
      ['D', 'E', 'F', 'G'].forEach(col => {
        this._setCell(ws, `${col}${row}`, '', valSt);
      });
      ws['!merges'].push({ s: { r: row - 1, c: 2 }, e: { r: row - 1, c: 6 } });
      row++;
    });

    // ── ROW 7: Spacer ───────────────────────────────────────────────────────
    this._setCell(ws, `A${row}`, '', { fill: { patternType: 'solid', fgColor: { rgb: C.NAVY } } });
    ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 6 } });
    row++;

    // ── ROW 8: Column headers ───────────────────────────────────────────────
    const HEADER_ROW = row;
    const headers = ['#', 'Lecture Title', 'Type', 'Duration', 'Watched', 'Rating', 'Notes'];
    const hSt = this._headerStyle();
    headers.forEach((h, i) => {
      const addr = `${String.fromCharCode(65 + i)}${row}`;
      this._setCell(ws, addr, h, hSt);
    });
    row++;

    // ── Data rows ───────────────────────────────────────────────────────────
    let currentChapter = null;
    let lectureNum     = 0;
    const dataValidations = [];

    videos.forEach((video) => {
      const chapter = video.Chapter || '';

      // Chapter divider
      if (chapter && chapter !== currentChapter) {
        currentChapter = chapter;
        this._setCell(ws, `A${row}`, `  ${chapter}`, this._chapterStyle());
        ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 6 } });
        ['B','C','D','E','F','G'].forEach(col => {
          ws[`${col}${row}`] = { v: '', t: 's', s: this._chapterStyle() };
        });
        row++;
      }

      lectureNum++;
      const isAlt     = lectureNum % 2 === 0;
      const rowBg     = isAlt ? C.ROW_ALT : C.WHITE;
      const textColor = '222222';
      const dimColor  = C.DIM;

      // A: index
      this._setCell(ws, `A${row}`, video.IndexRaw || lectureNum,
        this._style(rowBg, textColor, false, 10, false, 'center'));

      // B: title (strip HTML tags)
      const cleanTitle = (video.TitleRaw || video.VideoTitle || '')
        .replace(/<[^>]*>/g, '').trim();
      this._setCell(ws, `B${row}`, cleanTitle,
        this._style(rowBg, textColor, false, 10, false, 'left'));

      // C: type
      const typeLabel = video.Type || 'Video';
      const typeColor = typeLabel === 'Article' ? C.TEAL : textColor;
      this._setCell(ws, `C${row}`, typeLabel,
        this._style(rowBg, typeColor, false, 10, false, 'center'));

      // D: duration
      this._setCell(ws, `D${row}`, this._fmtDuration(video.duration || 0),
        this._style(rowBg, dimColor, false, 10, false, 'center'));

      // E: Watched dropdown — default "Not Started"
      this._setCell(ws, `E${row}`, 'Not Started',
        this._style(rowBg, dimColor, false, 10, true, 'center'));
      dataValidations.push({
        type: 'list', sqref: `E${row}`,
        formula1: '"Not Started,In Progress,Completed"',
      });

      // F: Rating dropdown — blank
      this._setCell(ws, `F${row}`, '',
        this._style(rowBg, textColor, false, 10, false, 'center'));
      dataValidations.push({
        type: 'list', sqref: `F${row}`,
        formula1: '"\u2B50,\u2B50\u2B50,\u2B50\u2B50\u2B50,\u2B50\u2B50\u2B50\u2B50,\u2B50\u2B50\u2B50\u2B50\u2B50"',
      });

      // G: Notes
      this._setCell(ws, `G${row}`, '',
        this._style(C.NOTES_BG, '555555', false, 10, false, 'left'));

      row++;
    });

    // ── Set worksheet ref range ─────────────────────────────────────────────
    ref.maxR = row - 1;
    ws['!ref'] = `A1:G${ref.maxR}`;

    // ── Row heights via !rows ───────────────────────────────────────────────
    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 36 };  // row 1 banner
    ws['!rows'][1] = { hpt: 18 };  // row 2 sub-header
    ws['!rows'][2] = { hpt:  8 };  // row 3 spacer
    for (let i = 3; i <= 5; i++) ws['!rows'][i] = { hpt: 18 }; // summary
    ws['!rows'][6] = { hpt:  8 };  // spacer
    ws['!rows'][7] = { hpt: 22 };  // header
    // Data rows
    for (let i = 8; i < row; i++) ws['!rows'][i] = { hpt: 20 };

    // ── Data validations ────────────────────────────────────────────────────
    ws['!dataValidations'] = dataValidations;

    // ── Assemble workbook ───────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Course Tracker');

    // ── Workbook properties ─────────────────────────────────────────────────
    wb.Props = {
      Title:   courseTitle + ' — Course Tracker',
      Subject: 'Udemy Course Progress',
      Author:  'UdemyDownloader Extension',
    };

    // ── Filename ────────────────────────────────────────────────────────────
    const safeName = courseTitle.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60);
    const filename = `${safeName} — Course Tracker.xlsx`;

    // ── Trigger browser download ────────────────────────────────────────────
    try {
      XLSX.writeFile(wb, filename, { bookType: 'xlsx', bookSST: false, type: 'binary', cellStyles: true });
      UI.showToast('Course tracker spreadsheet downloaded!', 'table');
    } catch (err) {
      console.error('[SheetGenerator] Failed to write xlsx:', err);
      UI.showToast('Spreadsheet generation failed.', 'alert-circle');
    }
  },
};
