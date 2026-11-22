/* ============================================================
   淮海战役 · 指挥界面
   作战序列、部队详情、命令下达、战报、弹窗、回合控制
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const D = HX.Data;
  const E = HX.Engine;
  const R = HX.Render;
  const UI = HX.UI = {};

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  let App = null;
  let oobTab = 'pla';
  let modalOpen = false;
  let toastTimer = null;
  let docCache = null;

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function fmtDate(iso) {
    const p = iso.split('-');
    return p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日';
  }
  function weekday(iso) {
    return WEEK[new Date(iso + 'T00:00:00').getDay()];
  }
  function fmtTroops(n) {
    n = Math.round(n);
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + '千';
    return String(n);
  }
  function pct(v) { return Math.max(0, Math.min(100, v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function barClass(v) { return v < 30 ? 'low' : v < 60 ? 'mid' : ''; }

  UI.init = function (app) {
    App = app;
    if (!UI._bound) {
      bind();
      UI._bound = true;
    }
    refreshAll();
  };

  /* ============================================================
     顶栏 / 状态刷新
     ============================================================ */
  function refreshTop() {
    const s = App.state;
    if (!s) return;
    $('#hud-date').textContent = fmtDate(s.date);
    $('#hud-weekday').textContent = weekday(s.date);
    const w = s.weather || { label: '晴', temp: 12 };
    $('#hud-weather').textContent = w.label + ' ' + w.temp + '°C';
    const ph = E.phaseOf(s);
    $('#hud-phase-tag').textContent = ph.name;
    $('#hud-phase-name').textContent = ph.title;
    const totalDays = 66;
    $('#hud-day').textContent = '第 ' + Math.min(s.day, totalDays) + ' 日 / 共 ' + totalDays + ' 日';
    const prog = Math.max(0, Math.min(1, (s.day - 1) / (totalDays - 1)));
    $('#hud-phase-fill').style.width = (prog * 100).toFixed(1) + '%';

    const pla = s.units.filter(u => u.alive && u.faction === 'pla').reduce((a, u) => a + u.troops, 0);
    const kmt = s.units.filter(u => u.alive && u.faction === 'kmt').reduce((a, u) => a + u.troops, 0);
    $('#hud-pla-troops').textContent = fmtTroops(pla);
    $('#hud-kmt-troops').textContent = fmtTroops(kmt);
    const total = Math.max(1, pla + kmt);
    $('#hud-odds-pla').style.width = (pla / total * 100).toFixed(1) + '%';
    $('#hud-odds-kmt').style.width = (kmt / total * 100).toFixed(1) + '%';

    const cp = $('#hud-cp');
    const maxCp = s.cpMax || 5;
    let pips = '';
    for (let i = 0; i < Math.max(6, maxCp); i++) pips += '<i class="' + (i < s.cp ? 'on' : '') + '"></i>';
    cp.innerHTML = pips;

    $('#btn-exec').disabled = App.busy || s.ended;
    $('#btn-auto').textContent = App.auto ? '暂停推演' : '自动推演';
    $('#btn-auto').classList.toggle('primary', !!App.auto);

    R.setWeather(s.weather ? s.weather.type : 'clear');
    const wl = $('#weather-layer');
    wl.className = s.weather ? s.weather.type : 'clear';

    const hint = hintFor(s);
    const hb = $('#hint-banner');
    if (hint) { hb.textContent = hint; hb.classList.remove('hidden'); }
    else hb.classList.add('hidden');

    $('#oob-summary').innerHTML =
      '<span>我军 ' + s.units.filter(u => u.alive && u.faction === 'pla').length + ' 部</span>' +
      '<span>敌军 ' + s.units.filter(u => u.alive && u.faction === 'kmt').length + ' 部</span>';
  }

  function hintFor(s) {
    if (s.ended) return '';
    if (s.date <= '1948-11-09') return '抢占运河铁桥与曹八集，切断黄百韬西退之路';
    if (s.date <= '1948-11-22') return '四面合围碾庄圩 · 以第7、10、13纵阻击徐州东援之敌';
    if (s.date <= '1948-12-15') return '中野围歼黄维于双堆集 · 华野阻援并相机夺取徐州';
    if (s.date <= '1949-01-05') return '围而不歼，展开政治攻势 · 1月6日总攻陈官庄';
    return '总攻陈官庄，全歼杜聿明集团';
  }

  /* ============================================================
     作战序列
     ============================================================ */
  function groupsFor(faction) {
    const s = App.state;
    const groups = [];
    if (faction === 'pla') {
      const defs = [
        { id: 'huaye', name: '华东野战军', match: u => u.parent !== '中野' && u.parent !== '苏北兵团' && u.parent !== '外线兵团' },
        { id: 'subei', name: '苏北兵团', match: u => u.parent === '苏北兵团' },
        { id: 'waixian', name: '外线兵团', match: u => u.parent === '外线兵团' },
        { id: 'zhongye', name: '中原野战军', match: u => u.parent === '中野' }
      ];
      for (const d of defs) {
        const units = s.units.filter(u => u.faction === 'pla' && d.match(u));
        if (units.length) groups.push({ name: d.name, units });
      }
    } else {
      const map = {};
      for (const u of s.units) {
        if (u.faction !== 'kmt') continue;
        const g = u.group || 'other';
        if (!map[g]) map[g] = { name: (D.groups[g] && D.groups[g].name) || '其他部队', units: [] };
        map[g].units.push(u);
      }
      const order = ['2b', '7b', '7b63', '13b', '16b', '3s', 'xzhq', 'suzhou', '107', '12b', '6b', '8b'];
      for (const key of order) if (map[key]) groups.push(map[key]);
      for (const key of Object.keys(map)) if (order.indexOf(key) < 0) groups.push(map[key]);
    }
    return groups;
  }

  function renderOOB() {
    const s = App.state;
    const list = $('#oob-list');
    if (!s) { list.innerHTML = ''; return; }
    const groups = groupsFor(oobTab);
    let html = '';
    for (const g of groups) {
      const alive = g.units.filter(u => u.alive).length;
      html += '<div class="oob-group"><div class="oob-group-head">' + esc(g.name) +
        '<span class="line"></span><span class="cnt">' + alive + '/' + g.units.length + '</span></div>';
      const sorted = g.units.filter(u => !u.pending).sort((a, b) => (b.alive - a.alive) || (a.hq - b.hq));
      for (const u of sorted) {
        const dead = !u.alive;
        const sel = App.selectedIds.indexOf(u.id) >= 0;
        const dotCls = dead ? 'idle' : (u.encircled ? 'warn' : '');
        const tr = u.maxTroops ? Math.max(0, u.troops / u.maxTroops * 100) : 0;
        html += '<div class="oob-row ' + u.faction + (dead ? ' dead' : '') + (sel ? ' selected' : '') + '" data-id="' + u.id + '">' +
          '<i class="stripe"></i>' +
          '<div class="info"><div class="nm"><b>' + esc(u.short) + '</b><span>' + esc(u.commander || '') + '</span>' +
          (u.alive && u.encircled ? '<span class="badge">围</span>' : '') + '</div>' +
          '<div class="meta"><span class="troops">' + (dead ? '已歼灭' : fmtTroops(u.troops)) + '</span>' +
          '<div class="bar"><i class="' + barClass(tr) + '" style="width:' + tr.toFixed(0) + '%"></i></div>' +
          '<span>' + (dead ? '' : '士气 ' + Math.round(u.morale)) + '</span></div></div>' +
          '<i class="dot ' + dotCls + '"></i></div>';
      }
      html += '</div>';
    }
    list.innerHTML = html;
  }

  /* ============================================================
     右栏
     ============================================================ */
  function selectedUnits() {
    const s = App.state;
    return App.selectedIds.map(id => s.units.find(u => u.id === id)).filter(Boolean);
  }

  function renderRight() {
    const root = $('#right-content');
    const s = App.state;
    if (!s) { root.innerHTML = ''; return; }
    const units = selectedUnits().filter(u => u.alive);
    if (!units.length) { root.innerHTML = renderOverview(); bindRight(); return; }
    const primary = units[0];
    root.innerHTML = (units.length > 1 ? renderMulti(units) : renderUnit(primary)) + renderAbilities();
    bindRight();
  }

  function renderOverview() {
    const s = App.state;
    const ph = E.phaseOf(s);
    const objs = E.objectiveStatus(s, false).filter(o => o.phase === ph.id);
    const done = objs.filter(o => o.done).length;
    const quote = D.quotes[(s.day - 1) % D.quotes.length];
    return '<div class="rc-head"><div class="kicker">战役态势 · ' + esc(ph.name) + '</div>' +
      '<h3>淮海战役</h3><div class="sub">' + fmtDate(D.startDate) + ' — ' + fmtDate(D.endDate) + '</div>' +
      '<div class="faction-stripe"></div></div>' +
      '<div class="phase-card"><div class="pc-tag">' + esc(ph.name) + ' · 目标 ' + done + '/' + objs.length + '</div>' +
      '<div class="pc-name">' + esc(ph.title) + '</div><div class="pc-brief">' + esc(ph.brief) + '</div></div>' +
      '<div class="rc-section"><h4>本阶段作战目标</h4>' +
      objs.map(o => '<div class="objective ' + (o.done ? 'done' : '') + '"><span class="mk">' + (o.done ? '✓' : '') + '</span><span class="txt">' + esc(o.text) + '</span></div>').join('') +
      '</div>' +
      renderAbilities() +
      '<div class="tip">选中一支部队即可下达命令。右键点击地图行军，右键点击敌军攻击。<b>执行本日</b>推进战局。</div>' +
      '<div class="rc-section"><h4>前线引语</h4><div style="font-family:var(--serif);font-size:12px;line-height:1.9;color:var(--ink-dim)">“' + esc(quote.text) + '”<br><span style="color:var(--brass-dim);font-size:10px;letter-spacing:.1em">—— ' + esc(quote.who) + '</span></div></div>';
  }

  function renderUnit(u) {
    const isPla = u.faction === 'pla';
    const parent = u.parent || (u.faction === 'kmt' ? ((D.groups[u.group] || {}).name || '徐州"剿总"') : '华东野战军');
    const objs = [];
    const status = E.statusText(App.state, u);
    const orderName = { move: '行军', attack: '攻击', defend: '防御', fortify: '构筑工事', rest: '休整', retreat: '转进' }[u.order && u.order.type] || '待命';

    let html = '<div class="rc-head ' + (isPla ? '' : 'kmt') + '">' +
      '<div class="kicker">' + esc(parent) + ' · ' + esc(u.echelon || (u.hq ? '司令部' : '部队')) + '</div>' +
      '<h3>' + esc(u.name) + '</h3>' +
      '<div class="sub">' + (u.commander && u.commander !== '—' ? esc(u.commander) + ' · ' : '') + fmtTroops(u.troops) + '人' + (u.hq ? ' · 指挥机构' : '') + '</div>' +
      '<div class="faction-stripe"></div></div>';

    html += '<div class="rc-section"><h4>部队状态</h4><div class="stat-grid">' +
      stat('兵员', u.troops / u.maxTroops * 100, fmtTroops(u.troops), barClass(u.troops / u.maxTroops * 100)) +
      stat('士气', u.morale, Math.round(u.morale), barClass(u.morale)) +
      stat('补给', u.supply, Math.round(u.supply), barClass(u.supply)) +
      stat('弹药', u.ammo, Math.round(u.ammo), barClass(u.ammo)) +
      stat('疲劳', u.fatigue, Math.round(u.fatigue), barClass(100 - u.fatigue)) +
      stat('工事', u.entrench, Math.round(u.entrench), '') +
      '</div>' +
      '<div class="unit-facts">' +
      '<div><span>当前命令</span><b>' + orderName + '</b></div>' +
      '<div><span>状态</span><b>' + esc(status) + '</b></div>' +
      '<div><span>位置</span><b>' + locationText(u) + '</b></div>' +
      '<div><span>类型</span><b>' + (u.type === 'art' ? '炮兵' : u.hq ? '指挥' : '步兵') + '</b></div>' +
      '</div>' +
      (u.encircled ? '<div class="tip" style="margin:12px 0 0;border-left-color:var(--danger)">该部补给线已被切断，粮弹告急，士气将逐日下降。应尽快突围或恢复联系。</div>' : '') +
      (u.note ? '<div class="tip" style="margin:12px 0 0">' + esc(u.note) + '</div>' : '') +
      '</div>';

    if (isPla && !App.state.ended) {
      html += '<div class="rc-section"><h4>下达命令</h4><div class="order-grid">' +
        orderBtn('move', '行军', '行', u.order && u.order.type === 'move') +
        orderBtn('attack', '攻击', '攻', u.order && u.order.type === 'attack', true) +
        orderBtn('defend', '转入防御', '防', u.order && u.order.type === 'defend') +
        orderBtn('fortify', '构筑工事', '工', u.order && u.order.type === 'fortify') +
        orderBtn('rest', '就地休整', '休', u.order && u.order.type === 'rest') +
        orderBtn('retreat', '转进', '退', u.order && u.order.type === 'retreat') +
        '</div><div style="margin-top:8px;font-size:10px;color:var(--ink-faint)">也可右键点击地图行军、右键点击敌军攻击。Shift 多选，拖框框选。</div></div>';
    } else {
      html += '<div class="rc-section"><h4>敌情研判</h4><div class="tip" style="margin:0">' +
        (u.faction === 'kmt' ? '当面之敌。其兵力、士气与补给为我军侦察所得，可能随战局变化。' : '') + '</div></div>';
    }
    return html;
  }

  function renderMulti(units) {
    const troops = units.reduce((a, u) => a + u.troops, 0);
    const morale = units.reduce((a, u) => a + u.morale * u.troops, 0) / Math.max(1, troops);
    const enc = units.filter(u => u.encircled).length;
    return '<div class="rc-head"><div class="kicker">已选部队</div><h3>' + units.length + ' 支部队</h3>' +
      '<div class="sub">合计 ' + fmtTroops(troops) + '人 · 平均士气 ' + Math.round(morale) + (enc ? ' · ' + enc + ' 部被围' : '') + '</div>' +
      '<div class="faction-stripe"></div></div>' +
      '<div class="rc-section"><h4>已选序列</h4>' +
      units.map(u => '<div class="objective"><span class="mk">' + u.short.slice(0, 1) + '</span><span class="txt">' + esc(u.name) + ' · ' + fmtTroops(u.troops) + '</span></div>').join('') +
      '</div>' +
      '<div class="rc-section"><h4>统一命令</h4><div class="order-grid">' +
      orderBtn('move', '行军', '行', false) +
      orderBtn('attack', '攻击', '攻', false, true) +
      orderBtn('defend', '转入防御', '防', false) +
      orderBtn('fortify', '构筑工事', '工', false) +
      orderBtn('rest', '就地休整', '休', false) +
      orderBtn('retreat', '转进', '退', false) +
      '</div></div>';
  }

  function stat(label, val, text, cls) {
    return '<div class="stat"><span class="lbl">' + label + '</span><div class="track"><i class="' + (cls || '') + '" style="width:' + pct(val).toFixed(0) + '%"></i></div><span class="val">' + text + '</span></div>';
  }

  function locationText(u) {
    const c = E.nearestCity(App.state, u.x, u.y, 280);
    if (!c) return Math.round(u.x) + ',' + Math.round(u.y);
    const d = Math.hypot(c.x - u.x, c.y - u.y);
    const km = Math.round(d / 4.56);
    if (km < 3) return c.name;
    const dirs = ['东', '东南', '南', '西南', '西', '西北', '北', '东北'];
    let ang = Math.atan2(u.y - c.y, u.x - c.x);
    ang = (ang + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.round(ang / (Math.PI / 4)) % 8;
    return c.name + dirs[idx] + ' ' + km + ' 公里';
  }
  function orderBtn(id, label, icon, active, attack) {
    return '<button class="order-btn' + (attack ? ' attack' : '') + (active ? ' active' : '') + '" data-order="' + id + '"><span class="ico">' + icon + '</span>' + label + '</button>';
  }

  function renderAbilities() {
    const s = App.state;
    return '<div class="rc-section"><h4>战役行动</h4><div class="ability-list">' +
      E.abilities.map(ab => {
        const cd = s.cooldowns[ab.id] || 0;
        const dateOk = !ab.requireDate || s.date >= ab.requireDate;
        const dis = s.cp < ab.cost || cd > 0 || !dateOk || s.ended;
        let meta = ab.cost + ' CP';
        if (cd > 0) meta = '冷却 ' + cd + ' 日';
        else if (!dateOk) meta = '12月后可用';
        return '<div class="ability' + (dis ? ' disabled' : '') + '" data-ability="' + ab.id + '">' +
          '<span class="an">' + ab.name + '</span><span class="ac">' + meta + '</span>' +
          '<span class="ad">' + ab.desc + '</span></div>';
      }).join('') +
      '</div></div>';
  }

  /* ============================================================
     交互绑定
     ============================================================ */
  function bindRight() {
    $$('#right-content .order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.order;
        const units = selectedUnits().filter(u => u.alive);
        if (!units.length) return;
        if (App.state.ended) return;
        if (type === 'move') {
          startTargeting({ mode: 'move', label: '点击地图指定行军目标' });
        } else if (type === 'attack') {
          startTargeting({ mode: 'attack', label: '点击敌军部队指定攻击目标' });
        } else if (type === 'defend') {
          E.orderDefend(App.state, units.map(u => u.id));
          toast('已下达防御命令');
          refreshAll();
        } else if (type === 'fortify') {
          E.orderFortify(App.state, units.map(u => u.id));
          toast('开始构筑工事');
          refreshAll();
        } else if (type === 'rest') {
          E.orderRest(App.state, units.map(u => u.id));
          toast('部队转入休整');
          refreshAll();
        } else if (type === 'retreat') {
          E.orderRetreat(App.state, units.map(u => u.id));
          toast('部队向后方转进');
          refreshAll();
        }
      });
    });
    $$('#right-content .ability').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('disabled')) {
          toast('该行动当前不可用', 'warn');
          return;
        }
        const id = el.dataset.ability;
        if (id === 'night') {
          const units = selectedUnits().filter(u => u.alive && u.faction === 'pla');
          if (!units.length) { toast('请先选择执行夜间攻击的部队', 'warn'); return; }
          const res = E.useAbility(App.state, 'night', units[0].x, units[0].y, units.map(u => u.id));
          toast(res.msg, res.ok ? '' : 'warn');
          if (res.ok) refreshAll();
        } else {
          startTargeting({ mode: 'ability', ability: id, label: '点击地图选择' + abilityName(id) + '地域' });
        }
      });
    });
  }

  function abilityName(id) {
    return { barrage: '炮火准备', supply: '支前补给', political: '政治攻势' }[id] || '行动';
  }

  function bind() {
    $('#oob-tabs').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      oobTab = btn.dataset.tab;
      $$('#oob-tabs button').forEach(b => b.classList.toggle('active', b === btn));
      renderOOB();
    });
    $('#oob-list').addEventListener('click', e => {
      const row = e.target.closest('.oob-row');
      if (!row) return;
      const u = App.state.units.find(x => x.id === row.dataset.id);
      if (!u) return;
      if (!u.alive) return;
      if (e.shiftKey) toggleSelect(u.id);
      else selectOnly(u.id);
      if (u.faction === 'pla') R.center(u.x, u.y, Math.max(R.cam.zoom, 0.85));
    });
    $('#btn-exec').addEventListener('click', () => App.execute());
    $('#btn-auto').addEventListener('click', () => App.toggleAuto());
    $('#btn-menu').addEventListener('click', showPauseMenu);
    $('#btn-sound').addEventListener('click', function () {
      if (HX.Audio) HX.Audio.toggle();
    });
    const tutSkip = $('#btn-tut-skip');
    if (tutSkip) tutSkip.addEventListener('click', tutorialFinish);
    const tutNext = $('#btn-tut-next');
    if (tutNext) tutNext.addEventListener('click', tutorialFinish);
    $('#btn-log').addEventListener('click', showLogModal);
    $('#btn-log-expand').addEventListener('click', showLogModal);
    $('#btn-doc').addEventListener('click', showDocModal);
    $('#btn-help').addEventListener('click', showHelpModal);
    $('#btn-fit').addEventListener('click', () => { R.fit(); });
    $('#btn-zoom-in').addEventListener('click', () => { R.zoomAt($('#stage').clientWidth / 2, $('#stage').clientHeight / 2, 1.2); });
    $('#btn-zoom-out').addEventListener('click', () => { R.zoomAt($('#stage').clientWidth / 2, $('#stage').clientHeight / 2, 0.83); });
    $('#btn-full').addEventListener('click', toggleFullMap);
    $('#btn-native-full').addEventListener('click', toggleNativeFullscreen);
    $('#btn-center-xz').addEventListener('click', () => { R.center(1336, 478, Math.max(0.9, R.cam.zoom)); });
    $('#btn-center-nz').addEventListener('click', () => { R.center(1562, 442, Math.max(1.0, R.cam.zoom)); });

    bindCanvas();
    bindKeys();
    bindModals();
  }

  /* 开场按钮必须在 UI.init 之前就能响应，否则无法进入战役 */
  function bindBootControls() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.bootBound) return;
      el.dataset.bootBound = '1';
      el.addEventListener('click', fn);
    };
    bind('btn-boot-start', startNewCampaign);
    bind('btn-boot-continue', function () { if (window.HX && HX.App) HX.App.continueLatest(); });
    bind('btn-boot-load', function () { showSaveSlots('load'); });
    bind('boot-save', function () { if (window.HX && HX.App) HX.App.continueLatest(); });
    bind('btn-boot-doc', showDocModal);
    bind('btn-boot-help', showHelpModal);
  }

  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (modalOpen) {
        if (e.key === 'Escape') {
          const backdrop = document.querySelector('.modal-backdrop');
          if (backdrop && backdrop.dataset.closable !== 'false') closeModal();
        }
        return;
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); App.execute(); }
      else if (e.code === 'Space') { e.preventDefault(); App.toggleAuto(); }
      else if (e.key === 'Escape') {
        if (targeting) cancelTargeting();
        else if (App.selectedIds && App.selectedIds.length) App.clearSelection();
        else showPauseMenu();
      }
      else if (e.key === 'f' || e.key === 'F') { toggleFullMap(); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const list = App.state.units.filter(u => u.alive && u.faction === 'pla');
        if (!list.length) return;
        const idx = list.findIndex(u => u.id === App.selectedIds[0]);
        const next = list[(idx + 1) % list.length];
        selectOnly(next.id);
        R.center(next.x, next.y);
      } else if (e.key === 'ArrowLeft' || e.key === 'a') R.pan(28, 0);
      else if (e.key === 'ArrowRight' || e.key === 'd') R.pan(-28, 0);
      else if (e.key === 'ArrowUp' || e.key === 'w') R.pan(0, 28);
      else if (e.key === 'ArrowDown' || e.key === 's') R.pan(0, -28);
    });
  }

  /* ============================================================
     地图输入
     ============================================================ */
  let drag = null;
  let targeting = null;
  let hoverId = null;

  function bindCanvas() {
    const canvas = $('#map');
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('pointerdown', e => {
      if (modalOpen || App.busy || !App.state) return;
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (e.button === 2) {
        drag = { mode: 'pan', sx: x, sy: y, lx: x, ly: y, moved: false };
      } else if (e.button === 0) {
        if (targeting) {
          issueTargeting(x, y, e.shiftKey);
          drag = null;
          return;
        }
        drag = { mode: 'box', sx: x, sy: y, lx: x, ly: y, moved: false };
      }
    });

    canvas.addEventListener('pointermove', e => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      R.setMouse({ x, y });
      const ll = R.screenToLonLat(x, y);
      $('#coord-readout').textContent = fmtLonLat(ll);
      if (!App.state) return;
      if (drag) {
        const dx = x - drag.lx, dy = y - drag.ly;
        if (Math.abs(x - drag.sx) + Math.abs(y - drag.sy) > 4) drag.moved = true;
        if (drag.mode === 'pan' && drag.moved) {
          R.pan(dx, dy);
          canvas.classList.add('dragging');
        } else if (drag.mode === 'box' && drag.moved) {
          R.setBox({ x: drag.sx, y: drag.sy }, { x, y });
        }
        drag.lx = x; drag.ly = y;
      } else {
        const u = R.pickUnit(App.state, x, y);
        hoverId = u ? u.id : null;
        R.setHover(hoverId);
        showTooltip(u, x, y);
      }
    });

    canvas.addEventListener('pointerup', e => {
      if (!drag || !App.state) { drag = null; return; }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const wasPan = drag.mode === 'pan';
      const moved = drag.moved;
      const mode = drag.mode;
      const box = R.box;
      drag = null;
      canvas.classList.remove('dragging');
      R.setBox(null);
      if (App.busy) return;
      if (wasPan) {
        if (!moved) contextOrder(x, y, e.shiftKey);
      } else if (mode === 'box') {
        if (moved && box) boxSelect(box);
        else clickSelect(x, y, e.shiftKey);
      }
    });

    canvas.addEventListener('pointerleave', () => {
      hoverId = null;
      R.setHover(null);
      hideTooltip();
      R.setMouse(null);
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!App.state) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.14 : 0.88;
      R.zoomAt(x, y, factor);
    }, { passive: false });

    canvas.addEventListener('dblclick', e => {
      const rect = canvas.getBoundingClientRect();
      const u = R.pickUnit(App.state, e.clientX - rect.left, e.clientY - rect.top);
      if (u) R.center(u.x, u.y, Math.max(1.1, R.cam.zoom));
    });
  }

  function fmtLonLat(ll) {
    const lon = ll.lon, lat = ll.lat;
    const ldeg = Math.floor(lon), lmin = Math.round((lon - ldeg) * 60);
    const adeg = Math.floor(lat), amin = Math.round((lat - adeg) * 60);
    return ldeg + '°' + String(lmin).padStart(2, '0') + '′E · ' + adeg + '°' + String(amin).padStart(2, '0') + '′N';
  }

  function toggleFullMap() {
    const app = document.getElementById('app');
    app.classList.toggle('map-full');
    setTimeout(() => { R.resize(); R.clampCam(); }, 80);
  }
  UI.toggleFullMap = toggleFullMap;

  function toggleNativeFullscreen() {
    const wv = window.chrome && window.chrome.webview;
    if (wv && typeof wv.postMessage === 'function') {
      wv.postMessage('toggle-fullscreen');
      return;
    }
    const doc = document;
    const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!fsEl) {
      const el = doc.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        try { req.call(el); } catch (e) { }
      }
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) { try { exit.call(doc); } catch (e) { } }
    }
  }

  function clickSelect(x, y, additive) {
    const u = R.pickUnit(App.state, x, y);
    hideTooltip();
    if (!u) { if (!additive) App.clearSelection(); return; }
    if (u.faction === 'pla') {
      if (additive) toggleSelect(u.id); else selectOnly(u.id);
    } else {
      selectOnly(u.id);
      showEnemyPing(u);
    }
  }

  function boxSelect(box) {
    if (!box) return;
    const a = R.screenToWorld(box.a.x, box.a.y);
    const b = R.screenToWorld(box.b.x, box.b.y);
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    const ids = App.state.units.filter(u => u.alive && u.faction === 'pla' &&
      u.x >= x1 && u.x <= x2 && u.y >= y1 && u.y <= y2).map(u => u.id);
    if (ids.length) { App.selectedIds = ids; refreshAll(); tutorialOnSelect(); }
    else App.clearSelection();
  }

  function contextOrder(x, y, quick) {
    const s = App.state;
    if (!App.selectedIds.length) return;
    const u = R.pickUnit(s, x, y);
    if (u && u.faction === 'kmt') {
      if (quick) attackNow(App.selectedIds, u);
      else showAttackPreview(App.selectedIds, u.id);
    } else if (u && u.faction === 'pla') {
      App.selectedIds = [u.id];
      refreshAll();
      tutorialOnSelect();
    } else {
      const w = R.screenToWorld(x, y);
      const n = E.orderMove(s, App.selectedIds, w.x, w.y);
      if (n) {
        toast('已令 ' + n + ' 部向指定地域行军');
        if (HX.Audio) HX.Audio.order();
        tutorialOnOrder('move');
        R.invalidateReach();
        refreshAll();
      }
    }
  }

  function attackNow(ids, target) {
    const n = E.orderAttack(App.state, ids, target.id);
    if (n) {
      toast('已令 ' + n + ' 部攻击 ' + target.short);
      if (HX.Audio) HX.Audio.order();
      tutorialOnOrder('attack');
      R.invalidateReach();
      refreshAll();
    } else {
      toast('命令未能下达', 'warn');
    }
    return n;
  }

  function showAttackPreview(ids, targetId) {
    const s = App.state;
    const target = E.unitById(s, targetId);
    const p = E.previewCombat(s, ids, targetId);
    if (!target || !p) {
      toast('无法预估这次攻击', 'warn');
      return;
    }
    const names = p.attackers.map(a => a.short).join('、');
    const avg = (list, key) => list.length ? list.reduce((n, u) => n + u[key], 0) / list.length : 0;
    const factorHtml = p.factors.length
      ? p.factors.map(f => '<span class="ap-chip ' + (f.tone || '') + '">' + esc(f.label) +
        (f.value ? ' <b>' + esc(f.value) + '</b>' : '') + '</span>').join('')
      : '<span class="ap-chip">无明显修正</span>';
    const warnHtml = p.warnings.length
      ? '<div class="ap-warn">' + p.warnings.map(w => '· ' + esc(w)).join('<br>') + '</div>'
      : '';
    const note = p.allEngaged ? '' :
      '<div class="ap-note">部分部队尚未接敌，以上按当前兵力与地形估算；实际战斗将在接敌后发生。</div>';
    const body =
      '<div class="ap-head">' +
      '<div class="ap-army"><span class="ap-side pla">我军</span><b>' + esc(names) + '</b></div>' +
      '<div class="ap-vs">对</div>' +
      '<div class="ap-army"><span class="ap-side kmt">敌军</span><b>' + esc(target.short) + '</b></div>' +
      '</div>' +
      '<div class="ap-verdict ' + (p.ratio >= 1.35 ? 'good' : p.ratio < 0.85 ? 'bad' : '') + '">' +
      esc(p.verdict) + '<span>战力比 ' + p.ratio.toFixed(2) + ' : 1</span></div>' +
      '<div class="ap-power"><div class="ap-bar"><i class="pla" style="width:' +
      (p.Ap / Math.max(1, p.Ap + p.Dp) * 100).toFixed(1) + '%"></i><i class="kmt" style="width:' +
      (p.Dp / Math.max(1, p.Ap + p.Dp) * 100).toFixed(1) + '%"></i></div>' +
      '<div class="ap-power-num"><span>我军战力 ' + p.Ap.toFixed(1) + '</span><span>敌军战力 ' + p.Dp.toFixed(1) + '</span></div></div>' +
      '<div class="ap-loss">' +
      '<div><span>预计敌军损失</span><b>' + fmtTroops(Math.round(p.defLossMin)) + ' – ' + fmtTroops(Math.round(p.defLossMax)) + '</b></div>' +
      '<div><span>预计我军损失</span><b>' + fmtTroops(Math.round(p.atkLossMin)) + ' – ' + fmtTroops(Math.round(p.atkLossMax)) + '</b></div>' +
      '</div>' +
      '<div class="ap-stats">' +
      '<span>我军 士气 ' + Math.round(avg(p.attackers, 'morale')) + ' · 补给 ' + Math.round(avg(p.attackers, 'supply')) + ' · 疲劳 ' + Math.round(avg(p.attackers, 'fatigue')) + '</span>' +
      '<span>敌军 士气 ' + Math.round(target.morale) + ' · 补给 ' + Math.round(target.supply) + ' · 工事 ' + Math.round(target.entrench) + '</span>' +
      '</div>' +
      '<div class="ap-factors">' + factorHtml + '</div>' + warnHtml + note +
      '<div class="ap-note">按住 Shift 右键可直接下达攻击令，跳过预估。</div>';

    UI.showModal({
      kicker: '作战预估 · 攻击',
      title: '攻击 ' + target.short,
      sub: '第 ' + s.day + ' 日 · ' + ((E.nearestCity(s, target.x, target.y, 40) || {}).name || '野外'),
      width: 'wide',
      closable: true,
      body: body,
      actions: [
        { label: '取消' },
        { label: '下达攻击令', primary: true, onClick: function () { attackNow(ids, target); } }
      ]
    });
  }
  UI.showAttackPreview = showAttackPreview;

  function issueTargeting(x, y, quick) {
    const s = App.state;
    const w = R.screenToWorld(x, y);
    if (!targeting) return;
    if (targeting.mode === 'move') {
      const ids = App.selectedIds;
      if (!ids.length) { cancelTargeting(); return; }
      const n = E.orderMove(s, ids, w.x, w.y);
      toast(n ? '已令 ' + n + ' 部行军' : '命令未能下达', n ? '' : 'warn');
      if (n) {
        if (HX.Audio) HX.Audio.order();
        tutorialOnOrder('move');
      }
    } else if (targeting.mode === 'attack') {
      const u = R.pickUnit(s, x, y);
      if (!u || u.faction !== 'kmt') { toast('请点击敌军部队', 'warn'); return; }
      if (quick) {
        attackNow(App.selectedIds, u);
      } else {
        cancelTargeting();
        showAttackPreview(App.selectedIds, u.id);
        return;
      }
    } else if (targeting.mode === 'ability') {
      const ids = App.selectedIds;
      const res = E.useAbility(s, targeting.ability, w.x, w.y, ids);
      toast(res.msg, res.ok ? '' : 'warn');
      if (!res.ok) return;
    }
    cancelTargeting();
    R.invalidateReach();
    refreshAll();
  }

  function startTargeting(t) {
    targeting = t;
    $('#map').classList.add('targeting');
    const banner = $('#target-banner');
    banner.textContent = t.label + ' · 按 Esc 取消';
    banner.classList.remove('hidden');
  }
  function cancelTargeting() {
    targeting = null;
    $('#map').classList.remove('targeting');
    $('#target-banner').classList.add('hidden');
  }
  UI.startTargeting = startTargeting;
  UI.cancelTargeting = cancelTargeting;

  /* ---------------- 悬停提示 ---------------- */
  function showTooltip(u, x, y) {
    const tip = $('#map-tooltip');
    if (!u) { hideTooltip(); return; }
    const isPla = u.faction === 'pla';
    tip.innerHTML = '<div class="tt-title">' + esc(u.name) + '</div>' +
      '<div class="tt-sub">' + esc(u.commander || '') + (u.hq ? ' · 指挥机构' : '') + '</div>' +
      '<div class="tt-row"><span>兵力</span><span>' + fmtTroops(u.troops) + '</span></div>' +
      '<div class="tt-row"><span>士气 / 补给</span><span>' + Math.round(u.morale) + ' / ' + Math.round(u.supply) + '</span></div>' +
      '<div class="tt-row"><span>工事 / 疲劳</span><span>' + Math.round(u.entrench) + ' / ' + Math.round(u.fatigue) + '</span></div>' +
      '<div class="tt-row"><span>状态</span><span style="color:' + (u.encircled ? '#e0836c' : isPla ? '#cbd6b2' : '#a9c4dc') + '">' + esc(E.statusText(App.state, u)) + '</span></div>';
    tip.classList.remove('hidden');
    const rect = $('#stage').getBoundingClientRect();
    let left = x + 18, top = y + 16;
    if (left + 210 > rect.width) left = x - 200;
    if (top + 140 > rect.height) top = y - 130;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTooltip() { $('#map-tooltip').classList.add('hidden'); }

  function showEnemyPing(u) {
    // 选中敌军时轻微提示
    toast('敌 ' + u.short + ' · ' + fmtTroops(u.troops) + '人 · 士气 ' + Math.round(u.morale));
  }

  /* ============================================================
     选择
     ============================================================ */
  function selectOnly(id) {
    App.selectedIds = [id];
    refreshAll();
    tutorialOnSelect();
  }
  function toggleSelect(id) {
    const i = App.selectedIds.indexOf(id);
    if (i >= 0) App.selectedIds.splice(i, 1);
    else App.selectedIds.push(id);
    refreshAll();
    tutorialOnSelect();
  }
  UI.selectOnly = selectOnly;

  /* ============================================================
     刷新
     ============================================================ */
  UI.refreshAll = refreshAll;
  function refreshAll() {
    if (!App || !App.state) return;
    refreshTop();
    renderOOB();
    renderRight();
    renderLogFeed();
    R.setSelected(selectedUnits().filter(u => u.alive));
  }
  UI.refresh = refreshAll;

  function renderLogFeed() {
    const s = App.state;
    const feed = $('#log-feed');
    const entries = s.log.slice(-40);
    const last = entries.slice(-8);
    feed.innerHTML = last.map(l =>
      '<div class="log-line ' + l.type + '"><span class="ld">' + l.date.slice(5).replace('-', '.') + '</span><i class="lm"></i><span class="lt">' + esc(l.text) + '</span></div>'
    ).join('');
    feed.scrollTop = feed.scrollHeight;
  }

  /* ============================================================
     弹窗
     ============================================================ */
  function bindModals() {
    if (bindModals.done) return;
    bindModals.done = true;
    $('#modal-root').addEventListener('click', e => {
      if (e.target.classList.contains('modal-backdrop') && e.target.dataset.closable !== 'false') closeModal();
      const close = e.target.closest('[data-close]');
      if (close) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !modalOpen) return;
      const backdrop = document.querySelector('.modal-backdrop');
      if (backdrop && backdrop.dataset.closable !== 'false') closeModal();
    });
  }

  UI.showModal = function (opts) {
    const root = $('#modal-root');
    const width = opts.width ? ' ' + opts.width : '';
    root.innerHTML = '<div class="modal-backdrop" data-closable="' + (opts.closable === false ? 'false' : 'true') + '">' +
      '<div class="modal' + width + '">' +
      '<div class="modal-head"><div><div class="kicker">' + esc(opts.kicker || '') + '</div>' +
      '<h2>' + esc(opts.title || '') + '</h2>' +
      (opts.sub ? '<div class="sub">' + esc(opts.sub) + '</div>' : '') + '</div>' +
      (opts.closable === false ? '' : '<button class="modal-close" data-close="1">×</button>') +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.actions && opts.actions.length ? '<div class="modal-actions">' + opts.actions.map((a, i) =>
        '<button class="btn ' + (a.primary ? 'primary' : 'ghost') + '" data-act="' + i + '">' + esc(a.label) + '</button>').join('') + '</div>' : '') +
      '</div></div>';
    root.classList.add('active');
    modalOpen = true;
    $$('#modal-root [data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = opts.actions[+btn.dataset.act];
        if (a && a.onClick) a.onClick();
        if (!a || a.keepOpen !== true) closeModal();
      });
    });
    if (opts.onMount) opts.onMount(root);
  };

  function closeModal() {
    const root = $('#modal-root');
    root.classList.remove('active');
    root.innerHTML = '';
    modalOpen = false;
    if (App && App.onModalClosed) App.onModalClosed();
  }
  UI.closeModal = closeModal;
  UI.isModalOpen = function () { return modalOpen; };

  /* ---------------- 命令原文 ---------------- */
  function showDocModal() {
    const doc = D.orderDoc;
    if (!docCache) docCache = buildDocBody(doc);
    UI.showModal({
      kicker: '战史档案 · 一级密件',
      title: '作战命令原文',
      sub: doc.title + doc.subtitle + ' · ' + doc.date,
      width: 'wide',
      body: docCache,
      actions: [{ label: '收起档案', primary: false }]
    });
  }
  function buildDocBody(doc) {
    return '<div class="doc-grid"><div class="doc-scan">' +
      '<img src="' + doc.image + '" alt="华东野战军淮海战役攻击命令影印">' +
      '<div class="cap"><span>华东野战军淮海战役攻击命令（节选）</span><span>1948.11.4 · 可滚动阅读</span></div></div>' +
      '<div class="doc-text"><div class="doc-h">' + doc.title + '</div><div class="doc-d">' + doc.subtitle + ' · ' + doc.date + '</div>' +
      doc.paragraphs.map(p => '<p>' + (p.key ? '<span class="key">（' + p.key + '）</span>' : '') + esc(p.text) + '</p>').join('') +
      '<div class="sig">' + doc.signature.map(s => esc(s)).join('<br>') + '</div>' +
      '<div class="note">' + esc(doc.notes) + '</div>' +
      '<p class="muted" style="margin-top:14px;text-indent:0">本页图片为工作区内《文章.jpg》所示史料影印。命令原文个别字句因影印模糊，按通行史料校订。</p>' +
      '</div></div>';
  }

  /* ---------------- 作战手册 ---------------- */
  function showHelpModal() {
    UI.showModal({
      kicker: '指挥员必读',
      title: '作战手册',
      sub: '淮海战役沙盘 · 操作与规则',
      width: 'narrow',
      body: D.help.sections.map(s => '<h3>' + esc(s.h) + '</h3><p>' + esc(s.p) + '</p>').join('') +
        '<h3>胜负评定</h3><p>战役结束时按三个阶段目标的达成度、歼敌数量与自身伤亡评定战果，并与历史结果对照。</p>',
      actions: [
        {
          label: '重看新手引导', keepOpen: true, onClick: function () {
            closeModal();
            if (App && App.state && App.started) tutorialStart(true);
            else toast('进入战役后可重看引导', 'warn');
          }
        },
        { label: '明白', primary: true }
      ]
    });
  }

  /* ---------------- 战役简报 ---------------- */
  UI.showBriefing = function () {
    const b = D.briefing;
    UI.showModal({
      kicker: '战役简报 · 绝密',
      title: b.title,
      sub: '1948年11月6日 · 徐州—蚌埠',
      closable: false,
      width: 'wide',
      body: '<p class="lead">' + esc(b.situation[0]) + '</p>' +
        '<p>' + esc(b.situation[1]) + '</p>' +
        '<div class="modal-cols"><div><h3>作战任务</h3><ul>' + b.orders.map(o => '<li>' + esc(o) + '</li>').join('') + '</ul></div>' +
        '<div><h3>敌情要点</h3><ul><li>黄百韬第7兵团约12万人，正由新安镇西移。</li><li>李弥第13兵团控制曹八集、碾庄、运河车站。</li><li>邱清泉第2兵团、孙元良第16兵团在徐州以西。</li><li>黄维第12兵团正由阜阳东进。</li></ul></div></div>' +
        '<div class="tip" style="margin:18px 0 0">' + esc(b.tip) + '</div>',
      actions: [
        { label: '先看命令原文', keepOpen: true, onClick: showDocModal },
        { label: '开始指挥作战', primary: true }
      ]
    });
  };

  /* ---------------- 战报 ---------------- */
  function showLogModal() {
    const s = App.state;
    if (!s) return;
    tutorialOnLog();
    let html = '<div class="battlelog">';
    let lastDate = '';
    const icon = { combat: '⚔', victory: '★', loss: '✖', history: '◈', enemy: '◆', order: '▲', info: '·', objective: '✓' };
    for (const l of s.log) {
      if (l.date !== lastDate) {
        html += '<div class="day-sep">' + fmtDate(l.date) + '</div>';
        lastDate = l.date;
      }
      html += '<div class="bl ' + l.type + '"><span class="ic">' + (icon[l.type] || '·') + '</span><span>' + esc(l.text) + '</span></div>';
    }
    html += '</div>';
    UI.showModal({
      kicker: '作战记录',
      title: '战报 · ' + fmtDate(s.date),
      sub: '自战役发起以来的全部作战通报',
      width: 'wide',
      body: html,
      actions: [{ label: '关闭', primary: false }]
    });
  }

  /* ============================================================
     存档 / 菜单
     ============================================================ */
  function formatSavedAt(ms) {
    try {
      return new Date(ms).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (e) {
      return '';
    }
  }

  function updateBootSaves() {
    const cont = document.getElementById('btn-boot-continue');
    const load = document.getElementById('btn-boot-load');
    const start = document.getElementById('btn-boot-start');
    const box = document.getElementById('boot-save');
    if (!cont || !start || !load || !box) return;
    const latest = HX.Save ? HX.Save.latest() : null;
    if (latest) {
      cont.classList.remove('hidden');
      cont.disabled = false;
      cont.textContent = latest.entry.meta.ended ? '查看战果' : '继续战役';
      start.textContent = '开始新的战役';
      start.classList.remove('primary');
      start.classList.add('ghost');
      load.classList.remove('hidden');
      box.classList.remove('hidden');

      const thumb = document.getElementById('boot-save-thumb');
      if (latest.entry.thumb) {
        thumb.src = latest.entry.thumb;
        thumb.style.display = '';
      } else {
        thumb.removeAttribute('src');
        thumb.style.display = 'none';
      }
      const display = HX.Save.displayName(latest.entry);
      const slotLabel = latest.slot === 'auto' ? '自动存档' : (latest.entry.meta.label || '手动存档');
      document.getElementById('boot-save-kicker').textContent =
        slotLabel + ' · ' + formatSavedAt(latest.entry.savedAt);
      document.getElementById('boot-save-title').textContent = latest.entry.meta.ended
        ? display + ' · 战役已结束'
        : display;
      document.getElementById('boot-save-meta').textContent =
        fmtDate(latest.entry.meta.date) + ' · ' + latest.entry.meta.phase +
        ' · 我军 ' + fmtTroops(latest.entry.meta.pla) + ' · 敌军 ' + fmtTroops(latest.entry.meta.kmt) +
        ' · 第 ' + latest.entry.meta.day + ' 日';
    } else {
      cont.classList.add('hidden');
      cont.disabled = true;
      start.textContent = '开始指挥';
      start.classList.remove('ghost');
      start.classList.add('primary');
      load.classList.add('hidden');
      box.classList.add('hidden');
    }
  }
  UI.updateBootSaves = updateBootSaves;

  function startNewCampaign() {
    const latest = HX.Save ? HX.Save.latest() : null;
    const hasCurrent = !!(window.HX && HX.App && HX.App.state && HX.App.started);
    if (latest || hasCurrent) {
      confirmAction('开始新的战役',
        '新的战役会覆盖自动存档；已有手动存档会保留。确定开始吗？',
        function () {
          closeModal();
          if (window.HX && HX.App) HX.App.newGame();
        });
    } else if (window.HX && HX.App) {
      HX.App.newGame();
    }
  }

  function confirmAction(title, text, onYes, onCancel) {
    UI.showModal({
      kicker: '请确认',
      title: title,
      width: 'narrow',
      closable: true,
      body: '<div class="choice-text">' + esc(text) + '</div>',
      actions: [
        {
          label: '取消', keepOpen: true, onClick: function () {
            closeModal();
            if (onCancel) onCancel();
          }
        },
        {
          label: '确定', primary: true, keepOpen: true, onClick: function () {
            if (onYes) onYes();
          }
        }
      ]
    });
  }

  function promptSaveName(opts) {
    function submit() {
      const input = document.getElementById('save-name-input');
      const raw = input ? input.value : '';
      const name = String(raw).replace(/\s+/g, ' ').trim().slice(0, 30);
      if (!name) {
        toast('请输入存档名称', 'warn');
        if (input) { input.focus(); }
        return;
      }
      if (opts.onOk) opts.onOk(name);
    }

    UI.showModal({
      kicker: '存档命名',
      title: opts.title || '命名存档',
      sub: opts.sub || '',
      width: 'narrow',
      closable: true,
      body:
        '<div class="name-form">' +
        '<label for="save-name-input">存档名称</label>' +
        '<input id="save-name-input" class="name-input" maxlength="30" autocomplete="off" spellcheck="false" value="' + esc(opts.value || '') + '">' +
        '<div class="name-hint">最多 30 个字符；之后可在存档管理中随时重命名。</div>' +
        '</div>',
      actions: [
        {
          label: '取消', keepOpen: true, onClick: function () {
            closeModal();
            if (opts.onCancel) opts.onCancel();
          }
        },
        { label: '确定', primary: true, keepOpen: true, onClick: submit }
      ],
      onMount: function (root) {
        const input = root.querySelector('#save-name-input');
        if (!input) return;
        input.focus();
        input.select();
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            submit();
          }
        });
      }
    });
  }

  function showPauseMenu() {
    if (!App || !App.state) return;
    if (App.busy) { toast('作战推演中，请稍候', 'warn'); return; }
    if (App.auto) {
      App.auto = false;
      clearTimeout(App.autoTimer);
      refreshAll();
    }
    const s = App.state;
    const ph = E.phaseOf(s);
    const latest = HX.Save ? HX.Save.latest() : null;
    const last = latest
      ? HX.Save.displayName(latest.entry) + ' · ' + formatSavedAt(latest.entry.savedAt)
      : '尚无存档';
    UI.showModal({
      kicker: '战役菜单 · 暂停',
      title: '战役指挥',
      sub: fmtDate(s.date) + ' · ' + ph.name + ' · ' + ph.title,
      width: 'narrow',
      closable: true,
      body:
        '<div class="menu-grid">' +
        '<button class="menu-btn wide primary" data-menu="resume"><span>继续游戏</span><span class="k">ESC</span></button>' +
        '<button class="menu-btn" data-menu="save"><span>保存进度</span><span class="k">存档</span></button>' +
        '<button class="menu-btn" data-menu="load"><span>读取存档</span><span class="k">读档</span></button>' +
        '<button class="menu-btn" data-menu="menu"><span>返回主菜单</span><span class="k">自动存档</span></button>' +
        '<button class="menu-btn danger" data-menu="quit"><span>退出游戏</span><span class="k">自动存档</span></button>' +
        '</div>' +
        '<div class="pause-meta">最近存档：' + esc(last) + '<br>自动存档在每回合结束时、返回主菜单与退出游戏时更新。</div>',
      onMount: function (root) {
        root.querySelectorAll('[data-menu]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const act = btn.dataset.menu;
            if (act === 'resume') {
              closeModal();
            } else if (act === 'save') {
              showSaveSlots('save');
            } else if (act === 'load') {
              showSaveSlots('load');
            } else if (act === 'menu') {
              confirmAction('返回主菜单', '当前进度会自动存档，可随时继续。确定返回主菜单吗？',
                function () {
                  closeModal();
                  App.quitToMenu();
                },
                function () { showPauseMenu(); });
            } else if (act === 'quit') {
              confirmAction('退出游戏', '当前进度会自动存档。确定退出游戏吗？',
                function () { App.quitGame(); },
                function () { showPauseMenu(); });
            }
          });
        });
      }
    });
  }
  UI.showPauseMenu = showPauseMenu;

  function showSaveSlots(mode) {
    if (!HX.Save) return;
    const isSave = mode === 'save';
    const available = HX.Save.available();
    const slots = HX.Save.list();
    let html = '<div class="save-note">' +
      (isSave
        ? '保存时会为存档命名；自动存档每回合结束更新，手动存档可长期保留。存档保存在本机浏览器 / 桌面版数据中。'
        : '读取存档会覆盖当前进度；读取前当前进度会先写入自动存档。每个存档都可以重命名。') +
      '</div>';
    if (!available) {
      html += '<div class="save-note" style="border-left-color:var(--danger);color:#e0a08d">当前环境禁用了本地存储，无法读取或写入存档。请使用桌面版，或在浏览器设置中允许本地存储。</div>';
    }
    html += '<div class="slot-grid">';
    for (const slot of slots) {
      const e = slot.entry;
      const auto = slot.slot === 'auto';
      const thumb = (e && e.thumb)
        ? '<img class="slot-thumb" src="' + e.thumb + '" alt="">'
        : '<div class="slot-thumb empty">' + (e ? '无缩略图' : (auto ? '自动存档槽位' : '空存档位')) + '</div>';
      const display = e ? HX.Save.displayName(e) : slot.label;
      html += '<div class="slot-card' + (auto ? ' auto' : '') + (e ? '' : ' empty') + '">' + thumb +
        '<div class="slot-body"><div class="slot-title"><span class="slot-name">' + esc(display) + '</span>' +
        (auto ? '<span class="tag">自动</span>' : (e ? '<span class="tag">' + esc(slot.label) + '</span>' : '')) +
        (e && e.meta.ended ? '<span class="tag">已结束</span>' : '') +
        '</div>' +
        (e
          ? '<div class="slot-meta">' + fmtDate(e.meta.date) + ' · ' + esc(e.meta.phase) +
            '<br>我军 <b>' + fmtTroops(e.meta.pla) + '</b> · 敌军 <b>' + fmtTroops(e.meta.kmt) + '</b>' +
            '<br>' + formatSavedAt(e.savedAt) + (auto ? '<br>每回合自动写入' : '') + '</div>'
          : '<div class="slot-meta">尚未保存</div>') +
        '</div><div class="slot-actions">';
      if (e) {
        if (isSave && !auto) {
          html += '<button class="btn small" data-slot="' + slot.slot + '" data-act="save">覆盖保存</button>';
        }
        html += '<button class="btn small" data-slot="' + slot.slot + '" data-act="load">读取</button>';
        html += '<button class="btn small" data-slot="' + slot.slot + '" data-act="rename">重命名</button>';
        html += '<button class="btn small danger" data-slot="' + slot.slot + '" data-act="delete">删除</button>';
      } else if (isSave && !auto) {
        html += '<button class="btn small" data-slot="' + slot.slot + '" data-act="save">保存到此槽</button>';
      } else {
        html += '<button class="btn small" disabled>空</button>';
      }
      html += '</div></div>';
    }
    html += '</div>';

    function doSave(slotId, name) {
      const label = HX.Save.SLOT_LABELS[slotId] || slotId;
      const r = HX.Save.save(slotId, { name: name, label: label });
      if (r.ok) {
        closeModal();
        toast('已保存「' + name + '」');
        updateBootSaves();
        setTimeout(function () { showSaveSlots('save'); }, 0);
      } else {
        toast(r.msg || '保存失败', 'warn');
      }
    }

    function askName(slotId, existing) {
      const label = HX.Save.SLOT_LABELS[slotId] || slotId;
      const def = existing
        ? HX.Save.displayName(existing)
        : (label + ' · ' + (App && App.state ? fmtDate(App.state.date) : '当前进度'));
      promptSaveName({
        title: existing ? '命名并覆盖存档' : '命名存档',
        sub: '存档位「' + label + '」',
        value: def,
        onOk: function (name) { doSave(slotId, name); },
        onCancel: function () { showSaveSlots('save'); }
      });
    }

    function onSave(slotId) {
      const existing = HX.Save.get(slotId);
      const label = HX.Save.SLOT_LABELS[slotId] || slotId;
      if (existing) {
        const display = HX.Save.displayName(existing);
        confirmAction('覆盖存档', '存档位「' + label + '」已有存档「' + display + '」，保存会覆盖它。',
          function () {
            askName(slotId, existing);
          },
          function () { showSaveSlots('save'); });
      } else {
        askName(slotId, null);
      }
    }

    function onRename(slotId) {
      const e = HX.Save.get(slotId);
      if (!e) return;
      const label = HX.Save.SLOT_LABELS[slotId] || slotId;
      promptSaveName({
        title: '重命名存档',
        sub: '存档位「' + label + '」',
        value: HX.Save.displayName(e),
        onOk: function (name) {
          const r = HX.Save.rename(slotId, name);
          if (r.ok) {
            closeModal();
            toast('已重命名为「' + name + '」');
            updateBootSaves();
            setTimeout(function () { showSaveSlots(mode); }, 0);
          } else {
            toast(r.msg || '重命名失败', 'warn');
          }
        },
        onCancel: function () { showSaveSlots(mode); }
      });
    }

    function onLoad(slotId) {
      const e = HX.Save.get(slotId);
      if (!e) return;
      const label = HX.Save.displayName(e);
      const doIt = function () {
        closeModal();
        const r = HX.Save.loadSlot(slotId);
        if (!r.ok) toast(r.msg || '读取失败', 'warn');
        else toast('已读取「' + label + '」');
      };
      if (App && App.state && App.started) {
        confirmAction('读取存档', '读取「' + label + '」会覆盖当前进度；读取前的进度会先写入自动存档。',
          doIt,
          function () { showSaveSlots('load'); });
      } else {
        doIt();
      }
    }

    function onDelete(slotId) {
      const e = HX.Save.get(slotId);
      const display = e ? HX.Save.displayName(e) : (HX.Save.SLOT_LABELS[slotId] || slotId);
      confirmAction('删除存档', '确定删除「' + display + '」吗？此操作不可恢复。',
        function () {
          const r = HX.Save.delete(slotId);
          closeModal();
          if (r.ok) {
            toast('已删除「' + display + '」');
            updateBootSaves();
            setTimeout(function () { showSaveSlots(mode); }, 0);
          } else {
            toast(r.msg || '删除失败', 'warn');
          }
        },
        function () { showSaveSlots(mode); });
    }

    UI.showModal({
      kicker: '存档管理',
      title: isSave ? '保存进度' : '读取存档',
      sub: isSave ? '选择一个存档位保存当前战役' : '选择一个存档继续战役',
      width: 'wide',
      closable: true,
      body: html,
      actions: [{ label: '返回', primary: false }],
      onMount: function (root) {
        root.querySelectorAll('[data-slot]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const slotId = btn.dataset.slot;
            const act = btn.dataset.act;
            if (act === 'save') onSave(slotId);
            else if (act === 'load') onLoad(slotId);
            else if (act === 'rename') onRename(slotId);
            else if (act === 'delete') onDelete(slotId);
          });
        });
      }
    });
  }
  UI.showSaveSlots = showSaveSlots;


  UI.showChoice = function (choice) {
    UI.showModal({
      kicker: '中央军委指示 · 抉择',
      title: choice.title,
      closable: false,
      width: 'narrow',
      body: '<div class="choice-text">' + esc(choice.text) + '</div><div class="choice-opts">' +
        choice.options.map(o => '<button class="choice-opt" data-opt="' + o.id + '"><div class="co-t">' + esc(o.label) + '</div><div class="co-d">' + esc(o.desc) + '</div></button>').join('') +
        '</div>',
      onMount: (root) => {
        $$('#modal-root [data-opt]').forEach(btn => {
          btn.addEventListener('click', () => {
            E.choose(App.state, btn.dataset.opt);
            closeModal();
            toast(btn.dataset.opt === 'political' ? '转入政治攻势，围而不歼' : '全军立即总攻');
            refreshAll();
          });
        });
      }
    });
  };

  /* ---------------- 战果 ---------------- */
  UI.showResult = function () {
    const s = App.state;
    const r = s.result || E.resultOf(s);
    const hist = r.historical;
    const ratio = r.kmtLoss / Math.max(1, r.plaLoss);
    const days = Math.min(66, s.day);
    if (HX.Audio) HX.Audio.result(r.grade === 'S' || r.grade === 'A' || r.grade === 'B' || r.grade === 'C');
    UI.showModal({
      kicker: '战役终结 · 战果评定',
      title: '淮海战役 · ' + r.title,
      sub: fmtDate(D.startDate) + ' — ' + fmtDate(s.date),
      closable: false,
      width: 'wide',
      body: '<div class="result-grade"><div class="grade">' + esc(r.grade) + '</div>' +
        '<div><div class="rt">' + esc(r.title) + '</div><div class="rs">历时 ' + days + ' 日 · 交换比 ' + ratio.toFixed(2) + ' : 1 · 作战目标 ' + r.objectives + '/' + r.objectiveTotal + '</div></div></div>' +
        '<div class="result-grid">' +
        '<div><div class="k">歼灭国民党军</div><div class="v">' + fmtTroops(r.kmtLoss) + '<small> 人</small></div></div>' +
        '<div><div class="k">我军伤亡</div><div class="v">' + fmtTroops(r.plaLoss) + '<small> 人</small></div></div>' +
        '<div><div class="k">起义 / 投诚</div><div class="v">' + fmtTroops(r.defected) + '<small> 人</small></div></div>' +
        '<div><div class="k">攻占城镇</div><div class="v">' + r.cities + '<small> 座</small></div></div>' +
        '</div>' +
        '<h3>与历史结果对照</h3><div class="hist-compare">' +
        compareRow('歼敌', r.kmtLoss, hist.kmt, false) +
        compareRow('我伤亡', r.plaLoss, hist.pla, true) +
        '</div>' +
        '<p class="muted">历史：解放军以约13.6万人的伤亡，歼灭国民党军55.5万人，歼敌5个兵团、22个军、56个师。陈毅说：“淮海战役的胜利，是人民群众用小车推出来的。”</p>',
      actions: [
        { label: '查看战报', keepOpen: true, onClick: showLogModal },
        { label: '再打一仗', primary: true, onClick: () => { closeModal(); App.restart(); } }
      ]
    });
  };
  function compareRow(label, val, hist, brass) {
    const mx = Math.max(val, hist) || 1;
    return '<div class="hc-row"><span>' + label + '</span>' +
      '<div class="bar"><i class="' + (brass ? 'brass' : '') + '" style="width:' + (val / mx * 100) + '%"></i></div>' +
      '<span class="num">' + fmtTroops(val) + ' / ' + fmtTroops(hist) + '</span></div>';
  }

  /* ---------------- 提示 ---------------- */
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = type || '';
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  UI.toast = toast;

  /* ============================================================
     新手引导
     ============================================================ */
  const TUT_KEY = 'huaihai1948.tutorial.v1';
  const TUT_STEPS = [
    {
      title: '第 1 步 · 选中一支部队',
      text: '左键点击地图上的我军标号，或点击左栏作战序列中的一支部队。',
      hint: '先选 1 纵或 4 纵都可以。'
    },
    {
      title: '第 2 步 · 下达第一条命令',
      text: '右键点击地图上的空地行军。右键点击国民党军，会先弹出攻击预估，确认后再下达攻击令。',
      hint: '目标：向新安镇、碾庄方向推进。按住 Shift 右键可跳过攻击预估。'
    },
    {
      title: '第 3 步 · 执行本日',
      text: '命令下达后，点击右上角“执行本日”，让部队行动、交战并结算补给。',
      hint: '也可以按 E。'
    },
    {
      title: '第 1 日已结算',
      text: '点“完成引导”，或打开“战报”看看今天发生了什么。之后就可以自由指挥了。',
      hint: 'F11 可全屏，☰ 可保存 / 读取进度。'
    }
  ];
  let tutorial = { active: false, step: 0 };

  function tutorialRender() {
    if (!tutorial.active) return;
    const st = TUT_STEPS[Math.min(tutorial.step, TUT_STEPS.length - 1)];
    const kicker = document.getElementById('tut-kicker');
    const title = document.getElementById('tut-title');
    const text = document.getElementById('tut-text');
    const hint = document.getElementById('tut-hint');
    const dots = document.getElementById('tut-dots');
    const next = document.getElementById('btn-tut-next');
    if (kicker) kicker.textContent = '新手引导 · 第 ' + (tutorial.step + 1) + ' / 4 步';
    if (title) title.textContent = st.title;
    if (text) text.textContent = st.text;
    if (hint) hint.textContent = st.hint;
    if (dots) {
      dots.innerHTML = TUT_STEPS.map((s, i) => '<i class="' + (i <= tutorial.step ? 'on' : '') + '"></i>').join('');
    }
    if (next) next.classList.toggle('hidden', tutorial.step !== 3);
    const exec = document.getElementById('btn-exec');
    if (exec) exec.classList.toggle('tut-pulse', tutorial.step === 2);
  }

  function tutorialStart(force) {
    if (tutorial.active) return;
    if (!force) {
      try { if (localStorage.getItem(TUT_KEY)) return; } catch (e) { }
    }
    if (!App || !App.state || !App.started || App.state.ended) return;
    const boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('hidden')) return;
    tutorial.active = true;
    tutorial.step = 0;
    const el = document.getElementById('tutorial');
    if (el) el.classList.remove('hidden');
    tutorialRender();
  }

  function tutorialFinish() {
    tutorial.active = false;
    const el = document.getElementById('tutorial');
    if (el) el.classList.add('hidden');
    const exec = document.getElementById('btn-exec');
    if (exec) exec.classList.remove('tut-pulse');
    try { localStorage.setItem(TUT_KEY, '1'); } catch (e) { }
  }

  function tutorialAdvance(step) {
    if (!tutorial.active) return;
    tutorial.step = step;
    if (step >= 4) tutorialFinish();
    else tutorialRender();
  }

  function tutorialOnSelect() {
    if (!tutorial.active || tutorial.step !== 0) return;
    const u = App.state && App.state.units.find(x => x.id === App.selectedIds[0]);
    if (u && u.faction === 'pla') tutorialAdvance(1);
  }

  function tutorialOnOrder() {
    if (tutorial.active && tutorial.step === 1) tutorialAdvance(2);
  }

  function tutorialOnExecute() {
    if (tutorial.active && tutorial.step === 2) tutorialAdvance(3);
  }

  function tutorialOnLog() {
    if (tutorial.active && tutorial.step === 3) tutorialFinish();
  }

  UI.startTutorial = tutorialStart;
  UI.stopTutorial = function () {
    tutorial.active = false;
    const el = document.getElementById('tutorial');
    if (el) el.classList.add('hidden');
    const exec = document.getElementById('btn-exec');
    if (exec) exec.classList.remove('tut-pulse');
  };
  UI.tutorialOnSelect = tutorialOnSelect;
  UI.tutorialOnOrder = tutorialOnOrder;
  UI.tutorialOnExecute = tutorialOnExecute;
  UI.tutorialOnLog = tutorialOnLog;

  /* ============================================================
     开场
     ============================================================ */
  UI.initBoot = function () {
    bindBootControls();
    const q = D.quotes[Math.floor(Math.random() * D.quotes.length)];
    $('#boot-quote').innerHTML = '“' + esc(q.text) + '”<em>—— ' + esc(q.who) + '</em>';
    const start = $('#btn-boot-start');
    if (start) start.disabled = false;
    updateBootSaves();
    $('#loading').classList.add('hidden');
  };
  UI.hideBoot = function () {
    $('#boot').classList.add('hidden');
  };
  UI.showBoot = function () {
    $('#boot').classList.remove('hidden');
    updateBootSaves();
  };
  UI.showLoading = function (show) {
    $('#loading').classList.toggle('hidden', !show);
  };

  /* ============================================================
     回合动画
     ============================================================ */
  UI.playTurn = function (frames) {
    return new Promise(resolve => {
      R.addFrames(frames);
      const notable = (frames || []).filter(f => ['combat', 'destroy', 'capture', 'encircle'].indexOf(f.kind) >= 0);
      if (notable.length) {
        const combats = notable.filter(f => f.kind === 'combat');
        const destroys = notable.filter(f => f.kind === 'destroy');
        let text = '';
        if (combats.length) {
          const c = combats[combats.length - 1];
          text = c.attacker + ' 围攻 ' + c.target + ' · 敌伤 ' + Math.round(c.defLoss).toLocaleString('en-US') + ' · 我伤 ' + Math.round(c.atkLoss).toLocaleString('en-US');
          const killed = destroys.filter(d => d.how !== '起义' && d.how !== '投诚');
          if (killed.length) text += ' · 歼敌 ' + killed.slice(0, 2).map(d => d.short + d.how).join('、');
        } else if (destroys.length) {
          text = destroys.map(d => (d.faction === 'kmt' ? '歼敌 ' : '损失 ') + d.short + ' · ' + d.how).join('　◆　');
        } else if (notable[notable.length - 1].kind === 'capture') {
          const c = notable[notable.length - 1];
          text = (c.side === 'pla' ? '攻占 ' : '失守 ') + c.name;
        } else {
          text = notable[notable.length - 1].text || '';
        }
        showTicker('【战报】' + text);
      }
      const n = notable.length;
      const wait = Math.min(1500, 320 + n * 110);
      setTimeout(resolve, App.fastMode ? 60 : wait);
    });
  };

  let tickerTimer = null;
  function showTicker(text) {
    const el = $('#combat-ticker');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => el.classList.add('hidden'), 3400);
  }

  /* 脚本位于页面底部，DOM 已就绪：立即绑定开场按钮与弹窗关闭 */
  bindBootControls();
  bindModals();

})(typeof window !== 'undefined' ? window : globalThis);
