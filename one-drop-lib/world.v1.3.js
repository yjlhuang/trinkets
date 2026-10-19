/* 一滴水 world —— 共用的土地：植物、水塘、居民、手上的水、存檔。
   原始碼在 private repo one-drop-world（src/world.js）；各頁面載入的是發佈版
   one-drop-lib/world.vX.Y.js（classic script，相對路徑，same-origin）。
   不要直接改各 repo 裡的副本：改 src/world.js、發新版號，再用 tools/sync.mjs 同步。

   介面見 PLAN.md 2.2。
   存檔：仍寫回頁面原本的 key、v1 格式；既有欄位的順序與精度不變，v1.1 只在 flies 後面新增
   critters、seenKinds、found、newFound（居民與圖鑑）。v1.2 讓居民前面的植物變透明，不新增存檔欄位。
   v1.3 加 4 種居民（嗡嗡、點點、毛毛、小雲）和 4 種植物（三葉草、向日葵、鬱金香、南瓜），圖鑑 12 → 28 格；
   存檔欄位不變（只多了新的 kind/type 字串），讀到不認得的居民會原樣保留、存檔時寫回。
   內部資料已經是多地圖的形狀（maps + activeMap），目前只有 home 一張。 */
(function(){
'use strict';
const VERSION='1.3';

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
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=Math.PI*2;
// v1.3：今天的日期（南瓜只在 10～11 月長）；測試可以用 cfg.today() 注入
const today=()=>cfg.today?cfg.today():new Date();
const autumn=()=>{const m=today().getMonth();return m===9||m===10};
// v1.3：植物分組。outcome() 用它決定「從這株長出什麼」；不在分組裡的會被當成樹（舊程式的 else 分支）
const GRASSY={grass:1,mushroom:1,clover:1,pumpkin:1}, FLOWERY={flower:1,sunflower:1,tulip:1};
// v1.3：新植物的圖鑑格。min＝長到第幾階才登錄；稀有＝color 5（跟紫花同一個機率）
const PKEY={clover:{type:'clover',rare:false,min:1},cloverR:{type:'clover',rare:true,min:1},
  sunflower:{type:'sunflower',rare:false,min:3},sunflowerR:{type:'sunflower',rare:true,min:3},
  tulip:{type:'tulip',rare:false,min:3},tulipR:{type:'tulip',rare:true,min:3},
  pumpkin:{type:'pumpkin',rare:false,min:3},pumpkinR:{type:'pumpkin',rare:true,min:3}};

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
  [x,y]=clearOfCritters(type,x,y);
  let color=opts.color;
  if(color===undefined) color = chance(.03) ? 5 : Math.floor(Math.random()*5);
  const p={type,x,y,stage:opts.stage||1,v:0,born:now(),seed:Math.random(),color};
  plants.push(p);
  if(type==='flower'&&color===5) record('violet');
  if(type==='mushroom') record('ring');
  if(type==='clover') record(color===5?'cloverR':'clover');
  if(type==='flower' && color===5 && opts.color===undefined) emit('discover',{kind:'rare-flower',x,y,map:activeMap,color});
  return p;
}
function grow(p){ if(p.stage<3){p.stage++; ring(p);} if(p.type==='lily'&&p.stage>=2) record('lily'); if(p.type==='tree'&&p.stage>=3) record('tree');
  if(PKEY[p.type]&&PKEY[p.type].min===3&&p.stage>=3) record(p.type+(p.color===5?'R':'')); }
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
  const nG=count('grass')+count('clover'), nF=count('flower');   // v1.3：三葉草也算草，苔球、毛毛不會因此變少
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
    // v1.3：秋天（10～11 月）空地偶爾冒出南瓜藤
    if(autumn() && plants.filter(p=>p.type==='pumpkin').length<6 && chance(.05)){ acts.push(()=>addPlant('pumpkin',x,y)); return; }
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
      if(GRASSY[src.type]){
        // v1.3：三葉草會自己蔓延；很密的草地裡，新長的草偶爾是三葉草
        const sprout=()=>(src.type==='clover'&&chance(.45))||(nG>=5&&chance(.12))?'clover':'grass';
        for(let i=0,k=1+Math.floor(Math.random()*3);i<k;i++){const [a,b]=around(x,y,.02,.07),ty=sprout();acts.push(()=>addPlant(ty,a,b))}
        if(chance(.12)){const [a,b]=around(x,y,.02,.06);acts.push(()=>addPlant('flower',a,b))}
        if(autumn() && plants.filter(p=>p.type==='pumpkin').length<6 && chance(.03)){const [a,b]=around(x,y,.03,.07);acts.push(()=>addPlant('pumpkin',a,b))}
      }else if(FLOWERY[src.type]){
        const fc=src.type==='flower'?src.color:src.type==='sunflower'?1:undefined;
        for(let i=0,k=1+(chance(.4)?1:0);i<k;i++){const [a,b]=around(src.x,src.y,.025,.07);acts.push(()=>addPlant('flower',a,b,{color:fc!==undefined&&chance(.8)?fc:undefined}))}
        if(chance(.5)){const [a,b]=around(x,y,.02,.05);acts.push(()=>addPlant('grass',a,b))}
        // v1.3：黃花開成一片 → 向日葵；同一種顏色的花連成一大片 → 鬱金香
        const nY=near.filter(p=>p.type==='flower'&&p.color===1).length;
        if(nY>=3 && near.filter(p=>p.type==='sunflower').length<2 && chance(.18)){const [a,b]=around(src.x,src.y,.03,.07);acts.push(()=>addPlant('sunflower',a,b))}
        if(src.type==='flower' && near.filter(p=>p.type==='flower'&&p.color===src.color).length>=5 && chance(.15)){const [a,b]=around(src.x,src.y,.025,.06);acts.push(()=>addPlant('tulip',a,b))}
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
const CR={dew:7.4, moss:9.2, cap:7.2, bee:6, ladybug:7, puff:8, cloud:8};
const FIRST={dew:'水塘邊住進了一顆小露珠',moss:'草地上滾來一顆愛睡覺的苔球',cap:'蘑菇圈裡，好像有誰在偷看',
  bee:'花圃裡飛來一隻嗡嗡',ladybug:'花叢裡跑來一隻點點',puff:'草地上飄來一團毛毛',cloud:'答對好多題，飄來一朵小雲'};
const RARE={dew:'來了一顆會變色的露珠',moss:'這顆苔球別著一朵稀有的花',cap:'冒出一朵沒見過顏色的小蕈寶',
  bee:'這隻嗡嗡是藍色條紋的',ladybug:'來了一隻黃色的點點',puff:'飄來一團粉紅色的毛毛',cloud:'小雲身邊掛著一段彩虹'};
// v1.3：飛在空中的居民（不會被植物擋、也不會把新植物推開）；alt 是離地高度（S 單位）
const AIR={bee:1,puff:1,cloud:1}, ALT0={bee:22,puff:12,cloud:70};
const keepCritters=[];   // v1.3：讀到不認得的居民（例如之後版本才有的），原樣保留、存檔時寫回
const puffSeeds=[];      // 毛毛噴出來的種子（只在記憶體）
let streak=[];           // 最近幾次答對的時間（addWater），湊滿就來一朵小雲
const STREAK_N=10, STREAK_MS=5*60*1000;
function newCritter(kind,x,y,home,o={}){
  const t=now();
  return {kind,x,y,hx:home[0],hy:home[1],seed:o.seed??Math.random(),v:o.v??(Math.random()<.05?1:0),
    born:o.born??t,t0:t,wait:600+Math.random()*1500,hop:null,tgt:null,land:-1e9,
    blinkAt:t+800+Math.random()*3000,blinkT:-1e9,face:Math.random()<.5?-1:1,poke:-1e9,cheer:-1e9,
    e:kind==='cap'?0:1,state:kind==='cap'?'hidden':'idle',st0:t,sdur:400+Math.random()*1500,wakeAt:t+6000+Math.random()*9000,wakeT:-1e9,
    alt:ALT0[kind]||0,talt:ALT0[kind]||0,loop:-1e9,fly:-1e9,amt:1,drops:[],rainUntil:-1e9,heavy:-1e9,nextRain:t+4000+Math.random()*5000};
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
  if(!o.quiet){   // v1.2：真的剛出現（不是讀檔）才有提示；c.reveal 只在記憶體裡，不進存檔
    c.reveal=now();
    rings.push({x:c.x,y:c.y,t0:now()});
    setTimeout(()=>{ if(!c.hop&&!reduceMotion){ startHop(c,c.x,c.y,now(),420,12); c.t0=now(); c.wait=900; } },700);
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
  if(c.kind==='bee'){   // 飛到附近開著的花上面；藍紋嗡嗡偏愛紫花
    const fl=plants.filter(p=>FLOWERY[p.type]&&p.stage>=2&&dist(p.x,p.y,c.hx,c.hy)<.14*U);
    const pref=c.v?fl.filter(p=>p.color===5):[], pool=pref.length?pref:fl;
    if(pool.length&&chance(.8)){const f=pick(pool);c.talt=f.type==='sunflower'?44:f.type==='tulip'?30:19+f.stage*6;return [f.x,f.y]}
    c.talt=18+Math.random()*10;return around(c.hx,c.hy,0,.06);
  }
  if(c.kind==='cloud'){c.talt=ALT0.cloud;return around(c.hx,c.hy,0,.14)}
  if(c.kind==='puff'||c.kind==='ladybug'){
    for(let i=0;i<8;i++){const t=around(c.hx,c.hy,0,c.kind==='puff'?.08:.06);if(!pondAt(t[0],t[1],1.2)) return t}
    return [c.x,c.y];
  }
  return ringSpot(c);
}
function startHop(c,x1,y1,t,d,h){c.hop={x0:c.x,y0:c.y,x1,y1,t0:t,d,h};c.face=x1>c.x?1:x1<c.x?-1:c.face}
function airMove(c,t,dt){   // v1.3：飛的居民平滑地飄，不用跳
  c.alt+=(c.talt-c.alt)*Math.min(1,dt*1.5);
  if(reduceMotion||t-c.t0<c.wait) return;
  if(!c.tgt) c.tgt=critterTarget(c);
  c.tgt[0]=clamp(c.tgt[0],.03,.97);c.tgt[1]=clamp(c.tgt[1],.08,.98);
  const d=dist(c.x,c.y,c.tgt[0],c.tgt[1]);
  if(d<1.5){c.tgt=null;c.t0=t;c.wait=c.kind==='bee'?1400+Math.random()*1800:2500+Math.random()*3500;return}
  const sp=(c.kind==='bee'?.05:c.kind==='cloud'?.012:.01)*U*dt, lin=Math.min(1,sp/d);
  const f=c.kind==='bee'?Math.max(lin,Math.min(1,dt*1.8)):lin;
  if(Math.abs(c.tgt[0]-c.x)>1e-4) c.face=c.tgt[0]>c.x?1:-1;
  c.x+=(c.tgt[0]-c.x)*f;c.y+=(c.tgt[1]-c.y)*f;c.moving=t;
}
function rainTick(c,t,dt){   // 小雲：每隔一陣子下一點雨（雨滴只在記憶體，不會澆到植物）
  if(!reduceMotion&&t>c.nextRain){c.rainUntil=t+1600;c.nextRain=t+6500+Math.random()*4000}
  if(t<c.rainUntil&&!reduceMotion&&Math.random()<dt*(t<c.heavy?40:14)) c.drops.push({dx:Math.random()*2-1,t0:t});
  for(let i=c.drops.length-1;i>=0;i--) if(t-c.drops[i].t0>720) c.drops.splice(i,1);
}
function puffBurst(c,t){
  const p=critterPos(c,t), r=CR.puff*S;
  for(let i=0;i<9;i++) puffSeeds.push({x:p.cx+(Math.random()-.5)*r,y:p.cy-p.lift,vx:(Math.random()*16-8)*S,vy:(Math.random()*-9-5)*S,t0:t,rot:Math.random()*TAU,life:1800+Math.random()*1000});
  c.amt=.28;
}
function updateCritters(t,dt){
  for(const c of critters){
    if(t>c.blinkAt){c.blinkT=t;c.blinkAt=t+1800+Math.random()*3800}
    if(c.kind==='moss'&&t>c.wakeAt){c.wakeT=t;c.wakeAt=t+9000+Math.random()*12000}
    if(c.kind==='puff') c.amt=Math.min(1,c.amt+dt/9);
    if(c.kind==='cloud') rainTick(c,t,dt);
    if(AIR[c.kind]){ airMove(c,t,dt); continue; }
    if(c.kind==='ladybug'&&t-c.fly<1000) continue;
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
    const bug=c.kind==='ladybug';   // 點點：一小步一小步地蹦（橫著滑會像蜘蛛）
    const step=(c.kind==='dew'?.032:bug?.02:.014)*U, f=Math.min(1,step/d);
    const dur=c.kind==='dew'?380:bug?200:240;
    if(reduceMotion){c.x+=(c.tgt[0]-c.x)*f;c.y+=(c.tgt[1]-c.y)*f;c.t0=t;c.wait=400;continue}
    startHop(c,c.x+(c.tgt[0]-c.x)*f,c.y+(c.tgt[1]-c.y)*f,t,dur,c.kind==='dew'?9:bug?2.6:4);
    c.t0=t;c.wait=dur+(c.kind==='dew'?120+Math.random()*260:bug?40+Math.random()*90:200+Math.random()*350);
  }
  for(let i=sparks.length-1;i>=0;i--) if(t-sparks[i].t0>1100) sparks.splice(i,1);
  for(let i=puffSeeds.length-1;i>=0;i--){const s=puffSeeds[i];if(t-s.t0>s.life){puffSeeds.splice(i,1);continue}
    s.x+=s.vx*dt+Math.sin(t*.003+i)*.15*S;s.y+=s.vy*dt;s.vy*=.992;s.vx*=.995;s.rot+=dt*2}
}
function critterPos(c,t){
  let x=c.x,y=c.y,lift=0,sq=0;
  if(c.hop){
    const k=Math.min(1,(t-c.hop.t0)/c.hop.d);
    x=c.hop.x0+(c.hop.x1-c.hop.x0)*k;y=c.hop.y0+(c.hop.y1-c.hop.y0)*k;
    lift=Math.sin(Math.PI*k)*c.hop.h*S;
    sq=k<.12?-.22*(1-k/.12):.14*Math.sin(Math.PI*k);
  }else if(t-c.land<240) sq=-.24*(1-(t-c.land)/240);
  let cx=x*W;
  if(AIR[c.kind]){
    lift+=c.alt*S+(reduceMotion?0:Math.sin(t*(c.kind==='bee'?.006:.0025)+c.seed*9)*S*(c.kind==='cloud'?1.5:1));
    if(c.kind==='bee'){const k=(t-c.loop)/800;if(k>=0&&k<1){cx+=Math.sin(k*TAU)*CR.bee*S*2.2*c.face;lift+=(1-Math.cos(k*TAU))*CR.bee*S*1.5}}
    if(c.kind==='puff'&&t-c.cheer<900) lift+=Math.sin(Math.PI*(t-c.cheer)/900)*5*S;
    lift=Math.min(lift,Math.max(0,y*H-CR[c.kind]*S*2.2));   // 不要飛出土地上緣
  }else if(c.kind==='ladybug'){const k=(t-c.fly)/1000;if(k>=0&&k<1) lift+=Math.sin(Math.PI*k)*5*S}
  return {cx,cy:y*H,lift,sq};
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
  else if(c.kind==='bee') drawBee(c,t,p,g);
  else if(c.kind==='ladybug') drawLadybug(c,t,p,g);
  else if(c.kind==='puff') drawPuff(c,t,p,g);
  else if(c.kind==='cloud') drawCloud(c,t,p,g);
  else drawCap(c,t,p,g);
}
/* ---------- v1.3 居民的畫法（照 docs/new-guide-candidates.html，降過彩度） ---------- */
function smile(y,r,big){ctx.strokeStyle='#2a2a2a';ctx.lineWidth=r*.09;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,y,big?r*.16:r*.09,Math.PI*.15,Math.PI*.85);ctx.stroke()}
function airShadow(X,Y,rx,a){const b=ctx.globalAlpha;ctx.globalAlpha=b*a;ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,Y,rx,rx*.3,0,0,TAU);ctx.fill();ctx.globalAlpha=b}
function drawBee(c,t,p,g){   // 嗡嗡：蜜蜂
  const r=CR.bee*S*g, X=p.cx, Y=p.cy-p.lift;
  airShadow(X,p.cy,r*.8,.6);
  ctx.save();ctx.translate(X,Y);
  const flap=reduceMotion?1:.35+.65*Math.abs(Math.sin(t*.05));
  ctx.fillStyle='rgba(255,255,255,.72)';ctx.strokeStyle='rgba(120,140,160,.35)';ctx.lineWidth=S*.4;
  for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*r*.8,-r*.85,r*.5,Math.max(.01,r*.85*flap),s*.55,0,TAU);ctx.fill();ctx.stroke()}
  const body=c.v?'#f2e6bf':'#efc451', band=c.v?'#5f8fcf':'#3a2e22';
  ctx.fillStyle=body;
  for(let i=0;i<14;i++){const a=i/14*TAU;ctx.beginPath();ctx.arc(Math.cos(a)*r*.92,Math.sin(a)*r*.92,r*.2,0,TAU);ctx.fill()}
  ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(0,0,r*1.02,0,TAU);ctx.clip();
  ctx.fillStyle=band;ctx.fillRect(-r*1.2,r*.22,r*2.4,r*.28);ctx.fillRect(-r*1.2,r*.68,r*2.4,r*.3);
  ctx.restore();
  ctx.strokeStyle='#3a2e22';ctx.lineWidth=S*.6;ctx.lineCap='round';ctx.fillStyle='#3a2e22';
  for(const s of [-1,1]){ctx.beginPath();ctx.moveTo(s*r*.3,-r*.85);ctx.quadraticCurveTo(s*r*.35,-r*1.3,s*r*.6,-r*1.45);ctx.stroke();ctx.beginPath();ctx.arc(s*r*.6,-r*1.45,r*.13,0,TAU);ctx.fill()}
  eyes(c,t,r*.34,-r*.2,r*.17,lookAt(X,Y,r),true);
  cheeks(r*.62,0,r*.15);
  smile(-r*.02,r,happy(c,t));
  ctx.restore();
}
function drawLadybug(c,t,p,g){   // 點點：瓢蟲
  const r=CR.ladybug*S*g, X=p.cx, Y=p.cy-p.lift;
  const fk=(t-c.fly)/1000, w=fk>=0&&fk<1?Math.sin(Math.PI*fk):0;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,p.cy,r*1.15*Math.max(.55,1-p.lift/(30*S)),r*.32,0,0,TAU);ctx.fill();
  const walking=!!c.hop&&!reduceMotion, hk=walking?Math.min(1,(t-c.hop.t0)/c.hop.d):0;
  ctx.save();ctx.translate(X,Y);ctx.rotate(walking?c.face*.12:0);ctx.scale(1-p.sq*.6,1+p.sq);
  // 四顆小短腳從身體下面探出來，小跑步時輪流抬起（不畫往兩側伸的長腳，免得像蜘蛛）
  ctx.fillStyle='#3e3632';
  [-.62,-.3,.3,.62].forEach((fx,i)=>{const up=walking&&(i%2===(hk<.5?0:1))?r*.13:0;ctx.beginPath();ctx.ellipse(fx*r,-r*.02-up,r*.15,r*.1,0,0,TAU);ctx.fill()});
  ctx.translate(0,-r*.14);
  const red=c.v?['#f4dc9c','#d9b257','#b38c34']:['#e6a294','#c45e50','#9f4a40'], dot=c.v?'#7a5232':'#3a302a';
  if(w>.05){ctx.fillStyle='rgba(225,236,240,.7)';for(const s of [-1,1]){ctx.save();ctx.translate(0,-r*1.45);ctx.rotate(s*(.5+w*.5));ctx.beginPath();ctx.ellipse(s*r*.7,-r*.2,r*.35,r*1.15,0,0,TAU);ctx.fill();ctx.restore()}}
  for(const s of [-1,1]){
    ctx.save();ctx.translate(0,-r*1.7);ctx.rotate(s*w*.65);ctx.translate(0,r*1.7);
    const gr=ctx.createRadialGradient(-s*r*.3,-r*1.6,r*.1,0,-r*1.1,r*1.5);gr.addColorStop(0,red[0]);gr.addColorStop(.5,red[1]);gr.addColorStop(1,red[2]);
    ctx.fillStyle=gr;ctx.beginPath();ctx.moveTo(0,-r*2.05);ctx.bezierCurveTo(s*r*1.5,-r*2.05,s*r*1.45,-r*.45,s*r*.35,-r*.35);ctx.lineTo(0,-r*.35);ctx.closePath();ctx.fill();
    ctx.fillStyle=dot;for(const [dx,dy,rr] of [[.62,-1.45,.2],[.9,-.85,.15],[.28,-.8,.13]]){ctx.beginPath();ctx.arc(s*dx*r,dy*r,rr*r,0,TAU);ctx.fill()}
    ctx.restore();
  }
  ctx.strokeStyle='rgba(60,30,25,.4)';ctx.lineWidth=r*.07;ctx.beginPath();ctx.moveTo(0,-r*2.02);ctx.lineTo(0,-r*.4);ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.3)';ctx.beginPath();ctx.ellipse(-r*.55,-r*1.55,r*.18,r*.1,-.6,0,TAU);ctx.fill();
  ctx.fillStyle='#3e3632';ctx.beginPath();ctx.ellipse(0,-r*.5,r*.95,r*.62,0,0,TAU);ctx.fill();
  ctx.fillStyle='#f1e6d3';ctx.beginPath();ctx.ellipse(0,-r*.42,r*.72,r*.44,0,0,TAU);ctx.fill();
  ctx.strokeStyle='#3e3632';ctx.lineWidth=r*.1;ctx.lineCap='round';ctx.fillStyle='#3e3632';
  for(const s of [-1,1]){const sw=reduceMotion?0:Math.sin(t*.005+s+c.seed*3)*r*.1;ctx.beginPath();ctx.moveTo(s*r*.3,-r*1.0);ctx.quadraticCurveTo(s*r*.55,-r*1.5,s*r*.9+sw,-r*1.55);ctx.stroke();ctx.beginPath();ctx.arc(s*r*.9+sw,-r*1.55,r*.13,0,TAU);ctx.fill()}
  const idleLook=walking||reduceMotion?0:Math.sin(t*.0012+c.seed*9)*r*.05;   // 停下來時東張西望
  eyes(c,t,r*.3,-r*.5,r*.14,hover?lookAt(X,Y,r):idleLook,true);
  cheeks(r*.55,-r*.32,r*.12);
  smile(-r*.36,r,happy(c,t));
  ctx.restore();
}
function drawPuff(c,t,p,g){   // 毛毛：蒲公英絨球
  const base=CR.puff*S*g, r=base*(.62+.38*c.amt), X=p.cx, Y=p.cy-p.lift;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,p.cy,base*.85*(.9+.1*c.amt),base*.26,0,0,TAU);ctx.fill();
  ctx.save();ctx.translate(X,Y);ctx.rotate(reduceMotion?0:Math.sin(t*.002+c.seed*3)*.07);
  const n=Math.floor(8+30*c.amt), col=c.v?['#f7e9ec','#e3c3cd','#c49ba8']:['#fbf8ef','#ebe4cc','#c9be98'], b=ctx.globalAlpha;
  ctx.lineCap='round';
  for(let i=0;i<n;i++){
    const a=i/n*TAU+hash(c.seed,i)*.3, len=r*(.5+.35*hash(c.seed,i+9)), r0=r*.62, x1=Math.cos(a)*(r0+len), y1=Math.sin(a)*(r0+len);
    ctx.strokeStyle=col[2];ctx.globalAlpha=b*.55;ctx.lineWidth=r*.07;ctx.beginPath();ctx.moveTo(Math.cos(a)*r0,Math.sin(a)*r0);ctx.lineTo(x1,y1);ctx.stroke();ctx.globalAlpha=b;
    ctx.fillStyle=col[0];ctx.beginPath();ctx.arc(x1,y1,r*.075,0,TAU);ctx.fill();
  }
  const gr=ctx.createRadialGradient(-r*.3,-r*.35,r*.1,0,0,r*.95);gr.addColorStop(0,col[0]);gr.addColorStop(.7,col[1]);gr.addColorStop(1,col[2]);
  ctx.fillStyle=gr;ctx.beginPath();ctx.arc(0,0,r*.85,0,TAU);ctx.fill();
  eyes(c,t,r*.3,-r*.05,r*.15,lookAt(X,Y,r),true);
  cheeks(r*.5,r*.22,r*.15);
  smile(r*.12,r,happy(c,t));
  ctx.restore();
}
function drawCloud(c,t,p,g){   // 小雲
  const r=CR.cloud*S*g, X=p.cx, Y=p.cy-p.lift, b=ctx.globalAlpha;
  ctx.strokeStyle='rgba(90,150,200,.8)';ctx.lineWidth=S*.6;ctx.lineCap='round';
  for(const d of c.drops){
    const k=(t-d.t0)/600, x=X+d.dx*r*.9;
    if(k<1){const y=Y+r*.5+(p.cy-Y-r*.5)*k;ctx.beginPath();ctx.moveTo(x,y-S*1.6);ctx.lineTo(x,y);ctx.stroke()}
    else{const q=(k-1)/.2;ctx.globalAlpha=b*.6*(1-q);ctx.strokeStyle='#fff';ctx.lineWidth=S*.4;ctx.beginPath();ctx.ellipse(x,p.cy,S*(1+q*3),S*(.4+q),0,0,TAU);ctx.stroke();
      ctx.globalAlpha=b;ctx.strokeStyle='rgba(90,150,200,.8)';ctx.lineWidth=S*.6}
  }
  airShadow(X,p.cy,r*1.5,.5);
  if(c.v){ // 彩虹
    ctx.lineWidth=S*1.15;ctx.globalAlpha=b*.75;
    ['#e99a92','#efbd85','#eedb8a','#9fcb8c','#8bb7dc','#ad9cd8'].forEach((cc,i)=>{ctx.strokeStyle=cc;ctx.beginPath();ctx.arc(X-r*1.1,Y+r*.9,r*(2.15-i*.17),Math.PI*1.02,Math.PI*1.5);ctx.stroke()});
    ctx.globalAlpha=b;
  }
  ctx.save();ctx.translate(X,Y);
  const sx=reduceMotion?1:1+Math.sin(t*.002+c.seed)*.025;ctx.scale(sx,2-sx);
  const puffs=[[-.85,.05,.6],[-.3,-.38,.72],[.38,-.45,.78],[.95,0,.58],[0,.15,.75]];
  ctx.fillStyle='rgba(110,130,150,.16)';for(const [x,y,s] of puffs){ctx.beginPath();ctx.arc(x*r,y*r+S*.6,s*r*1.06,0,TAU);ctx.fill()}
  const gr=ctx.createLinearGradient(0,-r*1.2,0,r*.8);gr.addColorStop(0,'#ffffff');gr.addColorStop(1,c.v?'#e8e2f6':'#dde6ee');
  ctx.fillStyle=gr;for(const [x,y,s] of puffs){ctx.beginPath();ctx.arc(x*r,y*r,s*r,0,TAU);ctx.fill()}
  ctx.fillRect(-r*.85,0,r*1.8,r*.6);
  const raining=t<c.rainUntil;
  if(raining){ // 下雨時瞇著眼，很舒服的樣子
    ctx.strokeStyle='#2a2a2a';ctx.lineWidth=r*.09;ctx.lineCap='round';
    for(const s of [-1,1]){ctx.beginPath();ctx.arc(s*r*.32,r*.06,r*.14,Math.PI*1.15,Math.PI*1.85);ctx.stroke()}
  }else eyes(c,t,r*.32,-r*.02,r*.15,lookAt(X,Y,r),true);
  cheeks(r*.62,r*.2,r*.15);
  smile(r*.12,r,happy(c,t)||raining);
  ctx.restore();
}

function drawSparks(t){
  for(const s of puffSeeds){
    const k=(t-s.t0)/s.life;ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.rot);ctx.globalAlpha=clamp((1-k)*1.8,0,1);
    ctx.strokeStyle='#d3caa0';ctx.lineWidth=S*.28;ctx.lineCap='round';
    for(let j=-2;j<=2;j++){ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(j*S*.45,-S*1.9);ctx.stroke()}
    ctx.fillStyle='#8a7a4a';ctx.beginPath();ctx.arc(0,S*.2,S*.35,0,TAU);ctx.fill();ctx.restore();
  }
  ctx.globalAlpha=1;
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
  else if(c.kind==='bee') c.loop=t;
  else if(c.kind==='ladybug'){c.fly=t;c.hop=null}
  else if(c.kind==='puff') puffBurst(c,t);
  else if(c.kind==='cloud'){c.rainUntil=t+2200;c.heavy=t+2200}
  else if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,440,15);c.t0=t;c.wait=1100}
  sparks.push({x:p.cx,y:AIR[c.kind]?p.cy-p.lift-r*1.6:p.cy-r*2.6,t0:t,c:'#f08aa2'});
}
function critterCheer(){
  critters.forEach((c,i)=>setTimeout(()=>{
    const t=now();
    if(c.kind==='cap'&&c.state!=='out') return;
    c.cheer=t;
    if(c.kind==='bee'){c.loop=t;return}
    if(c.kind==='ladybug'){c.fly=t;c.hop=null;return}
    if(c.kind==='cloud'){c.rainUntil=Math.max(c.rainUntil,t+1200);return}
    if(c.kind==='puff') return;
    if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,360,c.kind==='moss'?6:10);c.t0=t;c.wait=Math.max(c.wait,700)}
  },i*90+Math.random()*60));
}
function critterNotice(x,y){ // a drop lands nearby: dew and moss come to look
  for(const c of critters){
    if(c.kind==='cap'||AIR[c.kind]||dist(c.x,c.y,x,y)>.16*U) continue;
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
  // v1.3：嗡嗡（花圃有三種以上顏色）、點點（花開得多）、毛毛（草非常密）
  const nK=k=>critters.filter(c=>c.kind===k).length, near=(k,r)=>critters.some(c=>c.kind===k&&dist(c.hx,c.hy,x,y)<r*U);
  const fl=plants.filter(p=>FLOWERY[p.type]&&p.stage>=2&&dist(p.x,p.y,x,y)<.11*U);
  const cols=new Set(fl.filter(p=>p.type==='flower').map(p=>p.color)).size;
  const dry=!pondAt(x,y,1.2);
  if(cols>=3&&dry&&nK('bee')<3&&!near('bee',.15)&&chance(.15)) acts.push(()=>{if(!near('bee',.15))makeCritter('bee',x,y,[x,y])});
  if(fl.length>=4&&dry&&nK('ladybug')<3&&!near('ladybug',.15)&&chance(.15)) acts.push(()=>{if(!near('ladybug',.15))makeCritter('ladybug',x,y,[x,y])});
  if(nG>=10&&dry&&nK('puff')<3&&!near('puff',.15)&&chance(.1)) acts.push(()=>{if(!near('puff',.15))makeCritter('puff',x,y,[x,y])});
}
function streakTick(){   // v1.3：5 分鐘內答對 10 次（算 addWater 的次數，不算水滴數）→ 來一朵小雲
  const t=Date.now(); streak.push(t);
  streak=streak.filter(x=>t-x<STREAK_MS);
  if(streak.length<STREAK_N) return;
  streak=[];
  if(!ready||critters.filter(c=>c.kind==='cloud').length>=2) return;
  const spots=plants.filter(p=>p.type!=='lily');
  if(spots.length<8) return;
  const sp=pick(spots);
  if(makeCritter('cloud',sp.x,sp.y,[sp.x,sp.y])) save();
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
   hint:'蕈寶的帽子有紅、橘、白，稀有的那種不在裡面'},
  {k:'bee', name:'嗡嗡', art:'critter',kind:'bee',v:0,
   desc:'毛茸茸的小蜜蜂，在花和花之間飛來飛去，從來不螫人。',
   hint:'五顏六色的花圃'},
  {k:'beeR', name:'藍紋嗡嗡', art:'critter',kind:'bee',v:1,rare:true,
   desc:'身上是藍色條紋的嗡嗡。有紫花的時候，只拜訪紫花。',
   hint:'嗡嗡裡面，有一隻條紋不一樣'},
  {k:'ladybug', name:'點點', art:'critter',kind:'ladybug',v:0,
   desc:'圓圓的紅殼小瓢蟲，小跑一下、停一下。被點到會打開翅膀飄起來。',
   hint:'花開得很多的地方，有小紅點在跑'},
  {k:'ladybugR', name:'黃點點', art:'critter',kind:'ladybug',v:1,rare:true,
   desc:'黃底配咖啡色點點的點點，很少見。',
   hint:'點點也有不是紅色的'},
  {k:'puff', name:'毛毛', art:'critter',kind:'puff',v:0,
   desc:'一團軟綿綿的絨毛球。被點到會噴出種子，過一陣子再慢慢長回來。',
   hint:'草長得非常非常密的地方'},
  {k:'puffR', name:'粉紅毛毛', art:'critter',kind:'puff',v:1,rare:true,
   desc:'粉紅色的毛毛，噴出來的種子也是粉紅的。',
   hint:'有一團毛毛的顏色不太一樣'},
  {k:'cloud', name:'小雲', art:'critter',kind:'cloud',v:0,
   desc:'答對很多題就會飄來的小雲。你每答對一題，它就下一點雨。',
   hint:'一口氣答對很多題看看'},
  {k:'cloudR', name:'彩虹小雲', art:'critter',kind:'cloud',v:1,rare:true,
   desc:'身邊掛著一段彩虹的小雲。',
   hint:'小雲偶爾會帶著彩虹'},
  {sec:'花草',note:'在對的地方澆水，會長出不一樣的植物'},
  {k:'clover', name:'三葉草', art:'plant',type:'clover',color:0,ps:.05,
   desc:'一叢一叢的三葉草，長大會開白色的小絨球花。會自己慢慢蔓延。',
   hint:'草長得很密的地方，仔細看看'},
  {k:'cloverR', name:'四葉草', art:'plant',type:'clover',color:5,ps:.05,rare:true,
   desc:'三葉草裡偶爾會有一片四葉的。找到了會閃一下。',
   hint:'三葉草裡，有沒有不一樣的？'},
  {k:'sunflower', name:'向日葵', art:'plant',type:'sunflower',color:0,ps:.02,
   desc:'長得比其他花都高，花盤圓圓大大的。',
   hint:'黃色的花開成一片的時候'},
  {k:'sunflowerR', name:'紅向日葵', art:'plant',type:'sunflower',color:5,ps:.02,rare:true,
   desc:'花瓣是酒紅色的向日葵，很少見。',
   hint:'向日葵也有不是黃色的'},
  {k:'tulip', name:'鬱金香', art:'plant',type:'tulip',color:0,ps:.021,
   desc:'杯子形狀的花，有紅、黃、粉三種顏色。',
   hint:'同一種顏色的花連成一大片'},
  {k:'tulipR', name:'火焰鬱金香', art:'plant',type:'tulip',color:5,ps:.021,rare:true,
   desc:'白底帶紅色火焰紋的鬱金香。',
   hint:'有一種鬱金香身上有花紋'},
  {k:'pumpkin', name:'南瓜', art:'plant',type:'pumpkin',color:0,ps:.032,
   desc:'只在秋天（10～11 月）長。藤蔓在地上爬，最後結出一顆圓圓的南瓜。',
   hint:'秋天的時候，空地上好像會冒出藤蔓'},
  {k:'pumpkinR', name:'白南瓜', art:'plant',type:'pumpkin',color:5,ps:.032,rare:true,
   desc:'白色的南瓜，很少見。',
   hint:'南瓜也有不是橘色的'},
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
  for(const k in PKEY){const d=PKEY[k];if(plants.some(p=>p.type===d.type&&(p.color===5)===d.rare&&p.stage>=d.min)) mark(k)}
}
function onLand(key){
  switch(key){
    case 'pond': return ponds.length;
    case 'lily': return plants.filter(p=>p.type==='lily'&&p.stage>=2).length;
    case 'tree': return plants.filter(p=>p.type==='tree'&&p.stage>=3).length;
    case 'ring': return plants.filter(p=>p.type==='tree'&&p.stage>=3&&plants.some(q=>q.type==='mushroom'&&dist(q.x,q.y,p.x,p.y)<.1*U)).length;
    case 'fly': return flies.length;
    case 'violet': return plants.filter(p=>p.type==='flower'&&p.color===5).length;
    default:
      if(PKEY[key]){const d=PKEY[key];return plants.filter(p=>p.type===d.type&&(p.color===5)===d.rare&&p.stage>=d.min).length}
      return critters.filter(c=>c.kind+(c.v?'R':'')===key).length;
  }
}
const UNIT_WORD={pond:'個',lily:'朵',tree:'棵',ring:'個',fly:'隻',violet:'朵',cloud:'朵',cloudR:'朵',puff:'團',puffR:'團',
  clover:'叢',cloverR:'叢',sunflower:'朵',sunflowerR:'朵',tulip:'朵',tulipR:'朵',pumpkin:'顆',pumpkinR:'顆'};
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
  else if(c.kind==='bee') c.loop=t;
  else if(c.kind==='ladybug') c.fly=t;
  else if(c.kind==='puff') c.amt=.28;
  else if(c.kind==='cloud'){c.rainUntil=t+2200;c.heavy=t+2200}
  else if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,440,15)}
}
function tickPortraitCritter(c,t){
  if(t>c.blinkAt){c.blinkT=t;c.blinkAt=t+1800+Math.random()*3800}
  if(c.kind==='moss'&&t>c.wakeAt){c.wakeT=t;c.wakeAt=t+7000+Math.random()*8000}
  if(c.hop&&t-c.hop.t0>=c.hop.d){c.hop=null;c.land=t}
  if(c.kind==='dew'&&!c.hop&&!reduceMotion&&t>c.nextHop){startHop(c,c.x,c.y,t,380,8);c.nextHop=t+2500+Math.random()*4000}
  if(c.kind==='bee'&&!reduceMotion&&t>c.nextHop){c.loop=t;c.nextHop=t+3500+Math.random()*3000}
  if(c.kind==='puff') c.amt=Math.min(1,c.amt+1/540);
  if(c.kind==='cloud') rainTick(c,t,1/60);
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
          st.c=newCritter(e.kind,.5,e.kind==='cap'?.8:AIR[e.kind]?.86:.78,[.5,.8],{v:e.v,seed:e.kind==='moss'?(e.v?.31:.12):.37,born:-1e9});
          st.c.e=1;st.c.state='out';st.c.pstate='out';st.c.pt0=t;st.c.nextHop=t+800+Math.random()*2000;st.c.face=1;
          if(AIR[e.kind]){st.c.alt=st.c.talt={bee:17,puff:9,cloud:16}[e.kind]}
        }
        tickPortraitCritter(st.c,t);
        if(e.kind==='moss') st.c.face=1;
        if(e.kind==='bee'){S=P*.016;drawFlower({seed:.3,color:e.v?5:2},.5*W,.94*H,2,1,t)}
        S=P*({dew:.027,bee:.03,ladybug:.028,puff:.026,cloud:.024}[e.kind]||.024);
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
      case 'plant':{
        S=P*.012; drawGrass({seed:.7},.16*W,.9*H,1.5,1,t);drawGrass({seed:.9},.85*W,.88*H,1.5,1,t);
        S=P*e.ps; SPECIES[e.type].draw({seed:.137,v:3,stage:3,color:e.color},.5*W,.88*H,1,t);
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
  // v1.2：外層可能已設了透明度（居民前面的植物）；這裡設 alpha 的地方都乘上它，fade=1 時和原本完全相同
  const base=ctx.globalAlpha;
  const s=S*a, cr=Math.max(0,(v-.9))*s*9.5;
  ctx.fillStyle=PAL.shadow;
  ctx.beginPath();ctx.ellipse(X+cr*.2,Y+s,s*3+cr*1.05,s*1.2+cr*.35,0,0,Math.PI*2);ctx.fill();
  const th=s*(8+v*11), tw=s*(1.2+v*1.3);
  ctx.fillStyle=PAL.trunk;
  ctx.beginPath();ctx.moveTo(X-tw,Y);ctx.lineTo(X-tw*.55,Y-th);ctx.lineTo(X+tw*.55,Y-th);ctx.lineTo(X+tw,Y);ctx.closePath();ctx.fill();
  const sway=reduceMotion?0:Math.sin(time*.0008+p.seed*12)*s*.8;
  if(v<1.8){
    ctx.globalAlpha=base*Math.min(1,(1.8-v)*1.3);
    ctx.fillStyle=PAL.leaf;
    ctx.beginPath();ctx.ellipse(X-s*3+sway,Y-th-s,s*3.2,s*1.5,.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(X+s*3+sway,Y-th-s*2,s*3.2,s*1.5,-.5,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=base;
  }
  if(cr>0){
    const cy=Y-th-cr*.55;
    for(let k=0;k<5;k++){
      const ox=(hash(p.seed,k)-.5)*cr*1.1+sway, oy=(hash(p.seed,k+9)-.5)*cr*.7;
      ctx.fillStyle=PAL.canopy[k%3];
      ctx.beginPath();ctx.arc(X+ox,cy+oy,cr*(.55+hash(p.seed,k+5)*.3),0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle=PAL.canopyHi;ctx.globalAlpha=base*.55;
    ctx.beginPath();ctx.arc(X-cr*.28+sway,cy-cr*.3,cr*.32,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=base;
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
/* ---------- v1.3 植物：三葉草、向日葵、鬱金香、南瓜（照 docs/new-guide-candidates.html） ----------
   畫在原點、腳在 (0,0)；s＝單位長度；v＝1～3；rare＝color 5。外層已設的透明度（居民前面的植物）一律乘上去。 */
function drawNewPlant(fn,p,X,Y,a,t,z){
  ctx.save();ctx.translate(X,Y);ctx.scale(a*z,a*z);
  fn(ctx,Math.max(1,p.v),S,t,p.seed,p.color===5,p.color);
  ctx.restore();
}
function pStar(g,x,y,r,a){ // 四角星閃光
  if(r<=0) return;
  const b=g.globalAlpha;g.globalAlpha=b*a;g.fillStyle='#fff8d6';g.beginPath();
  g.moveTo(x,y-r);g.quadraticCurveTo(x,y,x+r,y);g.quadraticCurveTo(x,y,x,y+r);g.quadraticCurveTo(x,y,x-r,y);g.quadraticCurveTo(x,y,x,y-r);
  g.fill();g.globalAlpha=b;
}
function pZig(g,cx,cy,r0,r1,a0,a1,n,fill){
  g.fillStyle=fill;g.beginPath();g.moveTo(cx,cy);
  for(let i=0;i<=n*2;i++){const a=a0+(a1-a0)*i/(n*2),rr=i%2?r1:r0;g.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr)}
  g.closePath();g.fill();
}
function pPetal(g,x,y,w,h,rot,col){
  g.save();g.translate(x,y);g.rotate(rot);g.fillStyle=col;g.beginPath();g.moveTo(0,0);
  g.bezierCurveTo(-w,-h*.3,-w*.8,-h,0,-h);g.bezierCurveTo(w*.8,-h,w,-h*.3,0,0);g.fill();g.restore();
}
function pShade(hex,k){const n=parseInt(hex.slice(1),16),f=x=>Math.round(clamp(k<0?x*(1+k):x+(255-x)*k,0,255));
  return '#'+[f(n>>16),f(n>>8&255),f(n&255)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function drawClover(g,v,s,t,seed,rare){
  const spots=[[0,0,1],[-5,1.2,.9],[5,.8,.95],[-2.6,-1.6,.85],[2.8,-1.8,.8]];
  const n=v<1.5?1:v<2.5?3:5;
  if(v>2.4){const k=clamp((v-2.4)/.6,0,1); // 白色小絨球花
    for(const [dx,h] of [[-3.5,9],[3,10.5]]){
      const sw=reduceMotion?0:Math.sin(t*.0012+seed*7+dx)*s*.6, tx=dx*s+sw, ty=-h*s*k;
      g.strokeStyle=PAL.leaf;g.lineWidth=s*.6;g.lineCap='round';g.beginPath();g.moveTo(dx*s,0);g.quadraticCurveTo(dx*s,-h*s*.5,tx,ty);g.stroke();
      for(let i=0;i<10;i++){const a=i/10*TAU;g.fillStyle=i%3?'#f4f0e6':'#ecc8d2';g.beginPath();g.arc(tx+Math.cos(a)*s*1.1*k,ty+Math.sin(a)*s*.9*k,s*.7*k+.01,0,TAU);g.fill()}
      g.fillStyle='#fbf9f3';g.beginPath();g.arc(tx,ty-s*.3*k,s*.8*k+.01,0,TAU);g.fill();
    }
  }
  for(let i=0;i<n;i++){
    const [dx,dy,sz]=spots[i], bx=dx*s, by=dy*s*.5, h=(4+hash(seed,i)*2.5)*s;
    const sw=reduceMotion?0:Math.sin(t*.0014+seed*9+i)*s*.5, tx=bx+sw, ty=by-h;
    g.strokeStyle=PAL.leaf;g.lineWidth=s*.55;g.lineCap='round';g.beginPath();g.moveTo(bx,by);g.quadraticCurveTo(bx,by-h*.5,tx,ty);g.stroke();
    const four=rare&&i===0, m=four?4:3, L=2.3*s*sz;
    for(let k=0;k<m;k++){
      const a=-Math.PI/2+k*TAU/m+(four?Math.PI/4:0), cx=tx+Math.cos(a)*L*.72, cy=ty+Math.sin(a)*L*.5;
      const px=-Math.sin(a), py=Math.cos(a)*.7;
      g.fillStyle=four?'#79b452':['#6aa448','#629a43','#72ab50'][k%3];
      g.beginPath();g.arc(cx+px*L*.3,cy+py*L*.3,L*.46,0,TAU);g.arc(cx-px*L*.3,cy-py*L*.3,L*.46,0,TAU);g.fill();
      g.beginPath();g.moveTo(tx,ty);g.lineTo(cx+px*L*.55,cy+py*L*.55);g.lineTo(cx-px*L*.55,cy-py*L*.55);g.closePath();g.fill();
      g.strokeStyle='rgba(255,255,255,.4)';g.lineWidth=s*.35;g.beginPath();g.moveTo(cx+px*L*.25,cy+py*L*.25);g.lineTo(cx-Math.cos(a)*L*.15,cy-Math.sin(a)*L*.1);g.lineTo(cx-px*L*.25,cy-py*L*.25);g.stroke();
    }
    if(four&&!reduceMotion){const tw=(t*.0008+seed)%1;pStar(g,tx+L*1.3,ty-L*1.1,s*2*Math.sin(Math.PI*tw),Math.sin(Math.PI*tw))}
  }
}
function drawSunflower(g,v,s,t,seed,rare){
  const h=s*(6+(v-1)*15), sway=reduceMotion?0:Math.sin(t*.001+seed*9)*s*1.3*(h/(36*s)), tx=sway, ty=-h;
  g.strokeStyle='#5f8a3a';g.lineWidth=s*1.7;g.lineCap='round';g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(0,-h*.5,tx,ty);g.stroke();
  if(v<1.6){g.fillStyle='#76a248';for(const d of [-1,1]){g.beginPath();g.ellipse(tx+d*s*2.2,ty-s*.6,s*2.3,s*1.3,d*.35,0,TAU);g.fill()}return}
  for(const [f,d] of [[.3,-1],[.55,1],[.75,-1]]){
    if(f>.35&&v<2) continue;
    const lx=sway*f, ly=-h*f;
    g.fillStyle=d>0?'#6b9a3c':'#5f8a3a';g.beginPath();g.ellipse(lx+d*s*3.2,ly-s*.8,s*3.6,s*2,d*-.45,0,TAU);g.fill();
    g.strokeStyle='rgba(255,255,255,.22)';g.lineWidth=s*.35;g.beginPath();g.moveTo(lx,ly);g.lineTo(lx+d*s*5.5,ly-s*2.2);g.stroke();
  }
  const open=clamp((v-2.2)/.8,0,1);
  if(open<=0){pZig(g,tx,ty,s*2.2,s*3.2,0,TAU,8,'#6b9a3c');g.fillStyle='#7fae4c';g.beginPath();g.arc(tx,ty,s*2.2,0,TAU);g.fill();return}
  const R=s*(3+3.4*open);
  g.save();g.translate(tx,ty);g.rotate(reduceMotion?0:Math.sin(t*.0008+seed)*.08);g.scale(.92,1);
  for(let layer=0;layer<2;layer++){
    const pc=rare?(layer?'#cf6a3e':'#9c3a3c'):(layer?'#f0cc52':'#e0ad35');
    for(let i=0;i<16;i++){g.save();g.rotate(i/16*TAU+layer*TAU/32);g.fillStyle=pc;
      g.beginPath();g.ellipse(0,-R*(.78-layer*.08),R*.2,R*(.42-layer*.06),0,0,TAU);g.fill();g.restore()}
  }
  g.fillStyle=rare?'#3a2418':'#6b4a2b';g.beginPath();g.arc(0,0,R*.58,0,TAU);g.fill();
  g.fillStyle=rare?'#5a3a24':'#8a6238';
  for(let i=0;i<22;i++){const a=i*2.4,rr=Math.sqrt(i/22)*R*.5;g.beginPath();g.arc(Math.cos(a)*rr,Math.sin(a)*rr,R*.05,0,TAU);g.fill()}
  g.restore();
}
const TULIP=['#d4604f','#ecc251','#e698ae'];
function drawTulip(g,v,s,t,seed,rare,color){
  const lh=s*(5+v*2.6);
  for(const [d,c] of [[-1,'#78a05a'],[1,'#6a984c']]){g.save();g.translate(d*s*.6,0);g.rotate(d*.32);
    g.fillStyle=c;g.beginPath();g.moveTo(0,0);g.bezierCurveTo(d*s*3.4,-lh*.35,d*s*2.2,-lh*.9,d*s*.3,-lh);g.bezierCurveTo(-d*s*1.6,-lh*.55,-d*s*1.4,-lh*.2,0,0);g.fill();g.restore()}
  if(v<1.4) return;
  const open=clamp((v-2.2)/.8,0,1), c0=(color|0)%3;
  [[-2.4,1,c0],[3,.84,(c0+1+Math.floor(hash(seed,3)*2))%3]].forEach(([dx,f,ci])=>{
    const H=s*(7+(v-1.4)*8)*f, sw=reduceMotion?0:Math.sin(t*.0011+seed*6+dx)*s*.8, hx=dx*s+sw, hy=-H;
    g.strokeStyle='#6a984c';g.lineWidth=s*.9;g.lineCap='round';g.beginPath();g.moveTo(dx*s*.4,0);g.quadraticCurveTo(dx*s,-H*.5,hx,hy);g.stroke();
    const col=TULIP[ci];
    if(open<=0){const gr=g.createLinearGradient(0,hy+s*2,0,hy-s*3);gr.addColorStop(0,'#78a05a');gr.addColorStop(1,rare?'#f3e7df':col);
      g.fillStyle=gr;g.beginPath();g.ellipse(hx,hy-s*1.6,s*1.4,s*2.4,0,0,TAU);g.fill();return}
    const c=s*(2.4+1.2*open), base=rare?'#f8f1e7':col, dark=rare?'#e6dacb':pShade(col,-.18);
    pPetal(g,hx,hy,c*.75,c*2,0,dark);
    pPetal(g,hx,hy,c*.62,c*1.8,-.28-open*.12,base);
    pPetal(g,hx,hy,c*.62,c*1.8,.28+open*.12,base);
    pPetal(g,hx,hy,c*.6,c*1.75,0,pShade(base,.06));
    if(rare){g.strokeStyle='#c8574a';g.lineWidth=s*.45;g.lineCap='round';
      for(const [x0,x1] of [[-.4,-.55],[0,0],[.4,.55],[-.15,-.25],[.18,.28]]){g.beginPath();g.moveTo(hx+x0*c*.8,hy-c*.3);g.quadraticCurveTo(hx+x0*c,hy-c*1.1,hx+x1*c,hy-c*1.6);g.stroke()}}
  });
}
function drawPumpkin(g,v,s,t,seed,rare){
  const len=clamp((v-.8)/2,0,1);
  g.strokeStyle='#6b8a3c';g.lineWidth=s*1.1;g.lineCap='round';
  g.beginPath();g.moveTo(-s*2,0);g.bezierCurveTo(-s*6,-s*1.5,-s*9*len,s*.5,-s*13*len,-s*.8);g.stroke();
  g.beginPath();g.moveTo(-s*2,0);g.bezierCurveTo(s*3,s*1,s*8*len,-s*1,s*12*len,-s*.3);g.stroke();
  g.lineWidth=s*.4;g.beginPath();const cx=s*12*len+s*.5,cy=-s*1.6;
  for(let a=0;a<TAU*1.6;a+=.2){const rr=s*1.3*(1-a/(TAU*1.8));g.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr)}g.stroke();
  const leaf=(x,L,rot)=>{g.save();g.translate(x,0);g.rotate(rot);
    g.strokeStyle='#6b8a3c';g.lineWidth=s*.6;g.beginPath();g.moveTo(0,0);g.lineTo(0,-L*.9);g.stroke();
    g.fillStyle='#6f9a45';for(let i=0;i<5;i++){const a=-Math.PI/2+(i-2)*.55;g.beginPath();g.arc(Math.cos(a)*L*.55,-L*1.25+Math.sin(a)*L*.5+L*.55,L*.48,0,TAU);g.fill()}
    g.fillStyle='#5f8a3a';g.beginPath();g.arc(0,-L*1.2,L*.42,0,TAU);g.fill();
    g.strokeStyle='rgba(255,255,255,.2)';g.lineWidth=s*.3;g.beginPath();for(let i=0;i<3;i++){const a=-Math.PI/2+(i-1)*.7;g.moveTo(0,-L*1.05);g.lineTo(Math.cos(a)*L*.7,-L*1.05+Math.sin(a)*L*.7)}g.stroke();
    g.restore()};
  const sw=reduceMotion?0:Math.sin(t*.0012+seed*5)*.05;
  leaf(-s*2,s*(2.6+v*.7),-.15+sw);
  if(v>1.6){leaf(-s*8*len,s*(2.2+v*.5),-.45+sw);leaf(s*7*len,s*(2+v*.5),.4-sw)}
  const fl=clamp((v-1.8)/.4,0,1)*(1-clamp((v-2.6)/.3,0,1));
  if(fl>0){const fx=s*9*len,fy=-s*2.8;g.fillStyle='#ecc251';g.beginPath();
    for(let i=0;i<10;i++){const a=-Math.PI/2+i/10*TAU,rr=(i%2?1.1:2.4)*s*fl;g.lineTo(fx+Math.cos(a)*rr,fy+Math.sin(a)*rr)}g.closePath();g.fill();
    g.fillStyle='#e0a040';g.beginPath();g.arc(fx,fy,s*.6*fl,0,TAU);g.fill()}
  const pk=clamp((v-2.3)/.7,0,1);
  if(pk>0){
    const P2=s*(2+5*pk), px=s*1.5;
    const cols=rare?['#cfc8b8','#e6e0d2','#f4f0e6']:['#c96b26','#dc8135','#e9984c'];
    g.fillStyle=PAL.shadow;g.beginPath();g.ellipse(px,s*.3,P2*1.2,P2*.3,0,0,TAU);g.fill();
    for(const [dx,rx,ci] of [[-.72,.42,0],[.72,.42,0],[-.38,.5,1],[.38,.5,1],[0,.45,2]]){g.fillStyle=cols[ci];g.beginPath();g.ellipse(px+dx*P2,-P2*.78,rx*P2,P2*.78,0,0,TAU);g.fill()}
    g.fillStyle='rgba(255,255,255,.22)';g.beginPath();g.ellipse(px-P2*.12,-P2*1.15,P2*.1,P2*.28,-.2,0,TAU);g.fill();
    g.strokeStyle=rare?'#7f8a5a':'#5d6b2f';g.lineWidth=s*1.1;g.beginPath();g.moveTo(px,-P2*1.45);g.quadraticCurveTo(px+s*.3,-P2*1.45-s*1.6,px+s*1.4,-P2*1.45-s*1.8);g.stroke();
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

/* ---------- keeping residents visible ----------
   Plants standing in front of a resident become see-through around its body,
   so it still looks tucked into the meadow but can always be read.
   A resident that has just arrived gets a stronger clearing for a few seconds.
   （v1.2，照 docs/one-drop-visibility-reference.html 移植） */
const REVEAL_MS=3000;
function critterViews(t){
  const out=[];
  for(const c of critters){
    if(c.kind==='cap'&&c.e<=0) continue;
    if(c.kind==='bee'||c.kind==='cloud') continue;   // 飛得比植物高，不用讓前面的植物變透明
    const p=critterPos(c,t), r=CR[c.kind]*S;
    const k=t-(c.reveal||-1e9);
    out.push({cx:p.cx, cy:p.cy, top:p.cy-p.lift-r*2.5, r, fresh:k<REVEAL_MS?1-k/REVEAL_MS:0});
  }
  return out;
}
const PLANT_BOX={grass:[7,24],flower:[8,34],tree:[26,95],mushroom:[4,8],clover:[9,17],sunflower:[10,42],tulip:[9,33],pumpkin:[12,15]};   // [half width, height] in S units
function foliageAlpha(p,X,Y,views){
  const box=PLANT_BOX[p.type]; if(!box) return 1;
  const hw=box[0]*S, h=box[1]*S*(p.type==='tree'?Math.max(.4,p.v/3):1);
  let a=1;
  for(const v of views){
    if(Y<=v.cy-1) continue;                        // behind the resident: drawn first anyway
    if(Y-h>v.cy) continue;                         // too short to reach its body
    if(Y>v.cy+(v.r*3+h)) continue;
    const reach=v.r*1.3+hw*(1+v.fresh*.6);
    const dx=Math.abs(X-v.cx);
    if(dx>=reach) continue;
    const edge=Math.min(1,(reach-dx)/(v.r*.9));    // soft edge, no popping as it hops
    const floor=v.fresh>0?.14:.3;
    a=Math.min(a,1-(1-floor)*edge);
  }
  return a;
}
function clearOfCritters(type,x,y){
  // new growth never sprouts right on top of a resident
  if(type==='lily'||!critters.length) return [x,y];
  for(const c of critters){
    if(AIR[c.kind]) continue;
    const r=CR[c.kind]*S*1.5, dx=(x-c.x)*W, dy=(y-c.y)*H, d=Math.hypot(dx,dy);
    if(d<r){ const a=d>0.5?Math.atan2(dy,dx):Math.random()*Math.PI*2; x=c.x+Math.cos(a)*r*1.1/W; y=c.y+Math.sin(a)*r*1.1/H; }
  }
  return [x,y];
}

// 物種表：type → 怎麼畫。之後加新物種只要加一筆（外觀、出現條件、圖鑑文字會慢慢搬進來）
const SPECIES={
  grass:   {draw:(p,X,Y,a,t)=>drawGrass(p,X,Y,p.v,a,t)},
  flower:  {draw:(p,X,Y,a,t)=>drawFlower(p,X,Y,p.v,a,t)},
  tree:    {draw:(p,X,Y,a,t)=>drawTree(p,X,Y,p.v,a,t)},
  mushroom:{draw:(p,X,Y,a)=>drawMushroom(p,X,Y,a)},
  lily:    {draw:(p,X,Y,a)=>drawLily(p,X,Y,p.v,a)},
  clover:   {draw:(p,X,Y,a,t)=>drawNewPlant(drawClover,p,X,Y,a,t,1.5)},
  sunflower:{draw:(p,X,Y,a,t)=>drawNewPlant(drawSunflower,p,X,Y,a,t,1)},
  tulip:    {draw:(p,X,Y,a,t)=>drawNewPlant(drawTulip,p,X,Y,a,t,1.3)},
  pumpkin:  {draw:(p,X,Y,a,t)=>drawNewPlant(drawPumpkin,p,X,Y,a,t,1.1)},
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
  const views=critterViews(t);
  for(const p of flat.concat(up)){
    if(p.kind){ drawCritter(p,t); continue; }
    const a=reduceMotion?1:Math.max(.001,easeBack((t-p.born)/700));
    const X=p.x*W,Y=p.y*H;
    const fade=views.length&&p.type!=='lily'?foliageAlpha(p,X,Y,views):1;
    ctx.globalAlpha=fade;
    const sp=SPECIES[p.type];
    if(sp) sp.draw(p,X,Y,a,t);
    ctx.globalAlpha=1;
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
    critters:critters.map(c=>[c.kind,+c.x.toFixed(4),+c.y.toFixed(4),+c.seed.toFixed(6),c.v,+c.hx.toFixed(4),+c.hy.toFixed(4)]).concat(keepCritters), seenKinds, found, newFound
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
    (d.critters||[]).forEach(a=>{if(!Array.isArray(a)) return; if(CR[a[0]]) makeCritter(a[0],a[1],a[2],[a[5],a[6]],{seed:a[3],v:a[4],born:-1e9,quiet:true}); else keepCritters.push(a)});
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
  for(const a of [plants,wets,ponds,flies,falls,rings,critters,sparks,keepCritters,puffSeeds]) a.length=0;
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
  addWater(n){ n=n|0; if(n<=0) return; water+=n; syncWater(true); critterCheer(); streakTick(); },   // 答對：居民一起跳；連續答對會來小雲
  refresh(){ syncWater(false); },               // 啟動時畫一次水滴列與提示字
  freeze(){ frozen=true; clearTimeout(saveT); },
  get water(){ return water; },
  get activeMap(){ return activeMap; },
  // 測試用唯讀窺視（x,y 是可以點到那隻居民的畫面座標，px，相對於畫布左上）
  _peek(){
    const t=now();
    return {
      critters:critters.map(c=>{const p=critterPos(c,t);const k=t-(c.reveal||-1e9);return {kind:c.kind,v:c.v,x:p.cx,y:p.cy-p.lift-CR[c.kind]*S*1.1,
        fx:p.cx,fy:p.cy,cx:c.x,cy:c.y,r:CR[c.kind]*S,hop:!!c.hop,cheer:c.cheer,state:c.state,e:c.e,fresh:k<REVEAL_MS?1-k/REVEAL_MS:0}}),
      // v1.2：每株植物現在的透明度（順序同存檔的 plants；睡蓮一律 1）
      fade:(()=>{const vs=critterViews(t);return plants.map(p=>vs.length&&p.type!=='lily'?foliageAlpha(p,p.x*W,p.y*H,vs):1)})(),
      plants:plants.map(p=>({type:p.type,x:p.x,y:p.y})), ponds:ponds.map(p=>({x:p.x,y:p.y,r:p.r})), W, H, S,
      found:{...found}, newFound:{...newFound}, seenKinds:{...seenKinds}, guideOpen:!G.guide.hidden, now:t,
    };
  },
  // v1.2 測試用：假如畫面座標 (X,Y)（px，植物的腳）有一株 type（樹用 v），它現在的透明度（唯讀）
  _fadeAt(type,X,Y,v=3){ return foliageAlpha({type,v},X,Y,critterViews(now())); },
  // v1.2 測試用（會改資料）：直接呼叫 addPlant，看新植物落在哪（x,y 是 0～1）；頁面不要用
  _addPlant(type,x,y){ const p=addPlant(type,x,y); return p&&{x:p.x,y:p.y,inPond:!!pondAt(p.x,p.y)}; },
};
return api;
}

window.OneDropWorld={ VERSION, create };
})();
