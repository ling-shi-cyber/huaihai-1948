/* 关键战斗数值基准测试 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const ctx = { console, Math, Date, JSON }; ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['js/data.js', 'js/geo.js', 'js/engine.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const HX = ctx.HX, E = HX.Engine;

function bench(name, kmtIds, plaIds, center, days) {
  const s = E.create({ seed: 20241106 });
  s.date = '1948-12-10';
  s.units.forEach(u => { if (kmtIds.indexOf(u.id) < 0 && plaIds.indexOf(u.id) < 0) u.alive = false; });
  // 包围圈
  const k = kmtIds.length;
  kmtIds.forEach((id, i) => {
    const u = E.unitById(s, id); if (!u) return;
    const a = (i / k) * Math.PI * 2;
    u.x = center.x + Math.cos(a) * 18; u.y = center.y + Math.sin(a) * 18;
    u.alive = true; u.entrench = 100; u.supply = 100; u.morale = 72; u.troops = u.maxTroops;
    u.order = { type: 'defend' };
  });
  plaIds.forEach((id, i) => {
    const u = E.unitById(s, id); if (!u) return;
    const a = (i / plaIds.length) * Math.PI * 2;
    u.x = center.x + Math.cos(a) * 55; u.y = center.y + Math.sin(a) * 55;
    u.alive = true; u.supply = 100; u.fatigue = 0; u.morale = 90; u.troops = u.maxTroops;
    u.order = { type: 'defend' };
  });
  console.log(`\n=== ${name} ===`);
  const kmtStart = kmtIds.reduce((a, id) => a + (E.unitById(s, id) || {}).troops, 0);
  const plaStart = plaIds.reduce((a, id) => a + (E.unitById(s, id) || {}).troops, 0);
  let lastK = kmtStart, lastP = plaStart;
  for (let d = 0; d < days; d++) {
    const alive = kmtIds.map(id => E.unitById(s, id)).filter(u => u && u.alive);
    if (!alive.length) { console.log(`  ${s.date} 全歼，历时 ${d} 天`); break; }
    // 所有华野集中攻击同一目标（集中兵力）
    const target = alive.slice().sort((a, b) => b.troops - a.troops)[0];
    for (const id of plaIds) {
      const u = E.unitById(s, id); if (!u || !u.alive) continue;
      if (target) E.orderAttack(s, [id], target.id);
    }
    const r = E.resolveTurn(s);
    const kNow = kmtIds.reduce((a, id) => { const u = E.unitById(s, id); return a + (u && u.alive ? u.troops : 0); }, 0);
    const pNow = plaIds.reduce((a, id) => { const u = E.unitById(s, id); return a + (u && u.alive ? u.troops : 0); }, 0);
    console.log(`  ${s.date} 敌 ${(kNow / 1e4).toFixed(1)}万(-${((lastK - kNow) / 1000).toFixed(1)}k) 我 ${(pNow / 1e4).toFixed(1)}万(-${((lastP - pNow) / 1000).toFixed(1)}k) 敌士气${Math.round(alive[0].morale)} 敌补给${Math.round(alive[0].supply)} 围${alive[0].encircled ? '是' : '否'}`);
    lastK = kNow; lastP = pNow;
  }
  const kEnd = kmtIds.reduce((a, id) => { const u = E.unitById(s, id); return a + (u && u.alive ? u.troops : 0); }, 0);
  const pEnd = plaIds.reduce((a, id) => { const u = E.unitById(s, id); return a + (u && u.alive ? u.troops : 0); }, 0);
  console.log(`  结果: 敌损失 ${((kmtStart - kEnd) / 1e4).toFixed(1)}万 / 我损失 ${((plaStart - pEnd) / 1e4).toFixed(1)}万 = ${((kmtStart - kEnd) / Math.max(1, plaStart - pEnd)).toFixed(2)}:1`);
}

bench('碾庄 · 黄百韬兵团', ['kmt-7b-25', 'kmt-7b-64', 'kmt-7b-100', 'kmt-7b-44', 'kmt-7b-hq'],
  ['pla-1', 'pla-4', 'pla-6', 'pla-8', 'pla-9', 'pla-lzn', 'pla-tez'], { x: 1562, y: 442 }, 20);

bench('双堆集 · 黄维兵团', ['kmt-12b-18', 'kmt-12b-10', 'kmt-12b-14', 'kmt-12b-85', 'kmt-12b-hq'],
  ['pla-z1', 'pla-z2', 'pla-z3', 'pla-z4', 'pla-z6', 'pla-z9', 'pla-z11'], { x: 1197, y: 864 }, 20);

bench('陈官庄 · 杜聿明集团', ['kmt-2b-5', 'kmt-2b-70', 'kmt-2b-74', 'kmt-2b-12', 'kmt-13b-8', 'kmt-13b-9', 'kmt-13b-115', 'kmt-16b-41', 'kmt-16b-47'],
  ['pla-1', 'pla-4', 'pla-6', 'pla-8', 'pla-9', 'pla-10', 'pla-13', 'pla-7', 'pla-3', 'pla-sb2'], { x: 1071, y: 607 }, 25);
