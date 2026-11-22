/* ============================================================
   淮海战役 · 地形渲染
   程序化生成写实地图：平原农田、丘陵晕渲、河湖水系、
   铁路公路、城镇街区、村落树丛
   ============================================================ */
(function (root) {
  'use strict';
  const HX = root.HX = root.HX || {};
  const D = HX.Data;
  const Geo = HX.Geo;

  const Terrain = HX.Terrain = {};

  function hash2(ix, iy) {
    let h = (ix | 0) * 374761393 + (iy | 0) * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return ((h >>> 0) % 1000003) / 1000003;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function sampleHeight(geo, x, y) {
    const cell = geo.cell;
    const fx = x / cell - 0.5, fy = y / cell - 0.5;
    const x0 = clamp(Math.floor(fx), 0, geo.cols - 1);
    const y0 = clamp(Math.floor(fy), 0, geo.rows - 1);
    const x1 = clamp(x0 + 1, 0, geo.cols - 1);
    const y1 = clamp(y0 + 1, 0, geo.rows - 1);
    const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
    const h00 = geo.height[y0 * geo.cols + x0];
    const h10 = geo.height[y0 * geo.cols + x1];
    const h01 = geo.height[y1 * geo.cols + x0];
    const h11 = geo.height[y1 * geo.cols + x1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), ty);
  }

  function smoothLine(ctx, pts) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2;
      const yc = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  }

  /* ---------------- 底图 ---------------- */
  function paintBase(ctx, map, geo) {
    const w = map.w, h = map.h;
    const img = ctx.createImageData(w, h);
    const data = img.data;
    const step = 2;

    // 自然斑块噪声
    function vnoise(x, y, s) {
      const fx = x / s, fy = y / s;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0));
      const ty = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
      const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
      const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    function noiseAt(x, y) {
      return 0.5 * vnoise(x, y, 86) + 0.3 * vnoise(x + 41, y + 17, 27) + 0.2 * vnoise(x + 11, y + 53, 9);
    }

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const hgt = sampleHeight(geo, x, y);
        const hx1 = sampleHeight(geo, x + 9, y), hx0 = sampleHeight(geo, x - 9, y);
        const hy1 = sampleHeight(geo, x, y + 9), hy0 = sampleHeight(geo, x, y - 9);
        const shade = clamp(1 - (hx1 - hx0) * 2.6 - (hy1 - hy0) * 2.6, 0.76, 1.2);

        let r, g, b;
        if (hgt < 0.1) { r = 139; g = 130; b = 99; }
        else if (hgt < 0.16) { r = 131; g = 127; b = 95; }
        else if (hgt < 0.24) { r = 119; g = 119; b = 87; }
        else if (hgt < 0.36) { r = 103; g = 105; b = 78; }
        else { r = 88; g = 91; b = 69; }

        const n = noiseAt(x, y);
        const tint = (n - 0.5) * 20;
        r += tint * 0.95; g += tint; b += tint * 0.5;
        // 成片的田块色差（低频、低对比）
        const patch = 0.5 + 0.5 * Math.sin(x * 0.013 + Math.sin(y * 0.007) * 2.2);
        r += (patch - 0.5) * 8; g += (patch - 0.5) * 6; b += (patch - 0.5) * 3;

        // 细微颗粒
        const grain = (hash2(x * 3 + 7, y * 3 + 11) - 0.5) * 8;
        r = clamp((r + grain) * shade, 0, 255);
        g = clamp((g + grain) * shade, 0, 255);
        b = clamp((b + grain * 0.8) * shade, 0, 255);

        for (let dy = 0; dy < step; dy++) {
          let idx = ((y + dy) * w + x) * 4;
          for (let dx = 0; dx < step; dx++) {
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
            idx += 4;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // 整体色调压暗，接近航拍照片
    ctx.save();
    ctx.fillStyle = 'rgba(24, 28, 18, 0.16)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 田埂与林带线条
    ctx.save();
    for (let i = 0; i < 260; i++) {
      const x = hash2(i * 7, 3) * w;
      const y = hash2(5, i * 11) * h;
      const len = 20 + hash2(i, 9) * 55;
      const a = hash2(i * 3, 8) * Math.PI;
      ctx.strokeStyle = 'rgba(62, 58, 42, ' + (0.05 + hash2(i, 2) * 0.06) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // 经纬网
    ctx.save();
    ctx.strokeStyle = 'rgba(52, 48, 36, 0.2)';
    ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 6]);
    for (let lon = 115; lon <= 119; lon++) {
      const x = (lon - 114) * 420;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let lat = 33; lat <= 35; lat++) {
      const y = (35.3 - lat) * 460;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- 水系 ---------------- */
  function paintWater(ctx, map) {
    for (const lake of map.lakes) {
      const poly = lake.poly;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        const p = poly[i], prev = poly[i - 1];
        const mx = (p[0] + prev[0]) / 2, my = (p[1] + prev[1]) / 2;
        ctx.quadraticCurveTo(prev[0], prev[1], mx, my);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, '#33474a');
      g.addColorStop(1, '#293c40');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 152, 128, 0.25)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // 湖面微波
      ctx.clip();
      ctx.strokeStyle = 'rgba(160, 180, 175, 0.10)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        const yy = poly[0][1] + i * 7 + hash2(i, 3) * 5;
        ctx.beginPath();
        ctx.moveTo(poly[0][0] - 40, yy);
        ctx.bezierCurveTo(poly[0][0] + 20, yy - 4, poly[0][0] + 50, yy + 4, poly[0][0] + 110, yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const r of map.rivers) {
      ctx.save();
      smoothLine(ctx, r.pts);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (r.kind === 'oldriver') {
        ctx.strokeStyle = 'rgba(160, 146, 110, 0.45)';
        ctx.lineWidth = r.width + 4;
        ctx.stroke();
        smoothLine(ctx, r.pts);
        ctx.strokeStyle = 'rgba(196, 177, 136, 0.55)';
        ctx.lineWidth = Math.max(1.5, r.width * 0.35);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(30, 42, 42, 0.4)';
        ctx.lineWidth = r.width + 3;
        ctx.stroke();
        smoothLine(ctx, r.pts);
        ctx.strokeStyle = r.kind === 'canal' ? '#33494c' : '#32484b';
        ctx.lineWidth = r.width * 0.8;
        ctx.stroke();
        smoothLine(ctx, r.pts);
        ctx.strokeStyle = 'rgba(146, 162, 154, 0.22)';
        ctx.lineWidth = Math.max(1, r.width * 0.15);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------- 铁路 / 公路 ---------------- */
  function paintTransport(ctx, map) {
    // 公路
    for (const road of map.roads) {
      ctx.save();
      smoothLine(ctx, road.pts);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(46, 40, 28, 0.65)';
      ctx.lineWidth = 4.6;
      ctx.stroke();
      smoothLine(ctx, road.pts);
      ctx.strokeStyle = 'rgba(201, 186, 145, 0.82)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    // 铁路：路基 + 钢轨 + 枕木
    for (const rail of map.rails) {
      ctx.save();
      smoothLine(ctx, rail.pts);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(30, 26, 18, 0.9)';
      ctx.lineWidth = 3.8;
      ctx.stroke();
      smoothLine(ctx, rail.pts);
      ctx.strokeStyle = '#231f17';
      ctx.lineWidth = 1.9;
      ctx.stroke();

      // 枕木
      for (let i = 0; i < rail.pts.length - 1; i++) {
        const a = rail.pts[i], b = rail.pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
        const n = Math.floor(len / 7);
        for (let k = 0; k < n; k++) {
          const t = k / n;
          const px = a[0] + (b[0] - a[0]) * t;
          const py = a[1] + (b[1] - a[1]) * t;
          ctx.beginPath();
          ctx.moveTo(px - nx * 3.2, py - ny * 3.2);
          ctx.lineTo(px + nx * 3.2, py + ny * 3.2);
          ctx.strokeStyle = 'rgba(186, 172, 138, 0.55)';
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 桥梁
    for (const b of map.bridges) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = 'rgba(214, 200, 168, 0.9)';
      ctx.strokeStyle = 'rgba(45, 38, 26, 0.9)';
      ctx.lineWidth = 1;
      ctx.fillRect(-5, -2.4, 10, 4.8);
      ctx.strokeRect(-5, -2.4, 10, 4.8);
      ctx.restore();
    }
  }

  /* ---------------- 城镇 ---------------- */
  function paintCities(ctx, map) {
    const blocks = [];
    for (const c of map.cities) {
      const R = c.tier === 'major' ? 40 : c.tier === 'city' ? 24 : c.tier === 'town' ? 11 : 6;
      const n = c.tier === 'major' ? 120 : c.tier === 'city' ? 60 : c.tier === 'town' ? 20 : 8;
      for (let i = 0; i < n; i++) {
        const a = hash2(i * 3 + c.x, i * 7 + c.y) * Math.PI * 2;
        const rr = Math.pow(hash2(i + c.x * 2, i + c.y * 3), 0.55) * R;
        const bx = c.x + Math.cos(a) * rr;
        const by = c.y + Math.sin(a) * rr * 0.75;
        const bw = 2.5 + hash2(i, c.y) * 5;
        const bh = 2.5 + hash2(c.x, i) * 5;
        blocks.push({ x: bx, y: by, w: bw, h: bh, rot: hash2(i, i) * 0.6 });
      }
      // 城墙/外廓
      if (c.tier === 'major' || c.tier === 'city') {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, R * 1.15, R * 0.82, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(122, 114, 93, 0.2)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(64, 58, 44, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const b of blocks) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = hash2(b.x | 0, b.y | 0) > 0.5 ? '#6f6959' : '#7c7563';
      ctx.globalAlpha = 0.75;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    // 主要城市的街道网格
    for (const c of map.cities) {
      if (c.tier !== 'major' && c.tier !== 'city') continue;
      const R = c.tier === 'major' ? 40 : 24;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, R * 1.05, R * 0.76, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(196, 188, 164, 0.3)';
      ctx.lineWidth = 1.1;
      for (let i = -3; i <= 3; i++) {
        const yy = c.y + i * R * 0.22;
        ctx.beginPath();
        ctx.moveTo(c.x - R, yy + hash2(i, c.x) * 4);
        ctx.lineTo(c.x + R, yy + hash2(c.y, i) * 4);
        ctx.stroke();
      }
      for (let i = -3; i <= 3; i++) {
        const xx = c.x + i * R * 0.22;
        ctx.beginPath();
        ctx.moveTo(xx + hash2(i, c.y) * 4, c.y - R * 0.8);
        ctx.lineTo(xx + hash2(c.x, i) * 4, c.y + R * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 城市中心标记
    for (const c of map.cities) {
      if (c.tier === 'town') continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.tier === 'major' ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(233, 222, 192, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(42, 36, 25, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------------- 村落、树丛 ---------------- */
  function paintRural(ctx, map, geo) {
    // 村落：沿道路与河流分布
    const seeds = [];
    for (let i = 0; i < 420; i++) {
      const x = 30 + hash2(i * 5, 17) * (map.w - 60);
      const y = 30 + hash2(23, i * 7) * (map.h - 60);
      let near = false;
      for (const c of map.cities) {
        if (Math.hypot(c.x - x, c.y - y) < (c.tier === 'major' ? 60 : c.tier === 'city' ? 40 : 24)) { near = true; break; }
      }
      if (near) continue;
      seeds.push({ x, y });
    }
    for (const s of seeds) {
      const n = 3 + Math.floor(hash2(s.x | 0, s.y | 0) * 7);
      for (let i = 0; i < n; i++) {
        const x = s.x + (hash2(i, s.x | 0) - 0.5) * 20;
        const y = s.y + (hash2(i, s.y | 0) - 0.5) * 14;
        ctx.fillStyle = 'rgba(72, 66, 50, 0.78)';
        ctx.fillRect(x, y, 2.6, 2.3);
        ctx.fillStyle = 'rgba(126, 116, 92, 0.5)';
        ctx.fillRect(x, y - 1.3, 2.6, 1);
      }
      // 村头树
      if (hash2(s.x | 0, s.y | 0) > 0.45) {
        ctx.fillStyle = 'rgba(54, 66, 45, 0.35)';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(s.x + (hash2(i, 3) - 0.5) * 18, s.y + (hash2(3, i) - 0.5) * 12, 1.8 + hash2(i, 7) * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // 水系、道路旁的树带
    const lines = [];
    for (const r of map.rivers) lines.push(r.pts);
    for (const r of map.roads) lines.push(r.pts);
    for (const pts of lines) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.floor(len / 16);
        for (let k = 0; k < steps; k++) {
          if (hash2(i * 31 + k, 9) > 0.62) continue;
          const t = k / Math.max(1, steps);
          const x = a[0] + (b[0] - a[0]) * t + (hash2(k, i) - 0.5) * 12;
          const y = a[1] + (b[1] - a[1]) * t + (hash2(i, k) - 0.5) * 12;
          ctx.fillStyle = 'rgba(52, 66, 45, ' + (0.2 + hash2(k, i) * 0.25) + ')';
          ctx.beginPath();
          ctx.arc(x, y, 1.4 + hash2(k, 5) * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // 零散树丛与池塘
    for (let i = 0; i < 1500; i++) {
      const x = hash2(i * 11, 5) * map.w;
      const y = hash2(7, i * 13) * map.h;
      if (hash2(i, i * 2) > 0.4) continue;
      ctx.fillStyle = 'rgba(56, 70, 48, ' + (0.14 + hash2(i, 3) * 0.2) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + hash2(i, 5) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 34; i++) {
      const x = 120 + hash2(i * 3, 41) * (map.w - 240);
      const y = 120 + hash2(19, i * 3) * (map.h - 240);
      const r = 5 + hash2(i, 5) * 12;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(46, 64, 64, 0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(70, 82, 68, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 丘陵等高线
    for (const hill of map.hills) {
      ctx.save();
      for (let k = 1; k <= 3; k++) {
        const rr = (hill.rx || 60) * (0.35 + k * 0.22);
        const ry = (hill.ry || 40) * (0.35 + k * 0.22);
        ctx.beginPath();
        ctx.ellipse(hill.x, hill.y, rr, ry, 0.3 + k * 0.1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(52, 54, 36, 0.1)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 5]);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------- 标注 ---------------- */
  function paintLabels(ctx, map) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 15px "Noto Serif SC","Songti SC",serif';
    ctx.fillStyle = 'rgba(63, 57, 43, 0.55)';
    const labels = [
      { t: '陇 海 铁 路', x: 1010, y: 378, a: -0.08 },
      { t: '津 浦 铁 路', x: 1310, y: 700, a: 1.42 },
      { t: '大 运 河', x: 1745, y: 574, a: 0.85 },
      { t: '故 黄 河', x: 600, y: 328, a: 0.22 },
      { t: '淮 河', x: 1660, y: 1044, a: 0.02 },
      { t: '微 山 湖', x: 1345, y: 235, a: -0.1 },
      { t: '骆 马 湖', x: 1827, y: 556, a: 0 },
      { t: '洪 泽 湖', x: 1945, y: 922, a: 0 }
    ];
    for (const l of labels) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.a);
      ctx.fillText(l.t, 0, 0);
      ctx.restore();
    }
    ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(63, 57, 43, 0.4)';
    for (let lon = 115; lon <= 119; lon++) {
      ctx.fillText(lon + '°E', (lon - 114) * 420, 24);
    }
    for (let lat = 33; lat <= 35; lat++) {
      ctx.save();
      ctx.translate(22, (35.3 - lat) * 460);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(lat + '°N', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------- 生成 ---------------- */
  Terrain.build = function (map, geo) {
    const cv = document.createElement('canvas');
    cv.width = map.w;
    cv.height = map.h;
    const ctx = cv.getContext('2d');
    paintBase(ctx, map, geo);
    paintRural(ctx, map, geo);
    paintWater(ctx, map);
    paintTransport(ctx, map);
    paintCities(ctx, map);
    paintLabels(ctx, map);
    return cv;
  };

})(typeof window !== 'undefined' ? window : globalThis);
