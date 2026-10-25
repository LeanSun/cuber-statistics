'use strict';
const path=require('path');const ROOT=path.resolve(__dirname,'../..');
global.window={};require(path.join(ROOT,'js/data.js'));require(path.join(ROOT,'js/roster.js'));
const P=global.window.MOCK.players,R=global.window.WCA_ROSTER;
const placeW=(p)=>p===1?1:(p===2?0.6:0.4);
const A=[];
P.forEach(p=>{const m=p.mCalc;if(!m||!m.pod)return;
  const b=m.pod; // wcg,wcs,wcb, ccg,ccs,ccb, ncg,ncs,ncb, otg,ots,otb
  const wc=b[0]*1+b[1]*0.6+b[2]*0.4;
  const cc=b[3]*1+b[4]*0.6+b[5]*0.4;
  const nc=b[6]*1+b[7]*0.6+b[8]*0.4;
  const ot=b[9]*1+b[10]*0.6+b[11]*0.4;
  const m2=wc*1.0+cc*0.7, m3=nc*0.4+ot*0.4;
  const nWC=b[0]+b[1]+b[2], nCC=b[3]+b[4]+b[5], nNC=b[6]+b[7]+b[8], nOT=b[9]+b[10]+b[11];
  A.push({name:p.name,id:p.id,m2,m3,wc,cc,nc,ot,nWC,nCC,nNC,nOT,gW:b[0],comps:p.comps||0,podTotal:p.podTotal||0});});
const sum=(f)=>A.reduce((a,x)=>a+f(x),0);
console.log('=== 总量 ===');
console.log('明细档有 mCalc 的选手', A.length);
console.log('WC 领奖台', sum(x=>x.nWC), '| CC', sum(x=>x.nCC), '| NC', sum(x=>x.nNC), '| 其他', sum(x=>x.nOT));
console.log('全站领奖台总数(podTotal)', sum(x=>x.podTotal));
console.log('m2 总量', sum(x=>x.m2).toFixed(1), '其中 WC 部分', sum(x=>x.wc).toFixed(1), 'CC 部分', sum(x=>x.cc*0.7).toFixed(1));
console.log('m3 总量', sum(x=>x.m3).toFixed(1), '其中 NC', sum(x=>x.nc*0.4).toFixed(1), '其他', sum(x=>x.ot*0.4).toFixed(1));
console.log('\n=== m2 前 15 ===');
A.slice().sort((a,b)=>b.m2-a.m2).slice(0,15).forEach((x,i)=>
  console.log(String(i+1).padStart(2), x.name.padEnd(28), 'm2', x.m2.toFixed(2).padStart(6), '| WC金', x.nW, 'WC台', x.nWC, 'CC台', x.nCC));
console.log('\n=== 有 WC 领奖台的人数 ===');
[1,2,3].forEach(()=>{});
console.log('有≥1 WC 台', A.filter(x=>x.nWC>0).length, '| ≥1 CC 台', A.filter(x=>x.nCC>0).length, '| ≥1 NC 台', A.filter(x=>x.nNC>0).length);
console.log('m2>0 人数', A.filter(x=>x.m2>0).length, '| m3>0 人数', A.filter(x=>x.m3>0).length);
