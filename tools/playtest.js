/* 战役全程推演：模拟一个称职的华野指挥员 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const ctx = { console, Math, Date, JSON }; ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['js/data.js', 'js/geo.js', 'js/engine.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const HX = ctx.HX, E = HX.Engine;

const s = E.create({ seed: 19481106 });
const main = ['pla-1', 'pla-4', 'pla-6', 'pla-8', 'pla-9', 'pla-lzn', 'pla-tez'];
const block = ['pla-7', 'pla-10', 'pla-13'];
const north = ['pla-sb2', 'pla-sb11', 'pla-sb12', 'pla-sbhq'];
const zhong = ['pla-z1', 'pla-z2', 'pla-z3', 'pla-z4', 'pla-z6', 'pla-z9', 'pla-z11', 'pla-zhq'];
const other = ['pla-3', 'pla-lg', 'pla-bohai', 'pla-hq'];

function unit(id) { return E.unitById(s, id); }
function aliveOf(ids) { return ids.map(unit).filter(u => u && u.alive); }
function nearestOf(ids, from) {
  let best = null, bd = 1e9;
  for (const u of aliveOf(ids)) {
    const d = Math.hypot(u.x - from.x, u.y - from.y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function kmtGroup(groups) {
  return s.units.filter(u => u.alive && u.faction === 'kmt' && groups.indexOf(u.group) >= 0);
}
function attackNearest(ids, groups) {
  const us = aliveOf(ids).filter(u => !u.hq);
  if (!us.length) return;
  const targets = kmtGroup(groups).filter(t => t.troops > 3000);
  if (!targets.length) return;
  let cx = 0, cy = 0;
  us.forEach(u => { cx += u.x; cy += u.y; });
  cx /= us.length; cy /= us.length;
  targets.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  const target = targets[0];
  for (const u of us) {
    if (u.order.type === 'attack') {
      const t = unit(u.order.targetId);
      if (t && t.alive && t.id === target.id) continue;
    }
    E.orderAttack(s, [u.id], target.id);
  }
}

let turn = 0;
const marks = ['1948-11-09', '1948-11-12', '1948-11-16', '1948-11-20', '1948-11-22', '1948-11-25', '1948-12-01', '1948-12-06', '1948-12-10', '1948-12-16', '1949-01-06', '1949-01-10'];
const seen = {};
while (!s.ended && turn < 75) {
  turn++;
  if (s.pendingChoice) {
    E.choose(s, 'political');
    console.log('CHOICE', s.date, 'political');
  }
  if (s.day === 1) {
    E.orderMove(s, block, 1483, 460);
    E.orderFortify(s, block);
    E.orderMove(s, north, 1772, 440);
    E.orderMove(s, zhong, 1252, 740);
    E.orderMove(s, other, 1252, 800);
  }
  // 主攻
  if (kmtGroup(['7b', '7b63']).length) attackNearest(main, ['7b', '7b63']);
  else if (kmtGroup(['12b']).length) attackNearest(main, ['12b']);
  else attackNearest(main, ['2b', '13b', '16b', 'xzhq']);
  // 阻援集团：坚守大许家—曹八集
  for (const u of aliveOf(block)) {
    if (u.order.type === 'move') continue;
    if (!s.flags.blockSet) {
      const near = E.nearestUnit(s, u.x, u.y, 'kmt', 120);
      if (near && near.dist < 40) E.orderDefend(s, [u.id]);
      else E.orderFortify(s, [u.id]);
    }
  }
  s.flags.blockSet = true;
  // 苏北兵团
  if (kmtGroup(['7b63']).length) attackNearest(north, ['7b63']);
  else if (kmtGroup(['7b']).length) attackNearest(north, ['7b']);
  else attackNearest(north, ['12b', '2b', '13b', '16b']);
  // 中野：先宿县，再黄维
  const suz = E.cityById(s, 'suzhou');
  if (suz.side !== 'pla') {
    attackNearest(zhong, ['suzhou']);
    for (const u of aliveOf(zhong)) {
      if (u.hq || u.order.type === 'attack') continue;
      E.orderMove(s, [u.id], 1252, 745);
    }
  } else if (kmtGroup(['12b']).length) {
    attackNearest(zhong, ['12b']);
  } else {
    attackNearest(zhong, ['6b', '8b']);
  }
  // 其他部队向宿县/双堆集
  for (const u of aliveOf(other)) {
    if (u.order.type === 'move' || u.order.type === 'attack') continue;
    const t = kmtGroup(['12b', '6b', '8b']);
    if (t.length) E.orderMove(s, [u.id], 1252, 800);
  }

  const r = E.resolveTurn(s);
  const killed = r.frames.filter(f => f.kind === 'destroy');
  if (killed.length) console.log('  KILL', s.date, killed.map(f => f.short + '(' + f.how + ')').join(', '));
  if (marks.indexOf(s.date) >= 0 && !seen[s.date]) {
    seen[s.date] = 1;
    const pla = s.units.filter(u => u.alive && u.faction === 'pla').reduce((a, u) => a + u.troops, 0);
    const kmt = s.units.filter(u => u.alive && u.faction === 'kmt').reduce((a, u) => a + u.troops, 0);
    const enc = s.units.filter(u => u.alive && u.faction === 'kmt' && u.encircled).length;
    console.log(`${s.date} 我${(pla / 1e4).toFixed(1)}万 敌${(kmt / 1e4).toFixed(1)}万 被围${enc} 我伤${(s.stats.plaLoss / 1e4).toFixed(1)}万 敌伤${(s.stats.kmtLoss / 1e4).toFixed(1)}万 城${s.cities.filter(c => c.side === 'pla').length}`);
  }
}
console.log('END', s.date, s.ended, s.result);
console.log('log key:');
s.log.filter(l => ['history', 'victory', 'loss', 'objective'].indexOf(l.type) >= 0).slice(-30).forEach(l => console.log(' ', l.date, l.text));
