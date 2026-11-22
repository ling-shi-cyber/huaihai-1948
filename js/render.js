/* ============================================================
   淮海战役 · 地图渲染
   相机、城市标注、部队标号、命令箭头、战斗特效、天气
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const D = HX.Data;

  const Render = HX.Render = {};
  let cv = null, ctx = null, terrain = null;
  let vw = 0, vh = 0, dpr = 1;
  let time = 0, lastTime = 0;

  const cam = Render.cam = { x: 1508, y: 492, zoom: 0.92, minZoom: 0.35, maxZoom: 2.8 };

  Render.effects = [];
  Render.hoverId = null;
  Render.selected = [];
  Render.box = null;
  Render.targeting = null;
  Render.shake = 0;
  Render.combatFlash = 0;
  Render.weather = 'clear';
  Render.showSupply = false;

  const RAIN = [], SNOW = [], DUST = [];

  Render.init = function (canvas, terrainCanvas) {
    cv = canvas;
    ctx = canvas.getContext('2d');
    terrain = terrainCanvas;
    for (let i = 0; i < 160; i++) {
      RAIN.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 0.8, l: 8 + Math.random() * 18 });
    }
    for (let i = 0; i < 110; i++) {
      SNOW.push({ x: Math.random(), y: Math.random(), s: 0.25 + Math.random() * 0.7, r: 0.8 + Math.random() * 1.8, p: Math.random() * 6.28 });
    }
    for (let i = 0; i < 50; i++) {
      DUST.push({ x: Math.random(), y: Math.random(), s: 0.2 + Math.random() * 0.5 });
    }
    resize();
    window.addEventListener('resize', resize);
  };

  function resize() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = cv.clientWidth;
    vh = cv.clientHeight;
    cv.width = Math.max(1, Math.floor(vw * dpr));
    cv.height = Math.max(1, Math.floor(vh * dpr));
    cam.minZoom = Math.min(vw / D.map.w, vh / D.map.h) * 0.92;
    cam.zoom = Math.max(cam.zoom, cam.minZoom);
  }
  Render.resize = resize;
  Render.size = function () { return { w: vw, h: vh }; };

  Render.worldToScreen = function (x, y) {
    return { x: (x - cam.x) * cam.zoom + vw / 2, y: (y - cam.y) * cam.zoom + vh / 2 };
  };
  Render.screenToWorld = function (x, y) {
    return { x: (x - vw / 2) / cam.zoom + cam.x, y: (y - vh / 2) / cam.zoom + cam.y };
  };
  Render.screenToLonLat = function (x, y) {
    const w = Render.screenToWorld(x, y);
    return { lon: 114 + w.x / 420, lat: 35.3 - w.y / 460 };
  };

  Render.center = function (x, y, zoom) {
    cam.x = x; cam.y = y;
    if (zoom) cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, zoom));
  };
  Render.fit = function () {
    cam.zoom = Math.min(vw / D.map.w, vh / D.map.h) * 0.96;
    cam.x = D.map.w / 2;
    cam.y = D.map.h / 2;
  };
  Render.zoomAt = function (sx, sy, factor) {
    const before = Render.screenToWorld(sx, sy);
    cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * factor));
    const after = Render.screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  };
  Render.pan = function (dx, dy) {
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    clampCam();
  };
  function clampCam() {
    cam.x = Math.max(-200, Math.min(D.map.w + 200, cam.x));
    cam.y = Math.max(-160, Math.min(D.map.h + 160, cam.y));
  }
  Render.clampCam = clampCam;

  /* ---------------- 效果 ---------------- */
  Render.addFrames = function (frames) {
    if (!frames) return;
    const t = time;
    for (const f of frames) {
      if (f.kind === 'combat') {
        Render.effects.push({ kind: 'combat', x: f.targetX, y: f.targetY, t: t, dur: 1.5, defLoss: f.defLoss, atkLoss: f.atkLoss, text: f.target });
        Render.shake = Math.min(9, Render.shake + 3.5);
        Render.combatFlash = 1;
      } else if (f.kind === 'destroy') {
        Render.effects.push({ kind: 'destroy', x: f.x, y: f.y, t: t, dur: 2.4, how: f.how, name: f.short, faction: f.faction });
        Render.shake = Math.min(12, Render.shake + 5);
      } else if (f.kind === 'capture') {
        Render.effects.push({ kind: 'capture', x: f.x, y: f.y, t: t, dur: 2.2, name: f.name, side: f.side });
      } else if (f.kind === 'barrage') {
        Render.effects.push({ kind: 'barrage', x: f.x, y: f.y, r: f.r, t: t, dur: 1.6 });
      } else if (f.kind === 'airstrike') {
        Render.effects.push({ kind: 'airstrike', x: f.x, y: f.y, t: t, dur: 1.8 });
      } else if (f.kind === 'rout' || f.kind === 'defect') {
        Render.effects.push({ kind: 'dust', x: f.x, y: f.y, t: t, dur: 1.4 });
      } else if (f.kind === 'encircle') {
        Render.effects.push({ kind: 'encircle', x: f.x, y: f.y, t: t, dur: 3.2 });
      } else if (f.kind === 'spawn') {
        Render.effects.push({ kind: 'spawn', x: f.x, y: f.y, t: t, dur: 2.2, text: f.text });
      } else if (f.kind === 'supply') {
        Render.effects.push({ kind: 'supply', x: f.x, y: f.y, r: f.r, t: t, dur: 1.6 });
      }
    }
  };

  /* ---------------- 绘制 ---------------- */
  Render.draw = function (state, now) {
    if (!ctx) return;
    if (!lastTime) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    time = now / 1000;
    lastTime = now;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = '#0a0c09';
    ctx.fillRect(0, 0, vw, vh);

    let shx = 0, shy = 0;
    if (Render.shake > 0.1) {
      shx = (Math.random() - 0.5) * Render.shake;
      shy = (Math.random() - 0.5) * Render.shake;
      Render.shake *= Math.pow(0.02, dt);
    }

    ctx.save();
    ctx.translate(shx, shy);
    drawTerrain();
    drawCityLabels(state);
    drawReach();
    drawOrders(state);
    drawUnits(state);
    drawImportantLabels(state);
    drawEffects();
    drawBox();
    drawCursorTarget();
    ctx.restore();

    drawWeather(dt);
    drawFrame();

    // 交火时的画面赤色闪光
    if (Render.combatFlash > 0.01) {
      const a = Render.combatFlash * 0.2;
      const grd = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.28, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
      grd.addColorStop(0, 'rgba(180, 40, 20, 0)');
      grd.addColorStop(1, 'rgba(180, 40, 20, ' + a.toFixed(3) + ')');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, vw, vh);
      Render.combatFlash = Math.max(0, Render.combatFlash - dt * 1.8);
    }

    // 比例尺随缩放变化
    const sb = document.querySelector('#scalebar i');
    if (sb) sb.style.width = (228 * cam.zoom).toFixed(0) + 'px';
  };

  function drawTerrain() {
    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    // 地图外底色
    ctx.fillStyle = '#12140f';
    ctx.fillRect(-500, -500, D.map.w + 1000, D.map.h + 1000);
    if (terrain) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(terrain, 0, 0);
    }
    ctx.restore();
    // 边缘暗角与地图框
    const tl = Render.worldToScreen(0, 0);
    const br = Render.worldToScreen(D.map.w, D.map.h);
    ctx.save();
    ctx.strokeStyle = 'rgba(192, 162, 106, .22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, br.x - tl.x, br.y - tl.y);
    ctx.restore();
  }

  function drawCityLabels(state) {
    const showSmall = cam.zoom > 1.05;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const c of state.cities) {
      if (c.tier !== 'town') continue;
      if (!showSmall) continue;
      const p = Render.worldToScreen(c.x, c.y);
      if (p.x < -140 || p.y < -60 || p.x > vw + 140 || p.y > vh + 60) continue;
      const size = 11;
      const color = c.side === 'pla' ? '#e9d6bf' : c.side === 'kmt' ? '#d3e0ec' : '#d8d2c0';
      const dotColor = c.side === 'pla' ? '#d0483a' : c.side === 'kmt' ? '#5f92bd' : '#8a8272';
      const lx = p.x + 7, ly = p.y - 6;
      ctx.font = '500 ' + size + 'px "Noto Serif SC","Songti SC",serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 10, 6, .8)';
      ctx.strokeText(c.name, lx, ly);
      ctx.fillStyle = color;
      ctx.fillText(c.name, lx, ly);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(14, 16, 12, .8)';
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 重要城镇标注：绘制在部队之上，带小铭牌并自动避让部队 */
  function drawImportantLabels(state) {
    const KEY = { nianzhuang: 1, shuangduiji: 1, chenguanzhuang: 1, yunhezhan: 1, caobaji: 1, daxujia: 1 };
    const ALWAYS = { nianzhuang: 1, shuangduiji: 1, chenguanzhuang: 1 };
    const pts = [];
    for (const u of state.units) {
      if (!u.alive || u.pending) continue;
      const p = Render.worldToScreen(u.x, u.y);
      p.y += (Render.offsets && Render.offsets[u.id]) || 0;
      pts.push(p);
    }
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const c of state.cities) {
      const major = c.tier === 'major';
      const city = c.tier === 'city';
      const key = !!KEY[c.id];
      if (!major && !city && !key) continue;
      if (key && !ALWAYS[c.id] && cam.zoom < 0.95) continue;
      const p = Render.worldToScreen(c.x, c.y);
      if (p.x < -160 || p.y < -60 || p.x > vw + 160 || p.y > vh + 60) continue;
      const size = major ? 17 : city ? 13 : 11;
      ctx.font = (major ? '700 ' : city ? '600 ' : '500 ') + size + 'px "Noto Serif SC","Songti SC",serif';
      const tw = ctx.measureText(c.name).width;
      const bw = tw + 14, bh = size + 10;
      const cands = [
        { x: p.x + 10, y: p.y - bh - 22 },
        { x: p.x - bw - 10, y: p.y - bh - 22 },
        { x: p.x + 10, y: p.y + 12 },
        { x: p.x - bw - 10, y: p.y + 12 },
        { x: p.x - bw / 2, y: p.y - bh - 40 },
        { x: p.x - bw / 2, y: p.y + 30 },
        { x: p.x + 26, y: p.y - bh / 2 },
        { x: p.x - bw - 26, y: p.y - bh / 2 }
      ];
      let best = cands[0], bestScore = Infinity;
      for (const cand of cands) {
        let score = Math.hypot(cand.x + bw / 2 - p.x, cand.y + bh / 2 - p.y) * 0.02;
        if (cand.x < 8 || cand.y < 8 || cand.x + bw > vw - 8 || cand.y + bh > vh - 8) score += 6;
        for (const q of pts) {
          if (q.x > cand.x - 7 && q.x < cand.x + bw + 7 && q.y > cand.y - 6 && q.y < cand.y + bh + 6) score += 1;
        }
        if (score < bestScore) { bestScore = score; best = cand; }
      }
      // 引线
      const ax = Math.max(best.x, Math.min(p.x, best.x + bw));
      const ay = best.y > p.y ? best.y : best.y + bh;
      ctx.strokeStyle = 'rgba(220, 204, 168, .3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      // 铭牌
      ctx.fillStyle = 'rgba(9, 11, 7, .68)';
      ctx.fillRect(best.x, best.y, bw, bh);
      ctx.strokeStyle = major ? 'rgba(192, 162, 106, .5)' : 'rgba(150, 148, 122, .3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(best.x + 0.5, best.y + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = major ? '#f7e7ca' : '#e7ddc4';
      ctx.fillText(c.name, best.x + 7, best.y + bh / 2 + 0.5);
      // 控制方标记
      const dotColor = c.side === 'pla' ? '#d0483a' : c.side === 'kmt' ? '#5f92bd' : '#8a8272';
      ctx.beginPath();
      ctx.arc(p.x, p.y, major ? 4.5 : city ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(14, 16, 12, .85)';
      ctx.stroke();
      if (key) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = 'rgba(226, 158, 122, .8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-5.5, -5.5, 11, 11);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /* 选中部队的可达范围 */
  let reachUnitId = null, reachCache = null;
  Render.invalidateReach = function () { reachUnitId = null; reachCache = null; };
  function drawReach() {
    if (!Render.selected.length) return;
    const u = Render.selected[0];
    if (!u || !u.alive) return;
    if (reachUnitId !== u.id || !reachCache) {
      const grid = HX.Engine && HX._lastState ? HX._lastState.grid : null;
      const s = HX._lastState;
      if (!s) return;
      const budget = HX.Engine.unitBudget(s, u);
      const flood = HX.Geo.flood(s.grid, u.x, u.y, budget);
      const c = document.createElement('canvas');
      c.width = s.grid.cols; c.height = s.grid.rows;
      const g = c.getContext('2d');
      const img = g.createImageData(s.grid.cols, s.grid.rows);
      for (let i = 0; i < flood.dist.length; i++) {
        if (flood.dist[i] < HX.Geo.CELL * 999999) {
          const a = 78 + Math.max(0, 1 - flood.dist[i] / Math.max(1, budget)) * 74;
          img.data[i * 4] = 146; img.data[i * 4 + 1] = 186; img.data[i * 4 + 2] = 104;
          img.data[i * 4 + 3] = a;
        }
      }
      g.putImageData(img, 0, 0);
      reachCache = c; reachUnitId = u.id;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    const cell = HX._lastState.grid.cell;
    const p = Render.worldToScreen(0, 0);
    ctx.translate(p.x, p.y);
    ctx.scale(cam.zoom * cell, cam.zoom * cell);
    ctx.drawImage(reachCache, 0, 0);
    ctx.restore();
  }

  /* 命令箭头 */
  function drawOrders(state) {
    const list = Render.selected.length ? Render.selected : [];
    for (const u of list) {
      if (!u || !u.alive || !u.order) continue;
      const o = u.order;
      if (o.type === 'move' || o.type === 'retreat') {
        if (!o.x) continue;
        const a = Render.worldToScreen(u.x, u.y);
        const b = Render.worldToScreen(o.x, o.y);
        drawArrow(a.x, a.y, b.x, b.y, u.faction === 'pla' ? 'rgba(180, 200, 130, .75)' : 'rgba(120, 165, 210, .75)', o.type === 'retreat');
        drawFlag(b.x, b.y, u.faction, o.type === 'retreat' ? '转' : '');
      } else if (o.type === 'attack') {
        const t = state.units.find(v => v.id === o.targetId);
        if (!t || !t.alive) continue;
        const a = Render.worldToScreen(u.x, u.y);
        const b = Render.worldToScreen(t.x, t.y);
        drawArrow(a.x, a.y, b.x, b.y, 'rgba(214, 92, 70, .8)', false);
        drawReticle(b.x, b.y, '#e0654d', 15);
      }
    }
  }

  function drawArrow(x1, y1, x2, y2, color, dashed) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;
    const ux = dx / len, uy = dy / len;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - ux * 10, y2 - uy * 10);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(dashed ? [5, 5] : [8, 4]);
    ctx.lineDashOffset = -(time * 22) % 12;
    ctx.stroke();
    ctx.setLineDash([]);
    // 箭头
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * 11 - uy * 5.5, y2 - uy * 11 + ux * 5.5);
    ctx.lineTo(x2 - ux * 11 + uy * 5.5, y2 - uy * 11 - ux * 5.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawFlag(x, y, faction, label) {
    ctx.save();
    const col = faction === 'pla' ? '#c0473a' : '#4f7ea9';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 15); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 15); ctx.lineTo(x + 11, y - 11); ctx.lineTo(x, y - 7); ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.fillStyle = 'rgba(12,15,10,.85)';
      ctx.beginPath(); ctx.arc(x, y + 1, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e6d6ae';
      ctx.font = '8px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 1);
    }
    ctx.restore();
  }

  function drawReticle(x, y, color, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.8);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r, i * Math.PI / 2 + 0.24, i * Math.PI / 2 + 0.66);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /* 部队 */
  function unitScale() {
    return Math.max(0.7, Math.min(1.05, Math.pow(cam.zoom, 0.35) * 0.9));
  }

  Render.unitScreenRect = function (u) {
    const p = Render.worldToScreen(u.x, u.y);
    const s = unitScale();
    const w = (u.hq ? 46 : 58) * s;
    const h = (u.hq ? 34 : 30) * s;
    return { x: p.x, y: p.y, w, h, s };
  };

  function drawUnits(state) {
    const s = unitScale();
    const units = state.units.filter(u => u.alive && !u.pending);
    Render.offsets = {};
    units.sort((a, b) => a.y - b.y);
    const placed = [];
    for (const u of units) {
      const p = Render.worldToScreen(u.x, u.y);
      if (p.x < -90 || p.y < -70 || p.x > vw + 90 || p.y > vh + 70) continue;
      const w = (u.hq ? 42 : 52) * s, h = (u.hq ? 30 : 27) * s;
      let oy = 0;
      const seq = [0, -15, 15, -27, 27, -38, 38];
      for (const cand of seq) {
        const r = { x: p.x - w / 2 - 2, y: p.y + cand - h / 2 - 2, w: w + 4, h: h + 4 };
        let hit = false;
        for (const q of placed) {
          if (r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y) { hit = true; break; }
        }
        if (!hit) { oy = cand; break; }
        oy = cand;
      }
      if (oy !== 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(212, 196, 160, .35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y + oy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212, 196, 160, .45)';
        ctx.fill();
        ctx.restore();
      }
      Render.offsets[u.id] = oy;
      const selected = Render.selected.some(v => v && v.id === u.id);
      drawUnit(state, u, p.x, p.y + oy, s, selected, Render.hoverId === u.id);
      placed.push({ x: p.x - w / 2 - 2, y: p.y + oy - h / 2 - 2, w: w + 4, h: h + 4 });
    }
  }

  function drawUnit(state, u, x, y, s, selected, hovered) {
    if (u.hq) return drawHQ(u, x, y, s, selected, hovered);
    const w = 52 * s, h = 27 * s;
    const isPla = u.faction === 'pla';
    const base = isPla ? '#2a1512' : '#111b24';
    const edge = isPla ? '#c04a3c' : '#5b88b0';
    const edgeDim = isPla ? 'rgba(192,74,60,.55)' : 'rgba(91,136,176,.55)';

    const left = x - w / 2, top = y - h / 2;

    // 地面阴影
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.42, w * 0.42, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.fill();
    ctx.restore();

    // 选中光环
    if (selected) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.4, w * 0.6, h * 0.26, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224, 196, 132, .9)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = -(time * 16) % 7;
      ctx.stroke();
      ctx.restore();
    }

    // 标牌
    ctx.save();
    ctx.beginPath();
    const cut = 5 * s;
    ctx.moveTo(left, top);
    ctx.lineTo(left + w - cut, top);
    ctx.lineTo(left + w, top + cut);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left, top + h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, isPla ? 'rgba(56,28,24,.97)' : 'rgba(24,38,52,.97)');
    g.addColorStop(1, 'rgba(13,16,12,.97)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = selected ? '#e3c88f' : hovered ? '#d8d0b0' : edgeDim;
    ctx.lineWidth = selected ? 1.4 : 1;
    ctx.stroke();

    // 左侧阵营条
    ctx.fillStyle = isPla ? '#c0473a' : '#4f7ea9';
    ctx.fillRect(left, top, 3.2 * s, h);
    // 顶部高光
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(left + 3.2 * s, top, w - 3.2 * s, 1);

    // 番号
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nameSize = u.short.length >= 4 ? 9.6 : 11;
    ctx.font = '600 ' + (nameSize * s) + 'px "Noto Serif SC","Songti SC",serif';
    ctx.fillStyle = '#f2e7cd';
    ctx.fillText(u.short, x + 2 * s, top + 9.5 * s);

    // 兵力
    ctx.font = '500 ' + (8 * s) + 'px "JetBrains Mono",Consolas,monospace';
    ctx.fillStyle = 'rgba(225, 214, 184, .72)';
    const troopsTxt = (u.troops / 10000).toFixed(1) + '万';
    ctx.textAlign = 'left';
    ctx.fillText(troopsTxt, left + 6 * s, top + 20 * s);

    // 兵员比例条
    const frac = Math.max(0.02, u.troops / u.maxTroops);
    const bw = 17 * s;
    ctx.fillStyle = 'rgba(255,255,255,.09)';
    ctx.fillRect(left + 25 * s, top + 19.5 * s, bw, 2.4 * s);
    ctx.fillStyle = isPla ? `rgba(${Math.round(190 + 20 * (1 - frac))},${Math.round(90 + 80 * frac)},${Math.round(70 + 50 * frac)},.9)` : 'rgba(120, 170, 210, .9)';
    ctx.fillRect(left + 25 * s, top + 19.5 * s, bw * frac, 2.4 * s);

    // 补给状态点
    const dotX = left + w - 7 * s, dotY = top + 7 * s;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2.6 * s, 0, Math.PI * 2);
    if (u.encircled) {
      ctx.fillStyle = '#e05a42';
      ctx.shadowColor = 'rgba(224,90,66,.9)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = u.supply > 50 ? '#8fae74' : '#c9a04c';
      ctx.fill();
    }

    // 工事
    if (u.entrench > 45) {
      ctx.strokeStyle = 'rgba(216, 196, 140, .7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left + w - 10 * s, top + h - 4 * s);
      ctx.lineTo(left + w - 6 * s, top + h - 4 * s);
      ctx.moveTo(left + w - 10 * s, top + h - 7 * s);
      ctx.lineTo(left + w - 6 * s, top + h - 7 * s);
      ctx.stroke();
    }

    // 被围标记
    if (u.encircled) {
      ctx.fillStyle = 'rgba(180, 50, 34, .92)';
      ctx.fillRect(left, top + h - 9 * s, 15 * s, 9 * s);
      ctx.fillStyle = '#f2d2c2';
      ctx.font = '600 ' + (7.5 * s) + 'px "PingFang SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('围', left + 7.5 * s, top + h - 4.5 * s);
    }

    // 选中指示三角
    if (selected) {
      const bob = Math.sin(time * 4) * 2;
      ctx.beginPath();
      ctx.moveTo(x, top - 7 + bob);
      ctx.lineTo(x - 5, top - 1 + bob);
      ctx.lineTo(x + 5, top - 1 + bob);
      ctx.closePath();
      ctx.fillStyle = '#e6c98c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 24, 12, .8)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 被围光环
    if (u.encircled) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.62, h * 0.72, 0, 0, Math.PI * 2);
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -(time * 12) % 8;
      ctx.strokeStyle = 'rgba(226, 96, 72, .55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // 行动状态标记
    const ord = u.order ? u.order.type : 'defend';
    if (ord === 'attack') {
      ctx.fillStyle = 'rgba(224, 101, 77, .95)';
      ctx.beginPath();
      ctx.moveTo(left + w - 12 * s, top + h - 6 * s);
      ctx.lineTo(left + w - 4 * s, top + h - 6 * s);
      ctx.lineTo(left + w - 8 * s, top + h - 12 * s);
      ctx.closePath();
      ctx.fill();
    } else if (ord === 'move' || ord === 'retreat') {
      ctx.strokeStyle = 'rgba(180, 200, 130, .95)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(left + w - 12 * s, top + h - 6 * s);
      ctx.lineTo(left + w - 5 * s, top + h - 6 * s);
      ctx.moveTo(left + w - 8 * s, top + h - 9 * s);
      ctx.lineTo(left + w - 5 * s, top + h - 6 * s);
      ctx.lineTo(left + w - 8 * s, top + h - 3 * s);
      ctx.stroke();
    } else if (ord === 'rest') {
      ctx.fillStyle = 'rgba(150, 170, 130, .8)';
      ctx.fillRect(left + w - 11 * s, top + h - 8 * s, 7 * s, 1.2 * s);
      ctx.fillRect(left + w - 11 * s, top + h - 5 * s, 7 * s, 1.2 * s);
    }
    ctx.restore();
  }

  function drawHQ(u, x, y, s, selected, hovered) {
    const isPla = u.faction === 'pla';
    const col = isPla ? '#c0473a' : '#4f7ea9';
    const w = 46 * s, h = 34 * s;
    const left = x - w / 2, top = y - h / 2;
    ctx.save();
    // 底座
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.42, 14 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fill();
    if (selected) {
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.4, 20 * s, 8 * s, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224, 196, 132, .9)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -(time * 14) % 6;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 旗杆
    ctx.strokeStyle = hovered ? '#f0e2c0' : col;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.3); ctx.lineTo(x, top); ctx.stroke();
    // 旗面
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w * 0.55, top + 4 * s);
    ctx.lineTo(x + w * 0.55, top + 15 * s);
    ctx.lineTo(x, top + 12 * s);
    ctx.closePath();
    ctx.fillStyle = isPla ? 'rgba(66, 25, 20, .96)' : 'rgba(20, 40, 58, .96)';
    ctx.fill();
    ctx.strokeStyle = selected ? '#e3c88f' : col;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 文字
    ctx.fillStyle = '#f0e4c8';
    ctx.font = '600 ' + (8.5 * s) + 'px "PingFang SC",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(u.short, x + 3 * s, top + 8 * s);
    // 指挥官
    ctx.fillStyle = 'rgba(220, 208, 175, .65)';
    ctx.font = '400 ' + (7 * s) + 'px "PingFang SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.commander || '', x, y + h * 0.52);
    ctx.restore();
  }

  /* 拾取 */
  Render.pickUnit = function (state, sx, sy) {
    let best = null, bd = 1e9;
    const s = unitScale();
    for (const u of state.units) {
      if (!u.alive || u.pending) continue;
      const p = Render.worldToScreen(u.x, u.y);
      p.y += (Render.offsets && Render.offsets[u.id]) || 0;
      const w = (u.hq ? 36 : 52) * s, h = (u.hq ? 28 : 27) * s;
      if (Math.abs(sx - p.x) <= w / 2 + 2 && Math.abs(sy - p.y) <= h / 2 + 2) {
        const d = Math.hypot(sx - p.x, sy - p.y);
        if (d < bd) { bd = d; best = u; }
      }
    }
    return best;
  };

  /* 框选 */
  Render.setBox = function (a, b) { Render.box = a && b ? { a, b } : null; };
  function drawBox() {
    if (!Render.box) return;
    const { a, b } = Render.box;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    ctx.save();
    ctx.fillStyle = 'rgba(192, 162, 106, .07)';
    ctx.strokeStyle = 'rgba(214, 192, 142, .75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  function drawCursorTarget() {
    if (!Render.targeting) return;
    const m = Render.mouse;
    if (!m) return;
    if (Render.targeting.mode === 'attack') drawReticle(m.x, m.y, '#e0654d', 16);
    else {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 210, 150, .8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 12, 0, Math.PI * 2);
      ctx.moveTo(m.x - 18, m.y); ctx.lineTo(m.x - 6, m.y);
      ctx.moveTo(m.x + 6, m.y); ctx.lineTo(m.x + 18, m.y);
      ctx.moveTo(m.x, m.y - 18); ctx.lineTo(m.x, m.y - 6);
      ctx.moveTo(m.x, m.y + 6); ctx.lineTo(m.x, m.y + 18);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* 特效 */
  function drawEffects() {
    if (!Render.effects.length) return;
    const now = time;
    for (const e of Render.effects) {
      const age = now - e.t;
      if (age < 0 || age > e.dur) continue;
      const t = age / e.dur;
      const p = Render.worldToScreen(e.x, e.y);
      if (e.kind === 'combat') {
        const r = 8 + t * 46;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = '#ffb27a';
        ctx.lineWidth = 2 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff6b45';
        ctx.stroke();
        // 闪光
        const flash = Math.max(0, 1 - age * 6);
        if (flash > 0) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30);
          grd.addColorStop(0, 'rgba(255, 220, 150, ' + (0.75 * flash) + ')');
          grd.addColorStop(1, 'rgba(255, 120, 60, 0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 30, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        // 伤亡数字
        if (age < 1.5) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, (1.5 - age) * 1.4);
          ctx.font = '700 13px "JetBrains Mono",Consolas,monospace';
          ctx.textAlign = 'left';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(10, 8, 6, .8)';
          const d1 = '敌 -' + Math.round(e.defLoss).toLocaleString('en-US');
          const d2 = '我 -' + Math.round(e.atkLoss).toLocaleString('en-US');
          ctx.strokeText(d1, p.x + 12, p.y - 14 - age * 18);
          ctx.strokeText(d2, p.x + 12, p.y + 4 - age * 18);
          ctx.fillStyle = '#ffd9a8';
          ctx.fillText(d1, p.x + 12, p.y - 14 - age * 18);
          ctx.fillStyle = '#f0a58f';
          ctx.fillText(d2, p.x + 12, p.y + 4 - age * 18);
          ctx.restore();
        }
        // 落点烟尘
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.3;
        ctx.fillStyle = '#7a6a50';
        for (let i = 0; i < 5; i++) {
          const a = i * 1.257 + e.x;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r * 0.6, p.y + Math.sin(a) * r * 0.4, 3 + t * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (e.kind === 'destroy') {
        const k = Math.min(1, t * 4);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = 1 - Math.max(0, (t - 0.55) / 0.45);
        ctx.strokeStyle = e.faction === 'kmt' ? '#e0a060' : '#d06a5a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 16 + t * 30, 0, Math.PI * 2);
        ctx.stroke();
        // 印章
        ctx.rotate(-0.08);
        const sc = 0.7 + k * 0.3;
        ctx.scale(sc, sc);
        ctx.fillStyle = e.how === '起义' || e.how === '投诚' ? 'rgba(60, 110, 160, .92)' : 'rgba(150, 40, 28, .92)';
        ctx.fillRect(-24, -12, 48, 24);
        ctx.strokeStyle = 'rgba(240, 220, 180, .7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-24, -12, 48, 24);
        ctx.fillStyle = '#f4e3c6';
        ctx.font = '600 12px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.name + ' ' + (e.how || '被歼'), 0, 0);
        ctx.restore();
      } else if (e.kind === 'capture') {
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = e.side === 'pla' ? '#e0685a' : '#6f9cc4';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 + t * 34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = e.side === 'pla' ? '#f0d6c4' : '#cfe0ee';
        ctx.font = '600 12px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.name, p.x, p.y - 22 - t * 14);
        ctx.restore();
      } else if (e.kind === 'barrage') {
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.8;
        for (let i = 0; i < 3; i++) {
          const rr = (t + i * 0.12) * e.r;
          ctx.strokeStyle = 'rgba(255, 180, 90, .7)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      } else if (e.kind === 'airstrike') {
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = 'rgba(255, 200, 140, .8)';
        ctx.lineWidth = 1.5;
        const dy = -120 * (1 - t);
        ctx.beginPath(); ctx.moveTo(p.x - 40, p.y + dy - 40); ctx.lineTo(p.x, p.y); ctx.stroke();
        const rr = 6 + t * 30;
        ctx.fillStyle = 'rgba(255, 160, 80, ' + (0.5 * (1 - t)) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (e.kind === 'dust') {
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.45;
        ctx.fillStyle = '#8a7a5e';
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * t * 24, p.y + Math.sin(a) * t * 14, 3 + t * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (e.kind === 'encircle') {
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = 'rgba(224, 150, 90, .8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 7]);
        ctx.lineDashOffset = -(time * 30) % 17;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 70 - t * 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f0d2a8';
        ctx.font = '600 15px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.text, p.x, p.y - 84);
        ctx.restore();
      } else if (e.kind === 'spawn') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - t) * 2);
        ctx.strokeStyle = 'rgba(140, 170, 205, .8)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14 + t * 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#cfe0ee';
        ctx.font = '600 12px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.text || '', p.x, p.y - 30);
        ctx.restore();
      } else if (e.kind === 'supply') {
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.strokeStyle = 'rgba(150, 180, 120, .8)';
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, e.r * (0.5 + t * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    Render.effects = Render.effects.filter(e => time - e.t <= e.dur);
  }

  /* 天气 */
  function drawWeather(dt) {
    const type = Render.weather;
    if (type === 'rain') {
      ctx.save();
      ctx.strokeStyle = 'rgba(170, 195, 205, .22)';
      ctx.lineWidth = 1;
      for (const d of RAIN) {
        d.y += dt * 0.9 * d.s;
        d.x += dt * 0.12;
        if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
        if (d.x > 1) d.x -= 1;
        const x = d.x * vw, y = d.y * vh;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + d.l);
        ctx.stroke();
      }
      ctx.restore();
    } else if (type === 'snow') {
      ctx.save();
      for (const d of SNOW) {
        d.y += dt * 0.09 * d.s;
        d.p += dt * 0.8;
        d.x += Math.sin(d.p) * dt * 0.012;
        if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
        if (d.x > 1) d.x -= 1;
        if (d.x < 0) d.x += 1;
        ctx.fillStyle = 'rgba(228, 236, 238, ' + (0.28 + d.s * 0.35) + ')';
        ctx.beginPath();
        ctx.arc(d.x * vw, d.y * vh, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /* 边框装饰 */
  function drawFrame() {
    ctx.save();
    ctx.strokeStyle = 'rgba(192, 162, 106, .18)';
    ctx.lineWidth = 1;
    const m = 10;
    const len = 26;
    ctx.beginPath();
    ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
    ctx.moveTo(vw - m - len, m); ctx.lineTo(vw - m, m); ctx.lineTo(vw - m, m + len);
    ctx.moveTo(m, vh - m - len); ctx.lineTo(m, vh - m); ctx.lineTo(m + len, vh - m);
    ctx.moveTo(vw - m - len, vh - m); ctx.lineTo(vw - m, vh - m); ctx.lineTo(vw - m, vh - m - len);
    ctx.stroke();
    ctx.restore();
  }

  Render.setHover = function (id) { Render.hoverId = id; };
  Render.setSelected = function (units) { Render.selected = units || []; Render.invalidateReach(); };
  Render.setWeather = function (w) { Render.weather = w; };
  Render.setMouse = function (m) { Render.mouse = m; };

})(typeof window !== 'undefined' ? window : globalThis);
