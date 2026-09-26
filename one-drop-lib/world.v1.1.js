/* 一滴水 world —— 共用的土地：植物、水塘、居民、手上的水、存檔。
   原始碼在 private repo one-drop-world（src/world.js）；各頁面載入的是發佈版
   one-drop-lib/world.vX.Y.js（classic script，相對路徑，same-origin）。
   不要直接改各 repo 裡的副本：改 src/world.js、發新版號，再用 tools/sync.mjs 同步。

   介面見 PLAN.md 2.2。
   存檔：仍寫回頁面原本的 key、v1 格式；既有欄位的順序與精度不變，v1.1 只在 flies 後面新增
   critters、seenKinds、found、newFound（居民與圖鑑）。
   內部資料已經是多地圖的形狀（maps + activeMap），目前只有 home 一張。 */
(function(){
'use strict';
const VERSION='1.1';

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
const maps={ home:{plants:[],wets:[],ponds:[],flies:[],critters:[]} };
function bindMap(){ const m=maps[activeMap]; plants=m.plants; wets=m.wets; ponds=m.ponds; flies=m.flies; critters=m.critters; }
// 水量變了：土地游標、提示字、頁面的水滴列（頁面訂閱 water 事件）
function syncWater(gained){
  land.classList.toggle('has-water',water>0);
  emit('water',{water,gained:!!gained});
  updateHint();
}

/* ================= land ================= */
const cv=$('cv'); let ctx=cv.getContext('2d');   // 圖鑑畫像會用 withCanvas() 暫時換掉 ctx
let W=0,H=0,DPR=1,U=1,S=1, ground=null, hover=null, gen=0;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let plants, wets, ponds, flies, critters;   // 指向 maps[activeMap] 裡的陣列（bindMap），程式只原地修改、不重新指定
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
  record('pond');
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
  if(type==='flower'&&color===5) record('violet');
  if(type==='mushroom') record('ring');
  if(type==='flower' && color===5 && opts.color===undefined) emit('discover',{kind:'rare-flower',x,y,map:activeMap,color});
  return p;
}
function grow(p){ if(p.stage<3){p.stage++; ring(p);} if(p.type==='lily'&&p.stage>=2) record('lily'); if(p.type==='tree'&&p.stage>=3) record('tree'); }
function ring(p){ rings.push({x:p.x,y:p.y,t0:now()}) }
function around(x,y,minR,maxR){
  const a=Math.random()*Math.PI*2,r=(minR+Math.random()*(maxR-minR))*U;
  return [x+Math.cos(a)*r/W, y+Math.sin(a)*r*.7/H];
}
function addFly(x,y){ record('fly'); flies.push({x,y,seed:Math.random(),c:Math.floor(Math.random()*PAL.fly.length),born:now()}) }

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
    residents(x,y,acts,nG,bigTrees);
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
  residents(x,y,acts,nG,bigTrees);

  if(!acts.length) fresh();
  return acts;
}

function dropAt(x,y){
  if(water<=0){ emit('nowater'); return; }
  water--; syncWater(false); save();
  const g=gen;
  falls.push({x,y,t0:now()});
  critterNotice(x,y);
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
  cv.style.cursor=critterHit(hover.x,hover.y)?'pointer':'';
});
cv.addEventListener('pointerleave',()=>hover=null);
cv.addEventListener('click',e=>{
  const r=cv.getBoundingClientRect();
  const x=(e.clientX-r.left)/W, y=(e.clientY-r.top)/H;
  const c=critterHit(x,y);
  if(c){ poke(c); return; }
  dropAt(x,y);
});

/* ================= little residents =================
   露露 (dew)  — a living water drop; moves in beside a pond, hops along the bank, sits on lily pads
   苔球 (moss) — a sleepy ball of moss with a flower tucked on its side; settles in a thick meadow
   蕈寶 (cap)  — a shy little mushroom; lives in a mushroom ring and peeks out of the ground
   Tap one to say hi. Every right answer makes them all hop.
   critters 住在 maps[activeMap] 裡（bindMap）；提示文字走 message 事件，由頁面的 toast 顯示。 */
const sparks=[];
let seenKinds={};
const CR={dew:7.4, moss:9.2, cap:7.2};
const FIRST={dew:'水塘邊住進了一顆小露珠',moss:'草地上滾來一顆愛睡覺的苔球',cap:'蘑菇圈裡，好像有誰在偷看'};
const RARE={dew:'來了一顆會變色的露珠',moss:'這顆苔球別著一朵稀有的花',cap:'冒出一朵沒見過顏色的小蕈寶'};
function newCritter(kind,x,y,home,o={}){
  const t=now();
  return {kind,x,y,hx:home[0],hy:home[1],seed:o.seed??Math.random(),v:o.v??(Math.random()<.05?1:0),
    born:o.born??t,t0:t,wait:600+Math.random()*1500,hop:null,tgt:null,land:-1e9,
    blinkAt:t+800+Math.random()*3000,blinkT:-1e9,face:Math.random()<.5?-1:1,poke:-1e9,cheer:-1e9,
    e:kind==='cap'?0:1,state:kind==='cap'?'hidden':'idle',st0:t,sdur:400+Math.random()*1500,wakeAt:t+6000+Math.random()*9000,wakeT:-1e9};
}
function makeCritter(kind,x,y,home,o={}){
  if(critters.length>=15) return null;
  const c=newCritter(kind,x,y,home,o);
  critters.push(c);
  if(!o.quiet){ record(kind+(c.v?'R':'')); emit('discover',{kind:kind+(c.v?'R':''),x:c.x,y:c.y,map:activeMap}); }
  if(!o.quiet){
    if(!seenKinds[kind]){seenKinds[kind]=1;emit('message',FIRST[kind]);}
    else if(c.v) emit('message',RARE[kind]);
  }
  return c;
}
function nearestPond(x,y){let b=null,bd=1e9;for(const p of ponds){const d=dist(p.x,p.y,x,y);if(d<bd){bd=d;b=p}}return b}
function ringSpot(c){const a=Math.random()*Math.PI*2,rr=(.05+Math.random()*.02)*U;return [c.hx+Math.cos(a)*rr/W,c.hy+Math.sin(a)*rr*.5/H]}
function critterTarget(c){
  if(c.kind==='dew'){
    const p=nearestPond(c.hx,c.hy);
    if(!p) return around(c.x,c.y,.01,.04);
    c.hx=p.x;c.hy=p.y;
    const lil=plants.filter(q=>q.type==='lily'&&inPond(p,q.x,q.y)&&!critters.some(o=>o!==c&&dist(o.x,o.y,q.x,q.y)<3));
    if(lil.length&&chance(.3)){const l=pick(lil);return [l.x,l.y]}
    return pondEdge(p);
  }
  if(c.kind==='moss'){
    for(let i=0;i<8;i++){const t=around(c.hx,c.hy,0,.07);if(!pondAt(t[0],t[1],1.2)) return t}
    return [c.x,c.y];
  }
  return ringSpot(c);
}
function startHop(c,x1,y1,t,d,h){c.hop={x0:c.x,y0:c.y,x1,y1,t0:t,d,h};c.face=x1>c.x?1:x1<c.x?-1:c.face}
function updateCritters(t,dt){
  for(const c of critters){
    if(t>c.blinkAt){c.blinkT=t;c.blinkAt=t+1800+Math.random()*3800}
    if(c.kind==='moss'&&t>c.wakeAt){c.wakeT=t;c.wakeAt=t+9000+Math.random()*12000}
    if(c.kind==='cap'){
      const k=t-c.st0;
      if(c.state==='hidden'&&k>c.sdur){c.state='rise';c.st0=t}
      else if(c.state==='rise'){c.e=Math.min(1,k/500);if(c.e>=1){c.state='out';c.st0=t;c.sdur=3500+Math.random()*6000}}
      else if(c.state==='out'&&k>c.sdur&&!c.hop){c.state='sink';c.st0=t;c.e0=1}
      else if(c.state==='sink'){c.e=Math.max(0,c.e0*(1-k/280));if(c.e<=0){c.state='hidden';c.st0=t;c.sdur=2500+Math.random()*7000;const p=ringSpot(c);c.x=p[0];c.y=p[1];c.tgt=null}}
      if(c.state!=='out') continue;
    }
    if(c.hop){
      if(t-c.hop.t0>=c.hop.d){c.x=c.hop.x1;c.y=c.hop.y1;c.hop=null;c.land=t}
      else continue;
    }
    if(t-c.t0<c.wait) continue;
    if(!c.tgt) c.tgt=critterTarget(c);
    const d=dist(c.x,c.y,c.tgt[0],c.tgt[1]);
    if(d<1.5){c.tgt=null;c.t0=t;c.wait=c.kind==='moss'?3000+Math.random()*6000:c.kind==='cap'?1500+Math.random()*2500:1200+Math.random()*3000;continue}
    if(c.kind==='moss'){
      const f=Math.min(1,.016*U*dt/d);
      if(Math.abs(c.tgt[0]-c.x)>1e-4) c.face=c.tgt[0]>c.x?1:-1;
      c.x+=(c.tgt[0]-c.x)*f;c.y+=(c.tgt[1]-c.y)*f;c.moving=t;
      continue;
    }
    const step=(c.kind==='dew'?.032:.014)*U, f=Math.min(1,step/d);
    const dur=c.kind==='dew'?380:240;
    if(reduceMotion){c.x+=(c.tgt[0]-c.x)*f;c.y+=(c.tgt[1]-c.y)*f;c.t0=t;c.wait=400;continue}
    startHop(c,c.x+(c.tgt[0]-c.x)*f,c.y+(c.tgt[1]-c.y)*f,t,dur,c.kind==='dew'?9:4);
    c.t0=t;c.wait=dur+(c.kind==='dew'?120+Math.random()*260:200+Math.random()*350);
  }
  for(let i=sparks.length-1;i>=0;i--) if(t-sparks[i].t0>1100) sparks.splice(i,1);
}
function critterPos(c,t){
  let x=c.x,y=c.y,lift=0,sq=0;
  if(c.hop){
    const k=Math.min(1,(t-c.hop.t0)/c.hop.d);
    x=c.hop.x0+(c.hop.x1-c.hop.x0)*k;y=c.hop.y0+(c.hop.y1-c.hop.y0)*k;
    lift=Math.sin(Math.PI*k)*c.hop.h*S;
    sq=k<.12?-.22*(1-k/.12):.14*Math.sin(Math.PI*k);
  }else if(t-c.land<240) sq=-.24*(1-(t-c.land)/240);
  return {cx:x*W,cy:y*H,lift,sq};
}
const happy=(c,t)=>t-c.poke<1400||t-c.cheer<1100;
function eyes(c,t,ex,ey,er,look,open){
  const blink=t-c.blinkT<130;
  for(const s of [-1,1]){
    const X=ex*s+look, Y=ey;
    if(!open||blink){
      ctx.strokeStyle='#2a2a2a';ctx.lineWidth=er*.55;ctx.lineCap='round';
      ctx.beginPath();
      if(open) {ctx.moveTo(X-er*.9,Y);ctx.lineTo(X+er*.9,Y)}     // blinking
      else ctx.arc(X,Y-er*.35,er*.95,Math.PI*.2,Math.PI*.8);   // sleeping ‿
      ctx.stroke();continue;
    }
    if(happy(c,t)&&c.kind!=='moss'){ // ^ ^
      ctx.strokeStyle='#2a2a2a';ctx.lineWidth=er*.6;ctx.lineCap='round';
      ctx.beginPath();ctx.arc(X,Y+er*.5,er*.95,Math.PI*1.15,Math.PI*1.85);ctx.stroke();continue;
    }
    ctx.fillStyle='#262626';ctx.beginPath();ctx.ellipse(X,Y,er*.82,er,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(X-er*.28+look*.15,Y-er*.38,er*.34,0,Math.PI*2);ctx.fill();
  }
}
function cheeks(x,y,r){ctx.fillStyle='rgba(255,140,160,.42)';for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(x*s,y,r,r*.6,0,0,Math.PI*2);ctx.fill()}}
function lookAt(X,Y,r){
  if(!hover) return 0;
  return Math.max(-1,Math.min(1,(hover.x*W-X)/(60*S)))*r*.12;
}
function drawDew(c,t,p,g){
  const r=CR.dew*S*g, X=p.cx, Y=p.cy-p.lift;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(p.cx,p.cy,r*.85*Math.max(.5,1-p.lift/(30*S)),r*.3,0,0,Math.PI*2);ctx.fill();
  const idle=reduceMotion?0:Math.sin(t*.004+c.seed*20)*.035;
  const sy=1+p.sq+idle, sx=1-(p.sq+idle)*.7;
  ctx.save();ctx.translate(X,Y);ctx.scale(sx,sy);
  let c0='rgba(236,249,255,.97)',c1='rgba(150,207,238,.93)',c2='rgba(62,132,184,.95)',edge='rgba(35,85,125,.45)';
  if(c.v){const h=(t*.04+c.seed*360)%360;c0=`hsla(${h},90%,94%,.97)`;c1=`hsla(${(h+40)%360},75%,78%,.93)`;c2=`hsla(${(h+90)%360},60%,55%,.95)`;edge=`hsla(${(h+90)%360},50%,35%,.45)`}
  const gr=ctx.createRadialGradient(-r*.35,-r*1.35,r*.15,0,-r*.9,r*1.5);
  gr.addColorStop(0,c0);gr.addColorStop(.55,c1);gr.addColorStop(1,c2);
  ctx.beginPath();ctx.moveTo(0,-r*2.3);
  ctx.bezierCurveTo(r*.28,-r*1.95,r,-r*1.6,r,-r);ctx.arc(0,-r,r,0,Math.PI);
  ctx.bezierCurveTo(-r,-r*1.6,-r*.28,-r*1.95,0,-r*2.3);ctx.closePath();
  ctx.fillStyle=gr;ctx.fill();ctx.strokeStyle=edge;ctx.lineWidth=.8*S;ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.85)';
  ctx.beginPath();ctx.ellipse(-r*.45,-r*1.35,r*.17,r*.34,-.45,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(-r*.3,-r*1.8,r*.08,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.35)';ctx.beginPath();ctx.ellipse(r*.35,-r*.35,r*.35,r*.14,-.3,0,Math.PI*2);ctx.fill();
  const lk=lookAt(X,Y,r);
  eyes(c,t,r*.36,-r*.95,r*.17,lk,true);
  cheeks(r*.62,-r*.68,r*.17);
  ctx.strokeStyle='#2a2a2a';ctx.lineWidth=r*.09;ctx.lineCap='round';
  ctx.beginPath();ctx.arc(lk,-r*.76,happy(c,t)?r*.16:r*.09,Math.PI*.15,Math.PI*.85);ctx.stroke();
  ctx.restore();
}
function drawMoss(c,t,p,g){
  const r=CR.moss*S*g, X=p.cx, Y=p.cy-p.lift;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,p.cy+S*.5,r*1.15,r*.36,0,0,Math.PI*2);ctx.fill();
  const walking=!reduceMotion&&t-(c.moving||-1e9)<120;
  const breathe=reduceMotion?0:Math.sin(t*.0022+c.seed*9)*.03;
  const rot=walking?Math.sin(t*.012+c.seed*5)*.09:0;
  ctx.save();ctx.translate(X,Y);ctx.rotate(rot);ctx.scale((1-p.sq*.7-breathe*.5)*c.face,1+p.sq+breathe);
  const rx=r*1.1, ry=r*.9, cy=-ry;
  // soft lumpy outline
  ctx.fillStyle='#557f35';
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2;ctx.beginPath();ctx.arc(Math.cos(a)*rx*.93,cy+Math.sin(a)*ry*.93,r*(.24+hash(c.seed,i)*.08),0,Math.PI*2);ctx.fill()}
  const gr=ctx.createRadialGradient(-rx*.3,cy-ry*.45,r*.1,0,cy,rx*1.05);
  gr.addColorStop(0,'#a9cf6c');gr.addColorStop(.6,'#6f9a41');gr.addColorStop(1,'#557f35');
  ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(0,cy,rx,ry,0,0,Math.PI*2);ctx.fill();
  for(let i=0;i<12;i++){
    const a=hash(c.seed,i+30)*Math.PI*2,k=Math.sqrt(hash(c.seed,i+50))*.85;
    ctx.fillStyle=i%3?'rgba(70,105,40,.45)':'rgba(205,235,150,.55)';
    ctx.beginPath();ctx.arc(Math.cos(a)*rx*k,cy+Math.sin(a)*ry*k,r*(i%3?.07:.05),0,Math.PI*2);ctx.fill();
  }
  // flower tucked on its side
  const fc=c.v?PAL.flower[5]:PAL.flower[Math.floor(hash(c.seed,7)*5)];
  flowerHead(rx*.62,cy-ry*.62,r*.3,fc,1);
  ctx.scale(c.face,1);
  const awake=happy(c,t)||t-c.wakeT<1800;
  eyes(c,t,r*.34,cy+ry*.08,r*.15,awake?lookAt(X,Y,r):0,awake);
  cheeks(r*.6,cy+ry*.32,r*.16);
  if(awake){ctx.strokeStyle='#2a2a2a';ctx.lineWidth=r*.08;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,cy+ry*.28,r*.1,Math.PI*.15,Math.PI*.85);ctx.stroke()}
  ctx.restore();
  if(!awake&&!reduceMotion){ // drifting z
    const k=((t*.00035+c.seed)%1);
    ctx.globalAlpha=Math.sin(Math.PI*k)*.7;ctx.fillStyle='#fff';
    ctx.font=`700 ${Math.round(5*S+k*3*S)}px sans-serif`;
    ctx.fillText('z',X+r*.9+k*6*S,Y-r*1.9-k*14*S);ctx.globalAlpha=1;
  }
}
function drawCap(c,t,p,g){
  if(c.e<=0) return;
  const r=CR.cap*S*g, X=p.cx, Y=p.cy, h=r*2.6;
  if(c.e<1){ // little dirt mound while popping in/out
    ctx.fillStyle='rgba(95,70,45,.45)';ctx.beginPath();ctx.ellipse(X,Y,r*1.1,r*.35,0,0,Math.PI*2);ctx.fill();
  }else{
    ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,Y,r*1.1*Math.max(.5,1-p.lift/(20*S)),r*.32,0,0,Math.PI*2);ctx.fill();
  }
  ctx.save();
  ctx.beginPath();ctx.rect(X-r*3,Y-h*2,r*6,h*2+r*.2);ctx.clip();
  const idle=reduceMotion?0:Math.sin(t*.005+c.seed*11)*.03;
  ctx.translate(X,Y-p.lift+(1-c.e)*h*1.05);ctx.scale(1-(p.sq+idle)*.6,1+p.sq+idle);
  // feet + stem body
  ctx.fillStyle='#e6d9bf';
  for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*r*.38,-r*.05,r*.28,r*.16,0,0,Math.PI*2);ctx.fill()}
  ctx.fillStyle='#f5eedf';
  ctx.beginPath();ctx.moveTo(-r*.62,-r*.1);ctx.quadraticCurveTo(-r*.78,-r*.75,-r*.55,-r*1.35);
  ctx.lineTo(r*.55,-r*1.35);ctx.quadraticCurveTo(r*.78,-r*.75,r*.62,-r*.1);ctx.quadraticCurveTo(0,r*.12,-r*.62,-r*.1);ctx.fill();
  const lk=c.state==='out'?(hover?lookAt(X,Y,r):Math.sin(t*.0015+c.seed*7)*r*.08):0;
  eyes(c,t,r*.27,-r*.72,r*.13,lk,true);
  cheeks(r*.48,-r*.5,r*.13);
  // cap
  const capC=c.v?'#8e7be0':PAL.cap[Math.floor(hash(c.seed,3)*3)];
  ctx.fillStyle='rgba(0,0,0,.12)';ctx.beginPath();ctx.ellipse(0,-r*1.3,r*1.2,r*.28,0,0,Math.PI*2);ctx.fill();
  const gr=ctx.createRadialGradient(-r*.4,-r*2.1,r*.1,0,-r*1.5,r*1.5);
  gr.addColorStop(0,'rgba(255,255,255,.45)');gr.addColorStop(.35,capC);gr.addColorStop(1,capC);
  ctx.fillStyle=gr;
  ctx.beginPath();ctx.moveTo(-r*1.35,-r*1.3);ctx.bezierCurveTo(-r*1.35,-r*2.55,r*1.35,-r*2.55,r*1.35,-r*1.3);
  ctx.quadraticCurveTo(0,-r*1.08,-r*1.35,-r*1.3);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.88)';
  for(const [dx,dy,rr] of [[-.55,-1.85,.2],[.35,-2.08,.16],[.8,-1.6,.13],[-.05,-1.55,.1]]){ctx.beginPath();ctx.arc(dx*r,dy*r,rr*r,0,Math.PI*2);ctx.fill()}
  ctx.restore();
}
function drawCritter(c,t){
  const g=reduceMotion?1:Math.max(.001,easeBack((t-c.born)/700));
  const p=critterPos(c,t);
  if(c.kind==='dew') drawDew(c,t,p,g);
  else if(c.kind==='moss') drawMoss(c,t,p,g);
  else drawCap(c,t,p,g);
}
function drawSparks(t){
  for(const s of sparks){
    const k=(t-s.t0)/1100; if(k<0) continue;
    const X=s.x+Math.sin(k*6+s.x)*3*S, Y=s.y-k*22*S, r=3.2*S*(1-k*.3);
    ctx.globalAlpha=Math.min(1,(1-k)*1.6);
    ctx.fillStyle=s.c;
    ctx.beginPath();ctx.moveTo(X,Y+r*.9);
    ctx.bezierCurveTo(X-r*1.3,Y-r*.1,X-r*.6,Y-r*1.2,X,Y-r*.45);
    ctx.bezierCurveTo(X+r*.6,Y-r*1.2,X+r*1.3,Y-r*.1,X,Y+r*.9);ctx.fill();
  }
  ctx.globalAlpha=1;
}
function critterHit(x,y){
  const t=now();let best=null,bd=1e9;
  for(const c of critters){
    if(c.kind==='cap'&&c.e<.35) continue;
    const p=critterPos(c,t), r=CR[c.kind]*S;
    const d=Math.hypot(x*W-p.cx,y*H-(p.cy-p.lift-r*1.1));
    if(d<bd){bd=d;best=c}
  }
  return best&&bd<Math.max(16*S,CR[best.kind]*S*1.8)?best:null;
}
function poke(c){
  const t=now();c.poke=t;c.wakeT=t;
  const p=critterPos(c,t), r=CR[c.kind]*S;
  if(c.kind==='cap'){c.state='sink';c.st0=t;c.e0=c.e;c.hop=null}
  else if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,440,15);c.t0=t;c.wait=1100}
  sparks.push({x:p.cx,y:p.cy-r*2.6,t0:t,c:'#f08aa2'});
}
function critterCheer(){
  critters.forEach((c,i)=>setTimeout(()=>{
    const t=now();
    if(c.kind==='cap'&&c.state!=='out') return;
    c.cheer=t;
    if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,360,c.kind==='moss'?6:10);c.t0=t;c.wait=Math.max(c.wait,700)}
  },i*90+Math.random()*60));
}
function critterNotice(x,y){ // a drop lands nearby: dew and moss come to look
  for(const c of critters){
    if(c.kind==='cap'||dist(c.x,c.y,x,y)>.16*U) continue;
    const tg=around(x,y,.02,.035);
    if(c.kind==='dew'){ if(pondAt(tg[0],tg[1],1.05)) continue; const p=nearestPond(c.hx,c.hy); if(!p||!inPond(p,tg[0],tg[1],2.4)) continue; }
    else if(pondAt(tg[0],tg[1],1.15)) continue;
    c.tgt=tg;c.wait=0;c.wakeT=now();
  }
}
function residents(x,y,acts,nG,bigTrees){
  const bankP=ponds.find(p=>inPond(p,x,y,2.8));
  if(bankP&&critters.filter(c=>c.kind==='dew'&&dist(c.hx,c.hy,bankP.x,bankP.y)<6).length<3&&chance(.28))
    acts.push(()=>{if(critters.filter(c=>c.kind==='dew'&&dist(c.hx,c.hy,bankP.x,bankP.y)<6).length>=3)return;const [a,b]=pondEdge(bankP);makeCritter('dew',a,b,[bankP.x,bankP.y])});
  if(nG>=8&&!pondAt(x,y,1.2)&&critters.filter(c=>c.kind==='moss').length<4&&!critters.some(c=>c.kind==='moss'&&dist(c.hx,c.hy,x,y)<.15*U)&&chance(.15))
    acts.push(()=>{if(critters.some(c=>c.kind==='moss'&&dist(c.hx,c.hy,x,y)<.15*U))return;makeCritter('moss',x,y,[x,y])});
  const ringTree=bigTrees.find(tr=>plants.some(p=>p.type==='mushroom'&&dist(p.x,p.y,tr.x,tr.y)<.1*U));
  if(ringTree){
    const hx=ringTree.x,hy=ringTree.y+.012*U/H;
    if(critters.filter(c=>c.kind==='cap'&&dist(c.hx,c.hy,hx,hy)<6).length<2&&chance(.25))
      acts.push(()=>{if(critters.filter(c=>c.kind==='cap'&&dist(c.hx,c.hy,hx,hy)<6).length>=2)return;const c=makeCritter('cap',hx,hy,[hx,hy]);if(c){const p=ringSpot(c);c.x=p[0];c.y=p[1]}});
  }
}

/* ================= 圖鑑 (field guide) =================
   Everything found on the land is recorded here, and it stays even after the land is cleared.
   按鈕和對話框由 world 自己插進頁面（按鈕進 root、對話框進 body、CSS 進 head），頁面 HTML 不用改。
   顏色沿用頁面的 --panel --ink --muted --line --opt --water --right --wrong --soil；--sil --gold 由這裡定義。 */
const GUIDE_CSS=`
:root{--sil:rgba(70,52,30,.28);--gold:#c49a3a}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--sil:rgba(0,0,0,.38);--gold:#d9b560}}
:root[data-theme="dark"]{--sil:rgba(0,0,0,.38);--gold:#d9b560}
.guide-btn{position:absolute;left:.75rem;top:.75rem;display:flex;align-items:center;gap:.45rem;font-size:.9rem;color:var(--ink);background:var(--panel);border:0;border-radius:999px;padding:.35rem .9rem;cursor:pointer;opacity:.9}
.guide-btn:hover{opacity:1}
.guide-btn .gc{color:var(--muted);font-size:.8rem}
.guide-btn .dot{width:8px;height:8px;border-radius:50%;background:var(--wrong)}
.guide-btn .dot[hidden]{display:none}
.stale:not([hidden]) ~ .guide-btn{display:none}
.guide{position:fixed;inset:0;z-index:20;background:rgba(18,22,14,.5);display:grid;place-items:center;padding:1.25rem;animation:gfade .2s ease-out}
.guide[hidden]{display:none}
@keyframes gfade{from{opacity:0}to{opacity:1}}
.g-sheet{width:min(840px,100%);max-height:min(90vh,920px);background:var(--panel);border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3);animation:gup .28s cubic-bezier(.2,.9,.3,1.1)}
@keyframes gup{from{transform:translateY(16px);opacity:.4}to{transform:none;opacity:1}}
.g-head{display:flex;align-items:flex-start;gap:1rem;padding:1.2rem 1.5rem 1rem;border-bottom:1px solid var(--line)}
.g-head h2{margin:0;font-size:1.45rem}
.g-prog{display:flex;align-items:center;gap:.65rem;margin-top:.4rem;color:var(--muted);font-size:.9rem}
.g-track{width:9rem;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.g-track i{display:block;height:100%;background:var(--right);border-radius:3px;transition:width .6s}
.g-close{margin-left:auto;flex:none;width:2.4rem;height:2.4rem;border-radius:50%;border:1px solid var(--line);background:var(--opt);color:var(--ink);font-size:1.35rem;line-height:1;cursor:pointer}
.g-body{overflow-y:auto;padding:.25rem 1.5rem 1.6rem}
.g-sec{display:flex;align-items:baseline;gap:.75rem;flex-wrap:wrap;margin:1.1rem 0 .7rem}
.g-sec h3{margin:0;font-size:1.08rem}
.g-sec p{margin:0;font-size:.85rem;color:var(--muted)}
.g-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:.8rem}
.g-card{background:var(--opt);border:1.5px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.g-card.rare{border-color:var(--gold)}
.g-card.fresh{box-shadow:0 0 0 3px color-mix(in srgb,var(--water) 40%,transparent)}
.g-pic{position:relative;aspect-ratio:1/.8;background:radial-gradient(ellipse at 50% 62%,color-mix(in srgb,var(--soil) 78%,#fff) 0%,var(--soil) 72%)}
.g-card.rare .g-pic{background:radial-gradient(ellipse at 50% 62%,color-mix(in srgb,var(--soil) 70%,#fff6d8) 0%,var(--soil) 75%)}
.g-card.locked .g-pic{background:color-mix(in srgb,var(--soil) 45%,var(--opt))}
.g-pic canvas{display:block;width:100%;height:100%}
.g-pic.pokeable canvas{cursor:pointer}
.g-tag{position:absolute;top:.5rem;font-size:.74rem;padding:.08rem .5rem;border-radius:999px;color:#fff}
.g-tag.new{left:.5rem;background:var(--water)}
.g-tag.rare{right:.5rem;background:var(--gold)}
.g-text{padding:.6rem .8rem .8rem;display:flex;flex-direction:column;flex:1}
.g-text h4{margin:0 0 .25rem;font-size:1.08rem}
.g-desc{margin:0;font-size:.88rem;line-height:1.6}
.g-card.locked h4{color:var(--muted);letter-spacing:.12em}
.g-card.locked .g-desc{color:var(--muted)}
.g-meta{margin:.5rem 0 0;padding-top:.45rem;border-top:1px dashed var(--line);font-size:.78rem;color:var(--muted);margin-top:auto}
@media (max-width:600px){
  .guide{padding:0;place-items:end stretch}
  .g-sheet{max-height:92vh;border-radius:18px 18px 0 0}
  .g-head{padding:1rem 1rem .8rem}.g-body{padding:.25rem 1rem 1.2rem}
  .g-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}
  .g-text{padding:.5rem .6rem .65rem}.g-desc{font-size:.8rem}.g-text h4{font-size:1rem}
}
@media (prefers-reduced-motion:reduce){.guide,.g-sheet{animation:none}}
`;
const G={};   // 圖鑑的 DOM（元素參考，不靠 getElementById）
(function buildGuideDom(){
  if(!document.getElementById('odw-guide-css')){
    const st=document.createElement('style'); st.id='odw-guide-css'; st.textContent=GUIDE_CSS;
    document.head.appendChild(st);
  }
  const btn=document.createElement('button');
  btn.className='guide-btn'; btn.id='guideBtn'; btn.type='button';
  btn.innerHTML='圖鑑 <span class="gc" id="gcount">0/12</span><i class="dot" id="gdot" hidden></i>';
  land.appendChild(btn);
  const dlg=document.createElement('div');
  dlg.className='guide'; dlg.id='guide'; dlg.hidden=true;
  dlg.setAttribute('role','dialog'); dlg.setAttribute('aria-modal','true'); dlg.setAttribute('aria-labelledby','gTitle');
  dlg.innerHTML='<div class="g-sheet"><header class="g-head"><div><h2 id="gTitle">土地圖鑑</h2>'+
    '<div class="g-prog"><span class="g-track"><i id="gBar"></i></span><span id="gSub"></span></div></div>'+
    '<button class="g-close" id="gClose" aria-label="關閉圖鑑">×</button></header>'+
    '<div class="g-body" id="gBody"></div></div>';
  document.body.appendChild(dlg);
  Object.assign(G,{guideBtn:btn, gcount:btn.querySelector('.gc'), gdot:btn.querySelector('.dot'), guide:dlg,
    gBar:dlg.querySelector('#gBar'), gSub:dlg.querySelector('#gSub'), gClose:dlg.querySelector('.g-close'), gBody:dlg.querySelector('.g-body')});
})();
let found={}, newFound={};
const GUIDE=[
  {sec:'小居民',note:'住在土地上的小生物，點一下會跟你打招呼'},
  {k:'dew', name:'露露', art:'critter',kind:'dew',v:0,
   desc:'一顆會跳的露珠。喜歡在水塘邊跳來跳去，有時會坐在睡蓮葉上發呆。',
   hint:'有了水塘以後，在岸邊澆水看看'},
  {k:'dewR', name:'七彩露露', art:'critter',kind:'dew',v:1,rare:true,
   desc:'顏色會慢慢變換的露露。聽說是彩虹掉下來的一小滴。',
   hint:'露露裡面，偶爾會出現不一樣的'},
  {k:'moss', name:'苔球', art:'critter',kind:'moss',v:0,
   desc:'很愛睡覺的青苔團，身上別著一朵小花。走路很慢，偶爾醒來看看你。',
   hint:'草長得很密很密的地方'},
  {k:'mossR', name:'紫花苔球', art:'critter',kind:'moss',v:1,rare:true,
   desc:'別著稀有紫花的苔球。它自己好像不知道這朵花有多珍貴。',
   hint:'有一顆苔球，別著很少見的花'},
  {k:'cap', name:'蕈寶', art:'critter',kind:'cap',v:0,
   desc:'很害羞的小蘑菇，住在蘑菇圈裡。被點到會馬上躲回土裡。',
   hint:'蘑菇圈附近，好像有誰在偷看'},
  {k:'capR', name:'紫蕈寶', art:'critter',kind:'cap',v:1,rare:true,
   desc:'紫色的蕈寶，比一般的更害羞，很少露面。',
   hint:'蕈寶也有稀有的顏色'},
  {sec:'土地的秘密',note:'照顧土地時會慢慢發生的事'},
  {k:'pond', name:'水塘', art:'pond',
   desc:'同一塊地澆了太多水，就積成一個小水塘。',
   hint:'一直在同一個地方澆水，會怎麼樣？'},
  {k:'lily', name:'睡蓮', art:'lily',
   desc:'在水塘裡滴水會長出圓葉子，繼續照顧就會開花。',
   hint:'水塘裡面也可以滴水喔'},
  {k:'tree', name:'大樹', art:'tree',
   desc:'從一棵小樹苗慢慢長大。大樹旁邊會冒出更多新芽。',
   hint:'找到一棵小樹苗，一直照顧它'},
  {k:'ring', name:'蘑菇圈', art:'ring',
   desc:'大樹的樹蔭下，蘑菇會圍成一個圈。',
   hint:'在大樹旁邊澆水'},
  {k:'fly', name:'蝴蝶', art:'fly',
   desc:'花開得夠多，蝴蝶就會飛過來停一下。',
   hint:'花開得很多很多的地方'},
  {k:'violet', name:'紫花', art:'violet',rare:true,
   desc:'很少見的花。它旁邊再開的花，常常也是紫色的。',
   hint:'運氣很好的時候才會開'},
];
const G_ITEMS=GUIDE.filter(e=>e.k);
// 參考檔的 discover(key)；改名是為了不和 discover 事件（每次發生都發、給頁面 toast）混淆。
// 這裡只在圖鑑第一次登錄時做事，並發 found 事件。
function record(key){
  if(found[key]) return;
  found[key]=Date.now(); newFound[key]=1;
  updateGuideBtn(); save();
  const e=G_ITEMS.find(x=>x.k===key);
  emit('found',{key,name:e?e.name:key});
  if(e) setTimeout(()=>emit('message','圖鑑新增：'+e.name),2400);   // after the land's own message
}
function scanFound(){ // fill in anything already on the land (older saves)
  const t=Date.now(), mark=k=>{if(!found[k]) found[k]=t};
  critters.forEach(c=>mark(c.kind+(c.v?'R':'')));
  if(ponds.length) mark('pond');
  if(plants.some(p=>p.type==='lily'&&p.stage>=2)) mark('lily');
  if(plants.some(p=>p.type==='tree'&&p.stage>=3)) mark('tree');
  if(plants.some(p=>p.type==='mushroom')) mark('ring');
  if(plants.some(p=>p.type==='flower'&&p.color===5)) mark('violet');
  if(flies.length) mark('fly');
}
function onLand(key){
  switch(key){
    case 'pond': return ponds.length;
    case 'lily': return plants.filter(p=>p.type==='lily'&&p.stage>=2).length;
    case 'tree': return plants.filter(p=>p.type==='tree'&&p.stage>=3).length;
    case 'ring': return plants.filter(p=>p.type==='tree'&&p.stage>=3&&plants.some(q=>q.type==='mushroom'&&dist(q.x,q.y,p.x,p.y)<.1*U)).length;
    case 'fly': return flies.length;
    case 'violet': return plants.filter(p=>p.type==='flower'&&p.color===5).length;
    default: return critters.filter(c=>c.kind+(c.v?'R':'')===key).length;
  }
}
const UNIT_WORD={pond:'個',lily:'朵',tree:'棵',ring:'個',fly:'隻',violet:'朵'};
function updateGuideBtn(){
  const n=G_ITEMS.filter(e=>found[e.k]).length;
  G.gcount.textContent=n+'/'+G_ITEMS.length;
  G.gdot.hidden=!Object.keys(newFound).length;
}

/* ---------- portraits: the real drawing code, pointed at a small canvas ---------- */
const portraits=[];   // {e, cv, pctx, st, w, h}
function withCanvas(pctx,w,h,s,fn){
  const sv=[ctx,W,H,U,S,hover];
  ctx=pctx;W=w;H=h;U=Math.min(w,h);S=s;hover=null;
  try{fn()}finally{[ctx,W,H,U,S,hover]=sv}
}
function pokePortrait(pt,t){
  const c=pt.st.c; if(!c) return;
  c.poke=t;c.wakeT=t;
  if(c.kind==='cap'){ if(c.pstate==='out'){c.pstate='sink';c.pt0=t} }
  else if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,440,15)}
}
function tickPortraitCritter(c,t){
  if(t>c.blinkAt){c.blinkT=t;c.blinkAt=t+1800+Math.random()*3800}
  if(c.kind==='moss'&&t>c.wakeAt){c.wakeT=t;c.wakeAt=t+7000+Math.random()*8000}
  if(c.hop&&t-c.hop.t0>=c.hop.d){c.hop=null;c.land=t}
  if(c.kind==='dew'&&!c.hop&&!reduceMotion&&t>c.nextHop){startHop(c,c.x,c.y,t,380,8);c.nextHop=t+2500+Math.random()*4000}
  if(c.kind==='cap'){
    const k=t-c.pt0;
    if(c.pstate==='sink'){c.e=Math.max(0,1-k/260);if(c.e<=0){c.pstate='hidden';c.pt0=t}}
    else if(c.pstate==='hidden'&&k>900){c.pstate='rise';c.pt0=t}
    else if(c.pstate==='rise'){c.e=Math.min(1,k/450);if(c.e>=1){c.pstate='out';c.pt0=t}}
  }
}
function drawPortrait(pt,t){
  const {e,pctx,st,w,h}=pt, P=Math.min(w,h), dpr=pt.dpr;
  pctx.setTransform(1,0,0,1,0,0);pctx.clearRect(0,0,pt.cv.width,pt.cv.height);
  pctx.setTransform(dpr,0,0,dpr,0,0);
  const art=()=>{
    switch(e.art){
      case 'critter':{
        if(!st.c){
          st.c=newCritter(e.kind,.5,e.kind==='cap'?.8:.78,[.5,.8],{v:e.v,seed:e.kind==='moss'?(e.v?.31:.12):.37,born:-1e9});
          st.c.e=1;st.c.state='out';st.c.pstate='out';st.c.pt0=t;st.c.nextHop=t+800+Math.random()*2000;st.c.face=1;
        }
        tickPortraitCritter(st.c,t);
        if(e.kind==='moss') st.c.face=1;
        S=P*(e.kind==='dew'?.027:.024);
        drawCritter(st.c,t);break;
      }
      case 'pond':{
        S=P*.012;
        drawPond({x:.5,y:.55,r:.34/1.35,born:-1e9},t);
        for(const [x,y,sd] of [[.17,.34,.1],[.84,.4,.2],[.22,.8,.3],[.8,.78,.4]]) drawGrass({seed:sd},x*W,y*H,1.6,1,t);
        break;
      }
      case 'lily':{
        S=P*.012;
        drawPond({x:.5,y:.56,r:.42/1.35,born:-1e9},t);
        S=P*.045; drawLily({seed:.55},.46*W,.6*H,2,1);
        S=P*.028; drawLily({seed:.2},.72*W,.48*H,1,1);
        break;
      }
      case 'tree':{
        S=P*.012; drawGrass({seed:.7},.16*W,.9*H,1.5,1,t);drawGrass({seed:.9},.85*W,.88*H,1.5,1,t);
        S=P*.0105; drawTree({seed:.42},.5*W,.9*H,3,1,t);
        break;
      }
      case 'ring':{
        S=P*.03;
        const n=7;
        const pts=[...Array(n)].map((_,i)=>{const a=i/n*Math.PI*2+.3;return [.5+Math.cos(a)*.32,.64+Math.sin(a)*.17,i/n]}).sort((a,b)=>a[1]-b[1]);
        for(const [x,y,sd] of pts) drawMushroom({seed:sd+.05},x*W,y*H,1);
        break;
      }
      case 'fly':{
        S=P*.02;
        for(const [x,y,sd,c] of [[.3,.88,.15,2],[.55,.92,.35,1],[.75,.86,.55,3]]) drawFlower({seed:sd,color:c},x*W,y*H,2,1,t);
        // drawFly 會把蝴蝶畫在 y 往上 18*S 的地方（土地上是飛在花叢上方）；畫像的 S 很大，
        // 參考檔直接給 y=.52 會整隻畫到卡片外。這裡把那段位移加回來，讓蝴蝶停在花的上方（約 .22 高）。
        S=P*.04; drawFly({x:.5,y:.22+18*S/H,seed:.3,c:0,born:-1e9},t);
        break;
      }
      case 'violet':{
        S=P*.019; drawFlower({seed:.23,color:5},.5*W,.88*H,2.6,1,t);
        break;
      }
    }
  };
  withCanvas(pctx,w,h,1,art);
  if(!found[e.k]){ // silhouette
    pctx.setTransform(1,0,0,1,0,0);
    pctx.globalCompositeOperation='source-in';
    pctx.fillStyle=cssVar('--sil');pctx.fillRect(0,0,pt.cv.width,pt.cv.height);
    pctx.globalCompositeOperation='source-over';
  }
}
function fmtDate(ms){const d=new Date(ms);return (d.getMonth()+1)+'/'+d.getDate()}
function openGuide(){
  const body=G.gBody; body.innerHTML=''; portraits.length=0;
  const n=G_ITEMS.filter(e=>found[e.k]).length;
  G.gSub.textContent='已發現 '+n+' / '+G_ITEMS.length;
  G.gBar.style.width=(n/G_ITEMS.length*100)+'%';
  let grid=null;
  for(const e of GUIDE){
    if(e.sec){
      const h=document.createElement('div');h.className='g-sec';
      h.innerHTML='<h3></h3><p></p>';h.firstChild.textContent=e.sec;h.lastChild.textContent=e.note;
      body.appendChild(h);
      grid=document.createElement('div');grid.className='g-grid';body.appendChild(grid);
      continue;
    }
    const got=!!found[e.k];
    const card=document.createElement('article');
    card.className='g-card'+(got?'':' locked')+(got&&e.rare?' rare':'')+(newFound[e.k]?' fresh':'');
    card.innerHTML='<div class="g-pic"><canvas></canvas></div><div class="g-text"><h4></h4><p class="g-desc"></p><p class="g-meta"></p></div>';
    const tags=[];
    if(newFound[e.k]) tags.push('<span class="g-tag new">新發現</span>');
    if(got&&e.rare) tags.push('<span class="g-tag rare">稀有</span>');
    card.querySelector('.g-pic').insertAdjacentHTML('beforeend',tags.join(''));
    card.querySelector('h4').textContent=got?e.name:'？？？';
    card.querySelector('.g-desc').textContent=got?e.desc:'線索：'+e.hint;
    if(got){
      const c=onLand(e.k);
      card.querySelector('.g-meta').textContent=fmtDate(found[e.k])+' 發現'+(c?' · 現在有 '+c+' '+(UNIT_WORD[e.k]||'隻'):'');
    }else card.querySelector('.g-meta').remove();
    grid.appendChild(card);
    const cvs=card.querySelector('canvas');
    const pt={e,cv:cvs,pctx:cvs.getContext('2d'),st:{},w:0,h:0,dpr:1};
    portraits.push(pt);
    if(got&&e.art==='critter'){
      card.querySelector('.g-pic').classList.add('pokeable');
      cvs.setAttribute('aria-label','點一下 '+e.name);
      cvs.addEventListener('click',()=>pokePortrait(pt,now()));
    }
  }
  G.guide.hidden=false;
  sizePortraits();
  G.gClose.focus({preventScroll:true});
  G.gBody.scrollTop=0;
}
function sizePortraits(){
  const dpr=Math.min(devicePixelRatio||1,2);
  for(const pt of portraits){
    const r=pt.cv.getBoundingClientRect();
    pt.w=r.width;pt.h=r.height;pt.dpr=dpr;
    pt.cv.width=Math.round(r.width*dpr);pt.cv.height=Math.round(r.height*dpr);
  }
}
function closeGuide(){
  G.guide.hidden=true; portraits.length=0;
  newFound={}; updateGuideBtn(); save();
  G.guideBtn.focus({preventScroll:true});
}
function renderPortraits(t){
  if(G.guide.hidden) return;
  for(const pt of portraits) if(pt.w) drawPortrait(pt,t);
}
G.guideBtn.onclick=openGuide;
G.gClose.onclick=closeGuide;
G.guide.addEventListener('click',e=>{if(e.target===G.guide)closeGuide()});
// 圖鑑開著時，鍵盤不能碰到頁面的答題快捷鍵：window 的 capture 比頁面掛在 document 上的 handler 都早。
// 只 stopPropagation、不 preventDefault，焦點在「×」上時 Enter／空白鍵仍能關閉。
addEventListener('keydown',e=>{
  if(G.guide.hidden) return;
  if(e.key==='Escape'){ e.stopPropagation(); closeGuide(); return; }
  if(e.key==='Tab') return;
  e.stopPropagation();
},true);
addEventListener('resize',()=>{if(!G.guide.hidden)sizePortraits()});

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
  const flat=plants.filter(p=>p.type==='lily'), up=plants.filter(p=>p.type!=='lily').concat(critters).sort((a,b)=>a.y-b.y);
  for(const p of flat.concat(up)){
    if(p.kind){ drawCritter(p,t); continue; }
    const a=reduceMotion?1:Math.max(.001,easeBack((t-p.born)/700));
    const X=p.x*W,Y=p.y*H;
    const sp=SPECIES[p.type];
    if(sp) sp.draw(p,X,Y,a,t);
  }
  for(const f of flies) drawFly(f,t);
  drawSparks(t);
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
  updateCritters(t,dt);
  paint(t,true);
  renderPortraits(t);
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
    flies:flies.map(f=>[+f.x.toFixed(4),+f.y.toFixed(4),+f.seed.toFixed(6),f.c]),
    critters:critters.map(c=>[c.kind,+c.x.toFixed(4),+c.y.toFixed(4),+c.seed.toFixed(6),c.v,+c.hx.toFixed(4),+c.hy.toFixed(4)]), seenKinds, found, newFound
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
    (d.critters||[]).forEach(a=>{if(CR[a[0]]) makeCritter(a[0],a[1],a[2],[a[5],a[6]],{seed:a[3],v:a[4],born:-1e9,quiet:true})});
    if(d.seenKinds&&typeof d.seenKinds==='object') seenKinds=d.seenKinds;
    if(d.found&&typeof d.found==='object') found=d.found;
    if(d.newFound&&typeof d.newFound==='object') newFound=d.newFound;
  }
  scanFound();          // 舊存檔沒有 found：從現有土地補登（例如已經有水塘就記為已發現）
  updateGuideBtn();
  ready=true;
  return d;
}

/* ================= 清空土地 ================= */
function reset(){
  gen++;
  for(const a of [plants,wets,ponds,flies,falls,rings,critters,sparks]) a.length=0;
  seenKinds={};         // 圖鑑紀錄 found 不清
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
  addWater(n){ n=n|0; if(n<=0) return; water+=n; syncWater(true); critterCheer(); },   // 答對：居民一起跳
  refresh(){ syncWater(false); },               // 啟動時畫一次水滴列與提示字
  freeze(){ frozen=true; clearTimeout(saveT); },
  get water(){ return water; },
  get activeMap(){ return activeMap; },
  // 測試用唯讀窺視（x,y 是可以點到那隻居民的畫面座標，px，相對於畫布左上）
  _peek(){
    const t=now();
    return {
      critters:critters.map(c=>{const p=critterPos(c,t);return {kind:c.kind,v:c.v,x:p.cx,y:p.cy-p.lift-CR[c.kind]*S*1.1,hop:!!c.hop,cheer:c.cheer,state:c.state,e:c.e}}),
      found:{...found}, newFound:{...newFound}, seenKinds:{...seenKinds}, guideOpen:!G.guide.hidden, now:t,
    };
  },
};
return api;
}

window.OneDropWorld={ VERSION, create };
})();
