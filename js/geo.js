/* ============================================================
   淮海战役沙盘 · 地理内核
   纯逻辑模块：地形高度、通行代价、寻路、河流/桥梁判定
   同时被浏览器与 Node 测试环境使用
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const Geo = HX.Geo = {};

  const CELL = 12;
  const INF = 1e9;

  Geo.CELL = CELL;

  /* ------------------------ 噪声 ------------------------ */
  function hash2(ix, iy) {
    let h = (ix | 0) * 374761393 + (iy | 0) * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return ((h >>> 0) % 1000003) / 1000003;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function noise2(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
    const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function fbm(x, y, oct) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      v += amp * noise2(x * f, y * f);
      f *= 2.05; amp *= 0.5;
    }
    return v;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ------------------------ 几何工具 ------------------------ */
  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    const qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  /* 把折线栅格化到网格（带笔刷半径） */
  function rasterLine(grid, pts, radius, cb) {
    const { cols, rows } = grid;
    const rCells = Math.max(0, Math.ceil(radius / CELL));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (CELL * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
        for (let dy = -rCells; dy <= rCells; dy++) {
          for (let dx = -rCells; dx <= rCells; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const wx = nx * CELL + CELL / 2, wy = ny * CELL + CELL / 2;
            if (Math.hypot(wx - x, wy - y) > radius + CELL * 0.45) continue;
            cb(nx, ny, i);
          }
        }
      }
    }
  }

  function rasterCircle(grid, x, y, radius, cb) {
    const { cols, rows } = grid;
    const r = radius / CELL;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    const rc = Math.ceil(r) + 1;
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        cb(nx, ny);
      }
    }
  }

  /* ------------------------ 地形高度 ------------------------ */
  Geo.makeHeightFn = function (map) {
    const hills = map.hills || [];
    return function (x, y) {
      let h = 0.05 + fbm(x / 300 + 11.3, y / 300 + 7.7, 4) * 0.13;
      for (let i = 0; i < hills.length; i++) {
        const H = hills[i];
        const dx = (x - H.x) / H.rx, dy = (y - H.y) / H.ry;
        const d2 = dx * dx + dy * dy;
        if (d2 > 9) continue;
        h += (H.h / 100) * Math.exp(-d2 * 1.5);
      }
      return h;
    };
  };

  /* ------------------------ 构建地理网格 ------------------------ */
  Geo.build = function (map) {
    const cols = Math.ceil(map.w / CELL), rows = Math.ceil(map.h / CELL);
    const n = cols * rows;
    const grid = {
      map, cols, rows, n,
      cell: CELL,
      cost: new Float32Array(n),
      river: new Uint8Array(n),
      lake: new Uint8Array(n),
      rail: new Uint8Array(n),
      road: new Uint8Array(n),
      urban: new Uint8Array(n),
      bridge: new Uint8Array(n),
      cityIdx: new Int16Array(n).fill(-1),
      height: new Float32Array(n),
      supplyCost: new Float32Array(n),
      fieldCost: new Float32Array(n),
      heightFn: null
    };
    grid.heightFn = Geo.makeHeightFn(map);

    // 高度
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
        grid.height[cy * cols + cx] = grid.heightFn(x, y);
      }
    }

    // 湖泊
    for (const lake of (map.lakes || [])) {
      const poly = lake.poly;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
          if (pointInPoly(x, y, poly)) grid.lake[cy * cols + cx] = 1;
        }
      }
    }

    // 河流（宽度约 8~12px）
    for (const r of (map.rivers || [])) {
      rasterLine(grid, r.pts, (r.width || 8) * 1.35, (cx, cy) => {
        grid.river[cy * cols + cx] = 1;
      });
    }

    // 铁路 / 公路
    for (const rail of (map.rails || [])) {
      rasterLine(grid, rail.pts, 3.2, (cx, cy) => { grid.rail[cy * cols + cx] = 1; });
    }
    for (const road of (map.roads || [])) {
      rasterLine(grid, road.pts, 2.2, (cx, cy) => { grid.road[cy * cols + cx] = 1; });
    }

    // 城市建成区
    map.cities.forEach((city, idx) => {
      const r = city.tier === 'major' ? 34 : city.tier === 'city' ? 22 : city.tier === 'town' ? 13 : 8;
      rasterCircle(grid, city.x, city.y, r, (cx, cy) => {
        grid.urban[cy * cols + cx] = 1;
        if (grid.cityIdx[cy * cols + cx] < 0) grid.cityIdx[cy * cols + cx] = idx;
      });
    });

    // 桥梁
    for (const b of (map.bridges || [])) {
      rasterCircle(grid, b.x, b.y, 17, (cx, cy) => {
        grid.bridge[cy * cols + cx] = 1;
        grid.river[cy * cols + cx] = 1;
      });
    }

    // 通行代价
    for (let i = 0; i < n; i++) {
      let h = grid.height[i];
      let c = h > 0.34 ? 31 : h > 0.19 ? 23 : h > 0.12 ? 16 : 14;
      if (grid.urban[i]) {
        const idx = grid.cityIdx[i];
        const tier = idx >= 0 ? map.cities[idx].tier : 'town';
        c = tier === 'major' ? 21 : tier === 'city' ? 18 : 16;
      }
      if (grid.rail[i]) c = Math.min(c, 8);
      if (grid.road[i]) c = Math.min(c, 10.5);
      if (grid.lake[i]) c = INF;
      else if (grid.river[i]) {
        if (grid.bridge[i] || grid.rail[i] || grid.road[i]) c = Math.max(38, c * 1.7);
        else c = INF;
      }
      grid.cost[i] = c;

      // 补给通行代价：干线运输依赖铁路、公路，越野几乎无法补给
      let sc;
      if (grid.rail[i]) sc = 6;
      else if (grid.road[i]) sc = 9;
      else if (grid.urban[i]) sc = 12;
      else sc = 300;
      if (grid.lake[i]) sc = INF;
      else if (grid.river[i]) sc = (grid.bridge[i] || grid.rail[i] || grid.road[i]) ? 35 : INF;
      grid.supplyCost[i] = sc;

      // 野战补给（支前民工）可越野，但速度慢
      let fc;
      if (grid.rail[i]) fc = 6;
      else if (grid.road[i]) fc = 9;
      else if (grid.urban[i]) fc = 12;
      else fc = h > 0.2 ? 58 : 45;
      if (grid.lake[i]) fc = INF;
      else if (grid.river[i]) fc = (grid.bridge[i] || grid.rail[i] || grid.road[i]) ? 40 : INF;
      grid.fieldCost[i] = fc;
    }

    return grid;
  };

  /* 复制地理网格（用于动态破坏桥梁等，避免影响其他战役） */
  Geo.clone = function (g) {
    return {
      map: g.map, cols: g.cols, rows: g.rows, n: g.n, cell: g.cell,
      cost: new Float32Array(g.cost),
      supplyCost: new Float32Array(g.supplyCost),
      fieldCost: new Float32Array(g.fieldCost),
      river: new Uint8Array(g.river),
      lake: new Uint8Array(g.lake),
      rail: new Uint8Array(g.rail),
      road: new Uint8Array(g.road),
      urban: new Uint8Array(g.urban),
      bridge: new Uint8Array(g.bridge),
      cityIdx: new Int16Array(g.cityIdx),
      height: new Float32Array(g.height),
      heightFn: g.heightFn
    };
  };

  /* ------------------------ 查询 ------------------------ */
  Geo.cellIndex = function (grid, x, y) {
    const cx = clamp(Math.floor(x / CELL), 0, grid.cols - 1);
    const cy = clamp(Math.floor(y / CELL), 0, grid.rows - 1);
    return cy * grid.cols + cx;
  };

  Geo.isPassable = function (grid, x, y) {
    return grid.cost[Geo.cellIndex(grid, x, y)] < INF;
  };

  /* 找最近可通行点 */
  Geo.nearestPassable = function (grid, x, y, maxR) {
    if (Geo.isPassable(grid, x, y)) return { x, y };
    maxR = maxR || 160;
    for (let r = CELL; r <= maxR; r += CELL) {
      const steps = Math.max(8, Math.round(r / 6));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
        if (nx < 0 || ny < 0 || nx >= grid.map.w || ny >= grid.map.h) continue;
        if (Geo.isPassable(grid, nx, ny)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  };

  Geo.terrainInfo = function (grid, x, y) {
    const i = Geo.cellIndex(grid, x, y);
    const idx = grid.cityIdx[i];
    return {
      height: grid.height[i],
      river: !!grid.river[i],
      lake: !!grid.lake[i],
      urban: !!grid.urban[i],
      rail: !!grid.rail[i],
      road: !!grid.road[i],
      bridge: !!grid.bridge[i],
      city: idx >= 0 ? grid.map.cities[idx] : null
    };
  };

  /* 直线是否被水阻断（无桥） */
  Geo.crossesWater = function (grid, x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.ceil(d / 8));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const i = Geo.cellIndex(grid, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      if (grid.lake[i]) return true;
      if (grid.river[i] && !grid.bridge[i] && !grid.rail[i] && !grid.road[i]) return true;
    }
    return false;
  };

  /* ------------------------ 二叉堆 ------------------------ */
  function Heap() {
    this.a = [];
    this.p = [];
  }
  Heap.prototype.push = function (v, pri) {
    const a = this.a, p = this.p;
    let i = a.length;
    a.push(v); p.push(pri);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      const tv = a[parent]; a[parent] = a[i]; a[i] = tv;
      const tp = p[parent]; p[parent] = p[i]; p[i] = tp;
      i = parent;
    }
  };
  Heap.prototype.pop = function () {
    const a = this.a, p = this.p;
    if (!a.length) return -1;
    const top = a[0];
    const lastV = a.pop(), lastP = p.pop();
    if (a.length) {
      a[0] = lastV; p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        const tv = a[m]; a[m] = a[i]; a[i] = tv;
        const tp = p[m]; p[m] = p[i]; p[i] = tp;
        i = m;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.a.length; };

  /* ------------------------ Dijkstra 泛洪 ------------------------ */
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.41421356], [1, -1, 1.41421356], [-1, 1, 1.41421356], [-1, -1, 1.41421356]
  ];

  /**
   * 从 (sx,sy) 出发，按预算限制的可达区域
   * opts.block: 额外阻挡函数 (cellIndex) => bool
   */
  Geo.flood = function (grid, sx, sy, budget, opts) {
    opts = opts || {};
    const cols = grid.cols, rows = grid.rows, n = grid.n;
    const dist = new Float32Array(n).fill(INF);
    const from = new Int32Array(n).fill(-1);
    const block = opts.block;
    const start = Geo.cellIndex(grid, sx, sy);
    const cost = grid.cost;
    dist[start] = 0;
    const h = new Heap();
    h.push(start, 0);
    while (h.size()) {
      const cur = h.pop();
      const cd = dist[cur];
      if (cd == null || cd >= INF) continue;
      const cx = cur % cols, cy = (cur - cx) / cols;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        const cc = cost[ni];
        if (cc >= INF) continue;
        if (block && block(ni, nx, ny)) continue;
        const nd = cd + cc * DIRS[d][2];
        if (nd <= budget && nd < dist[ni]) {
          dist[ni] = nd;
          from[ni] = cur;
          h.push(ni, nd);
        }
      }
    }
    return { dist, from, budget };
  };

  /* 多源泛洪（补给网络） */
  Geo.floodMulti = function (grid, sources, budget, opts) {
    opts = opts || {};
    const cols = grid.cols, rows = grid.rows, n = grid.n;
    const dist = new Float32Array(n).fill(INF);
    const from = new Int32Array(n).fill(-1);
    const block = opts.block;
    const cost = opts.cost || grid.cost;
    const h = new Heap();
    for (const s of sources) {
      const idx = Geo.cellIndex(grid, s.x, s.y);
      if (dist[idx] > 0) {
        dist[idx] = 0;
        h.push(idx, 0);
      }
    }
    while (h.size()) {
      const cur = h.pop();
      const cd = dist[cur];
      if (cd >= INF) continue;
      const cx = cur % cols, cy = (cur - cx) / cols;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        const cc = cost[ni];
        if (cc >= INF) continue;
        if (block && block(ni, nx, ny)) continue;
        const nd = cd + cc * DIRS[d][2];
        if (nd <= budget && nd < dist[ni]) {
          dist[ni] = nd;
          from[ni] = cur;
          h.push(ni, nd);
        }
      }
    }
    return { dist, from, budget };
  };

  /* 标记圆形区域到数组（ZOC / 友军覆盖） */
  Geo.markCircle = function (grid, x, y, r, arr, val) {
    val = val == null ? 1 : val;
    rasterCircle(grid, x, y, r, (cx, cy) => { arr[cy * grid.cols + cx] = val; });
  };

  /* 从泛洪结果重建路径（世界坐标） */
  Geo.pathFrom = function (grid, flood, tx, ty) {
    const goal = Geo.cellIndex(grid, tx, ty);
    if (flood.dist[goal] >= INF || flood.dist[goal] > flood.budget) return null;
    return Geo.pathToIndex(grid, flood, goal);
  };

  /* 从泛洪结果按网格索引重建路径 */
  Geo.pathToIndex = function (grid, flood, goal) {
    if (goal < 0 || flood.dist[goal] >= INF) return null;
    const cols = grid.cols;
    const pts = [];
    let cur = goal;
    let guard = 0;
    while (cur >= 0 && guard++ < 20000) {
      const cx = cur % cols, cy = (cur - cx) / cols;
      pts.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
      cur = flood.from[cur];
    }
    pts.reverse();
    return Geo.smoothPath(grid, pts);
  };

  /* 去掉冗余拐点 */
  Geo.smoothPath = function (grid, pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) {
        if (Geo.lineClear(grid, pts[i].x, pts[i].y, pts[j].x, pts[j].y)) break;
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  };

  /* 线段是否可通行（忽略桥与河的阻挡细节，仅检查 basic passable） */
  Geo.lineClear = function (grid, x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.ceil(d / 5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const i = Geo.cellIndex(grid, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      if (grid.cost[i] >= INF) return false;
    }
    return true;
  };

  /* 路径总代价（用于显示距离） */
  Geo.pathCost = function (grid, pts) {
    if (!pts || pts.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.round(d / CELL));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const c = grid.cost[Geo.cellIndex(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)];
        total += (c >= INF ? 30 : c) * (d / steps / CELL);
      }
    }
    return total;
  };

  /* 以路径坐标点到起点的累计距离 */
  Geo.pathLength = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  };

  /* 从路径起点前进一定代价，返回新位置与剩余路径 */
  Geo.advanceAlong = function (grid, pts, budget) {
    if (!pts || pts.length === 0) return { x: 0, y: 0, rest: [], spent: 0 };
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, rest: pts, spent: 0 };
    let spent = 0;
    let x = pts[0].x, y = pts[0].y;
    let i = 1;
    for (; i < pts.length; i++) {
      const a = { x, y }, b = pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.round(d / CELL));
      const costPer = Geo.pathCost(grid, [a, b]) / steps;
      let moved = false;
      for (let s = 1; s <= steps; s++) {
        if (spent + costPer > budget) {
          const frac = costPer > 0 ? (budget - spent) / costPer : 0;
          const tx = a.x + (b.x - a.x) * ((s - 1 + frac) / steps);
          const ty = a.y + (b.y - a.y) * ((s - 1 + frac) / steps);
          const rest = [{ x: tx, y: ty }].concat(pts.slice(i));
          return { x: tx, y: ty, rest, spent: budget };
        }
        spent += costPer;
        moved = true;
      }
      if (moved) { x = b.x; y = b.y; }
      if (spent >= budget) {
        return { x, y, rest: pts.slice(i), spent };
      }
    }
    return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, rest: [], spent };
  };

  /* 路径到目标点的剩余距离 */
  Geo.remainingLength = function (pts) {
    return Geo.pathLength(pts);
  };

  Geo.distance = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };

})(typeof window !== 'undefined' ? window : globalThis);
