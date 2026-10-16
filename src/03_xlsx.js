/* ============ 零依赖 XLSX 生成器（ZIP store + OOXML） ============ */
/* 不用 SheetJS：社区版写不了单元格样式（边框/底色是 Pro 功能），报价单没边框没法看。 */

var CRC_TABLE = (function () {
  var t = new Uint32Array(256), n, k, c;
  for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();

function crc32(bytes) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function utf8(s) { return new TextEncoder().encode(s); }

function BW() { this.buf = new Uint8Array(4096); this.len = 0; }
BW.prototype.need = function (n) {
  if (this.len + n > this.buf.length) {
    var s = this.buf.length; while (s < this.len + n) s *= 2;
    var nb = new Uint8Array(s); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
};
BW.prototype.u8 = function (v) { this.need(1); this.buf[this.len++] = v & 0xFF; };
BW.prototype.u16 = function (v) { this.need(2); this.buf[this.len++] = v & 0xFF; this.buf[this.len++] = (v >>> 8) & 0xFF; };
BW.prototype.u32 = function (v) { this.need(4); this.buf[this.len++] = v & 0xFF; this.buf[this.len++] = (v >>> 8) & 0xFF; this.buf[this.len++] = (v >>> 16) & 0xFF; this.buf[this.len++] = (v >>> 24) & 0xFF; };
BW.prototype.bytes = function (b) { this.need(b.length); this.buf.set(b, this.len); this.len += b.length; };
BW.prototype.out = function () { return this.buf.subarray(0, this.len); };

function zipStore(files) {
  var w = new BW(), central = [], d = new Date();
  var dosDate = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  var dosTime = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  files.forEach(function (f) {
    var name = utf8(f.name), data = f.data, crc = crc32(data), off = w.len;
    w.u32(0x04034b50); w.u16(20); w.u16(0x0800); w.u16(0); w.u16(dosTime); w.u16(dosDate);
    w.u32(crc); w.u32(data.length); w.u32(data.length); w.u16(name.length); w.u16(0);
    w.bytes(name); w.bytes(data);
    central.push({ name: name, crc: crc, size: data.length, off: off });
  });
  var cdStart = w.len;
  central.forEach(function (e) {
    w.u32(0x02014b50); w.u16(20); w.u16(20); w.u16(0x0800); w.u16(0); w.u16(dosTime); w.u16(dosDate);
    w.u32(e.crc); w.u32(e.size); w.u32(e.size);
    w.u16(e.name.length); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u32(0); w.u32(e.off);
    w.bytes(e.name);
  });
  var cdSize = w.len - cdStart;
  w.u32(0x06054b50); w.u16(0); w.u16(0); w.u16(central.length); w.u16(central.length);
  w.u32(cdSize); w.u32(cdStart); w.u16(0);
  return w.out();
}

function xesc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colName(n) {
  var s = "", x = n + 1;
  while (x > 0) { var m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

/* 样式索引（与下方 styles.xml 的 cellXfs 顺序严格一一对应） */
var XS = {
  def: 0, title: 1, sub: 2, headDark: 3, text: 4, ctr: 5, num: 6,
  optText: 7, optCtr: 8, optNum: 9, bLabel: 10, bNum: 11, note: 12,
  plain: 13, sec: 14, bCtr: 15, sumHead: 16, sumNum: 17, headLight: 18,
  plainR: 19, textNB: 20, textBot: 21, optTextBot: 22
};

var FONT_NAME = "宋体", FONT_TITLE = "微软雅黑";

function stylesXml() {
  function f(extra, name) { return "<font>" + extra + '<sz val="11"/><name val="' + (name || FONT_NAME) + '"/></font>'; }
  /* 全表细线 + 表头上下 medium 粗线；线色用纯黑，
     别用浅灰 —— 低缩放（<70%）下浅色细线会被压成亚像素、看着像没画 */
  var W = 'thin';
  var BK = 'FF000000';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="8">'
    + f('')
    + f('<b/>')
    + f('<b/><color rgb="FFFFFFFF"/>')
    + f('<color rgb="FFC0392B"/>')
    + '<font><b/><sz val="16"/><name val="' + FONT_TITLE + '"/></font>'
    + f('<color rgb="FF808080"/>')
    + f('<b/><color rgb="FFC0392B"/>')
    + '<font><b/><sz val="12"/><name val="' + FONT_TITLE + '"/></font>'
    + '</fonts>'
    + '<fills count="5">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF404040"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFDECEA"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="4">'
    + '<border><left/><right/><top/><bottom/></border>'
    + '<border><left style="' + W + '"><color rgb="' + BK + '"/></left><right style="' + W + '"><color rgb="' + BK + '"/></right><top style="' + W + '"><color rgb="' + BK + '"/></top><bottom style="' + W + '"><color rgb="' + BK + '"/></bottom></border>'
    + '<border><left style="' + W + '"><color rgb="' + BK + '"/></left><right style="' + W + '"><color rgb="' + BK + '"/></right><top style="' + W + '"><color rgb="' + BK + '"/></top><bottom style="' + W + '"><color rgb="' + BK + '"/></bottom></border>'
    + '<border><left style="' + W + '"><color rgb="' + BK + '"/></left><right style="' + W + '"><color rgb="' + BK + '"/></right><top style="medium"><color rgb="' + BK + '"/></top><bottom style="medium"><color rgb="' + BK + '"/></bottom></border>'
    + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="23">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="3" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="3" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="3" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>'
    /* 21 / 22：底对齐。行内附图时，图片占上半部分，说明文字落到下方，两者不重叠 */
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="bottom" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="bottom" wrapText="1"/></xf>'
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

function sheetXml(model) {
  var cols = model.cols || [], rows = model.rows || [], merges = model.merges || [];
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="16.5"/>';
  if (cols.length) {
    x += '<cols>';
    for (var i = 0; i < cols.length; i++) x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + cols[i] + '" customWidth="1"/>';
    x += '</cols>';
  }
  x += '<sheetData>';
  rows.forEach(function (row, ri) {
    var r = ri + 1, cells = "";
    (row || []).forEach(function (c, ci) {
      if (!c) return;
      var v = c.v;
      if ((v === null || v === undefined || v === "") && (c.s === undefined || c.s === null)) return;
      var sAttr = (c.s !== undefined && c.s !== null) ? ' s="' + c.s + '"' : "";
      var ref = colName(ci) + r;
      if (c.t === "n" && (v === "" || v === null || v === undefined)) {
        cells += '<c r="' + ref + '"' + sAttr + '/>';
      } else if (c.t === "n" && !isNaN(Number(v))) {
        cells += '<c r="' + ref + '"' + sAttr + '><v>' + Number(v) + '</v></c>';
      } else {
        cells += '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
      }
    });
    var h = (model.rowHeights && model.rowHeights[ri]) ? ' ht="' + model.rowHeights[ri] + '" customHeight="1"' : "";
    x += '<row r="' + r + '"' + h + '>' + cells + '</row>';
  });
  x += '</sheetData>';
  if (merges.length) {
    x += '<mergeCells count="' + merges.length + '">';
    merges.forEach(function (m) { x += '<mergeCell ref="' + colName(m.c1) + (m.r1 + 1) + ':' + colName(m.c2) + (m.r2 + 1) + '"/>'; });
    x += '</mergeCells>';
  }
  x += '<pageMargins left="0.39" right="0.39" top="0.59" bottom="0.59" header="0.31" footer="0.31"/>';
  x += '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>';
  /* <drawing> 在 schema 里的位置：pageSetup / headerFooter 之后。
     放在 mergeCells 或 pageMargins 之前会让 Excel 报"文件损坏"。 */
  if (model.images && model.images.length) x += '<drawing r:id="rId1"/>';
  x += '</worksheet>';
  return x;
}

/* ---- 图片：OOXML drawing ---- */
/* 1 像素 = 9525 EMU（96 DPI）。EMU 是 EMU 整数，必须取整。 */
var EMU_PER_PX = 9525;

function emu(px) { return Math.round(px * EMU_PER_PX); }

/* 列宽(字符) → 像素，Excel 的近似换算（Calibri 11）。预览器和图片定位都用它。 */
function colPx(ch) { return Math.round(ch * 7) + 5; }

/* 像素 x → (列号, 列内偏移)。图片锚点必须按像素反查，
   直接写 col=3 会因为列宽不均而让图片溢出表格右边界。 */
function pxToCell(px, widths) {
  var x = 0;
  for (var i = 0; i < widths.length; i++) {
    var w = colPx(widths[i]);
    if (px < x + w - 0.5) return { col: i, dx: Math.max(0, px - x) };
    x += w;
  }
  return { col: widths.length - 1, dx: 0 };
}

/* 整表宽度（像素） */
function tablePx(widths) {
  var t = 0;
  for (var i = 0; i < widths.length; i++) t += colPx(widths[i]);
  return t;
}

function drawingXml(images) {
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  images.forEach(function (im, i) {
    var cx = emu(im.w), cy = emu(im.h);
    x += '<xdr:oneCellAnchor>'
      + '<xdr:from><xdr:col>' + im.col + '</xdr:col><xdr:colOff>' + emu(im.dx || 0) + '</xdr:colOff>'
      + '<xdr:row>' + im.row + '</xdr:row><xdr:rowOff>' + emu(im.dy || 0) + '</xdr:rowOff></xdr:from>'
      + '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>'
      + '<xdr:pic>'
      + '<xdr:nvPicPr>'
      + '<xdr:cNvPr id="' + (i + 1) + '" name="Picture ' + (i + 1) + '" descr="' + xesc(im.caption || "") + '"/>'
      + '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>'
      + '</xdr:nvPicPr>'
      + '<xdr:blipFill><a:blip r:embed="rId' + (i + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
      + '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
      + '</xdr:pic>'
      + '<xdr:clientData/>'
      + '</xdr:oneCellAnchor>';
  });
  return x + '</xdr:wsDr>';
}

function drawingRelsXml(images) {
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  images.forEach(function (im, i) {
    x += '<Relationship Id="rId' + (i + 1) + '"'
      + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
      + ' Target="../media/image' + (i + 1) + '.' + im.ext + '"/>';
  });
  return x + '</Relationships>';
}

var SHEET_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
  + '</Relationships>';

function buildXlsx(model) {
  var name = (model.sheetName || "报价单").replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31) || "报价单";
  var imgs = model.images || [];
  var extSet = {};
  imgs.forEach(function (im) { extSet[im.ext] = true; });
  var imgDefaults = Object.keys(extSet).map(function (e) {
    var mime = e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "gif" ? "image/gif" : e === "webp" ? "image/webp" : "image/png";
    return '<Default Extension="' + e + '" ContentType="' + mime + '"/>';
  }).join("");
  var drawingOverride = imgs.length
    ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    : "";

  var files = [
    {
      name: "[Content_Types].xml",
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + imgDefaults
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + drawingOverride
        + '</Types>')
    },
    {
      name: "_rels/.rels",
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>')
    },
    {
      name: "xl/workbook.xml",
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="' + xesc(name) + '" sheetId="1" r:id="rId1"/></sheets>'
        + '</workbook>')
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>')
    },
    { name: "xl/styles.xml", data: utf8(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheetXml(model)) }
  ];

  if (imgs.length) {
    files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: utf8(SHEET_RELS) });
    files.push({ name: "xl/drawings/drawing1.xml", data: utf8(drawingXml(imgs)) });
    files.push({ name: "xl/drawings/_rels/drawing1.xml.rels", data: utf8(drawingRelsXml(imgs)) });
    imgs.forEach(function (im, i) {
      files.push({ name: "xl/media/image" + (i + 1) + "." + im.ext, data: im.data });
    });
  }
  return zipStore(files);
}
