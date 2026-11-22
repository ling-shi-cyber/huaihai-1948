/* ============================================================
   淮海战役 · 战役引擎
   回合推进、行军寻路、补给与包围、战斗结算、敌军 AI、历史事件
   纯逻辑，无 DOM 依赖（可在 Node 中推演验证）
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const D = HX.Data;
  const Geo = HX.Geo;
  const Engine = HX.Engine = {};
  const INF = 1e9;
  const ENGAGE = 34;

  /* ---------------- 基础工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function rng(s) {
    s.rngState = (s.rngState + 0x6D2B79F5) | 0;
    let t = s.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  }
  function fmtDate(iso) {
    const p = iso.split('-');
    return p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日';
  }
  function fmtTroops(n) {
    n = Math.round(n);
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return n.toLocaleString('en-US');
  }

  Engine.util = { addDays: addDays, daysBetween: daysBetween, fmtDate: fmtDate, fmtTroops: fmtTroops, clamp: clamp };

  /* ---------------- 天气 ---------------- */
  function weatherFor(iso) {
    let plan = null;
    for (const p of D.weatherPlan) if (iso >= p.from && iso <= p.to) { plan = p; break; }
    if (!plan) plan = D.weatherPlan[D.weatherPlan.length - 1];
    const daySeed = daysBetween(D.startDate, iso);
    const variance = ((daySeed * 37) % 5) - 2;
    const labels = { clear: '晴', cloudy: '多云', rain: '阴雨', snow: '大雪' };
    const move = plan.type === 'rain' ? 0.82 : plan.type === 'snow' ? 0.72 : 1;
    const air = plan.type === 'clear' ? 1 : plan.type === 'cloudy' ? 0.5 : 0;
    return {
      type: plan.type, label: labels[plan.type], temp: plan.temp + variance,
      note: plan.note, moveFactor: move, airFactor: air,
      move: move
    };
  }
  Engine.weatherFor = weatherFor;

  /* ---------------- 建立战役 ---------------- */
  Engine.create = function (opts) {
    opts = opts || {};
    if (!HX._gridBase) HX._gridBase = Geo.build(D.map);
    const grid = Geo.clone(HX._gridBase);
    const seed = opts.seed || 19481106;
    const s = {
      seed: seed, rngState: seed,
      date: D.startDate, day: 1,
      grid: grid,
      units: D.units.map(makeUnit),
      cities: D.map.cities.map(c => Object.assign({}, c, { originalSide: c.side })),
      flags: {},
      stats: {
        kmtLoss: 0, plaLoss: 0, defected: 0, surrendered: 0,
        kmtDestroyed: 0, plaDestroyed: 0, combats: 0, citiesTaken: 0, airdrops: 0
      },
      cp: 5, cpMax: 5,
      cooldowns: { barrage: 0, night: 0, supply: 0, political: 0 },
      pendingEffects: [],
      log: [], frames: [],
      phaseId: 1, ended: false, result: null, pendingChoice: null,
      aiNotes: {}, aiOverrides: {},
      selected: [], weather: null,
      political: false, assaultUntil: null
    };
    s.weather = weatherFor(s.date);
    s.units.forEach(u => {
      if (u.pending) return;
      const p = Geo.nearestPassable(s.grid, u.x, u.y);
      u.x = p.x; u.y = p.y;
    });
    s.bridge = makeBridge(s.grid, 1651, 455, 21);
    computeSupply(s);
    log(s, '战役发起：华东野战军、中原野战军按11月4日攻击命令，向徐州地区国民党军发起进攻。', 'history');
    log(s, '第7兵团黄百韬部正由新安镇、瓦窑西移；第13兵团李弥部控制曹八集、碾庄一线。', 'info');
    return s;
  };

  /* 运河铁桥的动态破坏/修复 */
  function makeBridge(grid, x, y, r) {
    const cells = [];
    const cell = grid.cell;
    const c0x = Math.floor((x - r) / cell), c1x = Math.floor((x + r) / cell);
    const c0y = Math.floor((y - r) / cell), c1y = Math.floor((y + r) / cell);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) continue;
        const wx = cx * cell + cell / 2, wy = cy * cell + cell / 2;
        if (Math.hypot(wx - x, wy - y) > r) continue;
        const i = cy * grid.cols + cx;
        cells.push({ i: i, cost: grid.cost[i], sc: grid.supplyCost[i] });
      }
    }
    return { x: x, y: y, r: r, cells: cells, destroyed: false };
  }

  Engine.setBridge = function (s, destroyed) {
    if (!s.bridge) return;
    for (const c of s.bridge.cells) {
      s.grid.cost[c.i] = destroyed ? INF : c.cost;
      s.grid.supplyCost[c.i] = destroyed ? INF : c.sc;
    }
    s.bridge.destroyed = destroyed;
  };

  function makeUnit(data) {
    const u = Object.assign({}, data);
    u.maxTroops = data.troops;
    u.alive = !data.spawn;
    u.pending = !!data.spawn;
    u.spawnDate = data.spawn || null;
    u.order = { type: 'defend' };
    u.targetId = null;
    u.supplied = true;
    u.encircled = false;
    u.entrench = data.entrench != null ? data.entrench : (data.faction === 'kmt' ? 10 : 0);
    u.flagBarrage = false;
    u.flagNight = false;
    u.flagAssault = false;
    return u;
  }

  /* ---------------- 查询 ---------------- */
  Engine.unitById = function (s, id) { return s.units.find(u => u.id === id) || null; };
  Engine.cityById = function (s, id) { return s.cities.find(c => c.id === id) || null; };
  Engine.alive = function (s, faction) { return s.units.filter(u => u.alive && u.faction === faction); };
  Engine.phaseOf = function (s) {
    for (const p of D.phases) if (s.date >= p.from && s.date <= p.to) return p;
    return D.phases[D.phases.length - 1];
  };
  Engine.phaseProgress = function (s) {
    const ph = Engine.phaseOf(s);
    const total = daysBetween(ph.from, ph.to) + 1;
    const past = clamp(daysBetween(ph.from, s.date) + 1, 1, total);
    return { phase: ph, day: past, total: total };
  };
  Engine.nearestUnit = function (s, x, y, faction, maxD, excludeId) {
    let best = null, bd = maxD == null ? 1e9 : maxD;
    for (const u of s.units) {
      if (!u.alive || u.pending) continue;
      if (faction && u.faction !== faction) continue;
      if (excludeId && u.id === excludeId) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) { bd = d; best = u; }
    }
    return best ? { unit: best, dist: bd } : null;
  };
  Engine.nearestCity = function (s, x, y, maxD) {
    let best = null, bd = maxD == null ? 1e9 : maxD;
    for (const c of s.cities) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  Engine.nearestDepot = function (s, u) {
    let best = null, bd = 1e9;
    for (const c of s.cities) {
      if (c.side !== u.faction || !c.depot) continue;
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  /* ---------------- 纪录 ---------------- */
  function log(s, text, type, x, y) {
    s.log.push({ date: s.date, text: text, type: type || 'info', x: x, y: y });
    if (s.log.length > 400) s.log.shift();
  }
  Engine.log = log;

  /* ---------------- 行军预算 ---------------- */
  function unitBudget(s, u) {
    let b = 200 * (u.mobility || 1) * s.weather.moveFactor;
    b *= 0.66 + 0.34 * (u.supply / 100);
    b *= 1 - 0.32 * (u.fatigue / 100);
    if (u.order && u.order.type === 'retreat') b *= 1.12;
    if (u.hq) b *= 1.1;
    if (u.faction === 'kmt' && u.encircled) b *= 0.8;
    return b;
  }
  Engine.unitBudget = unitBudget;

  /* ---------------- 寻路 ---------------- */
  function bestPath(s, u, tx, ty, budget) {
    const grid = s.grid;
    const flood = Geo.flood(grid, u.x, u.y, budget || 7000);
    let path = Geo.pathFrom(grid, flood, tx, ty);
    if (path && path.length) return path;
    // 目标不可达：走向最接近目标的可达点
    let bestIdx = -1, bestScore = Infinity;
    const cols = grid.cols, cell = grid.cell;
    for (let i = 0; i < flood.dist.length; i++) {
      const d = flood.dist[i];
      if (d >= INF) continue;
      const cx = i % cols, cy = (i - cx) / cols;
      const wx = cx * cell + cell / 2, wy = cy * cell + cell / 2;
      const score = Math.hypot(wx - tx, wy - ty) + d * 0.002;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx < 0) return null;
    return Geo.pathToIndex(grid, flood, bestIdx);
  }
  Engine.bestPath = bestPath;

  /* ---------------- 命令 ---------------- */
  function canCommand(s, u) {
    return u && u.alive && !u.pending && u.faction === 'pla' && !s.ended;
  }

  Engine.orderMove = function (s, ids, x, y) {
    if (!Array.isArray(ids)) ids = [ids];
    let n = 0;
    for (const id of ids) {
      const u = Engine.unitById(s, id);
      if (!canCommand(s, u)) continue;
      const p = Geo.nearestPassable(s.grid, x, y);
      const path = bestPath(s, u, p.x, p.y);
      u.order = { type: 'move', x: p.x, y: p.y, path: path };
      u.targetId = null;
      n++;
    }
    return n;
  };

  Engine.orderAttack = function (s, ids, targetId) {
    if (!Array.isArray(ids)) ids = [ids];
    const target = Engine.unitById(s, targetId);
    if (!target || !target.alive) return 0;
    let n = 0;
    for (const id of ids) {
      const u = Engine.unitById(s, id);
      if (!canCommand(s, u)) continue;
      const path = bestPath(s, u, target.x, target.y);
      u.order = { type: 'attack', targetId: targetId, x: target.x, y: target.y, path: path };
      u.targetId = targetId;
      n++;
    }
    return n;
  };

  Engine.orderDefend = function (s, ids) {
    if (!Array.isArray(ids)) ids = [ids];
    ids.forEach(id => {
      const u = Engine.unitById(s, id);
      if (!canCommand(s, u)) return;
      u.order = { type: 'defend' }; u.targetId = null;
    });
  };

  Engine.orderFortify = function (s, ids) {
    if (!Array.isArray(ids)) ids = [ids];
    ids.forEach(id => {
      const u = Engine.unitById(s, id);
      if (!canCommand(s, u)) return;
      u.order = { type: 'fortify' }; u.targetId = null;
    });
  };

  Engine.orderRest = function (s, ids) {
    if (!Array.isArray(ids)) ids = [ids];
    ids.forEach(id => {
      const u = Engine.unitById(s, id);
      if (!canCommand(s, u)) return;
      u.order = { type: 'rest' }; u.targetId = null;
    });
  };

  Engine.orderRetreat = function (s, ids) {
    if (!Array.isArray(ids)) ids = [ids];
    ids.forEach(id => {
      const u = Engine.unitById(s, id);
      if (!canCommand(s, u)) return;
      const foe = Engine.nearestUnit(s, u.x, u.y, u.faction === 'pla' ? 'kmt' : 'pla', 420);
      let tx = u.x, ty = u.y;
      if (foe) {
        const a = Math.atan2(u.y - foe.unit.y, u.x - foe.unit.x);
        tx = clamp(u.x + Math.cos(a) * 160, 20, D.map.w - 20);
        ty = clamp(u.y + Math.sin(a) * 160, 20, D.map.h - 20);
      }
      const p = Geo.nearestPassable(s.grid, tx, ty);
      u.order = { type: 'retreat', x: p.x, y: p.y, path: bestPath(s, u, p.x, p.y) };
      u.targetId = null;
    });
  };

  /* ---------------- 战役级行动 ---------------- */
  Engine.abilities = [
    { id: 'barrage', name: '炮火准备', cost: 2, cd: 2, radius: 105, desc: '集中炮兵对指定地域实施火力准备，该地域内我军本日攻击力+22%。' },
    { id: 'night', name: '夜间攻击', cost: 2, cd: 3, radius: 0, desc: '令选定部队夜间突袭，本日攻击力+18%、敌军工事效果减半，疲劳+6。' },
    { id: 'supply', name: '支前补给', cost: 2, cd: 3, radius: 135, desc: '民工担架队与小车队前送粮弹，地域内我军补给+35、弹药+25。' },
    { id: 'political', name: '政治攻势', cost: 3, cd: 5, radius: 185, desc: '对包围圈内敌军展开火线喊话与劝降，敌士气-12，被围部队可能投诚。', requireDate: '1948-12-01' }
  ];

  Engine.useAbility = function (s, type, x, y, ids) {
    const ab = Engine.abilities.find(a => a.id === type);
    if (!ab) return { ok: false, msg: '未知行动' };
    if (s.cp < ab.cost) return { ok: false, msg: '指挥点不足' };
    if ((s.cooldowns[type] || 0) > 0) return { ok: false, msg: '尚需休整' };
    if (ab.requireDate && s.date < ab.requireDate) return { ok: false, msg: '时机未到' };
    s.cp -= ab.cost;
    s.cooldowns[type] = ab.cd;
    s.pendingEffects.push({ type: type, x: x, y: y, ids: ids || [], radius: ab.radius });
    log(s, '下达战役指令：' + ab.name + '。', 'order', x, y);
    return { ok: true, msg: ab.name + '已下达' };
  };

  function applyEffects(s, frames) {
    for (const ef of s.pendingEffects) {
      const targets = s.units.filter(u => u.alive && !u.pending && u.faction === 'pla' &&
        (ef.type === 'night' ? (ef.ids.indexOf(u.id) >= 0) : Math.hypot(u.x - ef.x, u.y - ef.y) <= ef.radius));
      if (ef.type === 'barrage') {
        targets.forEach(u => { u.flagBarrage = true; });
        log(s, '炮兵对 ' + cityNearText(s, ef.x, ef.y) + ' 地域实施火力准备。', 'order', ef.x, ef.y);
        frames.push({ kind: 'barrage', x: ef.x, y: ef.y, r: ef.radius });
      } else if (ef.type === 'night') {
        targets.forEach(u => { u.flagNight = true; u.fatigue = Math.min(100, u.fatigue + 6); });
        log(s, '夜间攻击：' + (targets.map(t => t.short).join('、') || '指定部队') + ' 利用夜暗接敌。', 'order', ef.x, ef.y);
        frames.push({ kind: 'night', x: ef.x, y: ef.y });
      } else if (ef.type === 'supply') {
        targets.forEach(u => { u.supply = Math.min(100, u.supply + 35); u.ammo = Math.min(100, u.ammo + 25); });
        log(s, '支前民工队向 ' + cityNearText(s, ef.x, ef.y) + ' 前线输送粮弹。', 'order', ef.x, ef.y);
        frames.push({ kind: 'supply', x: ef.x, y: ef.y, r: ef.radius });
      } else if (ef.type === 'political') {
        const foes = s.units.filter(u => u.alive && u.faction === 'kmt' && Math.hypot(u.x - ef.x, u.y - ef.y) <= ef.radius);
        foes.forEach(u => {
          u.morale = Math.max(2, u.morale - 12);
          if (!u.supplied && u.morale < 28 && rng(s) < 0.45) surrenderUnit(s, u, frames);
        });
        log(s, '对包围圈内敌军展开政治攻势，火线喊话、散发传单。', 'order', ef.x, ef.y);
        frames.push({ kind: 'political', x: ef.x, y: ef.y, r: ef.radius });
      }
    }
    s.pendingEffects = [];
  }

  function cityNearText(s, x, y) {
    const c = Engine.nearestCity(s, x, y, 70);
    return c ? c.name : '指定地域';
  }

  /* ---------------- 补给与包围 ---------------- */
  function computeSupply(s) {
    function nearField(x, y, field, rCells) {
      if (!field) return false;
      const cell = s.grid.cell;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dy = -rCells; dy <= rCells; dy++) {
        for (let dx = -rCells; dx <= rCells; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= s.grid.cols || ny >= s.grid.rows) continue;
          if (field.dist[ny * s.grid.cols + nx] < INF) return true;
        }
      }
      return false;
    }
    for (const faction of ['pla', 'kmt']) {
      const foeFaction = faction === 'pla' ? 'kmt' : 'pla';
      const n = s.grid.n;
      const zoc = new Uint8Array(n);
      const cover = new Uint8Array(n);
      for (const u of s.units) {
        if (!u.alive || u.pending) continue;
        if (u.faction === foeFaction) Geo.markCircle(s.grid, u.x, u.y, 24, zoc);
        else Geo.markCircle(s.grid, u.x, u.y, 15, cover);
      }
      const blocked = (i) => zoc[i] && !cover[i];
      const activeDepots = [];
      for (const c of s.cities) {
        if (c.side !== faction || !c.depot) continue;
        const besieged = s.units.some(u => u.alive && u.faction === foeFaction && Math.hypot(u.x - c.x, u.y - c.y) < 50);
        if (!besieged) activeDepots.push({ x: c.x, y: c.y });
      }
      let corridor = null;
      if (activeDepots.length) {
        corridor = Geo.floodMulti(s.grid, activeDepots, 900, { block: blocked, cost: s.grid.supplyCost });
      }
      // 支前民工 / 野战补给：仅解放军拥有流动补给能力
      let hqField = null;
      const hqs = faction === 'pla' ? s.units.filter(u => u.alive && !u.pending && u.faction === faction && u.hq) : [];
      if (hqs.length) {
        hqField = Geo.floodMulti(s.grid, hqs.map(h => ({ x: h.x, y: h.y })), 1050, { block: blocked, cost: s.grid.fieldCost });
      }
      for (const u of s.units) {
        if (!u.alive || u.pending || u.faction !== faction) continue;
        if (u.hq) { u.supplied = true; u.encircled = false; continue; }
        const i = Geo.cellIndex(s.grid, u.x, u.y);
        let ok = false;
        // 1) 距补给基地 120px 内直接前送
        for (const d of activeDepots) {
          if (Math.hypot(u.x - d.x, u.y - d.y) <= 120) { ok = true; break; }
        }
        // 2) 铁路、公路补给走廊（允许 32px 内的短途转运）
        if (!ok && corridor) {
          if (corridor.dist[i] < INF || nearField(u.x, u.y, corridor, 3)) ok = true;
        }
        // 3) 支前民工野战补给
        if (!ok && hqField && hqField.dist[i] < INF) ok = true;
        u.supplied = ok;
        u.encircled = !ok;
      }
    }
  }
  Engine.computeSupply = computeSupply;

  function supplyTick(s, frames) {
    computeSupply(s);
    let encircledKmt = 0;
    for (const u of s.units) {
      if (!u.alive || u.pending) continue;
      if (u.supplied) {
        const gain = u.faction === 'pla' ? 13 : 11;
        u.supply = Math.min(100, u.supply + gain);
        u.ammo = Math.min(100, u.ammo + (u.faction === 'pla' ? 11 : 9));
      } else {
        u.supply = Math.max(0, u.supply - (u.faction === 'pla' ? 11 : 13));
        u.ammo = Math.max(0, u.ammo - 9);
        u.morale = Math.max(2, u.morale - 1.2);
        if (u.supply <= 0) u.morale = Math.max(2, u.morale - 1.2);
        if (u.faction === 'kmt') encircledKmt++;
      }
    }
    // 空投：天晴时向被围国民党军投送粮弹
    if (encircledKmt > 0 && s.date >= '1948-11-25' && s.weather.type !== 'rain' && s.weather.type !== 'snow' && rng(s) < 0.7) {
      const pocket = s.units.filter(u => u.alive && u.faction === 'kmt' && !u.supplied && !u.hq);
      pocket.slice(0, 4).forEach(u => { u.supply = Math.min(60, u.supply + 12); u.ammo = Math.min(60, u.ammo + 6); });
      s.stats.airdrops++;
      log(s, '国民党空军向被围部队空投粮弹，多数落入我军阵地。', 'info');
      frames.push({ kind: 'airdrop' });
    }
    // 严寒与断粮减员
    if (s.weather.type === 'snow') {
      for (const u of s.units) {
        if (!u.alive || u.pending || u.supplied) continue;
        const loss = u.troops * 0.0035;
        applyLoss(s, u, loss);
        u.morale = Math.max(2, u.morale - 0.8);
      }
    }
    for (const u of s.units) {
      if (!u.alive || u.pending || u.supplied || u.supply > 0) continue;
      const starve = u.troops * (u.faction === 'kmt' ? 0.005 : 0.002);
      applyLoss(s, u, starve);
      u.morale = Math.max(2, u.morale - 1);
    }
  }

  /* ---------------- 战斗 ---------------- */
  function powerOf(s, u, mode, ctx) {
    ctx = ctx || {};
    const t = u.troops / 1000;
    const mor = 0.35 + 0.75 * (u.morale / 100);
    const sup = 0.55 + 0.5 * (u.supply / 100);
    const fat = 1 - 0.42 * (u.fatigue / 100);
    let mult = t * (u.combat || 1) * mor * sup * fat;
    const i = Geo.cellIndex(s.grid, u.x, u.y);
    const terrain = s.grid;
    if (mode === 'def') {
      mult *= 1 + 0.62 * (u.entrench / 100);
      const city = Engine.nearestCity(s, u.x, u.y, 26);
      if (city && city.side === u.faction) {
        const cm = city.tier === 'major' ? 1.35 : city.tier === 'city' ? 1.22 : city.tier === 'town' ? 1.12 : 1.04;
        mult *= cm;
      }
      if (terrain.height[i] > 0.2) mult *= 1.12;
      if (terrain.urban[i]) mult *= 1.05;
      mult *= 1 + hqBonus(s, u) * 0.7;
    } else {
      if (u.flagBarrage) mult *= 1.22;
      if (u.flagNight) mult *= 1.18;
      if (u.flagAssault) mult *= 1.15;
      if (ctx.river) mult *= 0.72;
      if (ctx.flank) mult *= 1.12;
      if (terrain.height[i] > 0.24) mult *= 0.94;
      mult *= 1 + hqBonus(s, u);
    }
    return mult;
  }

  function hqBonus(s, u) {
    let bonus = 0;
    for (const h of s.units) {
      if (!h.alive || !h.hq || h.faction !== u.faction || h.id === u.id) continue;
      if (dist(h, u) < 175) bonus = Math.max(bonus, 0.07);
    }
    return bonus;
  }

  function isFlanked(target, attackers) {
    if (attackers.length < 2) return false;
    const qs = new Set();
    for (const a of attackers) {
      let ang = Math.atan2(a.y - target.y, a.x - target.x);
      ang = (ang + Math.PI * 2) % (Math.PI * 2);
      qs.add(Math.floor(ang / (Math.PI / 2)));
    }
    for (let q = 0; q < 2; q++) if (qs.has(q) && qs.has(q + 2)) return true;
    return false;
  }

  function applyLoss(s, u, amount) {
    if (!u.alive || amount <= 0) return 0;
    const loss = Math.min(u.troops, amount);
    u.troops -= loss;
    if (u.faction === 'kmt') s.stats.kmtLoss += loss;
    else if (u.faction === 'pla') s.stats.plaLoss += loss;
    return loss;
  }

  function destroyUnit(s, u, how, frames, creditFaction) {
    if (!u.alive) return;
    u.alive = false;
    u.order = { type: 'defend' };
    const remaining = Math.max(0, u.troops);
    if (u.faction === 'kmt') {
      s.stats.kmtLoss += remaining;
      s.stats.kmtDestroyed++;
      if (how === '投诚' || how === '起义') s.stats.surrendered = (s.stats.surrendered || 0) + 1;
    } else {
      s.stats.plaLoss += remaining;
      s.stats.plaDestroyed++;
    }
    u.troops = 0;
    const label = how === '起义' ? '起义' : how === '投诚' ? '投诚' : how === '突围被歼' ? '突围被歼' : how === '溃散' ? '溃散' : '被歼';
    log(s, (u.faction === 'kmt' ? '国民党军' : '我军') + u.name + '（' + u.short + '）' + label + '。', u.faction === 'kmt' ? 'victory' : 'loss', u.x, u.y);
    frames.push({ kind: 'destroy', x: u.x, y: u.y, name: u.name, short: u.short, faction: u.faction, how: label });
    if (u.faction === 'kmt') {
      for (const v of s.units) {
        if (v.alive && v.faction === 'pla' && dist(v, u) < 120) v.morale = Math.min(100, v.morale + 1.5);
      }
    }
  }

  function surrenderUnit(s, u, frames) {
    if (u.faction !== 'kmt') return;    u.surrendered = true;
    const remaining = u.troops;
    s.stats.surrendered = (s.stats.surrendered || 0) + 1;
    s.stats.kmtLoss += remaining;
    u.troops = 0; u.alive = false;
    log(s, '国民党军' + u.name + '残部' + fmtTroops(remaining) + '人向我军投诚。', 'victory', u.x, u.y);
    frames.push({ kind: 'destroy', x: u.x, y: u.y, name: u.name, short: u.short, faction: 'kmt', how: '投诚' });
  }

  function routUnit(s, u, awayFrom, frames) {
    let ang = Math.atan2(u.y - awayFrom.y, u.x - awayFrom.x) + (rng(s) - 0.5) * 0.6;
    // 向己方补给基地方向偏转
    const depot = Engine.nearestDepot(s, u);
    if (depot) {
      const toDepot = Math.atan2(depot.y - u.y, depot.x - u.x);
      ang = ang * 0.55 + toDepot * 0.45;
    }
    const tx = clamp(u.x + Math.cos(ang) * 105, 20, D.map.w - 20);
    const ty = clamp(u.y + Math.sin(ang) * 105, 20, D.map.h - 20);
    const p = Geo.nearestPassable(s.grid, tx, ty);
    u.x = p.x; u.y = p.y;
    u.troops *= 0.94;
    u.morale = Math.max(8, u.morale - 4);
    u.entrench = 0;
    u.order = { type: 'defend' };
    log(s, u.short + '阵地被突破，溃退。', 'combat', u.x, u.y);
    frames.push({ kind: 'rout', x: u.x, y: u.y, faction: u.faction });
  }

  function assessEngagement(s, attackers, target) {
    const support = s.units.filter(v => v.alive && v.faction === target.faction && v.id !== target.id &&
      Math.hypot(v.x - target.x, v.y - target.y) < 50);
    const extra = s.units.filter(v => v.alive && v.faction === attackers[0].faction &&
      attackers.indexOf(v) < 0 && Math.hypot(v.x - target.x, v.y - target.y) < 48);

    let Dp = powerOf(s, target, 'def');
    const defBase = Dp;
    let supportPower = 0;
    support.slice(0, 3).forEach(v => {
      const p = powerOf(s, v, 'def') * 0.2;
      supportPower += p;
      Dp += p;
    });

    let Ap = 0;
    let riverCount = 0;
    const flank = isFlanked(target, attackers);
    for (const a of attackers) {
      const river = Geo.crossesWater(s.grid, a.x, a.y, target.x, target.y);
      if (river) riverCount++;
      Ap += powerOf(s, a, 'atk', { river: river, flank: flank });
    }
    let extraPower = 0;
    extra.slice(0, 4).forEach(v => {
      const p = powerOf(s, v, 'def') * 0.1;
      extraPower += p;
      Ap += p;
    });

    const arty = s.units.filter(v => v.alive && v.faction === attackers[0].faction && v.type === 'art' &&
      Math.hypot(v.x - target.x, v.y - target.y) < 135);
    let artyPower = 0;
    arty.slice(0, 2).forEach(v => {
      const p = powerOf(s, v, 'atk') * 0.3;
      artyPower += p;
      Ap += p;
    });

    const multiBonus = Math.min(0.18, Math.max(0, attackers.length - 1) * 0.045);
    Ap *= 1 + multiBonus;

    const ratio = Ap / Math.max(6, Dp);
    const defLossBaseF = clamp(0.01 + 0.052 * ratio, 0.006, 0.22);
    const atkLossBaseF = clamp(0.0015 + 0.006 / Math.max(0.35, ratio), 0.0015, 0.04);
    const atkPool = attackers.reduce((a, u) => a + u.troops, 0);

    function atkLossFor(f) {
      let total = 0;
      for (const a of attackers) {
        const share = atkPool > 0 ? a.troops / atkPool : 1 / attackers.length;
        total += Math.min(a.troops * 0.06, atkPool * f * share);
      }
      return total;
    }

    const factors = [];
    const warnings = [];
    const push = (label, value, tone) => factors.push({ label: label, value: value, tone: tone || '' });

    if (riverCount > 0) {
      push('渡河攻击', '-' + (riverCount > 1 ? '28%×' + riverCount : '28%'), 'bad');
    }
    if (flank) push('侧翼合击', '+12%', 'good');
    if (attackers.length > 1) push('多路协同', '+' + Math.round(multiBonus * 100) + '%', 'good');
    if (artyPower > 0) push('炮兵支援', '+' + Math.round(artyPower / Math.max(1, Ap - artyPower) * 100) + '%', 'good');
    if (extraPower > 0) push('附近友军火力', '+' + Math.round(extraPower / Math.max(1, Ap - extraPower) * 100) + '%', 'good');
    const anyBarrage = attackers.some(a => a.flagBarrage);
    const anyNight = attackers.some(a => a.flagNight);
    const anyAssault = attackers.some(a => a.flagAssault);
    if (anyBarrage) push('炮火准备', '+22%', 'good');
    if (anyNight) push('夜间攻击', '+18%', 'good');
    if (anyAssault) push('突击', '+15%', 'good');

    const hqAtk = Math.max.apply(null, attackers.map(a => hqBonus(s, a)).concat([0]));
    if (hqAtk > 0) push('我军指挥所靠前', '+' + Math.round(hqAtk * 100) + '%', 'good');
    const hqDef = hqBonus(s, target);
    if (hqDef > 0) push('敌军指挥所督战', '+' + Math.round(hqDef * 70) + '%', 'bad');

    if (target.entrench > 0) push('敌军工事', '+' + Math.round(target.entrench * 0.62) + '%', 'bad');
    const city = Engine.nearestCity(s, target.x, target.y, 26);
    if (city && city.side === target.faction) {
      const cm = city.tier === 'major' ? 1.35 : city.tier === 'city' ? 1.22 : city.tier === 'town' ? 1.12 : 1.04;
      push('敌军据' + city.name + '防御', '+' + Math.round((cm - 1) * 100) + '%', 'bad');
    }
    const ti = Geo.cellIndex(s.grid, target.x, target.y);
    if (s.grid.height[ti] > 0.2) push('敌军占据高地', '+12%', 'bad');
    if (s.grid.urban[ti]) push('敌军依托城区', '+5%', 'bad');
    if (support.length > 0) push('敌军友邻支援', '+' + support.length + ' 部', 'bad');
    const atkHigh = attackers.some(a => {
      const ai = Geo.cellIndex(s.grid, a.x, a.y);
      return s.grid.height[ai] > 0.24;
    });
    if (atkHigh) push('我军仰攻', '-6%', 'bad');

    if (riverCount > 0) warnings.push('渡河攻击会显著削弱我军火力。');
    if (target.entrench >= 45) warnings.push('敌军工事坚固，正面强攻代价较高。');
    if (target.encircled) warnings.push('敌军已被包围，可能投降或溃散。');
    if (target.supply < 30) warnings.push('敌军补给不足，持续作战能力下降。');
    if (attackers.some(a => a.supply < 35)) warnings.push('我军部分部队补给不足，攻击力下降。');
    if (attackers.some(a => a.fatigue > 55)) warnings.push('我军部分部队疲劳较高，建议轮换。');
    if (support.length > 0) warnings.push('敌军附近有 ' + support.length + ' 部友邻，可能加入防御。');
    if (attackers.length === 1) warnings.push('单路进攻，没有多路合击加成。');
    if (ratio < 0.85) warnings.push('兵力比不利，建议增兵或先断敌补给。');

    const defLossExpected = target.troops * defLossBaseF;
    const defLossMin = target.troops * defLossBaseF * 0.86;
    const defLossMax = target.troops * defLossBaseF * 1.14;
    const atkLossExpected = atkLossFor(atkLossBaseF * 0.9);
    const atkLossMin = atkLossFor(atkLossBaseF * 0.76);
    const atkLossMax = atkLossFor(atkLossBaseF * 1.04);

    let verdict;
    if (ratio >= 2.0) verdict = '优势明显';
    else if (ratio >= 1.35) verdict = '较有把握';
    else if (ratio >= 1.0) verdict = '势均力敌';
    else if (ratio >= 0.75) verdict = '较为不利';
    else verdict = '风险很高';

    return {
      support: support,
      extra: extra,
      arty: arty,
      flank: flank,
      riverCount: riverCount,
      defBase: defBase,
      supportPower: supportPower,
      extraPower: extraPower,
      artyPower: artyPower,
      preMulti: Ap / (1 + multiBonus),
      multiBonus: multiBonus,
      Dp: Dp,
      Ap: Ap,
      ratio: ratio,
      atkPool: atkPool,
      defLossBaseF: defLossBaseF,
      atkLossBaseF: atkLossBaseF,
      defLossExpected: defLossExpected,
      defLossMin: defLossMin,
      defLossMax: defLossMax,
      atkLossExpected: atkLossExpected,
      atkLossMin: atkLossMin,
      atkLossMax: atkLossMax,
      factors: factors,
      warnings: warnings,
      verdict: verdict
    };
  }

  function resolveEngagement(s, attackers, target, frames) {
    const A = assessEngagement(s, attackers, target);
    const ratio = A.ratio;

    const r1 = 0.86 + rng(s) * 0.28;
    const defLossF = A.defLossBaseF * r1;
    const defLoss = applyLoss(s, target, target.troops * defLossF);
    const atkLossF = A.atkLossBaseF * (1.9 - r1);
    const atkPool = A.atkPool;
    let atkLossTotal = 0;
    for (const a of attackers) {
      const share = atkPool > 0 ? a.troops / atkPool : 1 / attackers.length;
      const per = Math.min(a.troops * 0.06, atkPool * atkLossF * share);
      atkLossTotal += applyLoss(s, a, per);
      a.fatigue = Math.min(100, a.fatigue + 7);
      a.ammo = Math.max(0, a.ammo - 7);
      a.morale = clamp(a.morale + (ratio > 1.2 ? 1.3 : -2.4), 3, 100);
      a.entrench = Math.max(0, a.entrench - 4);
    }
    target.morale = clamp(target.morale - clamp(2 + 4 * ratio, 1.5, 12), 2, 100);
    target.fatigue = Math.min(100, target.fatigue + 5);
    target.entrench = Math.max(0, target.entrench - 10);
    s.stats.combats++;

    const place = (Engine.nearestCity(s, target.x, target.y, 40) || {}).name || '野外';
    const factorText = A.factors.slice(0, 5).map(f => f.label + (f.value ? ' ' + f.value : '')).join('，');
    log(s, '【' + place + '】' + attackers.map(a => a.short).join('、') + ' 围攻 ' + target.short +
      '，敌伤亡 ' + fmtTroops(defLoss) + '，我伤亡 ' + fmtTroops(atkLossTotal) + '。' +
      (factorText ? '（' + factorText + '）' : ''), 'combat', target.x, target.y);
    frames.push({
      kind: 'combat', x: (target.x + attackers[0].x) / 2, y: (target.y + attackers[0].y) / 2,
      targetX: target.x, targetY: target.y, defLoss: defLoss, atkLoss: atkLossTotal,
      attacker: attackers.map(a => a.short).join('·'), target: target.short, ratio: ratio,
      factors: factorText
    });


    if (target.alive && target.troops < Math.max(1600, target.maxTroops * 0.15)) {
      destroyUnit(s, target, '被歼', frames);
    } else if (target.alive && target.morale < 15 && target.encircled && target.faction === 'kmt' && target.troops < target.maxTroops * 0.35) {
      surrenderUnit(s, target, frames);
    } else if (target.alive && target.morale < 18 && target.encircled && target.faction === 'pla') {
      target.morale = 30;
      routUnit(s, target, attackers[0], frames);
    } else if (target.alive && !target.encircled && ratio > 1.8 && target.morale < 52 && rng(s) < 0.6) {
      routUnit(s, target, attackers[0], frames);
    } else if (target.alive && target.morale < 22 && ratio > 1.15 && !target.encircled && rng(s) < 0.55) {
      routUnit(s, target, attackers[0], frames);
    }
    for (const a of attackers) {
      if (a.alive && a.troops < Math.max(1200, a.maxTroops * 0.13)) destroyUnit(s, a, '被歼', frames);
      else if (a.alive && !a.encircled && a.troops < a.maxTroops * 0.3 && a.morale < 45 && rng(s) < 0.6) routUnit(s, a, target, frames);
    }
  }

  Engine.previewCombat = function (s, ids, targetId) {
    if (!Array.isArray(ids)) ids = [ids];
    const target = Engine.unitById(s, targetId);
    if (!target || !target.alive || target.faction === 'pla') return null;
    const attackers = ids.map(id => Engine.unitById(s, id))
      .filter(u => u && u.alive && u.faction !== target.faction && canCommand(s, u));
    if (!attackers.length) return null;
    const A = assessEngagement(s, attackers, target);
    const engagedCount = attackers.filter(u => dist(u, target) <= ENGAGE).length;
    A.attackers = attackers;
    A.target = target;
    A.engagedCount = engagedCount;
    A.allEngaged = engagedCount === attackers.length;
    return A;
  };

  /* ---------------- 移动 ---------------- */
  function moveUnitAlong(s, u, budget, frames) {
    const o = u.order;
    if (!o || !o.path || !o.path.length) {
      if (o && (o.type === 'move' || o.type === 'retreat')) u.order = { type: 'defend' };
      return 0;
    }
    const before = { x: u.x, y: u.y };
    const r = Geo.advanceAlong(s.grid, o.path, budget);
    const moved = Math.hypot(r.x - before.x, r.y - before.y);
    if (moved < 0.5) return 0;
    if (Geo.isPassable(s.grid, r.x, r.y)) { u.x = r.x; u.y = r.y; }
    u.fatigue = Math.min(100, u.fatigue + moved / 26);
    u.supply = Math.max(0, u.supply - moved / 220);
    o.path = r.rest;
    if (!r.rest || !r.rest.length || Geo.remainingLength(r.rest) < 8) {
      if (o.type === 'move' || o.type === 'retreat') u.order = { type: 'defend' };
    }
    return moved;
  }

  /* 防止部队完全重叠 */
  function separateUnits(s) {
    const alive = s.units.filter(u => u.alive && !u.pending);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= 15) continue;
        if (d < 0.001) { dx = 1; dy = 0; d = 1; }
        const push = (15 - d) / 2 + 0.5;
        const ax = a.x - dx / d * push, ay = a.y - dy / d * push;
        const bx = b.x + dx / d * push, by = b.y + dy / d * push;
        if (Geo.isPassable(s.grid, ax, ay)) { a.x = ax; a.y = ay; }
        if (Geo.isPassable(s.grid, bx, by)) { b.x = bx; b.y = by; }
      }
    }
  }

  /* 兵团部失去部队后随之覆灭 */
  function cleanupHq(s, frames) {
    const groups = {};
    for (const u of s.units) {
      if (!u.alive || u.pending || u.faction !== 'kmt' || !u.group) continue;
      if (!groups[u.group]) groups[u.group] = { combat: 0, hq: [] };
      if (u.hq) groups[u.group].hq.push(u);
      else groups[u.group].combat++;
    }
    for (const g of Object.keys(groups)) {
      if (groups[g].combat > 0) continue;
      for (const h of groups[g].hq) if (h.alive) destroyUnit(s, h, '被歼', frames);
    }
  }

  /* ---------------- AI ---------------- */
  function pickStance(s, groupId) {
    const g = D.groups[groupId];
    if (!g) return null;
    const entries = g.plan.concat(s.aiOverrides[groupId] || []);
    entries.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let cur = null;
    for (const e of entries) if (e.date <= s.date) cur = e;
    return cur;
  }

  function localRatio(s, u, range) {
    let own = 0, foe = 0;
    for (const v of s.units) {
      if (!v.alive || v.pending || v.id === u.id) continue;
      if (Math.hypot(v.x - u.x, v.y - u.y) > range) continue;
      if (v.faction === u.faction) own += v.troops; else foe += v.troops;
    }
    return own / Math.max(1, foe);
  }

  function nearestFoe(s, u, range) {
    const foeFaction = u.faction === 'pla' ? 'kmt' : 'pla';
    let best = null, bd = range;
    for (const v of s.units) {
      if (!v.alive || v.pending || v.faction !== foeFaction || v.hq) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) {
      const any = Engine.nearestUnit(s, u.x, u.y, foeFaction, range);
      if (any) best = any.unit;
    }
    return best ? { unit: best, dist: bd } : null;
  }

  function issueAttack(s, u, target) {
    u.order = { type: 'attack', targetId: target.id, x: target.x, y: target.y, path: bestPath(s, u, target.x, target.y) };
    u.targetId = target.id;
  }
  function issueMove(s, u, tx, ty) {
    const p = Geo.nearestPassable(s.grid, tx, ty);
    if (u.order && u.order.type === 'move' && u.order.x != null &&
      Math.hypot(u.order.x - p.x, u.order.y - p.y) < 30) return;
    u.order = { type: 'move', x: p.x, y: p.y, path: bestPath(s, u, p.x, p.y) };
    u.targetId = null;
  }
  function issueDefend(s, u, fortify) {
    if (u.order && (u.order.type === 'defend' || u.order.type === 'fortify')) {
      if (fortify && u.order.type !== 'fortify') u.order = { type: 'fortify' };
      return;
    }
    u.order = { type: fortify ? 'fortify' : 'defend' };
    u.targetId = null;
  }

  function aiPlan(s, frames) {
    for (const groupId of Object.keys(D.groups)) {
      const g = D.groups[groupId];
      const cur = pickStance(s, groupId);
      if (!cur) continue;
      const units = s.units.filter(u => u.alive && !u.pending && u.group === groupId);
      if (!units.length) continue;
      const key = groupId + '|' + cur.date + '|' + cur.stance;
      if (s.aiNotes[groupId] !== key) {
        s.aiNotes[groupId] = key;
        if (cur.note) log(s, g.name + '：' + cur.note + '。', 'enemy');
      }
      for (const u of units) {
        const off = u.off || [0, 0];
        const tx = clamp(cur.x + off[0], 24, D.map.w - 24);
        const ty = clamp(cur.y + off[1], 24, D.map.h - 24);
        const foe = nearestFoe(s, u, 105);
        const foeClose = nearestFoe(s, u, 46);
        const ratio = localRatio(s, u, 80);
        if (u.hq) {
          const threat = Engine.nearestUnit(s, u.x, u.y, 'pla', 115);
          if (threat && threat.dist < 95) {
            const ang = Math.atan2(u.y - threat.unit.y, u.x - threat.unit.x);
            issueMove(s, u, clamp(u.x + Math.cos(ang) * 95, 24, D.map.w - 24), clamp(u.y + Math.sin(ang) * 95, 24, D.map.h - 24));
          } else if (dist(u, { x: tx, y: ty }) > 42) {
            issueMove(s, u, tx, ty);
          } else {
            issueDefend(s, u, false);
          }
          continue;
        }
        // 被围且非死守集团的部队，向己方补给基地靠拢整顿
        if (!u.encircled) u.recoverUntil = null;
        if (u.encircled && u.morale < 55) {
          const noRetreat = ['7b', '7b63', '12b'].indexOf(u.group) >= 0 ||
            (s.date >= '1948-11-30' && ['2b', '13b', '16b', 'xzhq'].indexOf(u.group) >= 0);
          if (!noRetreat) {
            if (!u.recoverUntil) u.recoverUntil = addDays(s.date, 3);
            if (s.date < u.recoverUntil) {
              const depot = Engine.nearestDepot(s, u);
              if (depot && Math.hypot(depot.x - u.x, depot.y - u.y) > 45) issueMove(s, u, depot.x, depot.y);
              else issueDefend(s, u, true);
              continue;
            }
          }
        }
        switch (cur.stance) {
          case 'hold':
          case 'defend': {
            if (foeClose && (ratio > 1.25 + (1 - g.aggression) * 0.4 || g.aggression > 0.6 && ratio > 0.95)) {
              issueAttack(s, u, foeClose.unit);
            } else if (dist(u, { x: tx, y: ty }) > 24) {
              issueMove(s, u, tx, ty);
            } else {
              issueDefend(s, u, true);
            }
            break;
          }
          case 'retreat': {
            if (foeClose && dist(u, foeClose.unit) < 22) {
              issueAttack(s, u, foeClose.unit);
            } else if (dist(u, { x: tx, y: ty }) > 20) {
              issueMove(s, u, tx, ty);
            } else {
              issueDefend(s, u, true);
            }
            break;
          }
          case 'relieve': {
            if (foe && (ratio > 0.55 || g.aggression > 0.45)) issueAttack(s, u, foe.unit);
            else issueMove(s, u, tx, ty);
            break;
          }
          case 'breakout': {
            if (foeClose) issueAttack(s, u, foeClose.unit);
            else issueMove(s, u, tx, ty);
            break;
          }
          default:
            issueDefend(s, u, true);
        }
      }
    }
  }
  Engine.aiPlan = aiPlan;

  /* ---------------- 城市控制 ---------------- */
  function cityCapture(s, frames) {
    for (const c of s.cities) {
      if (c.lastFlip && s.day - c.lastFlip < 2) continue;
      const plaHold = s.units.some(u => u.alive && u.faction === 'pla' &&
        Math.hypot(u.x - c.x, u.y - c.y) < 28 && ['defend', 'fortify', 'rest'].indexOf(u.order.type) >= 0);
      const kmtHold = s.units.some(u => u.alive && u.faction === 'kmt' &&
        Math.hypot(u.x - c.x, u.y - c.y) < 28 && ['defend', 'fortify', 'rest'].indexOf(u.order.type) >= 0);
      const plaNear = s.units.some(u => u.alive && u.faction === 'pla' && Math.hypot(u.x - c.x, u.y - c.y) < 30);
      const kmtNear = s.units.some(u => u.alive && u.faction === 'kmt' && Math.hypot(u.x - c.x, u.y - c.y) < 56);
      if (c.side !== 'pla' && plaHold && !kmtNear) {
        c.side = 'pla'; c.lastFlip = s.day;
        s.stats.citiesTaken++;
        log(s, '我军攻占' + c.name + '。', 'victory', c.x, c.y);
        frames.push({ kind: 'capture', x: c.x, y: c.y, name: c.name, side: 'pla' });
        if (c.id === 'suzhou' && !s.flags.suzhouTaken) {
          s.flags.suzhouTaken = true;
          s.cp = Math.min(s.cpMax, s.cp + 1);
          log(s, '宿县易手，津浦线徐蚌段被切断，徐州国民党军补给大动脉中断。', 'history', c.x, c.y);
          for (const u of s.units) if (u.alive && u.faction === 'kmt') u.morale = Math.max(5, u.morale - 3);
        }
        if (c.id === 'xuzhou' && !s.flags.xuzhouTaken) {
          s.flags.xuzhouTaken = true;
          s.cp = Math.min(s.cpMax, s.cp + 1);
          log(s, '徐州解放。国民党军徐州"剿总"的指挥中枢不复存在。', 'history', c.x, c.y);
        }
      } else if (c.side === 'pla' && kmtHold && !plaNear) {
        c.side = 'kmt'; c.lastFlip = s.day;
        log(s, '国民党军重占' + c.name + '。', 'enemy', c.x, c.y);
        frames.push({ kind: 'capture', x: c.x, y: c.y, name: c.name, side: 'kmt' });
      }
    }
  }

  /* ---------------- 事件 ---------------- */
  function groupAlive(s, groups) {
    return s.units.some(u => (u.alive || u.pending) && u.faction === 'kmt' && groups.indexOf(u.group) >= 0);
  }
  Engine.groupAlive = groupAlive;

  function removeGroupAs(s, groupIds, how, frames) {
    for (const u of s.units) {
      if (!u.alive || u.pending || u.faction !== 'kmt') continue;
      if (groupIds.indexOf(u.group) < 0) continue;
      const remaining = u.troops;
      u.alive = false; u.troops = 0;
      if (how === '起义') { s.stats.defected += remaining; }
      else { s.stats.surrendered = (s.stats.surrendered || 0) + 1; s.stats.kmtLoss += remaining; }
      frames.push({ kind: 'destroy', x: u.x, y: u.y, name: u.name, short: u.short, faction: 'kmt', how: how });
    }
    log(s, (how === '起义' ? '第三绥靖区第59军、第77军大部共2.3万余人，在张克侠、何基沣率领下于贾汪、台儿庄起义，运河防线洞开。' : ''), 'history');
  }

  function spawnArrivals(s, frames) {
    for (const u of s.units) {
      if (!u.pending || !u.spawnDate || s.date < u.spawnDate) continue;
      u.pending = false;
      u.alive = true;
      const p = Geo.nearestPassable(s.grid, u.x, u.y);
      u.x = p.x; u.y = p.y;
      u.morale = u.faction === 'kmt' ? 70 : 85;
      if (!s.flags['spawn_' + u.id]) {
        s.flags['spawn_' + u.id] = true;
      }
    }
    if (s.date === '1948-11-08' && !s.flags.spawn12b) {
      s.flags.spawn12b = true;
      log(s, '黄维第12兵团由确山、驻马店东进，进抵阜阳、太和地区，企图经蒙城、宿县增援徐州。', 'enemy', 900, 1040);
      frames.push({ kind: 'spawn', x: 900, y: 1040, text: '黄维兵团东进' });
    }
    if (s.date === '1948-11-15' && !s.flags.spawn6b) {
      s.flags.spawn6b = true;
      log(s, '李延年第6兵团由蚌埠北上，企图解黄维之围。', 'enemy', 1430, 1095);
      frames.push({ kind: 'spawn', x: 1430, y: 1095, text: '李延年兵团北上' });
    }
    if (s.date === '1948-11-16' && !s.flags.spawn8b) {
      s.flags.spawn8b = true;
      log(s, '刘汝明第8兵团在蚌埠集结。', 'enemy', 1350, 1110);
    }
  }

  function runEvents(s, frames) {
    // 11/08 贾汪起义
    if (!s.flags.jiawang && s.date >= '1948-11-08' && groupAlive(s, ['3s'])) {
      s.flags.jiawang = true;
      removeGroupAs(s, ['3s'], '起义', frames);
      for (const u of s.units) if (u.alive && u.faction === 'kmt') u.morale = Math.max(5, u.morale - 3);
      s.cp = Math.min(s.cpMax + 2, s.cp + 2);
      log(s, '贾汪起义打乱了国民党军运河防线，徐州东北门户洞开。', 'history');
    }
    // 11/09 运河铁桥被炸
    if (!s.flags.bridgeBlown && s.date >= '1948-11-09') {
      s.flags.bridgeBlown = true;
      Engine.setBridge(s, true);
      const u63 = Engine.unitById(s, 'kmt-7b-63');
      if (u63 && u63.alive) { u63.morale = Math.max(5, u63.morale - 6); u63.supply = Math.max(0, u63.supply - 10); }
      log(s, '第7兵团工兵炸毁运河铁桥，第63军及辎重被隔于运河东岸。', 'enemy', 1651, 455);
    }
    // 11/12 华野工兵修复运河铁桥
    if (!s.flags.bridgeFixed && s.date >= '1948-11-12') {
      s.flags.bridgeFixed = true;
      Engine.setBridge(s, false);
      log(s, '华东野战军工兵冒着炮火修复运河铁桥，后续部队与炮兵得以西渡。', 'history', 1651, 455);
    }
    // 11/13 孙良诚投诚
    if (!s.flags.sunlc && s.date >= '1948-11-13') {
      s.flags.sunlc = true;
      const u = Engine.unitById(s, 'kmt-107');
      if (u && u.alive) {
        u.alive = false;
        const rem = u.troops; u.troops = 0;
        s.stats.kmtLoss += rem;
        s.stats.surrendered = (s.stats.surrendered || 0) + 1;
        frames.push({ kind: 'destroy', x: u.x, y: u.y, name: u.name, short: u.short, faction: 'kmt', how: '投诚' });
        log(s, '第107军军部及一个师共5800人在睢宁西北投诚，孙良诚被俘。', 'victory', u.x, u.y);
      }
    }
    // 11/16 总前委
    if (!s.flags.gw && s.date >= '1948-11-16') {
      s.flags.gw = true;
      log(s, '中央军委决定成立总前委，由刘伯承、陈毅、邓小平、粟裕、谭震林组成，邓小平为书记，统一指挥淮海前线。', 'history');
      s.cpMax = 6;
    }
    // 11/22 黄百韬兵团覆灭
    if (!s.flags.p1done && !groupAlive(s, ['7b', '7b63'])) {
      s.flags.p1done = true;
      s.cp = Math.min(s.cpMax, s.cp + 2);
      const reliefNear = s.units.some(u => u.alive && u.faction === 'kmt' && ['2b', '13b'].indexOf(u.group) >= 0 &&
        Math.hypot(u.x - 1562, u.y - 442) < 60);
      if (!reliefNear) { s.flags.reliefBlocked = true; log(s, '围歼黄百韬兵团期间，邱清泉、李弥兵团的东援被阻于大许家、曹八集一线。', 'victory'); }
      log(s, '黄百韬第7兵团覆灭，淮海战役第一阶段作战结束。', 'history');
    }
    // 11/25 黄维被围
    if (!s.flags.hwSurround && s.date >= '1948-11-25' && groupAlive(s, ['12b'])) {
      const close = s.units.filter(u => u.alive && u.faction === 'pla' && Math.hypot(u.x - 1197, u.y - 864) < 90).length;
      if (close >= 3) {
        s.flags.hwSurround = true;
        log(s, '中原野战军将黄维第12兵团合围于双堆集地区。', 'history', 1197, 864);
        frames.push({ kind: 'encircle', x: 1197, y: 864, text: '双堆集合围' });
      }
    }
    // 11/27 廖运周起义
    if (!s.flags.liaoyz && s.date >= '1948-11-27') {
      s.flags.liaoyz = true;
      const u = Engine.unitById(s, 'kmt-12b-85');
      if (u && u.alive) {
        const def = Math.min(5000, u.troops * 0.25);
        u.troops -= def;
        s.stats.defected += def;
        u.morale = Math.max(5, u.morale - 9);
        log(s, '第85军第110师师长廖运周率5000余人起义，黄维突围计划被打乱。', 'history', u.x, u.y);
        frames.push({ kind: 'defect', x: u.x, y: u.y, text: '廖运周起义' });
      }
    }
    // 11/30 徐州弃守
    if (!s.flags.xuzhouAbandon && s.date >= '1948-11-30') {
      s.flags.xuzhouAbandon = true;
      log(s, '杜聿明率徐州主力近30万人弃城西撤，企图经永城南下。', 'enemy', 1300, 520);
      for (const g of ['2b', '13b', '16b']) {
        if (!s.aiOverrides[g]) s.aiOverrides[g] = [];
        s.aiOverrides[g].push({ date: '1948-11-30', stance: 'breakout', x: 1150, y: 560, note: '弃徐州向西南撤退' });
      }
    }
    // 12/03 蒋介石空投手令
    if (!s.flags.airOrder && s.date >= '1948-12-03') {
      s.flags.airOrder = true;
      if (groupAlive(s, ['2b', '13b', '16b'])) {
        log(s, '蒋介石空投亲笔手令，令杜聿明停止西撤，转向濉溪口攻击以解黄维之围。杜聿明被迫遵命。', 'history', 1100, 600);
        for (const g of ['2b', '13b', '16b']) {
          if (!s.aiOverrides[g]) s.aiOverrides[g] = [];
          s.aiOverrides[g].push({ date: '1948-12-03', stance: 'relieve', x: 1163, y: 635, note: '奉空投手令转向濉溪口攻击' });
        }
      }
    }
    // 12/04 陈官庄被围
    if (!s.flags.cgzSurround && s.date >= '1948-12-04' && groupAlive(s, ['2b', '13b', '16b'])) {
      const close = s.units.filter(u => u.alive && u.faction === 'pla' && Math.hypot(u.x - 1071, u.y - 607) < 110).length;
      if (close >= 4) {
        s.flags.cgzSurround = true;
        log(s, '华东野战军将杜聿明集团合围于陈官庄、青龙集地区。', 'history', 1071, 607);
        frames.push({ kind: 'encircle', x: 1071, y: 607, text: '陈官庄合围' });
      }
    }
    // 12/06 孙元良突围
    if (!s.flags.swBreakout && s.date >= '1948-12-06' && groupAlive(s, ['16b'])) {
      s.flags.swBreakout = true;
      for (const u of s.units) {
        if (!u.alive || u.faction !== 'kmt' || u.group !== '16b') continue;
        u.morale = Math.max(5, u.morale - 14);
      }
      if (!s.aiOverrides['16b']) s.aiOverrides['16b'] = [];
      s.aiOverrides['16b'].push({ date: '1948-12-06', stance: 'breakout', x: 1050, y: 500, note: '第16兵团单独向北突围' });
      log(s, '孙元良第16兵团单独突围，遭我军截击。', 'enemy', 1050, 560);
    }
    // 12/06 黄维突围
    if (!s.flags.hwBreakout && s.date >= '1948-12-06' && groupAlive(s, ['12b'])) {
      s.flags.hwBreakout = true;
      log(s, '中原野战军对双堆集发起全线总攻，黄维兵团拼死突围。', 'history', 1197, 864);
    }
    // 12/15 黄维覆灭
    if (!s.flags.p2done && !groupAlive(s, ['12b'])) {
      s.flags.p2done = true;
      s.cp = Math.min(s.cpMax, s.cp + 2);
      const reliefNear = s.units.some(u => u.alive && u.faction === 'kmt' && ['6b', '8b'].indexOf(u.group) >= 0 &&
        Math.hypot(u.x - 1197, u.y - 864) < 80);
      if (!reliefNear) { s.flags.reliefBlocked2 = true; log(s, '李延年、刘汝明兵团北援被阻于固镇、曹老集一线，未能解双堆集之围。', 'victory'); }
      log(s, '黄维第12兵团覆灭，淮海战役第二阶段作战结束。', 'history');
    }
    // 12/17 敦促投降书
    if (!s.flags.surrenderLetter && s.date >= '1948-12-17') {
      s.flags.surrenderLetter = true;
      log(s, '毛泽东《敦促杜聿明等投降书》发表，前线展开大规模政治攻势。', 'history');
    }
    // 01/06 总攻
    if (!s.flags.finalAssault && s.date >= '1949-01-06') {
      s.flags.finalAssault = true;
      s.assaultUntil = addDays(s.date, 3);
      log(s, '华东野战军对陈官庄杜聿明集团发起总攻。', 'history', 1071, 607);
      frames.push({ kind: 'assault', x: 1071, y: 607 });
    }
    // 国民党空军轰炸
    if (s.weather.airFactor > 0.4 && s.date >= '1948-11-10' && s.date < '1949-01-06' && rng(s) < 0.32) {
      const kmtDepots = s.cities.filter(c => c.side === 'kmt' && c.depot && (c.id === 'xuzhou' || c.id === 'bengbu'));
      if (kmtDepots.length) {
        let best = null, bd = 170;
        for (const c of kmtDepots) {
          const near = Engine.nearestUnit(s, c.x, c.y, 'pla', bd);
          if (near) { best = near.unit; bd = near.dist; }
        }
        if (best) {
          const loss = 500 + Math.round(rng(s) * 800);
          applyLoss(s, best, loss);
          best.morale = Math.max(5, best.morale - 1.5);
          log(s, '国民党空军轰炸' + best.short + '，我伤亡' + fmtTroops(loss) + '人。', 'loss', best.x, best.y);
          frames.push({ kind: 'airstrike', x: best.x, y: best.y });
        }
      }
    }
    // 政治攻势效果（仅限陈官庄包围圈）
    if (s.political && s.date <= '1949-01-05') {
      for (const u of s.units) {
        if (!u.alive || u.faction !== 'kmt' || !u.encircled) continue;
        if (Math.hypot(u.x - 1071, u.y - 607) > 230) continue;
        u.morale = Math.max(2, u.morale - 0.9);
        u.supply = Math.max(0, u.supply - 1);
        if (u.morale < 20 && u.troops < u.maxTroops * 0.45 && rng(s) < 0.04) surrenderUnit(s, u, frames);
      }
    }
    return false;
  }

  /* ---------------- 目标 ---------------- */
  Engine.objectiveStatus = function (s, mark) {
    const out = [];
    for (const ph of D.phases) {
      for (const o of ph.objectives) {
        const key = 'obj_' + o.id;
        let done = !!s.flags[key];
        if (!done && o.check(s)) {
          done = true;
          if (mark !== false) {
            s.flags[key] = true;
            log(s, '作战目标达成：' + o.text + '。', 'objective');
            s.cp = Math.min(s.cpMax, s.cp + 1);
          }
        }
        out.push({ id: o.id, text: o.text, done: done, phase: ph.id, weight: o.weight });
      }
    }
    return out;
  };

  /* ---------------- 结局 ---------------- */
  Engine.resultOf = function (s) {
    const kmtLoss = Math.round(s.stats.kmtLoss);
    const plaLoss = Math.round(s.stats.plaLoss);
    const plaAlive = s.units.some(u => u.alive && u.faction === 'pla');
    const groupsDown = ['7b', '7b63', '12b', '2b', '13b', '16b'].filter(g => !groupAlive(s, [g]));
    const main1 = groupsDown.indexOf('7b') >= 0 && groupsDown.indexOf('7b63') >= 0;
    const main2 = groupsDown.indexOf('12b') >= 0;
    const main3 = ['2b', '13b', '16b'].every(g => groupsDown.indexOf(g) >= 0);
    let grade = 'C', title = '相持未决';
    if (!plaAlive) { grade = 'F'; title = '全军覆没'; }
    else if (main1 && main2 && main3) { grade = 'S'; title = '全胜 · 淮海大捷'; }
    else if (main2 && main3) { grade = 'A'; title = '大胜'; }
    else if (main2 || main3 || main1) { grade = 'B'; title = '小胜'; }
    else { grade = 'D'; title = '战役失利'; }
    if (plaLoss > kmtLoss * 0.5) { grade = grade === 'S' ? 'A' : grade; }
    return {
      grade: grade, title: title, kmtLoss: kmtLoss, plaLoss: plaLoss,
      groupsDown: groupsDown, objectives: Engine.objectiveStatus(s, false).filter(o => o.done).length,
      objectiveTotal: D.phases.reduce((a, p) => a + p.objectives.length, 0),
      defected: Math.round(s.stats.defected), surrendered: s.stats.surrendered,
      cities: s.cities.filter(c => c.side === 'pla').length,
      historical: { kmt: 555000, pla: 136000 }
    };
  };

  /* ---------------- 回合推进 ---------------- */
  Engine.resolveTurn = function (s) {
    const frames = [];
    s.frames = frames;
    if (s.ended) return { frames: frames, ended: true };

    // 抉择未决：不推进
    if (s.pendingChoice) return { frames: [{ kind: 'choice' }], choice: s.pendingChoice };

    // 12月16日：政治攻势抉择（在当日行动之前）
    if (s.date === '1948-12-16' && !s.flags.choicePolitical && groupAlive(s, ['2b', '13b', '16b'])) {
      s.flags.choicePolitical = true;
      s.pendingChoice = {
        id: 'political',
        title: '围而不歼',
        text: '为配合平津战役，中央军委指示对陈官庄杜聿明集团暂缓总攻，转入战场休整，展开政治攻势。大雪封冻，敌军粮弹俱绝。',
        options: [
          { id: 'political', label: '展开二十天政治攻势（推荐）', desc: '敌军士气持续崩溃、大批官兵投诚，我军恢复补给与体力；1月6日再行总攻。' },
          { id: 'assault', label: '立即发起总攻', desc: '我军攻击力提升，但敌军困兽犹斗，伤亡将显著增加。' }
        ]
      };
      return { frames: [{ kind: 'choice' }], choice: s.pendingChoice };
    }

    // 天气
    s.weather = weatherFor(s.date);

    // 新到部队
    spawnArrivals(s, frames);

    // 冷却
    for (const k of Object.keys(s.cooldowns)) s.cooldowns[k] = Math.max(0, s.cooldowns[k] - 1);

    // 清除本日增益
    for (const u of s.units) { u.flagBarrage = false; u.flagNight = false; u.flagAssault = false; }
    if (s.assaultUntil && s.date <= s.assaultUntil) {
      for (const u of s.units) if (u.alive && u.faction === 'pla') u.flagAssault = true;
    }

    // 战役指令
    applyEffects(s, frames);

    // 指挥所遇敌自动转移
    for (const u of s.units) {
      if (!u.alive || u.pending || u.faction !== 'pla' || !u.hq) continue;
      const threat = Engine.nearestUnit(s, u.x, u.y, 'kmt', 150);
      if (threat) {
        const ang = Math.atan2(u.y - threat.unit.y, u.x - threat.unit.x);
        const p = Geo.nearestPassable(s.grid, clamp(u.x + Math.cos(ang) * 160, 24, D.map.w - 24), clamp(u.y + Math.sin(ang) * 160, 24, D.map.h - 24));
        u.order = { type: 'retreat', x: p.x, y: p.y, path: bestPath(s, u, p.x, p.y) };
        if (!u.hqWarned) {
          u.hqWarned = true;
          log(s, u.short + '遭敌威胁，向后方转移。', 'info', u.x, u.y);
        }
      } else {
        u.hqWarned = false;
      }
    }

    // 敌军决策
    aiPlan(s, frames);

    // 补给（基于本日出发态势）
    supplyTick(s, frames);

    // 行军
    for (const u of s.units) {
      if (!u.alive || u.pending) continue;
      const o = u.order;
      if (!o) continue;
      if (o.type === 'move' || o.type === 'retreat') {
        moveUnitAlong(s, u, unitBudget(s, u), frames);
      } else if (o.type === 'attack') {
        const t = Engine.unitById(s, o.targetId);
        if (!t || !t.alive) { u.order = { type: 'defend' }; u.targetId = null; continue; }
        if (dist(u, t) <= ENGAGE) continue;
        if (!o.path || o.path.length < 2 || Math.hypot((o.path[o.path.length - 1] || {}).x - t.x, (o.path[o.path.length - 1] || {}).y - t.y) > 45) {
          o.path = bestPath(s, u, t.x, t.y);
        }
        if (o.path) moveUnitAlong(s, u, unitBudget(s, u), frames);
        o.x = t.x; o.y = t.y;
      }
    }

    // 部队拉开间距，避免完全重叠
    separateUnits(s);

    // 接触判定与交战
    const strikes = new Map();
    for (const u of s.units) {
      if (!u.alive || u.pending) continue;
      if (u.order.type !== 'attack') continue;
      let t = Engine.unitById(s, u.order.targetId);
      if (!t || !t.alive) { u.order = { type: 'defend' }; continue; }
      // 若指定目标不在接触距离内，则就近攻击当面对敌之敌
      if (dist(u, t) > ENGAGE) {
        const near = Engine.nearestUnit(s, u.x, u.y, u.faction === 'pla' ? 'kmt' : 'pla', ENGAGE);
        if (near) t = near.unit;
      }
      if (dist(u, t) <= ENGAGE) {
        if (!strikes.has(t.id)) strikes.set(t.id, []);
        strikes.get(t.id).push(u);
      }
    }
    const targets = Array.from(strikes.keys());
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(rng(s) * (i + 1));
      const tmp = targets[i]; targets[i] = targets[j]; targets[j] = tmp;
    }
    for (const tid of targets) {
      const t = Engine.unitById(s, tid);
      if (!t || !t.alive) continue;
      let atk = strikes.get(tid).filter(u => u.alive);
      if (!atk.length) continue;
      resolveEngagement(s, atk, t, frames);
    }

    // 攻城略地
    cleanupHq(s, frames);
    cityCapture(s, frames);

    // 伤亡过重的非被围部队自行后撤整顿
    for (const u of s.units) {
      if (!u.alive || u.pending || u.encircled) continue;
      if (u.troops < u.maxTroops * 0.35 && u.morale < 65) {
        if (!u.withdrawing) {
          u.withdrawing = true;
          const depot = Engine.nearestDepot(s, u);
          let ang = Math.atan2(u.y - 500, u.x - 1500);
          if (depot) ang = Math.atan2(depot.y - u.y, depot.x - u.x);
          const tx = clamp(u.x + Math.cos(ang) * 150, 24, D.map.w - 24);
          const ty = clamp(u.y + Math.sin(ang) * 150, 24, D.map.h - 24);
          const p = Geo.nearestPassable(s.grid, tx, ty);
          u.order = { type: 'retreat', x: p.x, y: p.y, path: bestPath(s, u, p.x, p.y) };
          log(s, u.short + '伤亡过重，向后方转进整顿。', 'info', u.x, u.y);
          frames.push({ kind: 'rout', x: u.x, y: u.y, faction: u.faction });
        }
      } else if (u.troops > u.maxTroops * 0.45) {
        u.withdrawing = false;
      }
    }

    // 被围日久、粮弹俱绝的小股敌军可能投诚
    for (const u of s.units) {
      if (!u.alive || u.faction !== 'kmt' || !u.encircled) continue;
      if (u.supply <= 15 && u.morale < 25 && u.troops < u.maxTroops * 0.45 && rng(s) < 0.03) {
        surrenderUnit(s, u, frames);
      }
    }

    // 士气崩溃的小股残部溃散
    for (const u of s.units) {
      if (!u.alive || u.pending) continue;
      if (u.morale <= 5 && u.troops < u.maxTroops * 0.32) {
        if (u.faction === 'kmt' && u.encircled) surrenderUnit(s, u, frames);
        else destroyUnit(s, u, '溃散', frames);
      }
    }
    // 恢复与工事
    for (const u of s.units) {
      if (!u.alive || u.pending) continue;
      const o = u.order || { type: 'defend' };
      if (o.type === 'rest') {
        u.fatigue = Math.max(0, u.fatigue - 24);
        u.morale = Math.min(100, u.morale + 5);
        u.supply = Math.min(100, u.supply + 6);
      } else if (o.type === 'defend' || o.type === 'fortify') {
        u.fatigue = Math.max(0, u.fatigue - 9);
        u.entrench = Math.min(100, u.entrench + (o.type === 'fortify' ? 13 : 6));
        u.morale = Math.min(100, u.morale + (u.supplied ? 1.3 : 0.2));
      } else {
        u.fatigue = Math.max(0, u.fatigue - 2);
      }
      u.supply = Math.max(0, Math.min(100, u.supply));
      if (u.morale < 35 && u.supplied) u.morale = Math.min(100, u.morale + 0.6);
    }

    // 历史事件
    const choiceNow = runEvents(s, frames);

    // 目标检查
    Engine.objectiveStatus(s, true);

    // 指挥点
    s.cp = Math.min(s.cpMax, s.cp + 1);

    // 结束判定
    const plaAlive = s.units.some(u => u.alive && !u.pending && u.faction === 'pla');
    const majorDown = !groupAlive(s, ['7b', '7b63']) && !groupAlive(s, ['12b']) &&
      ['2b', '13b', '16b'].every(g => !groupAlive(s, [g]));
    if (!plaAlive) {
      s.ended = true;
      s.result = Engine.resultOf(s);
      log(s, '我军主力损失殆尽，战役失败。', 'loss');
    } else if (s.date >= D.endDate || majorDown) {
      s.ended = true;
      s.result = Engine.resultOf(s);
      log(s, '淮海战役结束。' + (majorDown ? '我军全歼徐州"剿总"主力。' : '战役以我军重大胜利告终。'), 'history');
    }

    // 日期推进
    if (!s.pendingChoice) {
      s.date = addDays(s.date, 1);
      s.day++;
      if (s.date > D.endDate) s.date = D.endDate;
      s.weather = weatherFor(s.date);
    }
    return { frames: frames, choice: s.pendingChoice, ended: s.ended, result: s.result };
  };

  /* ---------------- 抉择 ---------------- */
  Engine.choose = function (s, optionId) {
    if (!s.pendingChoice) return;
    const ch = s.pendingChoice;
    s.pendingChoice = null;
    if (ch.id === 'political') {
      if (optionId === 'political') {
        s.political = true;
        for (const u of s.units) {
          if (u.alive && u.faction === 'kmt' && u.encircled && Math.hypot(u.x - 1071, u.y - 607) < 230) u.morale = Math.max(3, u.morale - 10);
          if (u.alive && u.faction === 'pla') {
            u.supply = Math.min(100, u.supply + 25);
            u.fatigue = Math.max(0, u.fatigue - 20);
            u.morale = Math.min(100, u.morale + 6);
          }
        }
        log(s, '对陈官庄集团停止攻击，转入二十天政治攻势。前线以馒头、热饭与喊话瓦解敌军。', 'history');
        s.flags.politicalChosen = true;
      } else {
        s.assaultUntil = addDays(s.date, 2);
        for (const u of s.units) if (u.alive && u.faction === 'kmt' && u.encircled) u.morale = Math.min(80, u.morale + 4);
        log(s, '我军拒绝休整，立即对陈官庄集团发起总攻。', 'history');
        s.flags.assaultChosen = true;
      }
    }
  };

  /* ---------------- 辅助显示 ---------------- */
  Engine.statusText = function (s, u) {
    if (!u.alive) return '已歼灭';
    if (u.pending) return '未参战';
    const bits = [];
    if (u.encircled) bits.push('被围');
    else if (!u.supplied) bits.push('断粮');
    if (u.order) {
      const map = { move: '行军', attack: '攻击', defend: '防御', fortify: '构筑工事', rest: '休整', retreat: '转进' };
      let ord = map[u.order.type] || u.order.type;
      if (u.order.type === 'attack') {
        const t = Engine.unitById(s, u.order.targetId);
        if (t && t.alive) ord += ' ' + t.short;
      }
      bits.push(ord);
    }
    return bits.join(' · ') || '待命';
  };

  Engine.canCommand = canCommand;
  Engine.ENGAGE = ENGAGE;

})(typeof window !== 'undefined' ? window : globalThis);
