/* ============================================================
   淮海战役 · 存档系统
   自动存档 / 手动存档 / 继续战役 / 退出自动保存
   存储：localStorage（桌面 WebView2 与浏览器均持久化）
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const Save = HX.Save = {};

  const STORAGE_KEY = 'huaihai1948.saves.v1';
  const SAVE_VERSION = 1;
  const SLOT_ORDER = ['auto', 's1', 's2', 's3'];
  const SLOT_LABELS = { auto: '自动存档', s1: '存档 1', s2: '存档 2', s3: '存档 3' };

  Save.SLOT_ORDER = SLOT_ORDER;
  Save.SLOT_LABELS = SLOT_LABELS;
  Save.STORAGE_KEY = STORAGE_KEY;
  Save.VERSION = SAVE_VERSION;

  function storageAvailable() {
    try {
      const k = '__huaihai_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readAll() {
    const empty = { v: SAVE_VERSION, slots: {} };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !data.slots) return empty;
      return data;
    } catch (e) {
      return empty;
    }
  }

  function writeAll(data) {
    if (!storageAvailable()) return { ok: false, msg: '浏览器或桌面版禁用了本地存储' };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
      return { ok: false, msg: quota ? '本地存储空间不足' : String(e.message || e) };
    }
  }

  function phaseLabel(state) {
    try {
      const p = HX.Engine.phaseOf(state);
      return p.name + ' · ' + p.title;
    } catch (e) {
      return '';
    }
  }

  function cleanName(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 30);
  }

  Save.displayName = function (entry) {
    if (entry && entry.name) return entry.name;
    if (entry && entry.meta && entry.meta.label) return entry.meta.label;
    return '存档';
  };

  function sumTroops(state, faction) {
    let n = 0;
    for (const u of (state.units || [])) {
      if (u.alive && u.faction === faction) n += u.troops;
    }
    return Math.round(n);
  }

  function snapshotState(state) {
    return {
      seed: state.seed,
      rngState: state.rngState,
      date: state.date,
      day: state.day,
      units: state.units,
      cities: state.cities,
      flags: state.flags,
      stats: state.stats,
      cp: state.cp,
      cpMax: state.cpMax,
      cooldowns: state.cooldowns,
      pendingEffects: state.pendingEffects || [],
      log: state.log || [],
      phaseId: state.phaseId,
      ended: state.ended,
      result: state.result,
      pendingChoice: state.pendingChoice,
      aiNotes: state.aiNotes || {},
      aiOverrides: state.aiOverrides || {},
      weather: state.weather,
      political: state.political,
      assaultUntil: state.assaultUntil,
      bridge: state.bridge,
      view: HX.Render && HX.Render.cam ? {
        x: HX.Render.cam.x,
        y: HX.Render.cam.y,
        zoom: HX.Render.cam.zoom
      } : null
    };
  }

  function makeThumb(state) {
    try {
      const cv = document.getElementById('map');
      if (!cv || !cv.width || !cv.height) return '';
      const w = 320, h = 180;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (!g) return '';
      const s = Math.max(w / cv.width, h / cv.height);
      const dw = cv.width * s, dh = cv.height * s;
      g.drawImage(cv, (w - dw) / 2, (h - dh) / 2, dw, dh);
      const grd = g.createLinearGradient(0, h - 40, 0, h);
      grd.addColorStop(0, 'rgba(5,7,4,0)');
      grd.addColorStop(1, 'rgba(5,7,4,.7)');
      g.fillStyle = grd;
      g.fillRect(0, h - 40, w, 40);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) {
      return '';
    }
  }

  function makeEntry(state, slot, opts) {
    opts = opts || {};
    const meta = {
      date: state.date,
      day: state.day,
      phase: phaseLabel(state),
      pla: sumTroops(state, 'pla'),
      kmt: sumTroops(state, 'kmt'),
      ended: !!state.ended,
      label: opts.label || SLOT_LABELS[slot] || slot,
      dayText: '第 ' + state.day + ' 日'
    };
    return {
      v: SAVE_VERSION,
      savedAt: Date.now(),
      meta: meta,
      thumb: opts.noThumb ? '' : makeThumb(state),
      state: snapshotState(state)
    };
  }

  Save.available = storageAvailable;

  Save.all = function () {
    try { return readAll(); } catch (e) { return { v: SAVE_VERSION, slots: {} }; }
  };

  Save.list = function () {
    const data = readAll();
    const out = [];
    for (const id of SLOT_ORDER) {
      out.push({ slot: id, label: SLOT_LABELS[id], entry: data.slots[id] || null });
    }
    return out;
  };

  Save.latest = function () {
    const data = readAll();
    let best = null;
    for (const id of SLOT_ORDER) {
      const e = data.slots[id];
      if (!e || !e.savedAt) continue;
      if (!best || e.savedAt > best.entry.savedAt) best = { slot: id, entry: e };
    }
    return best;
  };

  Save.hasAny = function () {
    return !!Save.latest();
  };

  Save.get = function (slot) {
    return readAll().slots[slot] || null;
  };

  Save.save = function (slot, opts) {
    opts = opts || {};
    const App = HX.App;
    const state = App && App.state;
    if (!state || !App.started) return { ok: false, msg: '当前没有进行中的战役' };
    if (App.busy && !opts.force) return { ok: false, msg: '正在推演，请稍后再保存' };
    const data = readAll();
    const prev = data.slots[slot];
    let name = cleanName(opts.name);
    let custom = !!name;
    const sameCampaign = !!(prev && prev.state && state && prev.state.seed === state.seed);
    if (slot === 'auto') {
      if (!name && prev && prev.customName && prev.name && sameCampaign) {
        name = prev.name;
        custom = true;
      } else if (!name) {
        name = '自动存档';
        custom = false;
      }
    } else if (!name) {
      name = (prev && prev.name) || SLOT_LABELS[slot];
      custom = !!(prev && prev.customName);
    }
    let entry;
    try {
      entry = makeEntry(state, slot, opts);
    } catch (e) {
      return { ok: false, msg: '存档生成失败：' + (e.message || e) };
    }
    entry.name = name;
    entry.customName = custom;
    data.slots[slot] = entry;
    const wrote = writeAll(data);
    if (!wrote.ok) return wrote;
    return { ok: true, entry: entry };
  };

  Save.saveAuto = function (opts) {
    return Save.save('auto', Object.assign({ force: true, silent: true }, opts || {}));
  };

  Save.delete = function (slot) {
    const data = readAll();
    if (!data.slots[slot]) return { ok: false, msg: '存档不存在' };
    delete data.slots[slot];
    return writeAll(data);
  };

  Save.rename = function (slot, name) {
    const clean = cleanName(name);
    if (!clean) return { ok: false, msg: '请输入存档名称' };
    const data = readAll();
    const entry = data.slots[slot];
    if (!entry) return { ok: false, msg: '存档不存在' };
    entry.name = clean;
    entry.customName = true;
    const wrote = writeAll(data);
    if (!wrote.ok) return wrote;
    return { ok: true, entry: entry };
  };

  Save.autoSaveForExit = function () {
    try {
      if (!HX.App || !HX.App.state || !HX.App.started) return false;
      const r = Save.saveAuto({ label: '退出自动存档' });
      return !!r.ok;
    } catch (e) {
      return false;
    }
  };

  Save.buildState = function (sv) {
    if (!HX._gridBase) HX._gridBase = HX.Geo.build(HX.Data.map);
    if (!sv || !sv.units || !sv.units.length || !sv.cities) return null;
    const s = {
      seed: sv.seed || 19481106,
      rngState: sv.rngState || sv.seed || 19481106,
      date: sv.date || HX.Data.startDate,
      day: sv.day || 1,
      grid: HX.Geo.clone(HX._gridBase),
      units: sv.units,
      cities: sv.cities,
      flags: sv.flags || {},
      stats: Object.assign({
        kmtLoss: 0, plaLoss: 0, defected: 0, surrendered: 0,
        kmtDestroyed: 0, plaDestroyed: 0, combats: 0, citiesTaken: 0, airdrops: 0
      }, sv.stats || {}),
      cp: sv.cp || 0,
      cpMax: sv.cpMax || 5,
      cooldowns: Object.assign({ barrage: 0, night: 0, supply: 0, political: 0 }, sv.cooldowns || {}),
      pendingEffects: sv.pendingEffects || [],
      log: sv.log || [],
      frames: [],
      phaseId: sv.phaseId || 1,
      ended: !!sv.ended,
      result: sv.result || null,
      pendingChoice: sv.pendingChoice || null,
      aiNotes: sv.aiNotes || {},
      aiOverrides: sv.aiOverrides || {},
      selected: [],
      weather: sv.weather || HX.Engine.weatherFor(sv.date || HX.Data.startDate),
      political: !!sv.political,
      assaultUntil: sv.assaultUntil || null,
      bridge: sv.bridge || null
    };
    if (s.bridge && s.bridge.destroyed) HX.Engine.setBridge(s, true);
    HX.Engine.computeSupply(s);
    return s;
  };

  Save.loadSlot = function (slot) {
    const data = readAll();
    const entry = data.slots[slot];
    if (!entry) return { ok: false, msg: '存档不存在' };
    if (entry.v && entry.v > SAVE_VERSION) return { ok: false, msg: '存档版本过新，请更新游戏' };
    let state;
    try {
      state = Save.buildState(entry.state);
    } catch (e) {
      return { ok: false, msg: '存档损坏：' + (e.message || e) };
    }
    if (!state) return { ok: false, msg: '存档内容不完整' };

    const App = HX.App;
    // 读取前把当前进度写入自动存档（如正在游戏中）
    if (App && App.state && App.started && !App.state.ended && !App.busy) {
      Save.saveAuto({ label: '读取前自动存档', noThumb: false });
    }

    App.state = state;
    App.selectedIds = [];
    App.busy = false;
    App.auto = false;
    if (App.autoTimer) clearTimeout(App.autoTimer);
    App.started = true;
    HX._lastState = state;
    if (HX.UI && HX.UI.stopTutorial) HX.UI.stopTutorial();
    if (HX.Audio) HX.Audio.unlock();
    const busy = document.getElementById('busy-indicator');
    if (busy) busy.classList.add('hidden');

    if (HX.UI) {
      HX.UI.hideBoot();
      HX.UI.init(App);
      HX.Render.setSelected([]);
      HX.UI.closeModal();
      HX.UI.refreshAll();
    }
    const view = entry.state && entry.state.view;
    if (view && HX.Render) HX.Render.center(view.x, view.y, view.zoom);
    else if (HX.Render) HX.Render.center(1512, 500, 0.82);

    if (HX.UI) {
      if (state.pendingChoice) {
        setTimeout(function () { HX.UI.showChoice(state.pendingChoice); }, 260);
      } else if (state.ended) {
        setTimeout(function () { HX.UI.showResult(); }, 320);
      }
    }
    return { ok: true, state: state, entry: entry };
  };

})(typeof window !== 'undefined' ? window : globalThis);
