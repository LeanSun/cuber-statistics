// 定点提取：三阶速拧单次（333 / single）的 M5 分量前十
// M5 分量 = w_e · rank^-GAMMA · dec · tw
//   现口径：w_333 = EV_WEIGHT_V2['333'] = 1.0000；tw_single = 1；dec(none)=1；GAMMA = 0.5
//   ⇒ 333 单次分量 = worldRank^-0.5
const fs = require('fs');
const OC = require('path').join(__dirname, '..', '..', '.workbuddy', 'tmp', 'oc');

// 姓名表：persons.tsv 列 [name,?,wca_id,...] → wca_id(r[2]) → name(r[0])
const pName = new Map();
{
  const s = fs.readFileSync(OC + '/WCA_export_persons.tsv', 'utf8');
  for (const ln of s.split('\n')) {
    if (!ln) continue;
    const c = ln.split('\t');
    if (c[2]) pName.set(c[2], c[0]);
  }
}

// ranks_single.tsv 列：[best(centi), personId, eventId, worldRank, continentRank, countryRank]
const GAMMA = 0.5, W = 1.0, TW = 1.0;
const rows = [];
{
  const s = fs.readFileSync(OC + '/WCA_export_ranks_single.tsv', 'utf8');
  for (const ln of s.split('\n')) {
    if (!ln) continue;
    const c = ln.split('\t');
    if (c[2] !== '333') continue;
    const wr = +c[3];
    if (!(wr >= 1 && wr <= 100)) continue;     // DEPTH=100
    const pid = c[1];
    const best = +c[0];                          // 百分秒
    const score = W * Math.pow(wr, -GAMMA) * TW;
    rows.push({ pid, name: pName.get(pid) || pid, wr, best, score });
  }
}
rows.sort((a, b) => a.wr - b.wr || a.name.localeCompare(b.name));   // 名次升序 == 分量降序
const top = rows.filter((x) => x.wr <= 10);   // 官方同名次：列出世界名次 ≤10 的全部选手（含并列）

console.log('三阶速拧单次（333 / single）M5 分量前十');
console.log('公式: M5分量 = worldRank^-0.5  (w_333=1.0000, tw_single=1, dec=1, GAMMA=0.5)');
console.log('快照: WCA 导出 v2.0.2 / v288 (2026-10-15)');
console.log('');
console.log('世界名次  选手                       WCA ID          单次PB(s)   M5分量      (并列)');
console.log('-------------------------------------------------------------------------------------');
let lastWr = 0;
top.forEach((x) => {
  const sec = (x.best / 100).toFixed(2);
  const tie = (x.wr === lastWr) ? '  ← 并列' : '';
  console.log(
    String(x.wr).padStart(4) + '    ' +
    (x.name).padEnd(24) + ' ' +
    x.pid.padEnd(15) + '  ' +
    sec.padStart(7) + '    ' +
    x.score.toFixed(4) + tie
  );
  lastWr = x.wr;
});
console.log('-------------------------------------------------------------------------------------');
console.log('世界名次 ≤10 的选手共 ' + top.length + ' 人（官方同名次：无第8名，第7/第9名各有并列）');
const tot = top.reduce((a, x) => a + x.score, 0);
console.log('以上分量合计: ' + tot.toFixed(4));
