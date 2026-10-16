/* ============ 应用层 ============ */

var LSK = {
  doc: "qb_doc_v1", hist: "qb_hist_v1", mat: "qb_mat_v1", comp: "qb_comp_v1",
  layout: "qb_layout_v1", grp: "qb_grp_v1", grpList: "qb_grplist_v1", matOv: "qb_matov_v1",
  tpl: "qb_tpl_v1"
};

var state = {
  doc: null,
  layout: "standard",
  materials: [],
  company: {},
  history: [],
  openGroups: {},
  groups: null,      /* 用户可维护的分类列表（有序） */
  matOv: {},         /* 内置物料的改动覆盖：{ 物料名: { g, d, units } } */
  matOpen: {},       /* 管理弹窗里哪些物料的单位编辑是展开的 */
  tpls: [],          /* 用户自建模板（存 LSK.tpl） */
  tplEdit: false,    /* 模板库是否处于「编辑（改名 / 删除）」状态 */
  caution: ""
};

/* ---------- 工具 ---------- */
function p2(n) { return n < 10 ? "0" + n : "" + n; }
function todayStr() { var d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  var n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return (isNaN(n) || String(v).trim() === "") ? null : n;
}
function fmt(n) { return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function floor100(n) { return Math.floor(n / 100) * 100; }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function toast(msg) {
  var t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.remove("on"); }, 1900);
}
function $(id) { return document.getElementById(id); }

/* ---------- 单据工厂 ---------- */
function blankRow() { return { item: "", desc: "", loc: "", qty: "", unit: "", price: "", amt: "", optional: false, type: "item" }; }

function newDoc() {
  return {
    no: "", date: todayStr(), customer: "", project: "", contact: "", phone: "", address: "",
    title: "报价单", demand: "", notice: "报价含普票，不含显示器。红色部分为选配。",
    notes: [], rows: [blankRow()], netNoOpt: "", netOpt: "", netNoOptAuto: true, netOptAuto: true,
    autoMerge: true, caution: "", tplId: "",
    colMode: "split", head: null, widths: null,
    images: [], imgCols: 2, imgPos: "after", imgCaption: true
  };
}

function cloneRow(r) { return JSON.parse(JSON.stringify(r)); }

/* ---------- 单号 ---------- */
function nextNo() {
  var d = todayStr().replace(/-/g, "");
  var n = 1;
  state.history.forEach(function (h) { if (h.doc && h.doc.no && h.doc.no.indexOf(d) === 0) n++; });
  return d + "-" + p2(n);
}

/* ---------- 物料库 ---------- */
/* 物料模型：{ n 名称, d 默认说明, g 分类, units: [{u 单位, p 单价}, ...] }
   内置物料（02_data.js 的 MATERIALS）本身只读，用户的改动记在 state.matOv 里；
   自定义物料直接存在 state.materials。
   老格式只有单个 u / p，matUnits() 会自动补成单元素数组，保证向后兼容。 */

var UNCAT = "未分类";

function matUnits(m) {
  var ov = state.matOv[m.n];
  if (ov && ov.units && ov.units.length) return ov.units;
  if (m.units && m.units.length) return m.units;
  return [{ u: m.u || "个", p: (m.p === "" || m.p === undefined) ? "" : m.p }];
}
function matUnit1(m) { var a = matUnits(m); return a[0] || { u: "个", p: "" }; }
function matDesc(m) {
  var ov = state.matOv[m.n];
  return (ov && ov.d !== undefined) ? ov.d : (m.d || "");
}
/* 物料归哪个分类：用户的覆盖记录 → 物料自带 → 分类被删了就落「未分类」 */
function matGroup(m) {
  var ov = state.matOv[m.n];
  var g = (ov && ov.g) || m.g;
  return state.groups.indexOf(g) >= 0 ? g : UNCAT;
}
function allMaterials() {
  var out = [];
  state.materials.forEach(function (m) {
    var c = JSON.parse(JSON.stringify(m)); c.custom = true; out.push(c);
  });
  MATERIALS.forEach(function (m) { out.push(JSON.parse(JSON.stringify(m))); });
  return out;
}
function findMaterial(name) {
  var v = String(name || "").trim();
  if (!v) return null;
  var list = allMaterials();
  for (var i = 0; i < list.length; i++) if (list[i].n === v) return list[i];
  for (var j = 0; j < list.length; j++) if (list[j].n.indexOf(v) >= 0) return list[j];
  return null;
}
function hasOverride(n) {
  var ov = state.matOv[n];
  return !!(ov && (ov.g !== undefined || ov.d !== undefined || ov.units));
}
function setOverride(n, patch) {
  var ov = state.matOv[n] || (state.matOv[n] = {});
  Object.keys(patch).forEach(function (k) { ov[k] = patch[k]; });
  saveMatStore();
}
function clearOverride(n) { delete state.matOv[n]; saveMatStore(); }
function saveMatStore() {
  lsSet(LSK.mat, state.materials);
  lsSet(LSK.matOv, state.matOv);
  lsSet(LSK.grpList, state.groups);
}

function renderMatList(filter) {
  var box = $("matList"); box.innerHTML = "";
  var f = String(filter || "").trim().toLowerCase();
  var buckets = {};
  allMaterials().forEach(function (m) {
    var g = matGroup(m);
    if (f && (m.n + " " + matDesc(m) + " " + g).toLowerCase().indexOf(f) < 0) return;
    (buckets[g] = buckets[g] || []).push(m);
  });
  /* 按用户排的分类顺序显示；空分类也显示（否则"我加的分类怎么不见了"）；
     搜索时只显示有命中的分类 */
  var order = state.groups.slice();
  if (buckets[UNCAT]) order.push(UNCAT);
  var keys = order.filter(function (g) { return f ? (buckets[g] && buckets[g].length) : true; });
  if (!keys.length) { box.innerHTML = '<p class="hint" style="padding:6px 8px">没有匹配的物料</p>'; return; }

  keys.forEach(function (g) {
    var open = !!f || !!state.openGroups[g];
    var head = document.createElement("button");
    head.type = "button";
    head.className = "mat-head" + (open ? " open" : "");
    head.innerHTML = '<span class="arw">' + (open ? "▾" : "▸") + "</span>" + g +
      '<span class="cnt">' + ((buckets[g] || []).length) + "</span>";
    head.onclick = function () {
      state.openGroups[g] = !state.openGroups[g];
      lsSet(LSK.grp, state.openGroups);
      renderMatList($("matSearch").value);
    };
    box.appendChild(head);
    if (!open) return;
    var items = buckets[g] || [];
    if (!items.length) {
      var em = document.createElement("p");
      em.className = "hint";
      em.style.cssText = "padding:3px 8px 3px 22px;margin:0";
      em.textContent = "（空分类，可在「管理物料」里加物料）";
      box.appendChild(em);
      return;
    }
    items.forEach(function (m) {
      var us = matUnits(m), d1 = us[0] || {};
      var b = document.createElement("button");
      b.className = "mat-item"; b.type = "button";
      b.style.paddingLeft = "22px";
      /* 名称在前、价格在后 —— flex 布局下 margin-left:auto 才能把价格推到最右 */
      b.innerHTML = "<span>" + m.n + "</span>" +
        (m.custom ? '<span style="color:var(--acc);font-size:10px">自定义</span>' : "") +
        '<span class="mp">' + (d1.p === "" || d1.p === undefined ? "—" : fmt(d1.p)) +
        (us.length > 1 ? "起" : "") + "</span>";
      b.title = matDesc(m) + "\n" + us.map(function (x) { return x.u + "  " + x.p; }).join("\n");
      b.onclick = function () { addRowFromMaterial(m); };
      box.appendChild(b);
    });
  });
}

/* 物料名 / 单位 / 使用位置 三个下拉候选 */
function renderDatalists() {
  var dl = $("dlMat"); if (dl) {
    dl.innerHTML = "";
    allMaterials().forEach(function (m) { var o = document.createElement("option"); o.value = m.n; dl.appendChild(o); });
  }
  var du = $("dlUnit"); if (du) {
    du.innerHTML = "";
    UNITS.forEach(function (u) { var o = document.createElement("option"); o.value = u; du.appendChild(o); });
  }
  var dlc = $("dlLoc"); if (dlc) {
    dlc.innerHTML = "";
    LOCATIONS.forEach(function (l) { var o = document.createElement("option"); o.value = l; dlc.appendChild(o); });
  }
}

/* ---------- 分类（大类）维护 ---------- */
function countInGroup(g) {
  return allMaterials().filter(function (m) { return matGroup(m) === g; }).length;
}
function saveGroups() { saveMatStore(); }

function renderGrpEditList(focusIdx) {
  var box = $("grpEditList"); if (!box) return;
  box.innerHTML = "";
  state.groups.forEach(function (g, i) {
    var row = document.createElement("div"); row.className = "matrow";
    var inp = document.createElement("input");
    inp.value = g; inp.style.flex = "2.2"; inp.style.fontWeight = "600";
    inp.onchange = function () { renameGroup(g, inp.value); };
    inp.onkeydown = function (ev) { if (ev.key === "Enter") inp.blur(); };
    row.appendChild(inp);
    var cnt = document.createElement("span");
    cnt.className = "hint"; cnt.style.cssText = "margin:0;flex:0 0 54px;text-align:right";
    cnt.textContent = countInGroup(g) + " 条";
    row.appendChild(cnt);
    row.appendChild(mkBtn("↑", function () { moveGroup(i, -1); }));
    row.appendChild(mkBtn("↓", function () { moveGroup(i, 1); }));
    var del = mkBtn("删", function () { deleteGroup(g); });
    del.className = "tiny danger";
    row.appendChild(del);
    box.appendChild(row);
  });
  if (typeof focusIdx === "number" && box.children[focusIdx]) {
    var t = box.children[focusIdx].querySelector("input");
    if (t) { t.focus(); t.select(); }
  }
}
function addGroup() {
  var base = "新分类", name = base, k = 1;
  while (state.groups.indexOf(name) >= 0) { k++; name = base + k; }
  state.groups.push(name);
  saveMatStore();
  renderGrpEditList(state.groups.length - 1);
  renderMatList($("matSearch").value);
  toast("已新增分类「" + name + "」，直接改名即可");
}
function renameGroup(oldName, raw) {
  var name = String(raw || "").trim();
  if (!name || name === oldName) { renderGrpEditList(); return; }
  if (state.groups.indexOf(name) >= 0) { toast("已经有「" + name + "」这个分类了"); renderGrpEditList(); return; }
  var i = state.groups.indexOf(oldName);
  if (i < 0) return;
  /* 先把该分类下的物料挑出来，再改分类名 ——
     顺序反了的话 matGroup() 会因为旧名已不在 groups 里而返回「未分类」，物料就跟不过去 */
  var moving = allMaterials().filter(function (m) { return matGroup(m) === oldName; });
  state.groups[i] = name;
  moving.forEach(function (m) { setOverride(m.n, { g: name }); });
  saveMatStore();
  renderGrpEditList(); renderMatEditList(); renderMatList($("matSearch").value);
  toast("分类已改名：" + oldName + " → " + name);
}
function moveGroup(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= state.groups.length) return;
  var t = state.groups[i]; state.groups[i] = state.groups[j]; state.groups[j] = t;
  saveMatStore(); renderGrpEditList(); renderMatList($("matSearch").value);
}
function deleteGroup(g) {
  var n = countInGroup(g);
  if (state.groups.length <= 1) { toast("至少要留一个分类"); return; }
  var msg = n
    ? "分类「" + g + "」下还有 " + n + " 条物料。\n删除后这些物料会归到「通用」。\n\n确定删除？"
    : "确定删除分类「" + g + "」？";
  if (!confirm(msg)) return;
  if (state.groups.indexOf("通用") < 0) state.groups.push("通用");
  var moving = allMaterials().filter(function (m) { return matGroup(m) === g; });
  state.groups = state.groups.filter(function (x) { return x !== g; });
  moving.forEach(function (m) { setOverride(m.n, { g: "通用" }); });
  saveMatStore();
  renderGrpEditList(); renderMatEditList(); renderMatList($("matSearch").value); renderDatalists();
  toast("已删除分类「" + g + "」，物料已归到「通用」");
}

/* ---------- 物料维护（含多单位多价格）---------- */
function openMatManager() {
  openModal(
    '<button class="mclose" onclick="closeModal()">×</button><h2>物料库管理</h2>' +
    '<p class="hint" style="margin:0 0 14px">分类和物料都能增删改。' +
    '修改会自动保存在当前浏览器，下次从同一位置打开可继续使用。' +
    '点「单位」展开可以给一个物料配多个单位、每个单位各自的单价（比如网线按「箱」也按「米」卖）。' +
    '内置物料也能改，改过的会显示「已改」，可以一键恢复默认。</p>' +
    '<p class="sec-title">分类（大类）</p>' +
    '<div id="grpEditList"></div>' +
    '<div style="margin:8px 0 18px;display:flex;gap:8px;align-items:center">' +
    '<button class="tiny" onclick="addGroup()">＋ 新增分类</button>' +
    '<span class="hint" style="margin:0">↑↓ 调顺序；改名会自动带上该类下的所有物料</span></div>' +
    '<p class="sec-title">物料</p>' +
    '<input id="matEditSearch" placeholder="筛选物料…" style="margin-bottom:8px">' +
    '<div id="matEditList"></div>' +
    '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="primary" onclick="addMaterial()">＋ 新增物料</button>' +
    '<button onclick="importFromDoc()">把当前单据的明细收进物料库</button>' +
    '<button onclick="closeModal()">关闭</button></div>'
  );
  renderGrpEditList();
  renderMatEditList();
  var ms = $("matEditSearch");
  ms.oninput = function () { renderMatEditList(ms.value); };
}
function renderMatEditList(filter) {
  var box = $("matEditList"); if (!box) return;
  var f = String(filter || "").trim().toLowerCase();
  box.innerHTML = "";
  /* 管理表单必须编辑真实自定义物料；allMaterials() 返回用于展示的副本。 */
  var list = state.materials.concat(MATERIALS.map(cloneRow)).filter(function (m) {
    return !f || (m.n + " " + matDesc(m)).toLowerCase().indexOf(f) >= 0;
  });
  /* 自定义的排前面 */
  list.sort(function (a, b) { return (state.materials.indexOf(b) >= 0 ? 1 : 0) - (state.materials.indexOf(a) >= 0 ? 1 : 0); });
  if (!list.length) { box.innerHTML = '<p class="hint">没有匹配的物料。</p>'; return; }

  list.forEach(function (m) {
    var isCustom = state.materials.indexOf(m) >= 0;
    var us = matUnits(m);
    var wrap = document.createElement("div"); wrap.className = "matitem";

    var row = document.createElement("div"); row.className = "matrow";
    if (isCustom) {
      var ni = document.createElement("input");
      ni.value = m.n; ni.style.flex = "2"; ni.placeholder = "物料名";
      ni.oninput = function () {
        m.n = ni.value; saveMatStore();
        renderMatList($("matSearch").value); renderDatalists();
      };
      row.appendChild(ni);
    } else {
      var nm = document.createElement("div");
      nm.className = "matname"; nm.style.flex = "2"; nm.textContent = m.n;
      nm.title = "内置物料：名称不可改，但说明 / 分类 / 单位单价都能改";
      row.appendChild(nm);
    }
    var di = document.createElement("input");
    di.value = matDesc(m); di.style.flex = "3"; di.placeholder = "默认说明";
    di.oninput = function () {
      if (isCustom) { m.d = di.value; saveMatStore(); }
      else setOverride(m.n, { d: di.value });
      renderMatList($("matSearch").value);
    };
    row.appendChild(di);

    var sel = document.createElement("select");
    sel.style.flex = "1.1";
    state.groups.forEach(function (g) {
      var o = document.createElement("option");
      o.value = g; o.textContent = g; o.selected = (matGroup(m) === g);
      sel.appendChild(o);
    });
    sel.onchange = function () {
      if (isCustom) { m.g = sel.value; saveMatStore(); }
      else setOverride(m.n, { g: sel.value });
      renderGrpEditList(); renderMatList($("matSearch").value);
    };
    row.appendChild(sel);

    var tog = mkBtn(us.length + " 个单位", function () {
      state.matOpen[m.n] = !state.matOpen[m.n];
      renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
    });
    tog.className = "tiny";
    tog.style.flex = "0 0 auto";
    tog.title = us.map(function (x) { return x.u + " " + x.p; }).join(" / ");
    row.appendChild(tog);

    if (!isCustom && hasOverride(m.n)) {
      var rv = mkBtn("恢复", function () {
        clearOverride(m.n);
        renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
        renderGrpEditList(); renderMatList($("matSearch").value);
        toast("已恢复默认：" + m.n);
      });
      rv.className = "tiny"; rv.title = "撤销对这条内置物料的所有改动";
      row.appendChild(rv);
    }
    if (isCustom) {
      var del = mkBtn("删", function () {
        state.materials = state.materials.filter(function (x) { return x !== m; });
        saveMatStore(); renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
        renderGrpEditList(); renderMatList($("matSearch").value); renderDatalists();
      });
      del.className = "tiny danger";
      row.appendChild(del);
    }
    wrap.appendChild(row);

    /* 展开的单位/单价编辑 */
    if (state.matOpen[m.n]) {
      var ub = document.createElement("div"); ub.className = "matunits";
      us.forEach(function (x, ui) {
        var ur = document.createElement("div"); ur.className = "matrow";
        var uu = document.createElement("input");
        uu.value = x.u; uu.style.flex = "1"; uu.placeholder = "单位（箱/米/个…）";
        uu.oninput = function () {
          x.u = uu.value;
          us[0] = us[0] || x;
          if (isCustom) { m.units = us; m.u = us[0].u; m.p = us[0].p; saveMatStore(); }
          else setOverride(m.n, { units: us });
          renderMatList($("matSearch").value); renderDatalists();
        };
        ur.appendChild(uu);
        var up = document.createElement("input");
        up.value = x.p === undefined || x.p === null ? "" : x.p;
        up.style.flex = "1"; up.placeholder = "单价";
        up.oninput = function () {
          x.p = up.value.trim() === "" ? "" : (Number(up.value) || 0);
          if (isCustom) { m.units = us; m.u = us[0].u; m.p = us[0].p; saveMatStore(); }
          else setOverride(m.n, { units: us });
          renderMatList($("matSearch").value);
        };
        ur.appendChild(up);
        if (ui === 0) {
          var tag = document.createElement("span");
          tag.className = "hint"; tag.style.cssText = "margin:0;flex:0 0 44px";
          tag.textContent = "默认";
          ur.appendChild(tag);
        } else {
          ur.appendChild(mkBtn("×", function () {
            us.splice(ui, 1);
            if (isCustom) { m.units = us; m.u = us[0].u; m.p = us[0].p; saveMatStore(); }
            else setOverride(m.n, { units: us });
            renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
            renderMatList($("matSearch").value);
          }));
        }
        ub.appendChild(ur);
      });
      ub.appendChild(mkBtn("＋ 加一个单位", function () {
        us.push({ u: "", p: "" });
        if (isCustom) { m.units = us; saveMatStore(); } else setOverride(m.n, { units: us });
        renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
      }));
      wrap.appendChild(ub);
    }
    box.appendChild(wrap);
  });
}
function addMaterial() {
  state.materials.push({
    n: "", d: "", g: state.groups[0] || "通用",
    units: [{ u: "个", p: "" }], u: "个", p: ""
  });
  saveMatStore(); renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
  renderGrpEditList(); renderMatList(""); renderDatalists();
}
/* 把当前单据里出现过的明细收进物料库（同名跳过） */
function importFromDoc() {
  var mine = {};
  state.materials.forEach(function (m) { mine[m.n] = true; });
  if (state.groups.indexOf("通用") < 0) { state.groups.push("通用"); }
  var n = 0;
  (state.doc.rows || []).forEach(function (r) {
    if ((r.type || "item") !== "item") return;
    var name = String(r.item || "").trim();
    if (!name || mine[name]) return;
    mine[name] = true; n++;
    var u = String(r.unit || "").trim() || "个";
    var p = num(r.price) === null ? "" : num(r.price);
    state.materials.push({ n: name, d: String(r.desc || "").trim(), g: "通用", units: [{ u: u, p: p }], u: u, p: p });
  });
  saveMatStore();
  renderMatEditList($("matEditSearch") ? $("matEditSearch").value : "");
  renderGrpEditList(); renderMatList($("matSearch").value); renderDatalists();
  toast(n ? "已收进 " + n + " 条物料" : "没有新物料可收");
}

/* ---------- 模板库 ---------- */
/* ---------- 模板库 ---------- */
/* 内置模板（02_data.js 的 TEMPLATES）只读；
   用户自建模板存在 state.tpls，可改名、可删除。两者合并渲染。 */
function allTemplates() { return TEMPLATES.concat(state.tpls || []); }
function findTemplate(id) {
  return allTemplates().filter(function (t) { return t.id === id; })[0] || null;
}
function saveTplStore() { lsSet(LSK.tpl, state.tpls || []); }

/* 用户自建模板：只有名字和标题，明细全空（要明细就先载入再「保存模板」） */
function blankUserTemplate(name, title) {
  return {
    id: "u-" + uid(), name: name, title: title || name, group: "我的模板",
    head: ["项目", "说明", "单位", "数量", "单价", "总价"], widths: [22, 44, 8, 8, 9, 10],
    custom: true, empty: true, demand: "", notice: "", notes: [],
    colMode: "split", rows: [R("", "", "", "", "", "")]
  };
}
/* 当前单据 → 模板（「保存模板」用）。key 记录来源，便于判断能否「更新」 */
function docToTemplate(name) {
  var d = state.doc;
  return {
    id: "u-" + uid(), name: name || "未命名模板", title: d.title || name || "报价单",
    group: "我的模板", custom: true,
    demand: d.demand || "", notice: d.notice || "", notes: (d.notes || []).slice(),
    rows: (d.rows || []).map(cloneRow), colMode: d.colMode || "split",
    head: d.head ? d.head.slice() : null, widths: d.widths ? d.widths.slice() : null,
    imageCount: (d.images || []).length,
    baseKey: tplSignature(d)
  };
}
/* 模板里到底有什么内容 —— 用来判断「这份单子是不是已经存成模板了」 */
function tplSignature(d) {
  var rows = (d.rows || []).filter(function (r) { return r.item || r.desc || r.qty || r.price || r.amt; });
  return JSON.stringify({
    t: d.title || "", n: rows.length,
    items: rows.slice(0, 8).map(function (r) { return [r.item || "", r.desc || "", r.price || ""]; })
  });
}

function renderTplList() {
  var box = $("tplList"); if (!box) return;
  box.innerHTML = "";

  function addCategory(text) {
    var label = document.createElement("p"); label.className = "tpl-category"; label.textContent = text;
    box.appendChild(label);
  }
  function addItem(t, isUser) {
    var on = state.doc && state.doc.tplId === t.id;
    var wrap = document.createElement("div"); wrap.className = "tpl-rowwrap";
    var b = document.createElement("button");
    b.className = "tpl-item" + (on ? " on" : "");
    b.type = "button"; b.dataset.templateId = t.id;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    var nm = document.createElement("span"); nm.className = "tpl-name"; nm.textContent = t.name;
    b.appendChild(nm);
    if (isUser && !state.tplEdit) {
      var cnt = (t.rows || []).filter(function (r) { return r.item || r.desc; }).length;
      var tag = document.createElement("span"); tag.className = "tpl-tag";
      tag.textContent = cnt ? cnt + " 项" : "空";
      b.appendChild(tag);
    }
    b.onclick = function () { if (!state.tplEdit) applyTemplate(t); };
    wrap.appendChild(b);

    if (state.tplEdit && isUser) {
      var ed = document.createElement("button");
      ed.className = "tpl-mini"; ed.type = "button"; ed.textContent = "改名";
      ed.title = "重命名这个模板";
      ed.onclick = function () {
        var v = prompt("模板名称", t.name);
        if (v === null) return;
        v = String(v).trim();
        if (!v) { toast("名字不能为空"); return; }
        if (allTemplates().some(function (x) { return x !== t && x.name === v; })) { toast("已经有叫「" + v + "」的模板了"); return; }
        t.name = v;
        saveTplStore(); renderTplList();
        if (state.doc && state.doc.tplId === t.id) renderAll();
        toast("已改名为「" + v + "」");
      };
      var del = document.createElement("button");
      del.className = "tpl-mini danger"; del.type = "button"; del.textContent = "删除";
      del.title = "删除这个模板（不影响已填好的报价单）";
      del.onclick = function () {
        if (!confirm("删除模板「" + t.name + "」？\n\n已经做好的报价单不受影响。")) return;
        state.tpls = state.tpls.filter(function (x) { return x.id !== t.id; });
        saveTplStore(); renderTplList();
        toast("已删除模板「" + t.name + "」");
      };
      wrap.appendChild(ed); wrap.appendChild(del);
    }
    box.appendChild(wrap);
  }

  addCategory("常用模板");
  TEMPLATES.forEach(function (t) { addItem(t, false); });

  if ((state.tpls || []).length) {
    addCategory("我的模板");
    state.tpls.forEach(function (t) { addItem(t, true); });
  }

  /* 底部：新建空模板 / 保存当前为模板 / 管理 */
  var bar = document.createElement("div"); bar.className = "tpl-actions";

  var bNew = document.createElement("button");
  bNew.className = "tiny"; bNew.id = "btnTplNew"; bNew.type = "button";
  bNew.textContent = "＋ 新建空模板";
  bNew.onclick = function () {
    var name = prompt("新模板名称", "新模板");
    if (name === null) return;
    name = String(name).trim();
    if (!name) { toast("名字不能为空"); return; }
    if (allTemplates().some(function (x) { return x.name === name; })) { toast("已经有叫「" + name + "」的模板了"); return; }
    var t = blankUserTemplate(name, name + "报价单");
    state.tpls.push(t); saveTplStore();
    applyTemplate(t);
    toast("已新建空模板「" + name + "」，点「改名」可以再改");
  };
  bar.appendChild(bNew);

  var bSave = document.createElement("button");
  bSave.className = "tiny primary"; bSave.id = "btnTplSave"; bSave.type = "button";
  bSave.textContent = "保存为模板";
  bSave.onclick = saveCurrentAsTemplate;
  bar.appendChild(bSave);

  var bMan = document.createElement("button");
  bMan.className = "tiny"; bMan.id = "btnTplEditMode"; bMan.type = "button";
  bMan.textContent = state.tplEdit ? "完成" : "管理";
  bMan.disabled = !state.tplEdit && !(state.tpls || []).length;
  bMan.onclick = function () { state.tplEdit = !state.tplEdit; renderTplList(); };
  bar.appendChild(bMan);

  box.appendChild(bar);
}

/* 把当前单据存成模板：已有同源模板时问「更新还是新建」 */
function saveCurrentAsTemplate() {
  var d = state.doc;
  var items = (d.rows || []).filter(function (r) { return r.item || r.desc || r.qty || r.price || r.amt; });
  if (!items.length) { toast("这份单子还是空的，先填点内容再存模板"); return; }

  var sig = tplSignature(d);
  var same = (state.tpls || []).filter(function (t) { return t.baseKey && t.baseKey === sig; })[0];
  var src = findTemplate(d.tplId);
  var target = same || (src && src.custom ? src : null);

  if (target) {
    var upd = confirm("「" + target.name + "」已经存过了。\n\n把当前内容覆盖进去？（选「取消」则另存为新模板）");
    if (upd) {
      var fresh = docToTemplate(target.name);
      fresh.id = target.id;
      state.tpls = state.tpls.map(function (t) { return t.id === target.id ? fresh : t; });
      saveTplStore(); renderTplList();
      toast("已更新模板「" + target.name + "」（" + items.length + " 项明细）");
      return;
    }
  }

  var name = prompt("模板名称", target ? target.name + " 副本" : (d.title || "我的模板"));
  if (name === null) return;
  name = String(name).trim();
  if (!name) { toast("名字不能为空"); return; }
  if (allTemplates().some(function (x) { return x.name === name; })) { toast("已经有叫「" + name + "」的模板了"); return; }

  var t = docToTemplate(name);
  state.tpls.push(t); saveTplStore(); renderTplList();
  toast("已存为模板「" + name + "」（" + items.length + " 项明细）" + ((d.images || []).length ? "；" + (d.images || []).length + " 张附图未存" : ""));
}

function applyTemplate(t) {
  if (state.doc && hasContent(state.doc) && !confirm("载入模板会替换当前内容，继续？")) return;
  var d = newDoc();
  d.tplId = t.id; d.title = t.title; d.demand = t.demand || ""; d.notice = t.notice || "";
  d.notes = (t.notes || []).slice();
  d.rows = (t.rows || []).map(cloneRow);
  d.colMode = t.colMode || "split";
  d.head = t.head ? t.head.slice() : null;
  d.widths = (t.widths && t.widths.length) ? t.widths.slice() : null;
  d.project = d.project || "";
  d.no = nextNo();
  if (t.presetNet) { d.netNoOpt = t.presetNet.noOpt; d.netOpt = t.presetNet.opt; d.netNoOptAuto = false; d.netOptAuto = false; }
  state.doc = d;
  /* 空模板 = 还没开工，工作台保持「选个模板开始」的状态，别直接跳到编辑区 */
  uiStarted = !t.empty;
  state.caution = t.caution || "";
  renderAll(); autosave();
  toast("已载入：" + t.name);
}
function hasContent(d) {
  return !!(d.customer || d.project || (d.rows || []).some(function (r) { return r.item || r.desc; }));
}

/* ---------- 版式 ---------- */
function renderLayoutList() {
  var box = $("layoutList"); box.innerHTML = "";
  LAYOUTS.forEach(function (l) {
    var lb = document.createElement("label");
    var rb = document.createElement("input");
    rb.type = "radio"; rb.name = "layout"; rb.value = l.id; rb.checked = state.layout === l.id;
    rb.onchange = function () { state.layout = l.id; lsSet(LSK.layout, l.id); renderAll(); };
    lb.appendChild(rb);
    var sp = document.createElement("span"); sp.textContent = l.name; sp.title = l.hint;
    lb.appendChild(sp);
    box.appendChild(lb);
  });
}

/* ---------- 明细表 ---------- */
/* 编辑器表头跟着「列结构」走 —— 这样切列结构能立刻看出区别 */
function renderHead() {
  var cm = COLMODES[state.doc.colMode] || COLMODES.split;
  var hasLoc = cm.keys.indexOf("loc") >= 0;
  var isMerged = cm.keys.indexOf("qtyUnit") >= 0;

  var cols = [54, 112, "auto"];
  if (hasLoc) cols.push(82);
  /* 编辑器中的数量和单位始终是两格；合列只作用于导出。
     colgroup 也保留两列，否则后面的金额框会错位并被压窄。 */
  cols.push(76, 96);
  cols.push(88, 104, 50, 42, 48);

  var cg = $("rowsCols"); cg.innerHTML = "";
  cols.forEach(function (w) {
    var c = document.createElement("col");
    c.style.width = typeof w === "number" ? w + "px" : w;
    cg.appendChild(c);
  });

  var tr = document.createElement("tr");
  function th(t, align, span) {
    var e = document.createElement("th");
    e.textContent = t;
    if (align) e.style.textAlign = align;
    if (span) e.colSpan = span;
    tr.appendChild(e);
  }
  th("#"); th("项目"); th("说明");
  if (hasLoc) th("使用位置");
  if (isMerged) th("数量 / 单位", "", 2);
  else { th("数量", "right"); th("单位"); }
  th("单价", "right"); th("总价", "right");
  th("配图"); th("选配"); th("");
  var hd = $("rowsHead"); hd.innerHTML = ""; hd.appendChild(tr);
  return { hasLoc: hasLoc, isMerged: isMerged, ncol: cols.length };
}

function renderRows() {
  clearRowDrag();
  hideRowMenu();
  var tb = $("rowsBody"); tb.innerHTML = "";
  var rows = state.doc.rows;
  var lay = renderHead();
  var ncol = lay.ncol;
  rows.forEach(function (r, i) {
    var tr = document.createElement("tr");
    tr.dataset.i = i;

    if (r.type === "group") {
      tr.className = "grp";
      tr.appendChild(rowIndexCell(i, "\u00a7"));
      var tdg = document.createElement("td"); tdg.colSpan = ncol - 2;
      var ig = document.createElement("input");
      ig.className = "c-item"; ig.value = r.item || "";
      ig.placeholder = "分组标题，如：一期明细 / 附表1 门禁";
      tdg.appendChild(ig); tr.appendChild(tdg);
      tr.appendChild(actCell(i)); tb.appendChild(tr); return;
    }
    if (r.type === "subtotal") {
      tr.className = "sub";
      tr.appendChild(rowIndexCell(i, "\u03a3"));
      var td1 = document.createElement("td"); td1.colSpan = ncol - 6; td1.style.textAlign = "right";
      var il = document.createElement("input");
      il.className = "c-desc"; il.value = r.desc || "小计"; il.placeholder = "小计";
      td1.appendChild(il); tr.appendChild(td1);
      var td2 = document.createElement("td"); td2.className = "out calc"; td2.colSpan = 4;
      td2.dataset.role = "subtotal"; td2.style.textAlign = "right";
      tr.appendChild(td2);
      tr.appendChild(actCell(i)); tb.appendChild(tr); return;
    }

    if (r.optional) tr.className = "opt";
    tr.appendChild(rowIndexCell(i, String(i + 1)));
    tr.appendChild(tdInput("c-item", r.item, "dlMat", "选物料…"));
    tr.appendChild(tdInput("c-desc", r.desc, "", "说明"));
    if (lay.hasLoc) tr.appendChild(tdInput("c-loc", r.loc, "dlLoc", ""));
    var tdq = tdInput("c-qty", r.qty, "", "填数量"); tdq.className = "num"; tr.appendChild(tdq);
    tr.appendChild(unitCell(r));
    var tdp = tdInput("c-price", r.price, "", ""); tdp.className = "num"; tr.appendChild(tdp);

    var tdt = document.createElement("td");
    tdt.className = "out"; tdt.dataset.role = "total";
    var inp = document.createElement("input");
    inp.className = "c-amt"; inp.value = r.amt === "" || r.amt === null || r.amt === undefined ? "" : r.amt;
    inp.setAttribute("aria-label", "总价，默认自动计算，可填写固定金额");
    inp.title = "自动计算；需要固定金额时可直接填写";
    inp.style.textAlign = "right";
    tdt.appendChild(inp); tr.appendChild(tdt);

    /* 配图列：这一行的产品选型图，导出时贴在该行「说明」格里 */
    var tdimg = document.createElement("td"); tdimg.className = "imgc";
    if (r.img) {
      var box = document.createElement("div"); box.className = "imgbox";
      var thumb = document.createElement("img");
      thumb.src = r.img; thumb.alt = ""; thumb.title = "点击换图";
      thumb.onclick = function () { pickRowImage(i); };
      box.appendChild(thumb);
      var rm = document.createElement("button");
      rm.type = "button"; rm.className = "rm"; rm.textContent = "\u00d7"; rm.title = "移除这张图";
      rm.onclick = function (ev) {
        ev.stopPropagation();
        delete r.img; delete r.imgW; delete r.imgH;
        renderRows(); recalc(); autosave();
      };
      box.appendChild(rm);
      tdimg.appendChild(box);
    } else {
      var addb = document.createElement("button");
      addb.type = "button"; addb.className = "addimg"; addb.textContent = "\uff0b";
      addb.title = "给这一行配图；也可以在行内按 Ctrl+V 粘贴截图";
      addb.onclick = function () { pickRowImage(i); };
      tdimg.appendChild(addb);
    }
    tr.appendChild(tdimg);

    var tdc = document.createElement("td"); tdc.className = "chk";
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "c-opt"; cb.checked = !!r.optional;
    cb.title = "标记为选配（导出时标红并单独计入「含选配合计」）";
    cb.setAttribute("aria-label", "将此行标记为选配");
    tdc.appendChild(cb); tr.appendChild(tdc);

    tr.appendChild(actCell(i));
    tb.appendChild(tr);
  });
  refreshRowTotals();
}

/* 只拖动手柄，编辑输入框仍可正常选字。整行对象移动，保留配图和选配。 */
var rowDrag = null;
function rowIndexCell(i, marker) {
  var cell = td("idx", ""), box = document.createElement("div"); box.className = "row-index";
  var handle = document.createElement("button");
  handle.type = "button"; handle.className = "row-drag"; handle.draggable = true; handle.textContent = "⠿";
  handle.title = "拖动调整行顺序；也可在行末更多菜单中上移或下移";
  handle.setAttribute("aria-label", "拖动第" + (i + 1) + "行调整顺序");
  var number = document.createElement("span"); number.textContent = marker;
  box.appendChild(handle); box.appendChild(number); cell.appendChild(box); return cell;
}
function clearRowDropMarks() {
  document.querySelectorAll("#rowsBody .drop-before,#rowsBody .drop-after").forEach(function (tr) { tr.classList.remove("drop-before", "drop-after"); });
}
function clearRowDrag() {
  clearRowDropMarks();
  document.querySelectorAll("#rowsBody .dragging").forEach(function (tr) { tr.classList.remove("dragging"); });
  rowDrag = null;
}
function bindRowDrag() {
  document.addEventListener("dragstart", function (e) {
    var handle = e.target.closest && e.target.closest("#rowsBody .row-drag"); if (!handle) return;
    var tr = handle.closest("tr"), index = +tr.dataset.i;
    rowDrag = { rows: state.doc.rows, row: state.doc.rows[index] };
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "报价明细行"); }
    tr.classList.add("dragging"); hideRowMenu();
  });
  document.addEventListener("dragover", function (e) {
    if (!rowDrag || rowDrag.rows !== state.doc.rows) return;
    var tr = e.target.closest && e.target.closest("#rowsBody tr");
    clearRowDropMarks(); if (!tr) return;
    e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    var rect = tr.getBoundingClientRect();
    tr.classList.add(e.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
    var wrap = tr.closest(".tbl-wrap"), bounds = wrap.getBoundingClientRect();
    if (e.clientY < bounds.top + 36) wrap.scrollTop -= 18;
    else if (e.clientY > bounds.bottom - 36) wrap.scrollTop += 18;
    if (e.clientY < 50) window.scrollBy(0, -18);
    else if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 18);
  });
  document.addEventListener("drop", function (e) {
    if (!rowDrag) return;
    var tr = e.target.closest && e.target.closest("#rowsBody tr"), drag = rowDrag;
    if (!tr || drag.rows !== state.doc.rows) { clearRowDrag(); return; }
    e.preventDefault();
    var from = drag.rows.indexOf(drag.row), rect = tr.getBoundingClientRect();
    var to = +tr.dataset.i + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0);
    clearRowDrag(); if (from < 0) return;
    if (to > from) to--;
    if (to === from) return;
    drag.rows.splice(from, 1); drag.rows.splice(to, 0, drag.row);
    renderRows(); recalc(); autosave();
    var handle = document.querySelector('#rowsBody tr[data-i="' + to + '"] .row-drag');
    if (handle) handle.focus({ preventScroll: true });
    toast("已调整行顺序，正在自动保存");
  });
  document.addEventListener("dragend", clearRowDrag);
}

function actCell(i) {
  var tda = document.createElement("td"); tda.className = "act";
  var more = btn("···", "更多行操作", function () { openRowMenu(i, more); });
  more.className = "row-more"; more.setAttribute("aria-label", "第" + (i + 1) + "行操作");
  more.setAttribute("aria-expanded", "false"); more.setAttribute("aria-controls", "rowActionMenu");
  tda.appendChild(more);
  return tda;
}
/* 单位格：物料配了多个单位时给下拉，选哪个自动带出那个单位的单价 */
function unitCell(r) {
  var td = document.createElement("td"); td.className = "unit-cell";
  var mat = (r.type === "item" || !r.type) ? findMaterial(r.item) : null;
  var us = mat ? matUnits(mat) : null;
  if (us && us.length > 1) {
    var sel = document.createElement("select");
    sel.className = "c-unit"; sel.setAttribute("aria-label", "单位");
    var hit = false;
    us.forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.u; o.textContent = x.u;
      if (String(r.unit) === String(x.u)) { o.selected = true; hit = true; }
      sel.appendChild(o);
    });
    if (!hit && String(r.unit || "") !== "") {
      var o2 = document.createElement("option");
      o2.value = r.unit; o2.textContent = r.unit; o2.selected = true;
      sel.appendChild(o2);
    }
    sel.title = "这个物料有多个单位，选哪个就按哪个的单价算";
    td.appendChild(sel);
  } else {
    var i = document.createElement("input");
    i.className = "c-unit"; i.value = r.unit || ""; i.setAttribute("aria-label", "单位");
    i.setAttribute("list", "dlUnit");
    td.appendChild(i);
  }
  return td;
}
function td(cls, text) { var e = document.createElement("td"); e.className = cls; e.textContent = text; return e; }
function tdInput(cls, val, listId, ph) {
  var e = document.createElement("td");
  var i = document.createElement("input");
  i.className = cls; i.value = val === undefined || val === null ? "" : val;
  i.setAttribute("aria-label", ({ "c-item": "项目或物料", "c-desc": "说明", "c-loc": "使用位置", "c-qty": "数量", "c-price": "单价" })[cls] || cls);
  if (listId) i.setAttribute("list", listId);
  i.placeholder = ph || "";
  e.appendChild(i); return e;
}
function btn(label, title, fn) {
  var b = document.createElement("button");
  b.type = "button"; b.className = "tiny"; b.textContent = label; b.title = title; b.onclick = fn;
  return b;
}

function addRowFromMaterial(m) {
  var d = matUnit1(m);
  state.doc.rows.push({
    item: m.n, desc: matDesc(m), loc: "", qty: "",
    unit: d.u, price: (d.p === 0 || d.p === "" || d.p === undefined) ? "" : d.p,
    amt: "", optional: false, type: "item"
  });
  uiStarted = true;
  renderRows(); recalc(); autosave();
  focusQuantity(state.doc.rows.length - 1);
}
function moveRow(i, dir) {
  var rs = state.doc.rows, j = i + dir;
  if (j < 0 || j >= rs.length) return;
  var t = rs[i]; rs[i] = rs[j]; rs[j] = t;
  renderRows(); recalc(); autosave();
}
function dupRow(i) { state.doc.rows.splice(i + 1, 0, cloneRow(state.doc.rows[i])); renderRows(); recalc(); autosave(); }
function delRow(i) { state.doc.rows.splice(i, 1); if (!state.doc.rows.length) state.doc.rows.push(blankRow()); renderRows(); recalc(); autosave(); }

/* ---------- 行金额 ---------- */
function rowTotal(r) {
  if (r.type && r.type !== "item") return { num: null, text: "" };
  if (r.amt !== "" && r.amt !== null && r.amt !== undefined) {
    var raw = String(r.amt).trim();
    var cleaned = raw.replace(/[^\d.\-]/g, "");
    /* 注意：Number("") 是 0 而不是 NaN。剥掉非数字字符后若为空串，
       必须当作「非数字文本」原样显示，否则「另配」「另计」会被静默算成 0。 */
    var n = Number(cleaned);
    if (cleaned !== "" && !isNaN(n)) return { num: n, text: fmt(n) };
    return { num: null, text: raw };
  }
  var q = num(r.qty), p = num(r.price);
  var hasUnit = String(r.unit === undefined || r.unit === null ? "" : r.unit).trim() !== "";
  if (p === null) {
    /* 单价留空但行内有数量或单位 → 按「赠送」处理（对齐原表「少许 / 赠送」那行） */
    if (q !== null || hasUnit) return { num: null, text: "赠送", gift: true };
    return { num: null, text: "" };
  }
  if (q === null) return { num: null, text: "" };
  return { num: q * p, text: fmt(q * p) };
}
function refreshRowTotals() {
  var tb = $("rowsBody"), acc = 0;
  state.doc.rows.forEach(function (r, i) {
    var tr = tb.children[i]; if (!tr) return;
    if (r.type === "group") { acc = 0; return; }
    if (r.type === "subtotal") {
      var sc = tr.querySelector('[data-role="subtotal"]');
      if (sc) sc.textContent = fmt(acc);
      acc = 0; return;
    }
    var info = rowTotal(r);
    if (info.num !== null && !r.optional) acc += info.num;
    var cell = tr.querySelector('[data-role="total"]'); if (!cell) return;
    var inp = cell.querySelector(".c-amt");
    if (inp && inp.value === "") { inp.placeholder = info.text || "自动"; }
    cell.classList.toggle("gift", !!info.gift);
    cell.classList.toggle("calc", !!info.num);
    tr.classList.toggle("opt", !!r.optional);
  });
}

/* ---------- 汇总 ---------- */
function calcSums() {
  var s = { raw: 0, noOpt: 0, opt: 0, missing: 0 };
  state.doc.rows.forEach(function (r) {
    if (r.type && r.type !== "item") return;
    var t = rowTotal(r);
    if (t.num === null) {
      if (num(r.qty) !== null && num(r.price) === null && (r.amt === "" || r.amt === null)) s.missing++;
      return;
    }
    s.raw += t.num;
    if (r.optional) s.opt += t.num; else s.noOpt += t.num;
  });
  s.optAll = s.noOpt + s.opt;
  return s;
}
function recalc() {
  var s = calcSums(), d = state.doc;
  if (d.netNoOptAuto) d.netNoOpt = s.noOpt ? String(s.noOpt) : "";
  if (d.netOptAuto) d.netOpt = s.optAll ? String(s.optAll) : "";
  $("tNoOptSum").value = fmt(s.noOpt);
  $("tOptSum").value = fmt(s.optAll);
  $("tNoOptNet").value = d.netNoOpt === "" ? "" : fmt(Number(d.netNoOpt));
  $("tOptNet").value = d.netOpt === "" ? "" : fmt(Number(d.netOpt));
  $("tRawSum").textContent = fmt(s.raw);

  /* 实收状态提示：手工改过就明确标出来，避免"改完忘了怎么回去" */
  var manual = !d.netNoOptAuto || !d.netOptAuto;
  var nm = $("netMode");
  if (nm) {
    nm.textContent = manual ? "⚠ 实收已手工指定（点「恢复自动跟随合计」可还原）" : "实收：自动跟随合计";
    nm.style.color = manual ? "var(--warn)" : "var(--txt3)";
  }
  $("tNoOptNet").style.fontWeight = d.netNoOptAuto ? "" : "600";
  $("tOptNet").style.fontWeight = d.netOptAuto ? "" : "600";

  var al = $("totAlert"), msgs = [], warn = false;
  if (state.caution) { msgs.push(state.caution); warn = true; }
  var nn = num(d.netNoOpt), on = num(d.netOpt);
  if (nn !== null && nn > s.noOpt) { msgs.push("不含选配「实收」(" + fmt(nn) + ") 高于「合计」(" + fmt(s.noOpt) + ")，请核对。"); warn = true; }
  if (on !== null && on > s.optAll) { msgs.push("含选配「实收」(" + fmt(on) + ") 高于「合计」(" + fmt(s.optAll) + ")，请核对。"); warn = true; }
  if (s.missing) { msgs.push("有 " + s.missing + " 行填了数量但没填单价，已按「赠送」处理；如果是漏填请补上单价。"); warn = true; }
  if (!msgs.length && nn !== null && s.noOpt && nn < s.noOpt * 0.85) {
    msgs.push("实收比合计低 " + Math.round((1 - nn / s.noOpt) * 100) + "%，确认是有意让价？"); warn = true;
  }
  if (!msgs.length) msgs.push("明细与合计一致，共 " + state.doc.rows.filter(function (r) { return rowTotal(r).num !== null; }).length + " 行有效明细。");
  al.innerHTML = msgs.map(function (m) { return "<div>" + m + "</div>"; }).join("");
  al.className = "alert" + (warn ? "" : " ok");
  refreshRowTotals();
  updateWorkspace();
}

/* ---------- 元信息双向绑定 ---------- */
var META = [["mNo", "no"], ["mDate", "date"], ["mCustomer", "customer"], ["mProject", "project"], ["mContact", "contact"], ["mPhone", "phone"], ["mAddress", "address"], ["docTitle", "title"], ["demand", "demand"], ["notice", "notice"]];

function renderMeta() {
  META.forEach(function (p) { var el = $(p[0]); if (el) el.value = state.doc[p[1]] === undefined || state.doc[p[1]] === null ? "" : state.doc[p[1]]; });
  $("notes").value = (state.doc.notes || []).join("\n");
}
function bindMeta() {
  META.forEach(function (p) {
    var el = $(p[0]); if (!el) return;
    el.addEventListener("input", function () { state.doc[p[1]] = el.value; autosave(); });
  });
  $("notes").addEventListener("input", function () {
    state.doc.notes = $("notes").value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    autosave();
  });
  $("tNoOptNet").addEventListener("input", function () {
    state.doc.netNoOpt = $("tNoOptNet").value.replace(/[^\d.\-]/g, ""); state.doc.netNoOptAuto = false; recalc(); autosave();
  });
  $("tOptNet").addEventListener("input", function () {
    state.doc.netOpt = $("tOptNet").value.replace(/[^\d.\-]/g, ""); state.doc.netOptAuto = false; recalc(); autosave();
  });
}

/* ---------- 表格事件 ---------- */
function bindRows() {
  bindRowDrag();
  /* 注意：监听挂在 document 上，用 closest('#rowsBody') 过滤。
     不能挂在 tbody 本身 —— renderHead() 重建 colgroup/thead 的 innerHTML 时，
     浏览器会重排表格结构并换掉 tbody 元素，原来挂的监听就跟着一起没了。 */
  document.addEventListener("input", function (e) {
    if (!e.target.closest || !e.target.closest("#rowsBody")) return;
    var tr = e.target.closest("tr"); if (!tr) return;
    var i = +tr.dataset.i, r = state.doc.rows[i]; if (!r) return;
    var c = e.target.className || "";
    if (c.indexOf("c-item") >= 0) {
      r.item = e.target.value;
      var m = (r.type === "item" || !r.type) ? findMaterial(r.item) : null;
      if (m) {
        var d1 = matUnit1(m);
        r.desc = matDesc(m); r.unit = d1.u; r.price = (d1.p === 0 || d1.p === "") ? "" : d1.p;
        tr.querySelector(".c-desc").value = r.desc;
        /* 单位格可能是输入框也可能是下拉，按新物料重建 */
        var tdOld = tr.querySelector(".c-unit").parentNode;
        if (tdOld && tdOld.parentNode) tdOld.parentNode.replaceChild(unitCell(r), tdOld);
        tr.querySelector(".c-price").value = r.price;
      }
    }
    else if (c.indexOf("c-desc") >= 0) r.desc = e.target.value;
    else if (c.indexOf("c-loc") >= 0) r.loc = e.target.value;
    else if (c.indexOf("c-qty") >= 0) r.qty = e.target.value;
    else if (c.indexOf("c-unit") >= 0) r.unit = e.target.value;
    else if (c.indexOf("c-price") >= 0) r.price = e.target.value;
    else if (c.indexOf("c-amt") >= 0) r.amt = e.target.value;
    recalc(); autosave();
  });
  document.addEventListener("change", function (e) {
    if (!e.target.closest || !e.target.closest("#rowsBody")) return;
    var tr = e.target.closest("tr"); if (!tr) return;
    var i = +tr.dataset.i, r = state.doc.rows[i]; if (!r) return;
    var c = e.target.className || "";
    if (c.indexOf("c-opt") >= 0) {
      r.optional = e.target.checked;
      tr.classList.toggle("opt", r.optional);
    } else if (c.indexOf("c-unit") >= 0 && e.target.tagName === "SELECT") {
      /* 换了单位 → 自动带出该单位的单价 */
      r.unit = e.target.value;
      var m = findMaterial(r.item);
      if (m) {
        var us = matUnits(m);
        for (var z = 0; z < us.length; z++) {
          if (String(us[z].u) === String(r.unit)) {
            r.price = (us[z].p === 0 || us[z].p === "") ? "" : us[z].p;
            var pi = tr.querySelector(".c-price");
            if (pi) pi.value = r.price;
          }
        }
      }
    } else return;
    recalc(); autosave();
  });
}

/* ---------- 组装导出数据 ---------- */
function compose() {
  var d = state.doc, noPrice = state.layout === "noprice";
  var cm = COLMODES[d.colMode] || COLMODES.split;
  var keys = cm.keys.slice();
  /* 模板自带表头 / 列宽 且与列结构等长时，以模板的为准（列结构只决定数据字段）
     —— 这样模板能自定义表头文案（如「品名 / 品牌型号」）而不被 picker 覆盖。 */
  var custom = !!(d.head && d.head.length === cm.head.length);
  var head = (custom ? d.head : cm.head).slice();
  var widths = (custom && d.widths && d.widths.length === cm.w.length ? d.widths : cm.w).slice();
  if (noPrice) {
    var drop = ["price", "total"], kill = [];
    keys.forEach(function (k, i) { if (drop.indexOf(k) >= 0) kill.push(i); });
    for (var z = kill.length - 1; z >= 0; z--) { keys.splice(kill[z], 1); head.splice(kill[z], 1); widths.splice(kill[z], 1); }
  }

  var rows = [];
  (d.rows || []).forEach(function (r) {
    var type = r.type || "item";
    if (type === "group") {
      var t = String(r.item || "").trim();
      if (t) rows.push({ kind: "group", title: t });
      return;
    }
    if (type === "subtotal") { rows.push({ kind: "subtotal", label: String(r.desc || "小计").trim() || "小计" }); return; }
    var q = (r.qty === "" || r.qty === null || r.qty === undefined) ? "" : String(r.qty);
    var u = String(r.unit || "");
    var filled = String(r.item || "").trim() || String(r.desc || "").trim() || q ||
      String(r.price || "").trim() || String(r.amt || "").trim() || u || String(r.loc || "").trim();
    if (!filled) return;
    var t = rowTotal(r), pn = num(r.price);
    rows.push({
      kind: "item", optional: !!r.optional, total: t, priceNum: pn,
      img: r.img || "", imgW: r.imgW || 0, imgH: r.imgH || 0,
      vals: {
        item: String(r.item || ""), desc: String(r.desc || ""), loc: String(r.loc || ""),
        unit: u, qty: q, qtyUnit: q + u,
        price: pn === null ? "" : pn,
        total: t.num === null ? t.text : t.num
      }
    });
  });

  /* 小计行：汇总自上一个分组/小计之后、且非选配的明细 */
  var acc = 0;
  rows.forEach(function (row) {
    if (row.kind === "group") { acc = 0; return; }
    if (row.kind === "subtotal") { row.amount = acc; acc = 0; return; }
    if (!row.optional && row.total && row.total.num !== null) acc += row.total.num;
  });

  var s = calcSums();
  var sub = [d.customer ? "客户：" + d.customer : "", d.project ? "项目：" + d.project : "",
    d.date ? "日期：" + d.date : ""].filter(Boolean).join("　　");
  return {
    noPrice: noPrice, keys: keys, head: head, widths: widths, rows: rows,
    title: d.title || "报价单", sub: sub,
    metaLine: [d.no ? "单号：" + d.no : "", d.contact ? "联系人：" + d.contact : "",
      d.phone ? "电话：" + d.phone : "", d.address ? "地址：" + d.address : ""].filter(Boolean).join("　　"),
    demand: d.demand || "", notice: d.notice || "", notes: d.notes || [],
    sums: {
      noOpt: s.noOpt, opt: s.opt, optAll: s.optAll, raw: s.raw,
      noOptNet: num(d.netNoOpt) === null ? s.noOpt : num(d.netNoOpt),
      optNet: num(d.netOpt) === null ? s.optAll : num(d.netOpt)
    },
    autoMerge: d.autoMerge !== false
  };
}

/* 相邻且同值的单元格自动纵向合并（按对象字段名取值，不是列下标） */
function autoMergeRanges(data, key) {
  var res = [], i = 0;
  while (i < data.length) {
    var v = String(data[i][key] === undefined || data[i][key] === null ? "" : data[i][key]).trim();
    if (!v) { i++; continue; }
    var j = i + 1;
    while (j < data.length && String(data[j][key] === undefined || data[j][key] === null ? "" : data[j][key]).trim() === v) j++;
    if (j - i > 1) res.push({ a: i, b: j - 1 });
    i = j;
  }
  return res;
}

/* 两列都相同才合并：用于「说明」列。
   只比说明本身的话，不同产品的相同说明会被并成一条，看起来像后面那行没有说明。 */
function autoMergeBoth(data, keyA, keyB) {
  var res = [], i = 0;
  function val(row, k) { return String(row[k] === undefined || row[k] === null ? "" : row[k]).trim(); }
  while (i < data.length) {
    var va = val(data[i], keyA), vb = val(data[i], keyB);
    if (!va || !vb) { i++; continue; }
    var j = i + 1;
    while (j < data.length && val(data[j], keyA) === va && val(data[j], keyB) === vb) j++;
    if (j - i > 1) res.push({ a: i, b: j - 1 });
    i = j;
  }
  return res;
}

/* ---------- 图片：dataURL ↔ 字节 ---------- */
function dataUrlExt(u) {
  var m = /^data:image\/([a-z]+)/i.exec(u || "");
  var e = m ? m[1].toLowerCase() : "png";
  if (e === "jpeg") e = "jpeg";
  return e;
}
function dataUrlToBytes(u) {
  var i = String(u).indexOf(",");
  var b64 = i >= 0 ? String(u).slice(i + 1) : String(u);
  var bin = atob(b64), len = bin.length, arr = new Uint8Array(len);
  for (var k = 0; k < len; k++) arr[k] = bin.charCodeAt(k);
  return arr;
}

/* 把图片排成若干行，锚点按像素反查；同时预留空行，否则图片会压到下面的内容 */
function buildImages(c, widths, rows) {
  var d = state.doc;
  var list = (d.images || []).filter(function (im) { return im && im.src && im.w && im.h; });
  if (!list.length) return [];
  var ROW_PX = 22, GAP = 10, PAD = 6;
  var totalPx = tablePx(widths);
  var nCol = d.imgCols === 1 ? 1 : 2;
  var cellW = Math.floor((totalPx - PAD * 2 - GAP * (nCol - 1)) / nCol);
  var withCap = d.imgCaption !== false;
  var out = [], i = 0;

  while (i < list.length) {
    var band = list.slice(i, i + nCol);
    var startRow = rows.length, maxH = 0, caps = [];
    band.forEach(function (im, k) {
      var r = Math.min(1, cellW / im.w);
      var w = Math.round(im.w * r), h = Math.round(im.h * r);
      var pos = pxToCell(PAD + k * (cellW + GAP), widths);
      out.push({
        data: dataUrlToBytes(im.src), ext: dataUrlExt(im.src), caption: im.caption || "",
        col: pos.col, dx: pos.dx, dy: 5, row: startRow, w: w, h: h
      });
      maxH = Math.max(maxH, 5 + h + (withCap ? 20 : 6));
      caps.push({ row: startRow + Math.ceil((5 + h + 2) / ROW_PX), col: pos.col, text: im.caption || "" });
    });
    var need = Math.ceil(maxH / ROW_PX) + 1;
    for (var z = 0; z < need; z++) rows.push([]);
    if (withCap) caps.forEach(function (cr) {
      if (!cr.text) return;
      var rr = Math.min(cr.row, rows.length - 1);
      if (!rows[rr]) rows[rr] = [];
      rows[rr][cr.col] = { v: cr.text, s: XS.note };
    });
    i += nCol;
  }
  return out;
}

/* ---------- 生成 XLSX 模型 ---------- */
function toXlsxModel() {
  var c = compose(), n = c.keys.length;
  var widths = c.widths;
  var rows = [], merges = [], heights = {};
  var simple = state.layout === "simple";
  function blankRowArr() { var a = []; for (var i = 0; i < n; i++) a.push(null); return a; }
  function merged(v, s) {
    var a = blankRowArr(); a[0] = { v: v, s: s };
    merges.push({ r1: rows.length, c1: 0, r2: rows.length, c2: n - 1 });
    return a;
  }

  var biz = state.layout === "business";
  var co = state.company || {};
  if (biz && co.name) {
    rows.push(merged(co.name, XS.title));
    var l2 = [co.phone ? "电话：" + co.phone : "", co.addr ? "地址：" + co.addr : "",
      co.tax ? "税号：" + co.tax : ""].filter(Boolean).join("　　");
    if (l2) rows.push(merged(l2, XS.sub));
  }
  rows.push(merged(c.title, XS.title));
  if (c.sub) rows.push(merged(c.sub, XS.sub));
  if (c.metaLine) rows.push(merged(c.metaLine, XS.sub));
  rows.push(blankRowArr());
  function wrapped(v, s) {
    rows.push(merged(v, s));
    heights[rows.length - 1] = Math.max(18, Math.ceil(String(v).length / 88) * 16 + 4);
  }
  if (c.demand) wrapped(c.demand, XS.textNB);
  if (c.notice) wrapped(c.notice, XS.textNB);
  rows.push(blankRowArr());

  rows.push(c.head.map(function (t) { return { v: t, s: simple ? XS.headLight : XS.headDark }; }));

  var detailStart = rows.length, mergeSrc = [], rowImgs = [];
  var descIdx = c.keys.indexOf("desc");
  c.rows.forEach(function (row) {
    if (row.kind === "group") {
      rows.push(merged(row.title, XS.sec));
      mergeSrc.push({ item: "\u0000g" + rows.length, desc: "\u0000g" + rows.length });
      return;
    }
    if (row.kind === "subtotal") {
      var a = blankRowArr();
      /* 标签里已经含「小计 / 合计」就不再重复加 */
      var hasWord = /小计|合计/.test(row.label);
      a[Math.max(0, n - 4)] = { v: hasWord ? "" : row.label, s: XS.bCtr };
      a[Math.max(0, n - 3)] = { v: hasWord ? row.label : "小计", s: XS.bCtr };
      a[n - 1] = { v: row.amount, t: "n", s: XS.bNum };
      rows.push(a);
      mergeSrc.push({ item: "\u0000s" + rows.length, desc: "\u0000s" + rows.length });
      return;
    }
    var opt = row.optional;
    var hasImg = !!(row.img && row.imgW && row.imgH && descIdx >= 0);
    rows.push(c.keys.map(function (k) {
      var v = row.vals[k];
      if (k === "price" || k === "total") {
        return typeof v === "number" ? { v: v, t: "n", s: opt ? XS.optNum : XS.num }
          : { v: v, s: opt ? XS.optCtr : XS.ctr };
      }
      if (k === "loc" || k === "unit" || k === "qty" || k === "qtyUnit") return { v: v, s: opt ? XS.optCtr : XS.ctr };
      /* 有配图的行：说明改成底对齐，图片占上半部分，文字落到下方不重叠 */
      if (k === "desc" && hasImg) return { v: v, s: opt ? XS.optTextBot : XS.textBot };
      return { v: v, s: opt ? XS.optText : XS.text };
    }));
    var ri = rows.length - 1;
    var lines = Math.ceil(String(row.vals.desc || "").length / 19) + Math.ceil(String(row.vals.item || "").length / 9);
    heights[ri] = Math.max(20, Math.min(60, lines * 15 + 6));
    if (hasImg) rowImgs.push({ row: ri, src: row.img, w: row.imgW, h: row.imgH });
    mergeSrc.push(row.vals);
  });

  if (c.autoMerge && mergeSrc.length > 1) {
    autoMergeRanges(mergeSrc, "item").forEach(function (m) { merges.push({ r1: detailStart + m.a, c1: 0, r2: detailStart + m.b, c2: 0 }); });
    autoMergeBoth(mergeSrc, "item", "desc").forEach(function (m) { merges.push({ r1: detailStart + m.a, c1: 1, r2: detailStart + m.b, c2: 1 }); });
  }

  if (!c.noPrice) {
    rows.push(blankRowArr());
    function sumRow(l1, l2, val) {
      var a = blankRowArr();
      a[Math.max(0, n - 4)] = { v: l1, s: XS.bCtr };
      a[Math.max(0, n - 3)] = { v: l2, s: XS.bCtr };
      a[n - 1] = { v: val, t: "n", s: XS.bNum };
      return a;
    }
    function netRow(val) {
      var a = blankRowArr();
      a[n - 2] = { v: "实收", s: XS.bLabel };
      a[n - 1] = { v: val, t: "n", s: XS.bNum };
      return a;
    }
    rows.push(sumRow("不含选配", "合计", c.sums.noOpt));
    rows.push(netRow(c.sums.noOptNet));
    rows.push(sumRow("含选配", "合计", c.sums.optAll));
    rows.push(netRow(c.sums.optNet));
  }

  if (c.notes.length) {
    rows.push(blankRowArr());
    rows.push(merged("备注：", XS.sec));
    c.notes.forEach(function (t, i) { wrapped((i + 1) + ". " + t, XS.note); });
  }
  if (biz) {
    rows.push(blankRowArr());
    var tail = [co.name || "", co.bank ? "开户行：" + co.bank : "", co.account ? "账号：" + co.account : "", "（盖章）"]
      .filter(Boolean).join("　　");
    if (tail) rows.push(merged(tail, XS.textNB));
  }

  var images = buildRowImages(rowImgs, widths, heights, descIdx).concat(buildImages(c, widths, rows));
  return { sheetName: "报价单", cols: widths, rows: rows, merges: merges, rowHeights: heights, images: images };
}

/* 行内配图：锚在该行「说明」列，行高撑到「图片 + 文字」都放得下 */
function buildRowImages(list, widths, heights, descIdx) {
  if (!list.length || descIdx < 0) return [];
  var PAD = 4;
  var colW = Math.max(60, colPx(widths[descIdx]) - PAD * 2 - 2);
  var out = [];
  list.forEach(function (ri) {
    var scale = Math.min(1, colW / ri.w);
    var w = Math.max(1, Math.round(ri.w * scale)), h = Math.max(1, Math.round(ri.h * scale));
    out.push({
      data: dataUrlToBytes(ri.src), ext: dataUrlExt(ri.src), caption: "",
      col: descIdx, dx: PAD, dy: PAD, row: ri.row, w: w, h: h
    });
    var textH = heights[ri.row] || 20;
    heights[ri.row] = h + PAD * 2 + textH;
  });
  return out;
}

/* ---------- 打印视图 ---------- */
function renderPrint() {
  var c = compose(), h = [], co = state.company || {}, biz = state.layout === "business";
  h.push('<div class="p-title">' + esc(biz && co.name ? co.name : c.title) + '</div>');
  var subParts = [];
  if (biz && co.name) subParts.push(c.title);
  if (co.phone) subParts.push("电话：" + co.phone);
  if (co.addr) subParts.push("地址：" + co.addr);
  if (co.tax) subParts.push("税号：" + co.tax);
  if (subParts.length) h.push('<div class="p-sub">' + esc(subParts.join("　　")) + '</div>');
  var meta = [c.sub, c.metaLine].filter(Boolean).join("　　");
  if (meta) h.push('<div class="p-meta"><span>' + esc(meta) + '</span></div>');
  if (c.demand) h.push('<div class="p-note">' + esc(c.demand) + '</div>');
  if (c.notice) h.push('<div class="p-note">' + esc(c.notice) + '</div>');

  h.push('<table><thead><tr>');
  c.head.forEach(function (t) { h.push("<th>" + esc(t) + "</th>"); });
  h.push("</tr></thead><tbody>");
  c.rows.forEach(function (row) {
    if (row.kind === "group") {
      h.push('<tr class="p-grp"><td colspan="' + c.head.length + '">' + esc(row.title) + "</td></tr>");
      return;
    }
    if (row.kind === "subtotal") {
      h.push('<tr class="p-sub"><td colspan="' + Math.max(1, c.head.length - 1) + '" class="r">' + esc(/小计|合计/.test(row.label) ? row.label : row.label + " 小计") + "</td>" +
        '<td class="r">' + fmt(row.amount) + "</td></tr>");
      return;
    }
    h.push('<tr' + (row.optional ? ' class="opt"' : '') + '>');
    c.keys.forEach(function (k) {
      var v = row.vals[k];
      if (k === "price" || k === "total" || k === "qty" || k === "qtyUnit") {
        h.push('<td class="r">' + esc(typeof v === "number" ? fmt(v) : v) + "</td>");
      } else if (k === "loc" || k === "unit") {
        h.push('<td class="c">' + esc(v) + "</td>");
      } else if (k === "desc" && row.img) {
        h.push('<td class="hasimg"><img class="cellimg" src="' + row.img + '" alt="">' + esc(v) + "</td>");
      } else {
        h.push("<td>" + esc(v) + "</td>");
      }
    });
    h.push("</tr>");
  });
  if (!c.noPrice) {
    var pad = Math.max(0, c.head.length - 4);
    var pre = '<td colspan="' + pad + '"></td>';
    h.push("<tr>" + pre + '<td class="c">不含选配</td><td class="c">合计</td><td></td><td class="r">' + fmt(c.sums.noOpt) + "</td></tr>");
    h.push("<tr>" + pre + '<td></td><td></td><td class="c">实收</td><td class="r">' + fmt(c.sums.noOptNet) + "</td></tr>");
    h.push("<tr>" + pre + '<td class="c">含选配</td><td class="c">合计</td><td></td><td class="r">' + fmt(c.sums.optAll) + "</td></tr>");
    h.push("<tr>" + pre + '<td></td><td></td><td class="c">实收</td><td class="r">' + fmt(c.sums.optNet) + "</td></tr>");
  }
  h.push("</tbody></table>");

  if (c.notes.length) h.push('<div class="p-foot">' + c.notes.map(function (t, i) { return (i + 1) + ". " + esc(t); }).join("<br>") + "</div>");

  /* 附图 */
  var imgs = (state.doc.images || []).filter(function (im) { return im && im.src; });
  if (imgs.length) {
    h.push('<div class="p-imgs cols' + (state.doc.imgCols === 1 ? 1 : 2) + '">');
    imgs.forEach(function (im) {
      h.push('<figure><img src="' + im.src + '" alt="' + esc(im.caption || "") + '">' +
        (state.doc.imgCaption === false || !im.caption ? "" : "<figcaption>" + esc(im.caption) + "</figcaption>") + "</figure>");
    });
    h.push("</div>");
  }
  if (biz) {
    var tail = [co.name || "", co.bank ? "开户行：" + co.bank : "", co.account ? "账号：" + co.account : "", "（盖章）"]
      .filter(Boolean).join("　　");
    if (tail) h.push('<div class="p-foot" style="text-align:right;margin-top:26px">' + esc(tail) + "</div>");
  }
  $("printArea").innerHTML = h.join("");
}

function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ---------- 导出 ---------- */
function exportXlsx() {
  var c = compose();
  if (!c.rows.some(function (r) { return r.kind === "item"; })) { toast("明细为空，先添加几行"); return; }
  var bytes = buildXlsx(toXlsxModel());
  var base = (state.doc.project || state.doc.customer || "报价单").replace(/[\\\/:*?"<>|]/g, "");
  download(bytes, base + "-" + (state.doc.date || todayStr()) + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  toast("已导出 Excel（" + Math.round(bytes.length / 1024) + " KB）");
}
function download(bytes, filename, mime) {
  var blob = new Blob([bytes], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function exportJson() {
  var payload = { kind: "quotation", version: 2, doc: state.doc, layout: state.layout, templates: state.tpls || [] };
  download(new TextEncoder().encode(JSON.stringify(payload, null, 2)), (state.doc.project || "报价单") + ".json", "application/json");
  toast("已导出 JSON" + ((state.tpls || []).length ? "（含 " + state.tpls.length + " 个自建模板）" : ""));
}
function importJson() {
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = function () {
    var f = inp.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var o = JSON.parse(fr.result);
        if (o && o.kind === "quotation" && o.doc) {
          state.doc = o.doc; state.layout = o.layout || "standard";
          /* 备份里带的自建模板一并恢复（老备份没有这个字段，跳过即可） */
          if (Array.isArray(o.templates) && o.templates.length) {
            var names = {};
            state.tpls.forEach(function (t) { names[t.name] = true; });
            var addedT = 0;
            o.templates.forEach(function (t) {
              if (!t || !t.id || !t.name || names[t.name]) return;
              names[t.name] = true; addedT++; state.tpls.push(t);
            });
            saveTplStore();
            if (addedT) toast("已导入报价单，并恢复 " + addedT + " 个自建模板");
          }
          var restoredTpl = Array.isArray(o.templates);
          state.caution = ""; renderAll(); autosave();
          if (!restoredTpl) toast("已导入报价单");
        } else if (o && o.kind === "materials" && Array.isArray(o.items)) {
          state.materials = o.items.map(function (m) {
            /* 兼容只有单个 u / p 的旧格式 */
            if (!m.units || !m.units.length) {
              m.units = [{ u: m.u || "个", p: (m.p === undefined ? "" : m.p) }];
            }
            return m;
          });
          /* 导入的物料可能带新分类，一并加进去，别让它们变成「未分类」 */
          var added = 0;
          state.materials.forEach(function (m) {
            if (m.g && state.groups.indexOf(m.g) < 0) { state.groups.push(m.g); added++; }
          });
          saveMatStore();
          renderMatList(""); renderDatalists();
          toast("已导入 " + state.materials.length + " 条物料" + (added ? "，新增 " + added + " 个分类" : ""));
        } else { toast("文件格式不认识"); }
      } catch (e) { toast("解析失败：" + e.message); }
    };
    fr.readAsText(f, "utf-8");
  };
  inp.click();
}

/* ---------- 弹窗 ---------- */
function openModal(html) { $("modalBox").innerHTML = html; $("modal").classList.remove("hidden"); }
function closeModal() { $("modal").classList.add("hidden"); }

function openCompany() {
  var c = state.company || {};
  openModal(
    '<button class="mclose" onclick="closeModal()">×</button><h2>公司信息</h2>' +
    '<p class="hint" style="margin:0 0 12px">用于「商务版」版式。LOGO 会出现在打印 / PDF 里；Excel 里用公司名做文字抬头。</p>' +
    '<div class="mgrid">' +
    fld("cpName", "公司名", c.name) + fld("cpPhone", "电话", c.phone) + fld("cpAddr", "地址", c.addr) +
    fld("cpTax", "税号", c.tax) + fld("cpBank", "开户行", c.bank) + fld("cpAccount", "账号", c.account) +
    '</div>' +
    '<p class="sec-title" style="margin-top:14px">LOGO（PNG / JPG，用于打印与 PDF）</p>' +
    '<div style="display:flex;align-items:center;gap:12px">' +
    '<img id="cpLogoPrev" src="' + (c.logo || "") + '" style="max-height:52px;max-width:200px;border:1px solid var(--line);border-radius:6px;padding:4px;' + (c.logo ? "" : "display:none") + '">' +
    '<input id="cpLogo" type="file" accept="image/*" style="width:auto">' +
    '<button type="button" onclick="clearLogo()">清除</button></div>' +
    '<div style="margin-top:18px;display:flex;gap:8px"><button class="primary" onclick="saveCompany()">保存</button><button onclick="closeModal()">取消</button></div>'
  );
  $("cpLogo").onchange = function () {
    var f = this.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () { var p = $("cpLogoPrev"); p.src = fr.result; p.style.display = ""; p.dataset.v = fr.result; };
    fr.readAsDataURL(f);
  };
  $("cpLogoPrev").dataset.v = c.logo || "";
}
function fld(id, label, val) {
  return '<div class="fld"><span style="flex:0 0 56px">' + label + '</span><input id="' + id + '" value="' + String(val === undefined || val === null ? "" : val).replace(/"/g, "&quot;") + '"></div>';
}
function clearLogo() { $("cpLogoPrev").src = ""; $("cpLogoPrev").style.display = "none"; $("cpLogoPrev").dataset.v = ""; }
function saveCompany() {
  state.company = {
    name: $("cpName").value.trim(), phone: $("cpPhone").value.trim(), addr: $("cpAddr").value.trim(),
    tax: $("cpTax").value.trim(), bank: $("cpBank").value.trim(), account: $("cpAccount").value.trim(),
    logo: $("cpLogoPrev").dataset.v || ""
  };
  lsSet(LSK.comp, state.company); closeModal(); renderPrint(); toast("公司信息已保存");
}

/* ---------- 导出预览（让「版式」「列结构」的差别当场可见）---------- */
function openPreview() {
  $("topTools").open = false;
  openModal('<button class="mclose" onclick="closeModal()">×</button><h2>导出预览</h2><div id="pvBox"></div>');
  renderPreviewModal();
}
function renderPreviewModal() {
  renderPrint();
  var box = $("pvBox"); if (!box) return;
  box.innerHTML =
    '<p class="pvnote">检查报价内容，也可以在这里调整外观和明细列。Excel 会保留单元格格式；打印效果以此预览为参考。</p>' +
    '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px">' +
    '<div style="flex:1;min-width:240px"><p class="sec-title">版式（外观：底色、边框、抬头落款、有无价格）</p><div class="pickrow" id="pvLay"></div></div>' +
    '<div style="flex:1;min-width:240px"><p class="sec-title">列结构（表头有哪些列）</p><div class="pickrow" id="pvCol"></div></div>' +
    "</div>" +
    '<div class="pvbox sheet" id="pvSheet"></div>' +
    '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="primary" onclick="closeModal();exportXlsx()">导出 Excel</button>' +
    '<button onclick="closeModal();window.print()">打印 / PDF</button>' +
    '<button onclick="closeModal()">关闭</button></div>';

  LAYOUTS.forEach(function (l) {
    var d = document.createElement("div");
    d.className = "pickcard" + (state.layout === l.id ? " on" : "");
    d.innerHTML = "<b>" + l.name + "</b><span>" + l.hint + "</span>";
    d.onclick = function () { state.layout = l.id; lsSet(LSK.layout, l.id); renderLayoutList(); renderPreviewModal(); updateWorkspace(); };
    $("pvLay").appendChild(d);
  });
  Object.keys(COLMODES).forEach(function (k) {
    var d = document.createElement("div");
    d.className = "pickcard" + ((state.doc.colMode || "split") === k ? " on" : "");
    d.innerHTML = "<b>" + ({ split: "数量、单位分列", merged: "数量、单位合列", splitLoc: "增加使用位置" })[k] + "</b><span>" + COLMODES[k].name + "</span>";
    d.onclick = function () { state.doc.colMode = k; state.doc.head = null; state.doc.widths = null; renderRows(); renderColModes(); renderPreviewModal(); autosave(); updateWorkspace(); };
    $("pvCol").appendChild(d);
  });
  $("pvSheet").innerHTML = $("printArea").innerHTML;
}

function openHistory() {
  var list = state.history.slice().reverse();
  var h = '<button class="mclose" onclick="closeModal()">×</button><h2>历史报价单（' + list.length + '）</h2>';
  if (!list.length) h += '<p class="hint">还没有存过的单子。编辑完点「存入历史」，下次一键复制改数量即可。</p>';
  list.forEach(function (it) {
    h += '<div class="hist-item"><div class="hi-main"><div class="hi-t">' + esc(it.name) + '</div>' +
      '<div class="hi-s">' + esc(it.date) + '　' + esc(it.customer || "—") + '　¥' + fmt(it.amount) + '</div></div>' +
      '<button class="tiny" onclick="loadHist(\'' + it.id + '\')">载入</button>' +
      '<button class="tiny" onclick="copyHist(\'' + it.id + '\')">复制为新单</button>' +
      '<button class="tiny danger" onclick="delHist(\'' + it.id + '\')">删除</button></div>';
  });
  h += '<div style="margin-top:16px"><button class="primary" onclick="saveHist()">把当前单据存入历史</button></div>';
  openModal(h);
}
function saveHist() {
  var c = compose();
  var it = {
    id: uid(), ts: Date.now(), date: state.doc.date || todayStr(),
    name: (state.doc.project || state.doc.customer || "未命名") + (state.doc.no ? " · " + state.doc.no : ""),
    customer: state.doc.customer || "", amount: c.sums.optAll, doc: JSON.parse(JSON.stringify(state.doc))
  };
  state.history.push(it);
  if (state.history.length > 200) state.history = state.history.slice(-200);
  lsSet(LSK.hist, state.history);
  openHistory(); toast("已存入历史");
}
function loadHist(id) {
  var it = state.history.filter(function (x) { return x.id === id; })[0]; if (!it) return;
  state.doc = JSON.parse(JSON.stringify(it.doc)); state.caution = "";
  renderAll(); autosave(); closeModal(); toast("已载入");
}
function copyHist(id) {
  var it = state.history.filter(function (x) { return x.id === id; })[0]; if (!it) return;
  state.doc = JSON.parse(JSON.stringify(it.doc));
  state.doc.no = nextNo(); state.doc.date = todayStr(); state.caution = "";
  renderAll(); autosave(); closeModal(); toast("已复制为新单，改数量即可");
}
function delHist(id) {
  state.history = state.history.filter(function (x) { return x.id !== id; });
  lsSet(LSK.hist, state.history); openHistory();
}

/* ---------- 列结构 ---------- */
function renderColModes() {
  var box = $("colModeList"); if (!box) return;
  box.innerHTML = "";
  Object.keys(COLMODES).forEach(function (k) {
    var lb = document.createElement("label");
    var rb = document.createElement("input");
    rb.type = "radio"; rb.name = "colmode"; rb.value = k;
    rb.checked = (state.doc.colMode || "split") === k;
    rb.onchange = function () { state.doc.colMode = k; state.doc.head = null; state.doc.widths = null; renderAll(); autosave(); };
    lb.appendChild(rb);
    var sp = document.createElement("span");
    sp.textContent = COLMODES[k].name; sp.style.fontSize = "11px"; sp.style.lineHeight = "1.4";
    lb.appendChild(sp);
    box.appendChild(lb);
  });
}

/* ---------- 附图 ---------- */
var IMG_MAX_W = 1100;

function renderImages() {
  var box = $("imgList"); if (!box) return;
  var list = state.doc.images || [];
  var rc = document.querySelector('input[name="imgcols"][value="' + (state.doc.imgCols === 1 ? 1 : 2) + '"]');
  if (rc) rc.checked = true;
  var ic = $("imgCap"); if (ic) ic.checked = state.doc.imgCaption !== false;
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = '<div class="drop">还没有附图<br>点「选择图片」，或直接 <b>Ctrl + V</b> 粘贴截图</div>';
    return;
  }
  var wrap = document.createElement("div"); wrap.className = "imglist";
  list.forEach(function (im, i) {
    var d = document.createElement("div"); d.className = "imgitem";
    var img = document.createElement("img"); img.src = im.src; img.alt = im.caption || "";
    d.appendChild(img);
    var cap = document.createElement("input");
    cap.value = im.caption || ""; cap.placeholder = "图注（可空）";
    cap.oninput = function () { im.caption = cap.value; autosave(); };
    d.appendChild(cap);
    var row = document.createElement("div"); row.className = "row";
    row.appendChild(mkBtn("←", function () { moveImg(i, -1); }));
    row.appendChild(mkBtn("→", function () { moveImg(i, 1); }));
    row.appendChild(mkBtn("删除", function () { state.doc.images.splice(i, 1); renderImages(); autosave(); }));
    d.appendChild(row);
    wrap.appendChild(d);
  });
  box.appendChild(wrap);
}
function mkBtn(t, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = t; b.onclick = fn; return b; }
function moveImg(i, dir) {
  var a = state.doc.images, j = i + dir;
  if (j < 0 || j >= a.length) return;
  var t = a[i]; a[i] = a[j]; a[j] = t;
  renderImages(); autosave();
}
function pickImages() {
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
  inp.onchange = function () { addImageFiles(inp.files); };
  inp.click();
}
/* 读文件 → 缩放 → 转 JPEG（体积可控，localStorage 撑得住） */
function addImageFiles(files) {
  var arr = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
  if (!arr.length) return;
  var pending = arr.length, added = 0;
  arr.forEach(function (f) {
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var scale = Math.min(1, IMG_MAX_W / im.width);
        var w = Math.max(1, Math.round(im.width * scale)), h = Math.max(1, Math.round(im.height * scale));
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var cx = cv.getContext("2d");
        cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
        cx.drawImage(im, 0, 0, w, h);
        state.doc.images.push({ id: uid(), src: cv.toDataURL("image/jpeg", 0.9), caption: "", w: w, h: h });
        added++;
        if (--pending === 0) { renderImages(); autosave(); toast("已添加 " + added + " 张图"); }
      };
      im.onerror = function () { if (--pending === 0) { renderImages(); autosave(); } };
      im.src = fr.result;
    };
    fr.readAsDataURL(f);
  });
}
/* 行内配图：贴在某一行的「说明」格里，客户一眼知道图对应哪个物料 */
function pickRowImage(i) {
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*";
  inp.onchange = function () { if (inp.files[0]) attachRowImage(i, inp.files[0]); };
  inp.click();
}
function attachRowImage(i, file) {
  if (!file || !/^image\//.test(file.type)) return;
  var r = state.doc.rows[i];
  if (!r) return;
  var fr = new FileReader();
  fr.onload = function () {
    var im = new Image();
    im.onload = function () {
      var scale = Math.min(1, IMG_MAX_W / im.width);
      var w = Math.max(1, Math.round(im.width * scale)), h = Math.max(1, Math.round(im.height * scale));
      var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      var cx = cv.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
      cx.drawImage(im, 0, 0, w, h);
      r.img = cv.toDataURL("image/jpeg", 0.9); r.imgW = w; r.imgH = h;
      renderRows(); recalc(); autosave();
      toast("已给第 " + (i + 1) + " 行配图：" + (String(r.item || "").trim() || "（未命名）"));
    };
    im.onerror = function () { toast("这张图读不出来"); };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}
function bindPaste() {
  document.addEventListener("paste", function (e) {
    if (!e.clipboardData || !e.clipboardData.items) return;
    var files = [];
    for (var k = 0; k < e.clipboardData.items.length; k++) {
      var it = e.clipboardData.items[k];
      if (it.type && it.type.indexOf("image/") === 0) { var f = it.getAsFile(); if (f) files.push(f); }
    }
    if (!files.length) return;                 /* 纯文本粘贴照常 */
    e.preventDefault();
    /* 焦点在明细行里 → 贴到那一行；否则进「附图」区 */
    var tr = (e.target && e.target.closest) ? e.target.closest("tr") : null;
    var idx = (tr && tr.parentNode && tr.parentNode.id === "rowsBody") ? Number(tr.dataset.i) : -1;
    var row = idx >= 0 ? state.doc.rows[idx] : null;
    if (row && (row.type || "item") === "item") {
      attachRowImage(idx, files[0]);
      if (files.length > 1) toast("一次只贴一张，已取第一张");
    } else {
      addImageFiles(files);
    }
  });
}

/* ---------- 自动保存 ---------- */
var saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  setSaveStatus("saving", "正在保存…");
  saveTimer = setTimeout(saveCurrentDoc, 300);
}

function setSaveStatus(mode, text) {
  var el = $("saveStatus"); if (!el) return;
  el.dataset.state = mode; el.textContent = text;
}
function saveCurrentDoc() {
  var saved = lsSet(LSK.doc, state.doc);
  setSaveStatus(saved ? "saved" : "error", saved ? "已自动保存到当前浏览器" : "未能保存，请用「更多 → 保存备份」保留内容");
}

/* ---------- 一页式工作台 ---------- */
var uiStarted = false, rowMenuAnchor = null;
function selectSidebar(which, focus) {
  var templates = which === "templates";
  $("templatePanel").hidden = !templates; $("materialPanel").hidden = templates;
  ["tabTemplates", "tabMaterials"].forEach(function (id, index) {
    var selected = templates === (index === 0), tab = $(id);
    tab.setAttribute("aria-selected", selected ? "true" : "false"); tab.tabIndex = selected ? 0 : -1;
  });
  if (focus) {
    document.querySelector(".side").scrollIntoView({ block: "nearest" });
    if (templates) { var first = document.querySelector("#tplList .tpl-item"); if (first) first.focus({ preventScroll: true }); }
    else $("matSearch").focus({ preventScroll: true });
  }
}
function focusQuantity(index) {
  var row = $("rowsBody").children[index]; if (!row) return;
  var input = row.querySelector(".c-qty") || row.querySelector("input");
  row.classList.add("row-highlight"); row.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (input) { input.focus({ preventScroll: true }); input.select(); }
}
function updateWorkspace() {
  if (!$("workspaceTitle") || !state.doc) return;
  var items = state.doc.rows.filter(function (r) {
    return (!r.type || r.type === "item") && (["item", "desc", "qty", "amt", "price", "unit", "loc", "img"].some(function (key) {
      return r[key] !== null && r[key] !== undefined && String(r[key]).trim() !== "";
    }) || r.optional);
  });
  var started = uiStarted || items.length || state.doc.rows.length > 1 || state.doc.rows.some(function (r) { return r.type === "group" || r.type === "subtotal"; });
  var template = findTemplate(state.doc.tplId);
  $("workspaceTitle").textContent = started ? "核对数量，完成这份报价。" : "选个模板，开始做报价。";
  $("templateStatus").textContent = template
    ? (started
      ? "已载入「" + template.name + "」，共 " + items.length + " 项明细。右侧「保存为模板」可以把这份存下来。"
      : "已载入空模板「" + template.name + "」。点「＋ 添加明细」开始填，填好可以「保存为模板」。")
    : started ? "自定义报价：添加项目，填好数量，金额会自动计算。" : "先选一个模板；模板是空的，内容自己加。";
  /* 模板自带表头时，列结构选择器对它没有意义（改了也会被模板表头覆盖）→ 藏起来 */
  if ($("colModeWrap")) $("colModeWrap").hidden = !!(state.doc.colMode === "split" && state.doc.head && state.doc.head.length === COLMODES.split.head.length);
  $("emptyGuide").hidden = !!started; $("rowEditor").hidden = !started;
  $("detailCount").textContent = items.length ? items.length + " 项明细" : "还没有报价明细";
  $("btnStepTemplate").classList.toggle("is-current", !started);
  $("btnStepEdit").classList.toggle("is-current", !!started);
  var sums = calcSums();
  $("summaryAmount").textContent = "¥" + fmt(sums.noOpt);
  var optional = items.some(function (r) { return r.optional; });
  $("summaryOptional").textContent = optional ? "含选配：¥" + fmt(sums.optAll) : "未添加选配项目";
  $("footerSummary").textContent = items.length + " 项明细 · 基础报价 ¥" + fmt(sums.noOpt);
  var layout = LAYOUTS.filter(function (l) { return l.id === state.layout; })[0];
  $("appearanceStatus").textContent = layout ? layout.name : "标准横版";
  var imageCount = (state.doc.images || []).length;
  $("imageCount").textContent = imageCount ? imageCount + " 张附图" : "选填，可以直接粘贴截图";
  if (!started) { $("totAlert").textContent = "添加明细后，这里会帮你核对报价。"; $("totAlert").className = "alert ok"; }
}
function hideRowMenu() {
  var menu = $("rowActionMenu"); if (menu) menu.hidden = true;
  if (rowMenuAnchor) rowMenuAnchor.setAttribute("aria-expanded", "false");
  rowMenuAnchor = null;
}
function openRowMenu(index, anchor) {
  var same = rowMenuAnchor === anchor; hideRowMenu(); if (same) return;
  var menu = $("rowActionMenu"); menu.innerHTML = "";
  [["up", "上移一行", function () { moveRow(index, -1); }], ["down", "下移一行", function () { moveRow(index, 1); }],
    ["duplicate", "复制这一行", function () { dupRow(index); }], ["delete", "删除这一行", function () { delRow(index); }]].forEach(function (action) {
    var b = btn(action[1], action[1], function () { hideRowMenu(); action[2](); var next = $("rowsBody").children[Math.min(index, state.doc.rows.length - 1)]; if (next) next.querySelector(".row-more").focus({ preventScroll: true }); });
    b.dataset.action = action[0]; b.disabled = (action[0] === "up" && index === 0) || (action[0] === "down" && index === state.doc.rows.length - 1); menu.appendChild(b);
  });
  rowMenuAnchor = anchor; anchor.setAttribute("aria-expanded", "true"); menu.hidden = false;
  var rect = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.right - 152, window.innerWidth - 164)) + "px";
  menu.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)) + "px";
  var first = menu.querySelector("button:not(:disabled)"); if (first) first.focus({ preventScroll: true });
}
function bindWorkspace() {
  $("tabTemplates").onclick = function () { selectSidebar("templates"); };
  $("tabMaterials").onclick = function () { selectSidebar("materials"); };
  document.querySelector(".side-tabs").addEventListener("keydown", function (e) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) < 0) return;
    e.preventDefault(); var templates = e.key === "Home" || (e.key !== "End" && $("tabTemplates").getAttribute("aria-selected") !== "true");
    selectSidebar(templates ? "templates" : "materials"); $(templates ? "tabTemplates" : "tabMaterials").focus();
  });
  $("btnChooseTemplate").onclick = $("btnStepTemplate").onclick = function () { selectSidebar("templates", true); };
  $("btnAddMaterial").onclick = function () { selectSidebar("materials", true); };
  /* 空模板选好了但还没动手时，「开始填写」直接进入编辑区（不额外加一行） */
  $("btnStartBlank").onclick = function () {
    if (state.doc && !uiStarted && state.doc.rows.length === 1 && !state.doc.rows[0].item) {
      uiStarted = true; renderAll(); autosave();
      $("customerSection").scrollIntoView({ block: "start" });
      return;
    }
    $("btnAddRow").click();
  };
  $("btnStepEdit").onclick = function () { $("customerSection").scrollIntoView({ block: "start" }); $("mCustomer").focus({ preventScroll: true }); };
  $("btnFooterPreview").onclick = $("btnStepPreview").onclick = openPreview;
  $("btnHistory").onclick = function () { $("topTools").open = false; openHistory(); };
  document.querySelectorAll(".tools-panel button").forEach(function (b) { b.addEventListener("click", function () { $("topTools").open = false; }); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#rowActionMenu,.row-more")) hideRowMenu();
    if (!e.target.closest("#topTools")) $("topTools").open = false;
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { var anchor = rowMenuAnchor; hideRowMenu(); if (anchor) anchor.focus(); $("topTools").open = false; } });
  window.addEventListener("resize", hideRowMenu); document.addEventListener("scroll", hideRowMenu, true);
  window.addEventListener("pagehide", function () { clearTimeout(saveTimer); saveCurrentDoc(); });
}

/* ---------- 渲染总入口 ---------- */
function renderAll() {
  renderMeta(); renderRows(); renderTplList(); renderColModes(); renderImages(); recalc(); renderPrint();
}

/* ---------- 初始化 ---------- */
function init() {
  state.materials = lsGet(LSK.mat, []);
  state.company = lsGet(LSK.comp, {});
  state.history = lsGet(LSK.hist, []);
  state.layout = lsGet(LSK.layout, "standard");
  state.openGroups = lsGet(LSK.grp, { "监控": true });
  state.groups = lsGet(LSK.grpList, null) || GROUPS.slice();
  if (!state.groups || !state.groups.length) state.groups = GROUPS.slice();
  state.matOv = lsGet(LSK.matOv, {}) || {};
  state.tpls = lsGet(LSK.tpl, []) || [];
  if (!Array.isArray(state.tpls)) state.tpls = [];
  state.doc = lsGet(LSK.doc, null) || newDoc();
  if (!state.doc.no) state.doc.no = nextNo();
  if (!state.doc.rows || !state.doc.rows.length) state.doc.rows = [blankRow()];
  state.doc.rows.forEach(function (r) {
    if (r.amt === undefined) r.amt = "";
    if (!r.type) r.type = "item";
  });
  if (!state.doc.colMode) state.doc.colMode = "split";
  if (!state.doc.images) state.doc.images = [];
  if (!state.doc.imgCols) state.doc.imgCols = 2;
  if (state.doc.imgCaption === undefined) state.doc.imgCaption = true;
  /* 旧版本存在浏览器里的单据：模板已换掉 / 表头字段是旧格式 → 清掉，避免带出脏表头 */
  if (state.doc.tplId && !findTemplate(state.doc.tplId)) state.doc.tplId = "";
  if (!(state.doc.head && state.doc.head.length === (COLMODES[state.doc.colMode] || COLMODES.split).head.length)) state.doc.head = null;
  if (!(state.doc.widths && state.doc.head && state.doc.widths.length === state.doc.head.length)) state.doc.widths = null;

  /* 先把事件全部绑好，再做渲染 —— 万一某个渲染函数出错，界面也不会整个变哑 */
  $("btnNew").onclick = function () {
    if (hasContent(state.doc) && !confirm("新建会清空当前内容（可先在「更多」中保存备份），继续？")) return;
    state.doc = newDoc(); state.doc.no = nextNo(); state.caution = "";
    uiStarted = false;
    renderAll(); autosave();
  };
  $("btnAddRow").onclick = function () { var entering = !uiStarted; uiStarted = true; var first = state.doc.rows[0]; var empty = entering && state.doc.rows.length === 1 && !first.item && !first.desc && !first.qty && !first.price && !first.unit && !first.loc && !first.amt && (!first.type || first.type === "item"); var i = empty ? 0 : state.doc.rows.push(blankRow()) - 1; renderRows(); recalc(); autosave(); focusQuantity(i); };
  $("btnAddGroup").onclick = function () { uiStarted = true; state.doc.rows.push(G("")); renderRows(); recalc(); autosave(); focusQuantity(state.doc.rows.length - 1); };
  $("btnAddSub").onclick = function () { uiStarted = true; state.doc.rows.push(S("小计")); renderRows(); recalc(); autosave(); focusQuantity(state.doc.rows.length - 1); };
  $("btnAddImg").onclick = pickImages;
  $("btnMatManage").onclick = openMatManager;
  $("btnPasteHint").onclick = function () { toast("在页面任意位置按 Ctrl + V 即可粘贴截图"); };
  $("btnClearImg").onclick = function () {
    if (!(state.doc.images || []).length) return;
    if (!confirm("清空全部附图？")) return;
    state.doc.images = []; renderImages(); autosave();
  };
  Array.prototype.forEach.call(document.querySelectorAll('input[name="imgcols"]'), function (rb) {
    rb.onchange = function () { state.doc.imgCols = Number(rb.value); autosave(); };
  });
  $("imgCap").onchange = function () { state.doc.imgCaption = this.checked; autosave(); };
  bindPaste();
  $("btnClearRows").onclick = function () {
    if (!confirm("清空全部明细行？")) return;
    state.doc.rows = [blankRow()]; uiStarted = false; renderRows(); recalc(); autosave();
  };
  $("btnMergeToggle").onclick = function () {
    state.doc.autoMerge = state.doc.autoMerge === false;
    this.textContent = "合并规则：" + (state.doc.autoMerge ? "自动" : "关闭");
    autosave();
  };
  $("btnMergeToggle").textContent = "合并规则：" + (state.doc.autoMerge === false ? "关闭" : "自动");
  $("btnRound").onclick = function () {
    var s = calcSums();
    state.doc.netNoOpt = String(floor100(s.noOpt)); state.doc.netNoOptAuto = false;
    state.doc.netOpt = String(floor100(s.optAll)); state.doc.netOptAuto = false;
    recalc(); autosave();
    toast("实收已抹零到整百；点「恢复自动跟随合计」可还原");
  };
  $("btnNetAuto").onclick = function () {
    state.doc.netNoOptAuto = true; state.doc.netOptAuto = true;
    recalc(); autosave();
    toast("实收已恢复为自动跟随合计");
  };
  $("btnXlsx").onclick = exportXlsx;
  $("btnPrint").onclick = function () { renderPrint(); window.print(); };
  $("btnExportJson").onclick = exportJson;
  $("btnImport").onclick = importJson;
  $("btnCompany").onclick = openCompany;
  $("btnPreview").onclick = openPreview;
  $("matSearch").oninput = function () { renderMatList(this.value); };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  $("modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
  window.addEventListener("beforeprint", renderPrint);
  window.addEventListener("afterprint", function () { });

  /* 事件绑完了，最后再渲染 */
  bindMeta(); bindRows(); bindWorkspace();
  renderDatalists(); renderMatList(""); renderLayoutList();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
