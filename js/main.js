/* ============================================================
   淮海战役 · 应用主控
   ============================================================ */
(function () {
  'use strict';
  window.__errors = window.__errors || [];
  window.addEventListener('error', e => window.__errors.push(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
  const HX = window.HX;
  const D = HX.Data;
  const E = HX.Engine;
  const R = HX.Render;
  const UI = HX.UI;

  const App = HX.App = {
    state: null,
    selectedIds: [],
    busy: false,
    auto: false,
    autoTimer: null,
    fastMode: false,
    started: false,

    begin() {
      this.newGame();
    },

    newGame() {
      clearTimeout(this.autoTimer);
      this.auto = false;
      this.busy = false;
      this.state = E.create({ seed: (Date.now() % 100000) + 19481106 });
      HX._lastState = this.state;
      this.selectedIds = [];
      this.started = true;
      if (HX.Render) {
        HX.Render.effects.length = 0;
        HX.Render.shake = 0;
        HX.Render.combatFlash = 0;
      }
      const busy = document.getElementById('busy-indicator');
      if (busy) busy.classList.add('hidden');
      if (UI.stopTutorial) UI.stopTutorial();
      if (HX.Audio) HX.Audio.unlock();
      UI.hideBoot();
      UI.init(this);
      UI.closeModal();
      R.setSelected([]);
      R.center(1512, 500, Math.max(0.8, R.cam.minZoom));
      if (HX.Save) {
        setTimeout(function () {
          try { HX.Save.saveAuto({ label: '开局自动存档' }); } catch (e) { }
        }, 420);
      }
      setTimeout(() => UI.showBriefing(), 220);
      setTimeout(function () { if (UI.startTutorial) UI.startTutorial(); }, 1100);
    },

    continueLatest() {
      if (!HX.Save) return;
      const latest = HX.Save.latest();
      if (!latest) { UI.toast('没有找到可继续的存档', 'warn'); return; }
      const r = HX.Save.loadSlot(latest.slot);
      if (!r.ok) UI.toast(r.msg || '读取失败', 'warn');
      else UI.toast(latest.entry.meta.ended ? '已载入战役结局' : '已继续上次战役');
    },

    clearSelection() {
      this.selectedIds = [];
      UI.refreshAll();
    },

    async execute() {
      if (!this.state || this.busy || this.state.ended) return;
      if (this.state.pendingChoice) {
        UI.showChoice(this.state.pendingChoice);
        return;
      }
      if (UI.isModalOpen()) return;
      if (UI.tutorialOnExecute) UI.tutorialOnExecute();
      this.busy = true;
      document.getElementById('busy-indicator').classList.remove('hidden');
      UI.refreshAll();
      let res;
      try {
        res = E.resolveTurn(this.state);
        HX._lastState = this.state;
        await UI.playTurn(res.frames);
      } catch (err) {
        console.error(err);
        UI.toast('推演出错：' + err.message, 'warn');
        this.busy = false;
        document.getElementById('busy-indicator').classList.add('hidden');
        UI.refreshAll();
        return;
      }
      this.busy = false;
      document.getElementById('busy-indicator').classList.add('hidden');
      UI.refreshAll();
      if (HX.Audio) {
        const fought = (res.frames || []).some(f => f.kind === 'combat' || f.kind === 'destroy' || f.kind === 'rout');
        if (fought) HX.Audio.combat();
        else HX.Audio.turn();
      }
      if (HX.Save) {
        HX.Save.saveAuto({
          label: res.ended ? '战役结束自动存档' : (res.choice ? '抉择前自动存档' : '自动存档')
        });
      }
      if (res.choice) {
        this.auto = false;
        UI.showChoice(res.choice);
        UI.refreshAll();
        return;
      }
      if (res.ended) {
        this.auto = false;
        UI.refreshAll();
        setTimeout(() => UI.showResult(), 340);
        return;
      }
      if (this.auto) this.scheduleAuto();
    },

    scheduleAuto() {
      clearTimeout(this.autoTimer);
      if (!this.auto) return;
      this.autoTimer = setTimeout(async () => {
        if (!this.auto) return;
        if (this.busy) { this.scheduleAuto(); return; }
        if (this.state.ended) { this.auto = false; UI.refreshAll(); return; }
        if (UI.isModalOpen()) { this.scheduleAuto(); return; }
        await this.execute();
      }, 520);
    },

    toggleAuto() {
      if (!this.state || this.state.ended) return;
      this.auto = !this.auto;
      if (this.auto) {
        UI.toast('自动推演开始');
        this.scheduleAuto();
      } else {
        clearTimeout(this.autoTimer);
        UI.toast('自动推演暂停');
      }
      UI.refreshAll();
    },

    restart() {
      clearTimeout(this.autoTimer);
      this.auto = false;
      this.busy = false;
      UI.closeModal();
      this.newGame();
    },

    quitToMenu() {
      if (HX.Save && this.state) {
        HX.Save.saveAuto({ label: '返回主菜单自动存档' });
      }
      clearTimeout(this.autoTimer);
      this.auto = false;
      this.busy = false;
      if (UI.stopTutorial) UI.stopTutorial();
      UI.closeModal();
      UI.showBoot();
    },

    quitGame() {
      if (HX.Save) HX.Save.autoSaveForExit();
      const wv = window.chrome && window.chrome.webview;
      if (wv && typeof wv.postMessage === 'function') {
        UI.closeModal();
        wv.postMessage('quit-game');
        return;
      }
      this.quitToMenu();
    },

    onModalClosed() {
      UI.refreshAll();
    }
  };

  function loop(now) {
    if (App.state) {
      HX._lastState = App.state;
      R.draw(App.state, now);
    }
    requestAnimationFrame(loop);
  }

  function boot() {
    UI.showLoading(true);
    const canvas = document.getElementById('map');
    // 先绘制地形，避免首屏空白
    setTimeout(() => {
      try {
        HX._gridBase = HX.Geo.build(D.map);
        const terrain = HX.Terrain.build(D.map, HX._gridBase);
        HX._terrainCanvas = terrain;
        R.init(canvas, terrain);
        R.center(1508, 492, Math.max(0.9, R.cam.minZoom));
        UI.initBoot();
        UI.showLoading(false);
        // 空场景先铺一层地图
        drawIdleTerrain();
        requestAnimationFrame(loop);
      } catch (err) {
        console.error(err);
        UI.showLoading(false);
        document.getElementById('loading').innerHTML = '<p style="color:#e0836c">地形生成失败：' + String(err.message) + '</p>';
      }
    }, 60);
  }

  function drawIdleTerrain() {
    // 未开局时，用静态地图作背景（轻量绘制一次）
    const cv = document.getElementById('map');
    if (!cv || !HX._terrainCanvas) return;
    const ctx = cv.getContext('2d');
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0c09';
    ctx.fillRect(0, 0, w, h);
    const z = Math.max(w / D.map.w, h / D.map.h) * 1.05;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.filter = 'blur(1px) brightness(.55)';
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-D.map.w / 2, -D.map.h / 2);
    ctx.drawImage(HX._terrainCanvas, 0, 0);
    ctx.restore();
  }

  window.addEventListener('load', boot);

  // 浏览器/桌面窗口关闭前自动存档（WebView2 另外有原生 FormClosing 兜底）
  window.addEventListener('beforeunload', function () {
    if (HX.Save) HX.Save.autoSaveForExit();
  });
  window.addEventListener('pagehide', function () {
    if (HX.Save) HX.Save.autoSaveForExit();
  });

  /* 开发调试：?dev=start&turn=3&select=pla-1&doc=1 */
  setTimeout(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('dev') !== 'start') return;
    const run = async () => {
      if (!HX._gridBase) { setTimeout(run, 300); return; }
      App.begin();
      await new Promise(r => setTimeout(r, 420));
      UI.closeModal();
      const turns = Math.max(0, Math.min(30, +(params.get('turn') || 0)));
      for (let i = 0; i < turns; i++) await App.execute();
      if (params.get('cx')) {
        R.center(+(params.get('cx')), +(params.get('cy') || 500), +(params.get('zoom') || 1));
      }
      const sel = params.get('select');
      if (sel) UI.selectOnly(sel);
      if (params.get('doc')) UI.showDocModal();
      if (params.get('log')) UI.showLogModal;
    };
    setTimeout(run, 400);
  }, 0);

  // 桌面版（WebView2）全屏桥接
  (function () {
    const wv = window.chrome && window.chrome.webview;
    if (!wv || typeof wv.postMessage !== 'function') return;
    window.addEventListener('keydown', function (e) {
      if (e.key === 'F11') {
        e.preventDefault();
        wv.postMessage('toggle-fullscreen');
      } else if (e.key === 'Escape') {
        wv.postMessage('exit-fullscreen');
      }
    }, true);
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
  })();

  // 调试入口
  HX.debugSpeed = function (v) { App.fastMode = v !== false; };
})();
