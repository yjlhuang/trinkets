/* 一滴水 world —— 共用的土地：植物、水塘、居民、手上的水、存檔。
   原始碼在 private repo one-drop-world（src/world.js）；各頁面載入的是發佈版
   one-drop-lib/world.vX.Y.js（classic script，相對路徑，same-origin）。
   不要直接改各 repo 裡的副本：改 src/world.js、發新版號，再用 tools/sync.mjs 同步。

   介面見 PLAN.md 2.2。
   存檔：這一版仍寫回頁面原本的 key，v1 格式、欄位順序、數值精度完全不變；
   內部資料已經是多地圖的形狀（maps + activeMap），目前只有 home 一張。 */
(function(){
'use strict';
const VERSION='1.0';

function create(cfg){
const $=id=>document.getElementById(id);
const land=cfg.root;
const KEY=cfg.key;

/* ---------- 事件：on(type, fn)；discover 的 kind 是穩定字串 id，之後加新種類不用改頁面 ---------- */
const handlers={};
function on(type,fn){ (handlers[type]=handlers[type]||[]).push(fn); return api; }
function emit(type,ev){ (handlers[type]||[]).forEach(fn=>{ try{ fn(ev); }catch(e){ console.error(e); } }); }

/* ---------- 手上的水與地圖 ---------- */
let water=0, activeMap='home';
const maps={ home:{plants:[],wets:[],ponds:[],flies:[]} };
function bindMap(){ const m=maps[activeMap]; plants=m.plants; wets=m.wets; ponds=m.ponds; flies=m.flies; }
// 水量變了：土地游標、提示字、頁面的水滴列（頁面訂閱 water 事件）
function syncWater(gained){
  land.classList.toggle('has-water',water>0);
  emit('water',{water,gained:!!gained});
  updateHint();
}

/* ================= land ================= */
const cv=$('cv'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=1,U=1,S=1, ground=null, hover=null, gen=0;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let plants, wets, ponds, flies;          // 指向 maps[activeMap] 裡的陣列（bindMap），程式只原地修改、不重新指定
const falls=[], rings=[];

const PAL={
  grass:['#7f9c47','#6b8a3c','#8fae52','#5f7f36'],
  // index 5 is the rare one: it only appears by chance, then spreads like any other colour
  flower:['#f2f0f7','#f3c645','#e07f98','#8d9be0','#e9a063','#5b45d1'],
  leaf:'#5f8a3a', canopy:['#4f6f3a','#58793f','#476634'], canopyHi:'#7a9c55',
  trunk:'#6e5136', shadow:'rgba(40,28,15,.18)',
  pond:'#6f9fb3', pondDeep:'#557f93', pondRim:'rgba(60,45,28,.28)',
  pad:'#5d8d47', cap:['#b5563f','#c98a4a','#e8dcc8'],
  fly:['#f1d36b','#f3f1ea','#e39a58','#9fb7e6']
};
const now=()=>performance.now();
const cssVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hash=(seed,k)=>{const x=Math.sin(seed*9301+k*49297)*233280;return x-Math.floor(x)};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const chance=p=>Math.random()<p;
const dist=(ax,ay,bx,by)=>Math.hypot((ax-bx)*W,(ay-by)*H);

function resize(){
  const r=land.getBoundingClientRect();
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=r.width;H=r.height;
  cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);
  U=Math.min(W,H); S=Math.max(1,Math.min(2.2,U/450));
  buildGround();
}
function buildGround(){
  ground=document.createElement('canvas');
  ground.width=cv.width;ground.height=cv.height;
  const g=ground.getContext('2d');
  g.scale(DPR,DPR);
  g.fillStyle=cssVar('--soil');g.fillRect(0,0,W,H);
  const c1=cssVar('--speck'),c2=cssVar('--speck2');
  for(let i=0,n=Math.floor(W*H/260);i<n;i++){
    const x=hash(i,1)*W,y=hash(i,2)*H,r=hash(i,3)*1.6+.4;
    g.fillStyle=hash(i,4)<.5?c1:c2;g.globalAlpha=.35+hash(i,5)*.4;
    g.beginPath();g.ellipse(x,y,r*1.4,r,0,0,Math.PI*2);g.fill();
  }
  for(let i=0,n=Math.floor(W*H/9000);i<n;i++){
    const x=hash(i,11)*W,y=hash(i,12)*H,r=6+hash(i,13)*22;
    g.fillStyle=hash(i,14)<.5?c1:c2;g.globalAlpha=.12;
    g.beginPath();g.ellipse(x,y,r*1.6,r*.8,0,0,Math.PI*2);g.fill();
  }
  g.globalAlpha=1;
}

/* ---------- ponds ---------- */
// a pond is an ellipse; r is a fraction of U
function pondRx(p){return p.r*U*1.35} function pondRy(p){return p.r*U*.75}
function inPond(p,x,y,pad=1){const dx=(x-p.x)*W/(pondRx(p)*pad),dy=(y-p.y)*H/(pondRy(p)*pad);return dx*dx+dy*dy<1}
function pondAt(x,y,pad=1){return ponds.find(p=>inPond(p,x,y,pad))}
function pondEdge(p){const a=Math.random()*Math.PI*2,k=1.05+Math.random()*.25;return [p.x+Math.cos(a)*pondRx(p)*k/W,p.y+Math.sin(a)*pondRy(p)*k/H]}
function pondInside(p){const a=Math.random()*Math.PI*2,k=Math.random()*.6;return [p.x+Math.cos(a)*pondRx(p)*k/W,p.y+Math.sin(a)*pondRy(p)*k/H]}
function makePond(x,y){
  const p={x,y,r:.04+Math.random()*.02,born:now()};
  ponds.push(p);
  // nothing is lost: whatever grew here is nudged out to the bank
  for(const q of plants) if(q.type!=='lily' && inPond(p,q.x,q.y,1.05)){ [q.x,q.y]=pondEdge(p); }
  rings.push({x,y,t0:now(),type:'splash'});
  emit('discover',{kind:'pond',x,y,map:activeMap});
}

/* ---------- plants ---------- */
function addPlant(type,x,y,opts={}){
  if(plants.length>900) return null;
  x=Math.max(.02,Math.min(.98,x)); y=Math.max(.05,Math.min(.99,y));
  const pd=pondAt(x,y,1.05);
  if(type==='lily'){ if(!pd) return null; }
  else if(pd){ [x,y]=pondEdge(pd); }
  let color=opts.color;
  if(color===undefined) color = chance(.03) ? 5 : Math.floor(Math.random()*5);
  const p={type,x,y,stage:opts.stage||1,v:0,born:now(),seed:Math.random(),color};
  plants.push(p);
  if(type==='flower' && color===5 && opts.color===undefined) emit('discover',{kind:'rare-flower',x,y,map:activeMap,color});
  return p;
}
function grow(p){ if(p.stage<3){p.stage++; ring(p);} }
function ring(p){ rings.push({x:p.x,y:p.y,t0:now()}) }
function around(x,y,minR,maxR){
  const a=Math.random()*Math.PI*2,r=(minR+Math.random()*(maxR-minR))*U;
  return [x+Math.cos(a)*r/W, y+Math.sin(a)*r*.7/H];
}
function addFly(x,y){ flies.push({x,y,seed:Math.random(),c:Math.floor(Math.random()*PAL.fly.length),born:now()}) }

/* ---------- the hidden rules: what one drop does ---------- */
function outcome(x,y){
  const acts=[];
  const R=.11*U;
  const near=plants.map(p=>({p,d:dist(p.x,p.y,x,y)})).filter(o=>o.d<R && o.p.type!=='lily').sort((a,b)=>a.d-b.d).map(o=>o.p);
  const count=t=>near.filter(p=>p.type===t).length;
  const nG=count('grass'), nF=count('flower');
  const bigTrees=near.filter(p=>p.type==='tree'&&p.stage===3);

  // 1. dropped into a pond: lily pads, or the bank gets greener
  const pd=pondAt(x,y);
  if(pd){
    const lilies=plants.filter(p=>p.type==='lily'&&inPond(pd,p.x,p.y));
    const small=lilies.find(p=>p.stage<2);
    if(small && chance(.5)) acts.push(()=>grow(small));
    else if(lilies.length<4 && chance(.6)) acts.push(()=>{const [a,b]=pondInside(pd);addPlant('lily',a,b)});
    else for(let i=0;i<2;i++) acts.push(()=>{const [a,b]=pondEdge(pd);addPlant(chance(.6)?'grass':'flower',a,b)});
    return acts;
  }

  // 2. watering the same bare patch again and again pools into a pond
  const soaked=wets.filter(w=>dist(w.x,w.y,x,y)<.022*U).length;   // includes this drop
  const treeClose=plants.some(p=>p.type==="tree"&&p.stage===3&&dist(p.x,p.y,x,y)<.04*U);
  if(soaked>=6 && ponds.length<4 && !treeClose && !ponds.some(p=>dist(p.x,p.y,x,y)<.16*U) && chance(.35)){
    acts.push(()=>makePond(x,y)); return acts;
  }

  const fresh=()=>{
    const lush=near.length>=4, t=Math.random();
    if(t<(lush?.62:.72)) acts.push(()=>addPlant('grass',x,y));
    else if(t<(lush?.88:.94)) acts.push(()=>addPlant('flower',x,y));
    else acts.push(()=>addPlant('tree',x,y));
    if(chance(.35)){
      for(let i=0,k=1+Math.floor(Math.random()*2);i<k;i++){const [a,b]=around(x,y,.025,.06);acts.push(()=>addPlant('grass',a,b))}
    }
  };

  if(!near.length){ fresh(); }
  else{
    const r=Math.random();
    const growable=near.filter(p=>p.stage<3);
    if(r<.45 && growable.length){
      // a crowded spot lets more than one plant grow at once
      const k=1+(near.length>=6?1:0)+(near.length>=10&&chance(.5)?1:0);
      growable.slice(0,k).forEach(p=>acts.push(()=>grow(p)));
    }else if(r<.85){
      const src=near[Math.floor(Math.pow(Math.random(),2)*near.length)];
      ring(src);
      if(src.type==='grass'||src.type==='mushroom'){
        for(let i=0,k=1+Math.floor(Math.random()*3);i<k;i++){const [a,b]=around(x,y,.02,.07);acts.push(()=>addPlant('grass',a,b))}
        if(chance(.12)){const [a,b]=around(x,y,.02,.06);acts.push(()=>addPlant('flower',a,b))}
      }else if(src.type==='flower'){
        for(let i=0,k=1+(chance(.4)?1:0);i<k;i++){const [a,b]=around(src.x,src.y,.025,.07);acts.push(()=>addPlant('flower',a,b,{color:chance(.8)?src.color:undefined}))}
        if(chance(.5)){const [a,b]=around(x,y,.02,.05);acts.push(()=>addPlant('grass',a,b))}
      }else{
        const t=Math.random(), sap=bigTrees.length>=2?.3:.15;   // a grove seeds more trees
        const [a,b]=around(src.x,src.y,.04,.1);
        if(t<.85-sap) acts.push(()=>addPlant(t<.45?'grass':'flower',a,b));
        else acts.push(()=>addPlant('tree',a,b));
        if(src.stage===3 && chance(.4)){
          for(let i=0;i<3;i++){const [c,d]=around(src.x,src.y,.05,.09);acts.push(()=>addPlant(chance(.5)?'flower':'grass',c,d))}
        }
      }
      // grass near flowers sometimes turns into a flower
      const g=near.find(p=>p.type==='grass');
      if(g && nF>=2 && chance(.2)){
        const col=near.find(p=>p.type==='flower').color;
        acts.push(()=>{const i=plants.indexOf(g);if(i>=0){plants.splice(i,1);addPlant('flower',g.x,g.y,{color:col})}});
      }
    }else fresh();

    // clusters are rewarded: a meadow blooms, a flower bed thickens
    if(nG>=5 && chance(.25)){const [a,b]=around(x,y,.01,.05);acts.push(()=>addPlant('flower',a,b))}
    if(nF>=4 && chance(.4)){const f=near.find(p=>p.type==='flower'&&p.stage<3);if(f)acts.push(()=>grow(f))}
  }

  // rare: butterflies settle over a big flower bed
  if(nF>=5 && flies.length<6 && !flies.some(f=>dist(f.x,f.y,x,y)<.12*U) && chance(.15)){
    acts.push(()=>{
      if(flies.length>=6 || flies.some(f=>dist(f.x,f.y,x,y)<.12*U)) return;
      addFly(x,y);emit('discover',{kind:'butterfly',x,y,map:activeMap});
    });
  }
  // rare: mushrooms ring the shade of a big tree
  const tree=bigTrees[0];
  if(tree && !plants.some(p=>p.type==='mushroom'&&dist(p.x,p.y,tree.x,tree.y)<.1*U) && chance(.12)){
    acts.push(()=>{
      if(plants.some(p=>p.type==='mushroom'&&dist(p.x,p.y,tree.x,tree.y)<.1*U)) return;
      const n=5+Math.floor(Math.random()*3), off=Math.random()*Math.PI*2;
      for(let i=0;i<n;i++){
        const a=off+i/n*Math.PI*2, rr=(.055+Math.random()*.012)*U;
        addPlant('mushroom',tree.x+Math.cos(a)*rr/W,tree.y+Math.sin(a)*rr*.5/H+.012*U/H);
      }
      emit('discover',{kind:'mushroom-ring',x:tree.x,y:tree.y,map:activeMap});
    });
  }
  // near a pond the bank grows thicker
  const bank=ponds.find(p=>inPond(p,x,y,2.6));
  if(bank && chance(.4)) acts.push(()=>{const [a,b]=pondEdge(bank);addPlant(chance(.7)?'grass':'flower',a,b)});

  if(!acts.length) fresh();
  return acts;
}

function dropAt(x,y){
  if(water<=0){ emit('nowater'); return; }
  water--; syncWater(false); save();
  const g=gen;
  falls.push({x,y,t0:now()});
  setTimeout(()=>{
    if(g!==gen) return;
    wets.push({x,y,t0:now(),r:14+Math.random()*8});
    const acts=outcome(x,y);
    acts.forEach((f,i)=>setTimeout(()=>{if(g===gen){f();save()}},120+i*(reduceMotion?0:180)));
    save();
    setTimeout(updateHint,200);
  },reduceMotion?0:420);
}

function updateHint(){
  const h=$('hint');
  if(plants.length||ponds.length||falls.length){h.classList.add('gone');return}
  h.classList.remove('gone');
  h.textContent= water>0 ? '點一下土地' : '一片安靜的空地';
}

cv.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse'){hover=null;return}
  const r=cv.getBoundingClientRect();hover={x:(e.clientX-r.left)/W,y:(e.clientY-r.top)/H};
});
cv.addEventListener('pointerleave',()=>hover=null);
cv.addEventListener('click',e=>{
  const r=cv.getBoundingClientRect();
  dropAt((e.clientX-r.left)/W,(e.clientY-r.top)/H);
});

/* ================= drawing ================= */
const easeBack=t=>{const c=1.7;t=Math.min(1,Math.max(0,t));return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2)};
function drawGrass(p,X,Y,v,a,time){
  const s=S*a, n=3+Math.round(v*3);
  ctx.lineCap='round';
  for(let i=0;i<n;i++){
    const hf=.6+hash(p.seed,i)*.6, h=s*(7+v*7)*hf;
    const off=(i-(n-1)/2)*s*1.5+(hash(p.seed,i+20)-.5)*s*2;
    const lean=(hash(p.seed,i+40)-.5)*s*6+off*.6;
    const sway=reduceMotion?0:Math.sin(time*.0013+p.seed*20+i*.7)*s*1.1;
    ctx.strokeStyle=PAL.grass[Math.floor(hash(p.seed,i+60)*4)];
    ctx.lineWidth=s*1.5;
    ctx.beginPath();ctx.moveTo(X+off,Y);
    ctx.quadraticCurveTo(X+off+lean*.2,Y-h*.6,X+off+lean+sway,Y-h);
    ctx.stroke();
  }
}
function flowerHead(cx,cy,pr,col,open){
  if(open<=0){
    ctx.fillStyle=PAL.leaf;ctx.beginPath();ctx.ellipse(cx,cy,pr*.55,pr*.85,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(cx,cy-pr*.4,pr*.35,pr*.45,0,0,Math.PI*2);ctx.fill();
    return;
  }
  ctx.fillStyle=col;
  for(let k=0;k<5;k++){
    const an=k/5*Math.PI*2-Math.PI/2;
    ctx.beginPath();ctx.arc(cx+Math.cos(an)*pr*.8*open,cy+Math.sin(an)*pr*.8*open,pr*(.35+.3*open),0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle=col==='#f3c645'?'#8a5a2b':(col==='#5b45d1'?'#f4f1ff':'#f0c24a');
  ctx.beginPath();ctx.arc(cx,cy,pr*.42,0,Math.PI*2);ctx.fill();
}
function drawFlower(p,X,Y,v,a,time){
  const s=S*a, col=PAL.flower[p.color]||PAL.flower[0];
  const sway=reduceMotion?0:Math.sin(time*.0011+p.seed*30)*s*1.4;
  drawGrass({seed:p.seed+.5},X,Y,.3,a*.8,time);
  const heads=v>2.5?2:1;
  for(let h=0;h<heads;h++){
    const hh=s*(12+v*6)*(h?.72:1);
    const dx=h?s*7*(hash(p.seed,3)<.5?-1:1):0;
    const tx=X+dx+sway, ty=Y-hh;
    ctx.strokeStyle=PAL.leaf;ctx.lineWidth=s*1.3;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(X,Y);ctx.quadraticCurveTo(X+dx*.3,Y-hh*.5,tx,ty);ctx.stroke();
    if(!h){ctx.fillStyle=PAL.leaf;ctx.beginPath();ctx.ellipse(X+s*2.5,Y-hh*.35,s*2.6,s*1.1,-.5,0,Math.PI*2);ctx.fill();}
    const open=Math.max(0,Math.min(1,(v-1)*1.4));
    flowerHead(tx,ty,s*(2.4+Math.min(v,2.4)*.9)*(h?.8:1),col,open);
  }
}
function drawTree(p,X,Y,v,a,time){
  const s=S*a, cr=Math.max(0,(v-.9))*s*9.5;
  ctx.fillStyle=PAL.shadow;
  ctx.beginPath();ctx.ellipse(X+cr*.2,Y+s,s*3+cr*1.05,s*1.2+cr*.35,0,0,Math.PI*2);ctx.fill();
  const th=s*(8+v*11), tw=s*(1.2+v*1.3);
  ctx.fillStyle=PAL.trunk;
  ctx.beginPath();ctx.moveTo(X-tw,Y);ctx.lineTo(X-tw*.55,Y-th);ctx.lineTo(X+tw*.55,Y-th);ctx.lineTo(X+tw,Y);ctx.closePath();ctx.fill();
  const sway=reduceMotion?0:Math.sin(time*.0008+p.seed*12)*s*.8;
  if(v<1.8){
    ctx.globalAlpha=Math.min(1,(1.8-v)*1.3);
    ctx.fillStyle=PAL.leaf;
    ctx.beginPath();ctx.ellipse(X-s*3+sway,Y-th-s,s*3.2,s*1.5,.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(X+s*3+sway,Y-th-s*2,s*3.2,s*1.5,-.5,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
  }
  if(cr>0){
    const cy=Y-th-cr*.55;
    for(let k=0;k<5;k++){
      const ox=(hash(p.seed,k)-.5)*cr*1.1+sway, oy=(hash(p.seed,k+9)-.5)*cr*.7;
      ctx.fillStyle=PAL.canopy[k%3];
      ctx.beginPath();ctx.arc(X+ox,cy+oy,cr*(.55+hash(p.seed,k+5)*.3),0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle=PAL.canopyHi;ctx.globalAlpha=.55;
    ctx.beginPath();ctx.arc(X-cr*.28+sway,cy-cr*.3,cr*.32,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
  }
}
function drawMushroom(p,X,Y,a){
  const s=S*a*(.8+hash(p.seed,1)*.5);
  ctx.fillStyle='#efe6d4';
  ctx.fillRect(X-s*.9,Y-s*3.2,s*1.8,s*3.2);
  ctx.fillStyle=PAL.cap[Math.floor(hash(p.seed,2)*3)];
  ctx.beginPath();ctx.ellipse(X,Y-s*3.2,s*3,s*2.2,0,Math.PI,0);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.85)';
  ctx.beginPath();ctx.arc(X-s*1.1,Y-s*4.2,s*.45,0,Math.PI*2);ctx.arc(X+s*.9,Y-s*4.6,s*.35,0,Math.PI*2);ctx.fill();
}
function drawLily(p,X,Y,v,a){
  const s=S*a;
  const rot=hash(p.seed,1)*Math.PI*2;
  ctx.fillStyle=PAL.pad;
  ctx.beginPath();ctx.moveTo(X,Y);
  ctx.ellipse(X,Y,s*5,s*2.4,0,rot+.35,rot+Math.PI*2-.35);ctx.closePath();ctx.fill();
  if(v>1.5){
    const k=Math.min(1,(v-1.5)*2);
    ctx.fillStyle='#f0b8c8';
    for(let i=0;i<6;i++){const an=i/6*Math.PI*2;ctx.beginPath();ctx.ellipse(X+Math.cos(an)*s*1.3*k,Y-s*1.2+Math.sin(an)*s*.6*k,s*1.1*k,s*.7*k,an,0,Math.PI*2);ctx.fill()}
    ctx.fillStyle='#f3d36a';ctx.beginPath();ctx.arc(X,Y-s*1.2,s*.6*k,0,Math.PI*2);ctx.fill();
  }
}
function drawPond(p,t){
  const a=reduceMotion?1:Math.max(.001,Math.min(1,(t-p.born)/1200));
  const X=p.x*W,Y=p.y*H,rx=pondRx(p)*a,ry=pondRy(p)*a;
  ctx.fillStyle=PAL.pondRim;ctx.beginPath();ctx.ellipse(X,Y+ry*.08,rx*1.08,ry*1.12,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=PAL.pond;ctx.beginPath();ctx.ellipse(X,Y,rx,ry,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=PAL.pondDeep;ctx.globalAlpha=.5;ctx.beginPath();ctx.ellipse(X+rx*.1,Y+ry*.12,rx*.6,ry*.5,0,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=.35;ctx.strokeStyle='#fff';ctx.lineWidth=1.2*S;ctx.lineCap='round';
  const sh=reduceMotion?0:Math.sin(t*.001+p.x*9)*rx*.05;
  ctx.beginPath();ctx.ellipse(X-rx*.25+sh,Y-ry*.35,rx*.3,ry*.12,0,Math.PI*1.1,Math.PI*1.8);ctx.stroke();
  ctx.globalAlpha=1;
}
function drawFly(f,t){
  const k=reduceMotion?0:t*.001;
  const X=f.x*W+Math.sin(k*.7+f.seed*10)*.04*U+Math.sin(k*1.9+f.seed*3)*.01*U;
  const Y=f.y*H-18*S+Math.cos(k*1.1+f.seed*7)*.025*U;
  const flap=reduceMotion?1:.25+.75*Math.abs(Math.sin(t*.018+f.seed*30));
  const s=S*Math.max(.001,Math.min(1,(t-f.born)/800));
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,Y+20*S,3*S,1.2*S,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=PAL.fly[f.c];
  for(const d of [-1,1]){
    ctx.beginPath();ctx.ellipse(X+d*s*2.4*flap,Y-s*1,s*2.6*flap,s*2.2,d*.3,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(X+d*s*1.8*flap,Y+s*1.6,s*1.8*flap,s*1.5,-d*.3,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#3a3226';ctx.fillRect(X-s*.35,Y-s*2,s*.7,s*4.2);
}
function drawDrop(X,Y,s,al){
  ctx.globalAlpha=al;
  ctx.fillStyle=cssVar('--water');
  ctx.beginPath();ctx.moveTo(X,Y-9*s);
  ctx.bezierCurveTo(X+2*s,Y-5*s,X+6*s,Y-s,X+6*s,Y+2.5*s);
  ctx.arc(X,Y+2.5*s,6*s,0,Math.PI);
  ctx.bezierCurveTo(X-6*s,Y-s,X-2*s,Y-5*s,X,Y-9*s);
  ctx.fill();
  ctx.globalAlpha=al*.6;ctx.strokeStyle='#fff';ctx.lineWidth=1.3*s;ctx.lineCap='round';
  ctx.beginPath();ctx.arc(X,Y+2.5*s,3.4*s,Math.PI*.6,Math.PI*.95);ctx.stroke();
  ctx.globalAlpha=1;
}

// 物種表：type → 怎麼畫。之後加新物種只要加一筆（外觀、出現條件、圖鑑文字會慢慢搬進來）
const SPECIES={
  grass:   {draw:(p,X,Y,a,t)=>drawGrass(p,X,Y,p.v,a,t)},
  flower:  {draw:(p,X,Y,a,t)=>drawFlower(p,X,Y,p.v,a,t)},
  tree:    {draw:(p,X,Y,a,t)=>drawTree(p,X,Y,p.v,a,t)},
  mushroom:{draw:(p,X,Y,a)=>drawMushroom(p,X,Y,a)},
  lily:    {draw:(p,X,Y,a)=>drawLily(p,X,Y,p.v,a)},
};

let last=now(), wetColor='';
function paint(t,withHover){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.drawImage(ground,0,0,W,H);
  for(const w of wets){
    const age=(t-w.t0)/1000;
    ctx.fillStyle=wetColor;ctx.globalAlpha=.035+.3*Math.max(0,1-age/4);
    ctx.beginPath();ctx.ellipse(w.x*W,w.y*H,w.r*S*1.5,w.r*S*.8,0,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
  for(const p of ponds) drawPond(p,t);
  for(let i=rings.length-1;i>=0;i--){
    const r=rings[i],k=(t-r.t0)/900;
    if(k>=1){rings.splice(i,1);continue}
    ctx.strokeStyle=r.type==='splash'?cssVar('--water'):'rgba(255,255,255,.8)';
    ctx.globalAlpha=(1-k)*.7;ctx.lineWidth=1.5*S;
    ctx.beginPath();ctx.ellipse(r.x*W,r.y*H,(6+k*26)*S,(3+k*12)*S,0,0,Math.PI*2);ctx.stroke();
  }
  ctx.globalAlpha=1;
  // lily pads lie flat on the water, so they go under everything standing
  const flat=plants.filter(p=>p.type==='lily'), up=plants.filter(p=>p.type!=='lily').sort((a,b)=>a.y-b.y);
  for(const p of flat.concat(up)){
    const a=reduceMotion?1:Math.max(.001,easeBack((t-p.born)/700));
    const X=p.x*W,Y=p.y*H;
    const sp=SPECIES[p.type];
    if(sp) sp.draw(p,X,Y,a,t);
  }
  for(const f of flies) drawFly(f,t);
  if(!withHover) return;
  for(let i=falls.length-1;i>=0;i--){
    const f=falls[i],k=reduceMotion?1:(t-f.t0)/420;
    if(k>=1){falls.splice(i,1);rings.push({x:f.x,y:f.y,t0:t,type:'splash'});continue}
    drawDrop(f.x*W,f.y*H-(1-k*k)*160*S,S*1.1,1);
  }
  if(hover && water>0){
    ctx.fillStyle=PAL.shadow;
    ctx.beginPath();ctx.ellipse(hover.x*W,hover.y*H,6*S,2.5*S,0,0,Math.PI*2);ctx.fill();
    drawDrop(hover.x*W,hover.y*H-22*S-(reduceMotion?0:Math.sin(t*.004)*2*S),S,.85);
  }
}
function frame(t){
  const dt=Math.min(.05,(t-last)/1000);last=t;
  for(const p of plants) p.v+=(p.stage-p.v)*Math.min(1,dt*(reduceMotion?60:2.6));
  paint(t,true);
  requestAnimationFrame(frame);
}


bindMap();

/* ================= 存檔（寫回頁面原本的 key；v1 格式不變） ================= */
// 這個 key 只有 world 會寫（單一寫入者）。題庫進度欄位由頁面的 getProgress() 提供，依原本順序排在 water 後面。
let saveT=null, ready=false, frozen=false;   // ready：load() 之後才准寫；frozen：頁面判定別的分頁改過存檔
function serialize(){
  const p=cfg.getProgress ? cfg.getProgress() : {};
  return JSON.stringify({
    v:1, water, ...p,
    plants:plants.map(p=>[p.type,+p.x.toFixed(4),+p.y.toFixed(4),p.stage,p.color,+p.seed.toFixed(6)]),
    wets:wets.slice(-400).map(w=>[+w.x.toFixed(4),+w.y.toFixed(4),+w.r.toFixed(1)]),
    ponds:ponds.map(p=>[+p.x.toFixed(4),+p.y.toFixed(4),+p.r.toFixed(4)]),
    flies:flies.map(f=>[+f.x.toFixed(4),+f.y.toFixed(4),+f.seed.toFixed(6),f.c])
  });
}
function writeNow(){
  clearTimeout(saveT);
  if(!ready||frozen) return;
  try{ localStorage.setItem(KEY,serialize()); }
  catch(e){ emit('saveerror',e); return; }      // 不再靜靜吞掉：頁面會持續顯示警告，直到下一次寫入成功
  emit('saved');
}
function save(){ clearTimeout(saveT); saveT=setTimeout(writeNow,250); }
addEventListener('pagehide',writeNow);          // 答完馬上離開也不漏存最後一筆
addEventListener('storage',e=>{
  if(e.key===KEY||e.key===null) emit('external',e);   // 別的分頁（或 Painless 匯入備份）改了存檔；要不要停寫由頁面決定
});
// 讀檔：土地放進 maps.home，回傳整包存檔物件（沒有存檔回傳 null）讓頁面還原題庫進度
function load(){
  let d=null;
  try{d=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
  if(d){
    water=Math.max(0,d.water|0);
    (d.plants||[]).forEach(a=>plants.push({type:a[0],x:a[1],y:a[2],stage:a[3],v:a[3],color:a[4],seed:a[5],born:-1e9}));
    (d.wets||[]).forEach(a=>wets.push({x:a[0],y:a[1],r:a[2],t0:-1e9}));
    (d.ponds||[]).forEach(a=>ponds.push({x:a[0],y:a[1],r:a[2],born:-1e9}));
    (d.flies||[]).forEach(a=>flies.push({x:a[0],y:a[1],seed:a[2],c:a[3],born:-1e9}));
  }
  ready=true;
  return d;
}

/* ================= 清空土地 ================= */
function reset(){
  gen++;
  for(const a of [plants,wets,ponds,flies,falls,rings]) a.length=0;
  water=0;
  syncWater(false); save();
}

/* ================= save a picture ================= */
function stamp(){const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())}
async function snapshot(){
  paint(now(),false);                     // one clean frame without the hovering drop
  return new Promise(res=>cv.toBlob(res,'image/png'));
}
const SNAP=cfg.snapshotPrefix||'我的小土地-';
(async()=>{
  const btn=$('snap');
  if(!btn) return;
  let downloads=null;
  try{ if(window.claude && typeof window.claude.use==='function') downloads=await window.claude.use('downloads'); }catch(e){}
  if(downloads){
    btn.hidden=false;
    btn.onclick=async()=>{
      const blob=await snapshot();
      try{ await downloads.save({filename:SNAP+stamp()+'.png',data:blob}); emit('message','圖片存好了'); }
      catch(e){
        if(e&&e.code==='declined') return;
        if(e&&e.code==='rate_limited'){emit('message','稍等一下再試');return}
        btn.hidden=true; emit('message','這裡沒辦法存圖片');
      }
    };
  }else if(!window.claude){
    // opened as a plain file outside Claude: a normal link download works
    btn.hidden=false;
    btn.onclick=async()=>{
      const blob=await snapshot(), a=document.createElement('a');
      a.href=URL.createObjectURL(blob); a.download=SNAP+stamp()+'.png'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
    };
  }
})();

/* ================= start ================= */
function themeChanged(){ wetColor=cssVar('--wet'); buildGround(); }
new ResizeObserver(resize).observe(land);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',themeChanged);
new MutationObserver(themeChanged).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
resize(); wetColor=cssVar('--wet');
requestAnimationFrame(frame);

const api={
  VERSION,
  load, save, reset, on,
  addWater(n){ n=n|0; if(n<=0) return; water+=n; syncWater(true); },
  refresh(){ syncWater(false); },               // 啟動時畫一次水滴列與提示字
  freeze(){ frozen=true; clearTimeout(saveT); },
  get water(){ return water; },
  get activeMap(){ return activeMap; },
};
return api;
}

window.OneDropWorld={ VERSION, create };
})();
