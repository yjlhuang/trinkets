/* 一滴水 world —— 共用的土地：植物、水塘、居民、手上的水、存檔。
   原始碼在 private repo one-drop-world（src/world.js）；各頁面載入的是發佈版
   one-drop-lib/world.vX.Y.js（classic script，相對路徑，same-origin）。
   不要直接改各 repo 裡的副本：改 src/world.js、發新版號，再用 tools/sync.mjs 同步。

   介面見 PLAN.md 2.2。
   存檔：仍寫回頁面原本的 key、v1 格式；既有欄位的順序與精度不變，v1.1 只在 flies 後面新增
   critters、seenKinds、found、newFound（居民與圖鑑）。v1.2 讓居民前面的植物變透明，不新增存檔欄位。
   v1.3 加 4 種居民（嗡嗡、點點、毛毛、小雲）和 4 種植物（三葉草、向日葵、鬱金香、南瓜），圖鑑 12 → 28 格；
   存檔欄位不變（只多了新的 kind/type 字串），讀到不認得的居民會原樣保留、存檔時寫回。
   v1.7 加十二月限定（呵呵公公、雪橇、聖誕紅、小雪）和大樹上限：公公、禮物、雪橇只在記憶體，不進存檔；
   聖誕紅是新的 plant type 字串；存檔欄位不變。
   v2.0 第二塊地「水邊樹林」：存在新的 key（KEY+'.forest'），第一塊地的 key 一個欄位都不加。
   森林 key 存在＝已經開門（第一塊地長到 300 株時建立）；「目前在哪塊地」也記在森林 key 裡。
   水、圖鑑（found/seenKinds）、頁面的答題進度仍然只寫在第一塊地的 key。 */
(function(){
'use strict';
const VERSION='2.0';

function create(cfg){
const $=id=>document.getElementById(id);
const land=cfg.root;
const KEY=cfg.key;
const FKEY=KEY+'.forest';   // v2.0 水邊樹林的存檔（Painless backup.js 的 KEYS.dropForest 要跟它一字不差）

/* ---------- 事件：on(type, fn)；discover 的 kind 是穩定字串 id，之後加新種類不用改頁面 ---------- */
const handlers={};
function on(type,fn){ (handlers[type]=handlers[type]||[]).push(fn); return api; }
function emit(type,ev){ (handlers[type]||[]).forEach(fn=>{ try{ fn(ev); }catch(e){ console.error(e); } }); }

/* ---------- 手上的水與地圖 ---------- */
let water=0, activeMap='home', forestOpen=false;
// keep：讀到不認得的居民（之後版本才有的），原樣保留、存檔時寫回（每塊地各一份）；n：這塊地滴過幾滴（森林的輪替用）
const newMapData=()=>({plants:[],wets:[],ponds:[],flies:[],critters:[],keep:[],n:0});
const maps={ home:newMapData() };
const inForest=()=>activeMap==='forest';
function bindMap(){ const m=maps[activeMap]; plants=m.plants; wets=m.wets; ponds=m.ponds; flies=m.flies; critters=m.critters; keepCritters=m.keep; stream=LAYOUT[activeMap].stream; }
/* v2.0 兩塊地的版面。水邊樹林照 docs/forest-map-preview.html 的 A「小溪穿林」：一條小溪從上面流下來，中間一個小水潭，
   開局就有三棵橡樹、一棵溪邊的小垂柳（中樹，要自己澆大）、香蒲、蕨、鈴蘭。溪和小水潭每次從這裡重建，不存檔。
   小垂柳一開始就是中樹：大樹上限 5 棵連中樹一起算，先佔一個名額，才不會被別的樹苗搶光、永遠長不大。
   座標 0～1；溪寬 w 是 U 的比例。植物的 seed 用 hash 算（不用 Math.random，第一塊地的亂數順序不受影響）。 */
const OPEN_AT=300;   // 第一塊地長到幾株開第二塊地（2026-11-21 主人定：300 株；普通格那一條拿掉）
const LAYOUT={
  home:{name:'第一塊地',stream:null},
  forest:{name:'水邊樹林',
    stream:{w:.03,pts:[[.72,-.03],[.67,.14],[.57,.3],[.56,.44],[.62,.58],[.53,.76],[.41,.9],[.37,1.03]]},
    pond:{x:.6,y:.55,r:.065},
    start:[['tree',.2,.3,3],['tree',.37,.2,3],['tree',.94,.46,3],['tree',.69,.24,2],
      ['cattail',.67,.63,3],['cattail',.52,.5,3],['cattail',.42,.8,3],['cattail',.64,.29,3],
      ['fern',.13,.42,3],['fern',.28,.37,2],['fern',.88,.56,3],['lilyvalley',.4,.31,3],
      ['lily',.58,.54,2],['lily',.62,.565,1],['lily',.605,.525,1],
      ['grass',.1,.7,2],['grass',.3,.65,2],['grass',.78,.75,2],['grass',.84,.2,2],['grass',.36,.58,2],['grass',.7,.9,2]]}
};
function fixedPond(m){ const p=LAYOUT.forest.pond; m.ponds.unshift({x:p.x,y:p.y,r:p.r,born:-1e9,fixed:true}); }
function seedForest(m){
  fixedPond(m);
  LAYOUT.forest.start.forEach(([type,x,y,stage],i)=>m.plants.push({type,x,y,stage,v:stage,color:0,seed:+hash(i+1,101).toFixed(6),born:-1e9,nb:-Math.floor(hash(i+1,102)*300)}));
}
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
let plants, wets, ponds, flies, critters, keepCritters, stream;   // 指向 maps[activeMap] 裡的陣列（bindMap），程式只原地修改、不重新指定
const falls=[], rings=[];

const PAL={
  grass:['#7f9c47','#6b8a3c','#8fae52','#5f7f36'],
  // index 5 is the rare one: it only appears by chance, then spreads like any other colour
  flower:['#f2f0f7','#f3c645','#e07f98','#8d9be0','#e9a063','#5b45d1'],
  leaf:'#5f8a3a', leafHi:'#6f9a45', canopy:['#6a8f47','#55773d','#3f5c2e'], canopyHi:'#86ab5c',   // v1.4 樹冠：受光、中間、陰影
  trunk:'#7a5a3c', trunkDark:'#4f3824', shadow:'rgba(40,28,15,.18)',
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
const december=()=>today().getMonth()===11;   // v1.7：十二月限定（公公、雪橇、聖誕紅、小雪）
// v1.5：南瓜上限 6 顆只算橘的（v1.3 連白的一起算，而且南瓜不會消失，6 顆橘的長滿後白南瓜就永遠出不來）。
// 橘的還沒滿：照舊，每顆 3% 是白的；橘的滿了：之後的南瓜機會只會長白南瓜（50%），白的最多 2 顆。
// 回傳要長的顏色，不長就回傳 null。
function pumpkinColor(){
  let o=0,w=0; for(const p of plants) if(p.type==='pumpkin') p.color===5?w++:o++;
  if(o<6) return w<2&&chance(.03)?5:Math.floor(Math.random()*5);
  return w<2&&chance(.5)?5:null;
}
// v1.7：聖誕紅的顏色，做法同 pumpkinColor()：紅的最多 12 株；紅的滿了只長白的。
// v1.8（主人：期間限定要讓學生考試前也收得到）：白的（color 5）8% → 20%、最多 2 → 3 株。
function poinColor(){
  let r=0,w=0; for(const p of plants) if(p.type==='poinsettia') p.color===5?w++:r++;
  if(r<12) return w<3&&chance(.2)?5:0;
  return w<3&&chance(.5)?5:null;
}
// v1.8：顏色在真的長出來那一刻才決定（滴水到長出來隔了幾百毫秒，點很快時先決定顏色會超過上限）
function addPoin(x,y){ const pc=poinColor(); return pc===null?null:addPlant('poinsettia',x,y,{color:pc}); }
// v2.0：南瓜也一樣（待辦：v1.3 起顏色在滴下去時就決定，連點很快時白南瓜會超過 2 顆）。滴下去時照舊決定「要不要長南瓜」，長出來那一刻再決定顏色
function addPumpkin(x,y){ const pc=pumpkinColor(); return pc===null?null:addPlant('pumpkin',x,y,{color:pc}); }
// v1.3：植物分組。outcome() 用它決定「從這株長出什麼」；不在分組裡的會被當成樹（舊程式的 else 分支）
// v2.0 香蒲、蕨、鈴蘭算草（水邊樹林才長）
const GRASSY={grass:1,mushroom:1,clover:1,pumpkin:1,cattail:1,fern:1,lilyvalley:1}, FLOWERY={flower:1,sunflower:1,tulip:1,poinsettia:1};   // v1.7 聖誕紅算花（不在分組裡會被當成樹）
const treeKey=p=>inForest()?(isWillow(p)?'willow':'oak'):'tree';   // v2.0 大樹的圖鑑格：第一塊地是「大樹」，水邊樹林分橡樹、垂柳
// v1.3：新植物的圖鑑格。min＝長到第幾階才登錄；稀有＝color 5（跟紫花同一個機率）
const PKEY={clover:{type:'clover',rare:false,min:1},cloverR:{type:'clover',rare:true,min:1},
  sunflower:{type:'sunflower',rare:false,min:3},sunflowerR:{type:'sunflower',rare:true,min:3},
  tulip:{type:'tulip',rare:false,min:3},tulipR:{type:'tulip',rare:true,min:3},
  pumpkin:{type:'pumpkin',rare:false,min:3},pumpkinR:{type:'pumpkin',rare:true,min:3},
  poinsettia:{type:'poinsettia',rare:false,min:2},poinsettiaR:{type:'poinsettia',rare:true,min:2},
  // v2.0 水邊樹林
  cattail:{type:'cattail',rare:false,min:3},cattailR:{type:'cattail',rare:true,min:3},
  fern:{type:'fern',rare:false,min:2},fernR:{type:'fern',rare:true,min:2},
  lilyvalley:{type:'lilyvalley',rare:false,min:3},lilyvalleyR:{type:'lilyvalley',rare:true,min:3}};

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
  if(stream) drawStream(g);   // v2.0 水邊樹林的小溪畫在底圖上（只畫一次，換地圖或改大小時重畫）
}

/* ---------- ponds ---------- */
// a pond is an ellipse; r is a fraction of U
function pondRx(p){return p.r*U*1.35} function pondRy(p){return p.r*U*.75}
function inPond(p,x,y,pad=1){const dx=(x-p.x)*W/(pondRx(p)*pad),dy=(y-p.y)*H/(pondRy(p)*pad);return dx*dx+dy*dy<1}
function pondAt(x,y,pad=1){return ponds.find(p=>inPond(p,x,y,pad))}
function pondEdge(p){const a=Math.random()*Math.PI*2,k=1.05+Math.random()*.25;return [p.x+Math.cos(a)*pondRx(p)*k/W,p.y+Math.sin(a)*pondRy(p)*k/H]}
function pondInside(p){const a=Math.random()*Math.PI*2,k=Math.random()*.6;return [p.x+Math.cos(a)*pondRx(p)*k/W,p.y+Math.sin(a)*pondRy(p)*k/H]}
/* ---------- v2.0 小溪（只有水邊樹林有；第一塊地 stream 是 null，下面這些都直接回傳「不在溪邊」） ---------- */
// 離溪最近的點：d＝距離（px），q＝溪中心線上的點，n＝法線
function streamNear(x,y){
  const P=[x*W,y*H]; let best=null;
  for(let i=0;i<stream.pts.length-1;i++){
    const A=[stream.pts[i][0]*W,stream.pts[i][1]*H], B=[stream.pts[i+1][0]*W,stream.pts[i+1][1]*H];
    const dx=B[0]-A[0],dy=B[1]-A[1],L=dx*dx+dy*dy||1;
    const k=clamp(((P[0]-A[0])*dx+(P[1]-A[1])*dy)/L,0,1), qx=A[0]+dx*k, qy=A[1]+dy*k;
    const d=Math.hypot(P[0]-qx,P[1]-qy);
    if(!best||d<best.d) best={d,qx,qy,nx:-dy/Math.sqrt(L),ny:dx/Math.sqrt(L)};
  }
  return best;
}
const inStream=(x,y,pad=1)=>!!stream&&streamNear(x,y).d<stream.w*U*pad;
const wetAt=(x,y,pad=1.2)=>!!pondAt(x,y,pad)||inStream(x,y,pad);
// 長在溪裡的推到岸上
function streamBank(x,y){
  const s=streamNear(x,y); let dx=x*W-s.qx, dy=y*H-s.qy, l=Math.hypot(dx,dy);
  if(l<.5){const sg=Math.random()<.5?-1:1;dx=s.nx*sg;dy=s.ny*sg;l=1}
  const k=stream.w*U*(1.15+Math.random()*.6);
  return [(s.qx+dx/l*k)/W,(s.qy+dy/l*k)/H];
}
const nearWater=(x,y)=>ponds.some(p=>inPond(p,x,y,1.9))||(!!stream&&streamNear(x,y).d<(stream.w+.045)*U);
const shady=(x,y)=>plants.some(p=>p.type==='tree'&&p.stage===3&&dist(p.x,p.y,x,y)<.085*U);
// 水邊樹林的樹：靠溪的長成垂柳，其他是橡樹（看位置決定，溪不會動，所以每次算出來都一樣；記在記憶體裡不進存檔）
// 用固定的 780×610 虛擬土地量距離（跟螢幕大小無關，同一棵樹在手機和電腦上都是同一種）
function isWillow(p){
  if(p.wl===undefined){
    const st=LAYOUT.forest.stream, VW=780, VH=610; let d=1e9;
    for(let i=0;i<st.pts.length-1;i++){
      const [ax,ay]=st.pts[i],[bx,by]=st.pts[i+1], dx=(bx-ax)*VW, dy=(by-ay)*VH, L=dx*dx+dy*dy||1;
      const k=clamp(((p.x-ax)*VW*dx+(p.y-ay)*VH*dy)/L,0,1);
      d=Math.min(d,Math.hypot((p.x-ax)*VW-dx*k,(p.y-ay)*VH-dy*k));
    }
    p.wl=d<(st.w+.08)*VH;
  }
  return p.wl;
}
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
// v1.5：土地長滿（超過 FULL 株）以後，只有特殊植物還能長：換掉附近一株普通的草或花，總數不變。
// 普通版在地上已經有 ROOM_CAP 株以上就不換（免得整片草地慢慢變成三葉草），稀有版（color 5）一律可以換。
// 南瓜的數量由 pumpkinColor() 管。
const FULL=900, ROOM_CAP={clover:40,sunflower:12,tulip:12,pumpkin:Infinity,poinsettia:Infinity};   // 聖誕紅的數量由 poinColor() 管
// v1.7：大樹上限。中樹（stage 2）的樹冠已經很大，一起算。到了上限：小樹苗不再長大、不再冒新樹苗。
// 新樹苗只長在「樹區」：後排（y .2～.32，再往上樹冠會超出土地）或左右邊緣。樹區外的大樹畫成半透明（舊存檔的樹不動）。
const TREE_CAP=5;
const bigTrees=()=>plants.filter(p=>p.type==='tree'&&p.stage>=2).length;
const treeZone=(x,y)=>y<=.32||x<=.08||x>=.92;
function toTreeZone(x,y){
  const yy=Math.max(.2,y), c=[[x,clamp(y,.2,.32)],[.03+Math.random()*.05,yy],[.92+Math.random()*.05,yy]];
  let best=c[0],bd=1e9; for(const q of c){const d=Math.hypot((q[0]-x)*W,(q[1]-y)*H);if(d<bd){bd=d;best=q}}
  return best;
}
const plainPlant=q=>(q.type==='grass'||q.type==='flower')&&q.color!==5;
function dropPlant(q){const i=plants.indexOf(q);if(i>=0)plants.splice(i,1)}
// 南瓜很矮，擋在它前面（畫在它後面、y 比較大）的普通草花最多換掉 2 株，讓它看得到
function clearFront(x,y){
  const blk=plants.filter(q=>plainPlant(q)&&q.y>y&&(q.y-y)*H<Math.min(PLANT_BOX[q.type][1],30)*S&&Math.abs(q.x-x)*W<(PLANT_BOX[q.type][0]+10)*S)
    .sort((a,b)=>dist(a.x,a.y,x,y)-dist(b.x,b.y,x,y)).slice(0,2);
  blk.forEach(dropPlant); return blk.length;
}
function makeRoom(x,y){
  let best=null,bd=.08*U;
  for(const q of plants){ if(!plainPlant(q)) continue; const d=dist(q.x,q.y,x,y); if(d<bd){bd=d;best=q} }
  if(best) dropPlant(best); return !!best;
}
function addPlant(type,x,y,opts={}){
  const full=plants.length>FULL;
  if(full && !(type in ROOM_CAP)) return null;
  if(type==='tree'){   // v1.7：大樹滿了就長草；不在樹區就移到最近的樹區
    if(bigTrees()>=TREE_CAP) type='grass';
    else if(!treeZone(x,y)) [x,y]=toTreeZone(x,y);
  }
  x=Math.max(.02,Math.min(.98,x)); y=Math.max(.05,Math.min(.99,y));
  const pd=pondAt(x,y,1.05);
  if(type==='lily'){ if(!pd) return null; }
  else if(pd){ [x,y]=pondEdge(pd); }
  if(inForest()){   // v2.0 水邊樹林：長在溪裡的推到岸上；草長在水邊常是香蒲，長在大樹下常是蕨或鈴蘭
    if(type!=='lily'&&inStream(x,y,1.1)) [x,y]=streamBank(x,y);
    if(type==='grass'){ const r=Math.random(); if(nearWater(x,y)){ if(r<.35) type='cattail'; } else if(shady(x,y)){ if(r<.3) type='fern'; else if(r<.48) type='lilyvalley'; } }
  }
  [x,y]=clearOfCritters(type,x,y);
  let color=opts.color;
  if(color===undefined) color = chance(.03) ? 5 : Math.floor(Math.random()*5);
  if(full){
    if(color!==5 && plants.filter(q=>q.type===type&&q.color!==5).length>=ROOM_CAP[type]) return null;
    if(!(type==='pumpkin'&&clearFront(x,y)) && !makeRoom(x,y)) return null;
  }else if(type==='pumpkin') clearFront(x,y);
  // v1.8：聖誕紅一長出來就是第 2 階（開紅花、登錄圖鑑）；第 1 階只有綠葉，學生認不出來，長滿的地也很難剛好滴到旁邊讓它長大
  const p={type,x,y,stage:opts.stage||(type==='poinsettia'?2:1),v:0,born:now(),seed:Math.random(),color};
  if(inForest()) p.nb=maps.forest.n;   // v2.0 輪替：第幾滴長出來的（存檔第 7 欄）
  plants.push(p);
  if(activeMap==='home'&&!forestOpen&&plants.length>=OPEN_AT) setTimeout(()=>openForest(false),1200);   // v2.0 第一塊地長到 300 株就開第二塊地
  if(type==='flower'&&color===5) record('violet');
  if(type==='mushroom') record('ring');
  if(type==='clover') record(color===5?'cloverR':'clover');
  if(type==='poinsettia') record(color===5?'poinsettiaR':'poinsettia');
  if(type==='flower' && color===5 && opts.color===undefined) emit('discover',{kind:'rare-flower',x,y,map:activeMap,color});
  return p;
}
function grow(p){
  if(p.type==='tree'&&(p.stage===1?bigTrees()>=TREE_CAP:plants.filter(q=>q.type==='tree'&&q.stage>=3).length>=TREE_CAP)) return;   // v1.7 大樹上限
  if(p.stage<3){p.stage++; ring(p);} if(p.type==='lily'&&p.stage>=2) record('lily'); if(p.type==='tree'&&p.stage>=3) record(treeKey(p));
  const pk=p.type+(p.color===5?'R':''); if(PKEY[pk]&&p.stage>=PKEY[pk].min) record(pk); }
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
  const crowded=inForest()&&near.length>=14;   // v2.0 水邊樹林：太擠的地方只長大、不再冒新的（第一塊地永遠是 false，亂數順序不變）

  // 1. dropped into a pond: lily pads, or the bank gets greener
  const pd=pondAt(x,y);
  if(pd){
    const lilies=plants.filter(p=>p.type==='lily'&&inPond(pd,p.x,p.y));
    const small=lilies.find(p=>p.stage<2);
    if(small && chance(.5)) acts.push(()=>grow(small));
    else if(lilies.length<(pd.fixed?6:4) && chance(.6)) acts.push(()=>{const [a,b]=pondInside(pd);addPlant('lily',a,b)});
    else for(let i=0;i<2;i++) acts.push(()=>{const [a,b]=pondEdge(pd);addPlant(chance(.6)?'grass':'flower',a,b)});
    residents(x,y,acts,nG,bigTrees);
    return acts;
  }

  // v2.0 滴在小溪裡：兩岸長得更茂密（只有水邊樹林有溪）
  if(stream && inStream(x,y)){
    for(let i=0;i<2;i++){const [a,b]=around(x,y,.03,.07);acts.push(()=>addPlant(chance(.7)?'grass':'flower',a,b))}
    residents(x,y,acts,nG,bigTrees);
    return acts;
  }

  // 2. watering the same bare patch again and again pools into a pond
  const soaked=wets.filter(w=>dist(w.x,w.y,x,y)<.022*U).length;   // includes this drop
  const treeClose=plants.some(p=>p.type==="tree"&&p.stage===3&&dist(p.x,p.y,x,y)<.04*U);
  if(soaked>=6 && ponds.filter(p=>!p.fixed).length<4 && !treeClose && !inStream(x,y,2.2) && !ponds.some(p=>dist(p.x,p.y,x,y)<.16*U) && chance(.35)){
    acts.push(()=>makePond(x,y)); return acts;
  }

  const fresh=()=>{
    // v1.3：秋天（10～11 月）空地偶爾冒出南瓜藤
    if(autumn() && chance(.05)){ const pc=pumpkinColor(); if(pc!==null){ acts.push(()=>addPumpkin(x,y)); return; } }
    if(december() && chance(.1) && poinColor()!==null){ acts.push(()=>addPoin(x,y)); return; }
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
    if((r<.45||crowded) && growable.length){
      // a crowded spot lets more than one plant grow at once
      const k=1+(near.length>=6?1:0)+(near.length>=10&&chance(.5)?1:0);
      growable.slice(0,k).forEach(p=>acts.push(()=>grow(p)));
    }else if(r<.85&&!crowded){
      const src=near[Math.floor(Math.pow(Math.random(),2)*near.length)];
      ring(src);
      if(GRASSY[src.type]){
        // v1.3：三葉草會自己蔓延；很密的草地裡，新長的草偶爾是三葉草
        const sprout=()=>(src.type==='clover'&&chance(.45))||(nG>=5&&chance(.12))?'clover':'grass';
        for(let i=0,k=1+Math.floor(Math.random()*3);i<k;i++){const [a,b]=around(x,y,.02,.07),ty=sprout();acts.push(()=>addPlant(ty,a,b))}
        if(chance(.12)){const [a,b]=around(x,y,.02,.06);acts.push(()=>addPlant('flower',a,b))}
        if(autumn() && chance(.03)){const pc=pumpkinColor();if(pc!==null){const [a,b]=around(x,y,.03,.07);acts.push(()=>addPumpkin(a,b))}}
        if(december() && chance(.08)){const [a,b]=around(x,y,.03,.07);acts.push(()=>addPoin(a,b))}
      }else if(FLOWERY[src.type]){
        if(december() && chance(.08)){const [a,b]=around(src.x,src.y,.03,.07);acts.push(()=>addPoin(a,b))}
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
    }else if(!crowded) fresh();

    // clusters are rewarded: a meadow blooms, a flower bed thickens
    if(!crowded && nG>=5 && chance(.25)){const [a,b]=around(x,y,.01,.05);acts.push(()=>addPlant('flower',a,b))}
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

  if(!acts.length&&!crowded) fresh();
  return acts;
}

/* ---------- v2.0 輪替（只有水邊樹林）：每株活幾滴由 seed 算出來；只有滴水時才會變老，放著不玩不會自己變空 ----------
   大樹、蘑菇、睡蓮、南瓜等特殊植物，和稀有色（color 5）不會走——紫花例外：紫花旁邊再開的花常常也是紫的，
   不會謝的話其他顏色謝了又長、紫花只增不減，越積越多（2026-11-21 主人試玩快轉時發現紫花比例很高）。 */
const LIFE={grass:[700,1200],flower:[450,800],cattail:[220,380],fern:[1200,2000],lilyvalley:[900,1500],clover:[900,1500]};   // 三葉草會自己蔓延，不會走的話會慢慢鋪滿（四葉草是 color 5，不會走）
const petals=[];   // 謝掉的花留下的花瓣（只在記憶體）：搬搬隊會扛回窩裡
function lifeOf(p){ const L=LIFE[p.type]; return L&&(p.color!==5||p.type==='flower') ? L[0]+hash(p.seed,77)*(L[1]-L[0]) : 0; }
function fluffBurst(p){   // 香蒲的穗爆開，絨毛飄走
  if(reduceMotion) return; const t=now();
  for(let i=0;i<7;i++) puffSeeds.push({x:p.x*W+(Math.random()-.5)*4*S,y:p.y*H-24*S,vx:(Math.random()*16+4)*S,vy:(Math.random()*-8-3)*S,t0:t,rot:Math.random()*TAU,life:1800+Math.random()*1000});
}
function turnover(){
  const m=maps.forest; m.n++;
  for(let i=plants.length-1;i>=0;i--){
    const p=plants[i], life=lifeOf(p);
    if(!life||m.n-(p.nb|0)<=life) continue;
    plants.splice(i,1); ring(p);
    if(p.type==='cattail'){ fluffBurst(p); if(chance(.4)){const [a,b]=around(p.x,p.y,.08,.22);addPlant('grass',a,b)} }
    else if(p.type==='flower'&&petals.length<6) petals.push({x:p.x,y:p.y,col:p.color,t0:now()});
  }
  // 花開著的時候偶爾也會掉一片花瓣，搬搬隊比較常有事做
  if(petals.length<3&&critters.some(c=>c.kind==='beans')&&chance(.2)){
    const fl=plants.filter(p=>p.type==='flower'&&p.stage>=2&&critters.some(c=>c.kind==='beans'&&dist(c.hx,c.hy,p.x,p.y)<.25*U));
    if(fl.length){const f=pick(fl),[a,b]=around(f.x,f.y,.01,.025);petals.push({x:a,y:b,col:f.color,t0:now()})}
  }
}

// v2.0 切換地圖時，還在半空中的水滴和還沒長完的植物要先跑完（不然會長到另一塊地）：busyUntil 之前不切換、也不接新的水滴
let busyUntil=0, switching=false;
function dropAt(x,y){
  if(switching) return;
  if(water<=0){ emit('nowater'); return; }
  water--; syncWater(false); save();
  const g=gen;
  falls.push({x,y,t0:now()});
  critterNotice(x,y);
  busyUntil=Math.max(busyUntil,now()+(reduceMotion?0:420)+80);
  setTimeout(()=>{
    if(g!==gen) return;
    wets.push({x,y,t0:now(),r:14+Math.random()*8});
    if(inForest()) turnover();
    const acts=outcome(x,y);
    busyUntil=Math.max(busyUntil,now()+120+acts.length*(reduceMotion?0:180)+80);
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
const CR={dew:7.4, moss:9.2, cap:7.2, bee:6, ladybug:7, puff:8, cloud:8, santa:8.6, frog:8, pebble:8, acorn:7, leaf:7, beans:6.2};
// v1.7：客人（呵呵公公）：只在十二月、只在記憶體（serialize 會跳過），不佔 15 隻居民的名額，一塊地最多一位
const GUEST={santa:1};
const FIRST={dew:'水塘邊住進了一顆小露珠',moss:'草地上滾來一顆愛睡覺的苔球',cap:'蘑菇圈裡，好像有誰在偷看',
  bee:'花圃裡飛來一隻嗡嗡',ladybug:'花叢裡跑來一隻點點',puff:'草地上飄來一團毛毛',cloud:'答對好多題，飄來一朵小雲',
  santa:'聖誕公公揹著禮物來了！點點看他',
  frog:'睡蓮葉上跳來一隻呱呱',pebble:'水塘邊有一顆石頭在打呼',acorn:'大樹下滾來一顆橡橡',leaf:'有一片葉子醒過來了',beans:'花叢旁邊搬來了搬搬隊'};
const RARE={dew:'來了一顆會變色的露珠',moss:'這顆苔球別著一朵稀有的花',cap:'冒出一朵沒見過顏色的小蕈寶',
  bee:'這隻嗡嗡是藍色條紋的',ladybug:'來了一隻黃色的點點',puff:'飄來一團粉紅色的毛毛',cloud:'小雲身邊掛著一段彩虹',
  frog:'來了一隻粉紅色的呱呱',pebble:'這顆石石身上有花紋',acorn:'金色的橡橡！',leaf:'一片楓紅的葉葉'};
const NORARE={santa:1,beans:1};   // 沒有稀有版（公公的稀有版是雪橇；搬搬隊三色一組就是特色）
// v2.0 水邊樹林自己的居民。森林裡第一塊地那幾種（露露、小雲…）最多 6 隻，名額留給這些（不然 15 隻很快被露露、小雲佔滿，搬搬隊來不了）
const NATIVE={frog:1,pebble:1,acorn:1,leaf:1,beans:1}, VISITOR_CAP=6;
// v1.3：飛在空中的居民（不會被植物擋、也不會把新植物推開）；alt 是離地高度（S 單位）
const AIR={bee:1,puff:1,cloud:1}, ALT0={bee:22,puff:12,cloud:70};
const puffSeeds=[];      // 毛毛噴出來的種子（只在記憶體）
let streak=[];           // 最近幾次答對的時間（addWater），湊滿就來一朵小雲
const STREAK_N=10, STREAK_MS=5*60*1000;
function newCritter(kind,x,y,home,o={}){
  const t=now();
  const c={kind,x,y,hx:home[0],hy:home[1],seed:o.seed??Math.random(),v:o.v??(Math.random()<.05?1:0),
    born:o.born??t,t0:t,wait:600+Math.random()*1500,hop:null,tgt:null,land:-1e9,
    blinkAt:t+800+Math.random()*3000,blinkT:-1e9,face:Math.random()<.5?-1:1,poke:-1e9,cheer:-1e9,
    e:kind==='cap'?0:1,state:kind==='cap'?'hidden':'idle',st0:t,sdur:400+Math.random()*1500,wakeAt:t+6000+Math.random()*9000,wakeT:-1e9,
    alt:ALT0[kind]||0,talt:ALT0[kind]||0,loop:-1e9,fly:-1e9,amt:1,drops:[],rainUntil:-1e9,heavy:-1e9,nextRain:t+4000+Math.random()*5000};
  // v2.0 水邊樹林居民的狀態：計時起點用 seed 算（不呼叫 Math.random，第一塊地的亂數順序不變）。
  // 每個欄位都要有初值：石石的 rolled 沒給的時候，位置會算成 NaN、存檔變 null
  Object.assign(c,{croak:-1e9,nextCroak:t+2500+hash(c.seed,41)*2500,roll:-1e9,rolled:true,awake:-1e9,wob:-1e9,nextWob:t+4000+hash(c.seed,42)*3000,
    lst:'sit',lt0:t,ldur:2500+hash(c.seed,43)*2000,rot:0,spin:-1e9,carry:false,petal:null});
  return c;
}
function makeCritter(kind,x,y,home,o={}){
  if(NORARE[kind]) o={...o,v:0};
  if(GUEST[kind]){ if(critters.some(c=>c.kind===kind)) return null; }
  else if(critters.filter(c=>!GUEST[c.kind]).length>=15) return null;
  else if(inForest()&&!o.quiet&&!NATIVE[kind]&&critters.filter(c=>!GUEST[c.kind]&&!NATIVE[c.kind]).length>=VISITOR_CAP) return null;   // 讀檔（quiet）不擋，免得丟掉存檔裡的居民
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
    for(let i=0;i<5;i++){const e=pondEdge(p);if(!inStream(e[0],e[1],1.1)) return e}   // v2.0 水邊樹林的小水潭在溪上，岸邊不要選到溪裡
    return [c.x,c.y];
  }
  if(c.kind==='moss'){
    for(let i=0;i<8;i++){const t=around(c.hx,c.hy,0,.07);if(!wetAt(t[0],t[1])) return t}
    return [c.x,c.y];
  }
  if(c.kind==='frog'){   // v2.0 呱呱：在自己水塘的睡蓮葉之間跳，偶爾跳到岸邊
    const p=nearestPond(c.hx,c.hy);
    if(!p) return [c.x,c.y];
    const lil=plants.filter(q=>q.type==='lily'&&inPond(p,q.x,q.y)&&dist(q.x,q.y,c.x,c.y)>3&&!critters.some(o=>o!==c&&dist(o.x,o.y,q.x,q.y)<3));
    if(lil.length&&chance(.75)){const l=pick(lil);return [l.x,l.y]}
    for(let i=0;i<5;i++){const e=pondEdge(p);if(!inStream(e[0],e[1],1.1)) return e}
    return [c.x,c.y];
  }
  if(c.kind==='beans'){   // v2.0 搬搬隊：附近有花瓣就去扛，扛到了就搬回窩
    if(c.carry) return [c.hx,c.hy];
    const pt=petals.find(q=>!q.taken&&dist(q.x,q.y,c.hx,c.hy)<.3*U);
    if(pt){pt.taken=1;c.petal=pt;return [pt.x,pt.y]}
    for(let i=0;i<8;i++){const t=around(c.hx,c.hy,0,.04);if(!wetAt(t[0],t[1])) return t}
    return [c.hx,c.hy];
  }
  if(c.kind==='acorn'||c.kind==='leaf'){   // v2.0 橡橡在大樹附近走；葉葉飄到大樹附近
    for(let i=0;i<8;i++){const t=around(c.hx,c.hy,.01,c.kind==='leaf'?.07:.06);if(!wetAt(t[0],t[1])) return t}
    return [c.x,c.y];
  }
  if(c.kind==='bee'){   // 飛到附近開著的花上面；藍紋嗡嗡偏愛紫花
    const fl=plants.filter(p=>FLOWERY[p.type]&&p.stage>=2&&dist(p.x,p.y,c.hx,c.hy)<.14*U);
    const pref=c.v?fl.filter(p=>p.color===5):[], pool=pref.length?pref:fl;
    if(pool.length&&chance(.8)){const f=pick(pool);c.talt=f.type==='sunflower'?44:f.type==='tulip'?30:19+f.stage*6;return [f.x,f.y]}
    c.talt=18+Math.random()*10;return around(c.hx,c.hy,0,.06);
  }
  if(c.kind==='cloud'){c.talt=ALT0.cloud;return around(c.hx,c.hy,0,.14)}
  if(c.kind==='puff'||c.kind==='ladybug'||c.kind==='santa'){
    for(let i=0;i<8;i++){const t=around(c.hx,c.hy,0,c.kind==='santa'?.12:c.kind==='puff'?.08:.06);if(!wetAt(t[0],t[1])) return t}
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
    if(c.kind==='pebble'){ pebbleTick(c,t); continue; }   // v2.0 石石幾乎都在睡，只有被點才翻滾
    if(c.kind==='leaf'){ leafTick(c,t); continue; }       // v2.0 葉葉：坐著 → 被風吹起來 → 晃下來
    if(c.kind==='frog'&&!reduceMotion&&!c.hop&&t>c.nextCroak){ croak(c,t); c.nextCroak=t+6000+Math.random()*4000; }
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
    if(d<1.5){
      if(c.kind==='beans'){ beansArrive(c,t); continue; }
      c.tgt=null;c.t0=t;c.wait=c.kind==='moss'?3000+Math.random()*6000:c.kind==='cap'?1500+Math.random()*2500:c.kind==='frog'?2000+Math.random()*2500:1200+Math.random()*3000;continue}
    if(c.kind==='moss'||c.kind==='santa'||c.kind==='beans'){
      const f=Math.min(1,(c.kind==='santa'?.03:c.kind==='beans'?(c.carry?.024:.032):.016)*U*dt/d);
      if(Math.abs(c.tgt[0]-c.x)>1e-4) c.face=c.tgt[0]>c.x?1:-1;
      c.x+=(c.tgt[0]-c.x)*f;c.y+=(c.tgt[1]-c.y)*f;c.moving=t;
      continue;
    }
    const bug=c.kind==='ladybug';   // 點點：一小步一小步地蹦（橫著滑會像蜘蛛）
    const frog=c.kind==='frog', acorn=c.kind==='acorn';   // v2.0 呱呱一跳就到下一片葉子；橡橡搖搖擺擺地小步走
    const step=(c.kind==='dew'?.032:bug?.02:frog?.08:acorn?.012:.014)*U, f=Math.min(1,step/d);
    const dur=c.kind==='dew'?380:bug?200:frog?540:acorn?280:240;
    if(reduceMotion){c.x+=(c.tgt[0]-c.x)*f;c.y+=(c.tgt[1]-c.y)*f;c.t0=t;c.wait=400;continue}
    startHop(c,c.x+(c.tgt[0]-c.x)*f,c.y+(c.tgt[1]-c.y)*f,t,dur,c.kind==='dew'?9:bug?2.6:frog?15:acorn?3.5:4);
    c.t0=t;c.wait=dur+(c.kind==='dew'?120+Math.random()*260:bug?40+Math.random()*90:frog?200+Math.random()*200:acorn?60+Math.random()*120:200+Math.random()*350);
  }
  for(let i=sparks.length-1;i>=0;i--) if(t-sparks[i].t0>1100) sparks.splice(i,1);
  for(let i=petals.length-1;i>=0;i--) if(!petals[i].taken&&t-petals[i].t0>45000) petals.splice(i,1);   // v2.0 沒人扛的花瓣 45 秒後被風吹走
  for(let i=puffSeeds.length-1;i>=0;i--){const s=puffSeeds[i];if(t-s.t0>s.life){puffSeeds.splice(i,1);continue}
    s.x+=s.vx*dt+Math.sin(t*.003+i)*.15*S;s.y+=s.vy*dt;s.vy*=.992;s.vx*=.995;s.rot+=dt*2}
}
/* ---------- v2.0 水邊樹林的居民：動作 ---------- */
const easeIO=k=>{k=clamp(k,0,1);return k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2};
function croak(c,t){ c.croak=t; sparks.push({x:c.x*W+9*S*c.face,y:c.y*H-17*S,t0:t,c:c.v?'#c2577a':'#4d7a2c',text:'呱'}); }
function pebbleTick(c,t){
  if(!c.rolled){   // 被點了才會滾（rolled 一開始就是 true；沒被點過不去算位置，不然起點是空的、位置會壞掉）
    const k=(t-c.roll)/1100;
    if(k>=0&&k<1) c.x=c.rx0+c.dir*easeIO(k)*c.rd;
    else if(k>=1){ c.rolled=true; c.x=c.rx0+c.dir*c.rd; sparks.push({x:c.x*W,y:c.y*H-CR.pebble*S*1.8,t0:t,c:'#f08aa2'}); }
  }
  if(!reduceMotion&&t>c.nextWob){c.wob=t;c.nextWob=t+5000+Math.random()*4000}
}
function pebbleRoll(c,t){
  if(t>c.roll&&t-c.roll<1100) return;
  c.awake=t; c.rx0=c.x; c.rolled=false; c.rd=18*S/W;
  // 左右輪流滾（不會越滾越遠）；滾過去是水就換邊，兩邊都是水就原地翻一圈
  let dir=-(c.dir||1); if(wetAt(c.x+dir*c.rd,c.y,1.1)) dir=-dir; if(wetAt(c.x+dir*c.rd,c.y,1.1)) c.rd=0;
  c.dir=dir; c.roll=reduceMotion?-1e9:t+380;
}
function leafRise(c,t){ c.lst='rise';c.lt0=t;c.x0=c.x;c.y0=c.y;const tg=critterTarget(c);c.x1=clamp(tg[0],.03,.97);c.y1=clamp(tg[1],.08,.98); }
function leafTick(c,t){
  if(reduceMotion) return;
  if(c.lst==='sit'){ if(t-c.lt0>c.ldur) leafRise(c,t); return; }
  if(c.lst==='rise'){
    const k=Math.min(1,(t-c.lt0)/900); c.alt=(1-Math.pow(1-k,2))*22;
    c.x=c.x0+(c.x1-c.x0)*k*.4; c.y=c.y0+(c.y1-c.y0)*k*.4; c.moving=t;
    if(k>=1){c.lst='fall';c.lt0=t;c.fx0=c.x;c.fy0=c.y}
    return;
  }
  const k=Math.min(1,(t-c.lt0)/3400), sw=Math.sin(k*Math.PI*3);
  c.alt=22*(1-k); c.x=c.fx0+(c.x1-c.fx0)*k+sw*.012; c.y=c.fy0+(c.y1-c.fy0)*k; c.rot=sw*.5; c.moving=t;
  if(k>=1){c.lst='sit';c.lt0=t;c.alt=0;c.rot=0;c.land=t;c.ldur=3500+Math.random()*3000}
}
function beansArrive(c,t){
  c.tgt=null; c.t0=t;
  if(c.petal&&!c.carry&&petals.includes(c.petal)){ petals.splice(petals.indexOf(c.petal),1); c.petal=null; c.carry=true; c.grab=t; c.wait=650; return; }
  if(c.carry&&dist(c.x,c.y,c.hx,c.hy)<3){ c.carry=false; c.wait=900; sparks.push({x:c.x*W,y:c.y*H-14*S,t0:t,c:'#e3a1b0'}); if(!reduceMotion) startHop(c,c.x,c.y,t,380,9); return; }
  c.petal=null; c.wait=600+Math.random()*1800;
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
  else if(c.kind==='leaf') lift+=c.alt*S;
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
  else if(c.kind==='santa') drawSanta(c,t,p,g);
  else if(c.kind==='frog') drawFrog(c,t,p,g);
  else if(c.kind==='pebble') drawPebble(c,t,p,g);
  else if(c.kind==='acorn') drawAcorn(c,t,p,g);
  else if(c.kind==='leaf') drawLeaf(c,t,p,g);
  else if(c.kind==='beans') drawBeans(c,t,p,g);
  else drawCap(c,t,p,g);
}
/* ---------- v1.7 呵呵公公、雪橇（照 docs/december-preview.html） ---------- */
function fluff(x,y,rx,ry,n,col,seed){
  ctx.fillStyle=col;
  for(let i=0;i<n;i++){const a=i/n*TAU;ctx.beginPath();ctx.arc(x+Math.cos(a)*rx*.82,y+Math.sin(a)*ry*.82,Math.min(rx,ry)*(.36+hash(seed,i)*.12),0,TAU);ctx.fill()}
  ctx.beginPath();ctx.ellipse(x,y,rx*.9,ry*.9,0,0,TAU);ctx.fill();
}
function drawSanta(c,t,p,g){
  const r=CR.santa*S*g, X=p.cx, Y=p.cy-p.lift;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,p.cy+S*.4,r*1.15*Math.max(.55,1-p.lift/(30*S)),r*.37,0,0,TAU);ctx.fill();
  const walking=!reduceMotion&&t-(c.moving||-1e9)<150;
  const breathe=reduceMotion?0:Math.sin(t*.0024+c.seed*9)*.03;
  const rot=walking?Math.sin(t*.013+c.seed*5)*.1:0;
  ctx.save();ctx.translate(X,Y);ctx.rotate(rot);ctx.scale((1-p.sq*.7-breathe*.5)*c.face,1+p.sq+breathe);
  const rx=r*1.02, ry=r*.98, cy=-ry;
  ctx.save();ctx.translate(-rx*.82,cy+ry*.05);ctx.rotate(-.25);   // 背後的禮物袋
  ctx.fillStyle='#a9794d';ctx.beginPath();ctx.ellipse(0,0,r*.62,r*.72,0,0,TAU);ctx.fill();
  ctx.fillStyle='#8a5e3a';ctx.beginPath();ctx.ellipse(r*.12,-r*.66,r*.26,r*.12,0,0,TAU);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.22)';ctx.beginPath();ctx.ellipse(-r*.22,-r*.2,r*.14,r*.28,-.4,0,TAU);ctx.fill();
  ctx.restore();
  ctx.fillStyle='#3b2b25';   // 靴子
  for(const s of [-1,1]){const k=walking?Math.sin(t*.02+(s>0?Math.PI:0))*r*.06:0;ctx.beginPath();ctx.ellipse(s*r*.42,-r*.06-Math.max(0,k),r*.32,r*.18,0,0,TAU);ctx.fill()}
  const gr=ctx.createRadialGradient(-rx*.35,cy-ry*.4,r*.1,0,cy,rx*1.1);
  gr.addColorStop(0,'#f2877a');gr.addColorStop(.55,'#d8473e');gr.addColorStop(1,'#ad2f2f');
  ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(0,cy,rx,ry,0,0,TAU);ctx.fill();
  ctx.save();ctx.beginPath();ctx.ellipse(0,cy,rx*1.01,ry*1.01,0,0,TAU);ctx.clip();
  ctx.fillStyle='#fbf7f0';for(let i=0;i<9;i++){ctx.beginPath();ctx.arc(-rx+i*rx/4,-r*.02,r*.2,0,TAU);ctx.fill()}   // 下擺白毛邊
  ctx.fillStyle='#2d2523';ctx.fillRect(-rx*1.1,cy+ry*.3,rx*2.2,ry*.2);   // 腰帶
  ctx.strokeStyle='#e8bf52';ctx.lineWidth=r*.07;ctx.strokeRect(-r*.17,cy+ry*.3+r*.02,r*.34,ry*.2-r*.04);
  ctx.restore();
  ctx.fillStyle='#2f6f4a';   // 手套
  for(const s of [-1,1]){const wave=s>0&&happy(c,t)&&!reduceMotion?Math.sin(t*.025)*r*.18:0;ctx.beginPath();ctx.arc(s*rx*.98,cy+ry*.18-wave,r*.2,0,TAU);ctx.fill()}
  ctx.scale(c.face,1);
  const fy=cy-ry*.28;
  ctx.fillStyle='#f7d2b8';ctx.beginPath();ctx.ellipse(0,fy,rx*.58,ry*.36,0,0,TAU);ctx.fill();
  fluff(0,cy+ry*.12,rx*.62,ry*.42,10,'#fbf8f3',c.seed);   // 鬍子
  ctx.fillStyle='rgba(200,190,180,.18)';ctx.beginPath();ctx.ellipse(r*.12,cy+ry*.34,rx*.35,ry*.12,0,0,TAU);ctx.fill();
  const ho=t>=(c.hoho||-1e9)&&t-(c.hoho||-1e9)<900;
  if(ho){ctx.fillStyle='#7a2a2a';ctx.beginPath();ctx.ellipse(0,cy+ry*.12,r*.14,r*.11+Math.abs(Math.sin((t-c.hoho)*.018))*r*.06,0,0,TAU);ctx.fill()}
  ctx.fillStyle='#ffffff';   // 八字鬍
  for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*r*.2,fy+ry*.24,r*.24,r*.12,s*-.35,0,TAU);ctx.fill()}
  const lk=lookAt(X,Y,r);
  eyes(c,t,r*.24,fy-ry*.02,r*.13,lk,true);
  cheeks(r*.44,fy+ry*.12,r*.12);
  ctx.fillStyle='#e0605a';ctx.beginPath();ctx.arc(lk*.5,fy+ry*.13,r*.11,0,TAU);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.6)';ctx.beginPath();ctx.arc(lk*.5-r*.03,fy+ry*.1,r*.035,0,TAU);ctx.fill();
  const hy=fy-ry*.3, sway=reduceMotion?0:Math.sin(t*.003+c.seed*7)*.08+(walking?Math.sin(t*.013)*.08:0);   // 帽子
  ctx.save();ctx.translate(0,hy);
  const tipX=r*.95+Math.sin(sway)*r*.3, tipY=-r*.95;
  const hg=ctx.createLinearGradient(0,-r,0,0);hg.addColorStop(0,'#c83a36');hg.addColorStop(1,'#e2564c');
  ctx.fillStyle=hg;ctx.beginPath();ctx.moveTo(-rx*.62,0);
  ctx.quadraticCurveTo(-rx*.45,-r*1.05,r*.2,-r*1.12);ctx.quadraticCurveTo(tipX*.9,-r*1.15,tipX,tipY+r*.25);
  ctx.quadraticCurveTo(r*.45,-r*.6,rx*.62,0);ctx.closePath();ctx.fill();
  fluff(tipX,tipY+r*.3,r*.2,r*.2,7,'#fbf8f3',c.seed+3);
  ctx.fillStyle='#fbf8f3';
  for(let i=0;i<7;i++){ctx.beginPath();ctx.arc(-rx*.62+i*rx*1.24/6,0,r*.17,0,TAU);ctx.fill()}
  ctx.fillRect(-rx*.62,-r*.12,rx*1.24,r*.22);
  ctx.restore();
  ctx.restore();
  if(ho&&!reduceMotion){   // 「呵呵」
    const k=(t-c.hoho)/900, b=ctx.globalAlpha;ctx.globalAlpha=b*Math.sin(Math.PI*k);ctx.fillStyle='#fff';ctx.strokeStyle='rgba(120,40,40,.6)';ctx.lineWidth=S*.8;
    ctx.font='900 '+Math.round(5.5*S)+'px sans-serif';ctx.textAlign='center';
    const tx=X+c.face*r*1.6, ty=Y-r*2.6-k*6*S;
    ctx.strokeText('呵呵',tx,ty);ctx.fillText('呵呵',tx,ty);ctx.globalAlpha=b;ctx.textAlign='start';
  }
}
// 雪橇：X、Y 是畫的位置（像素）
function drawSleighAt(X,Y,t,seed){
  const r=6.6*S;
  ctx.save();ctx.translate(X,Y);
  const dx=r*3.1;   // 麋鹿
  ctx.strokeStyle='#6e4a2c';ctx.lineWidth=S*.5;ctx.beginPath();ctx.moveTo(r*1.2,-r*.4);ctx.quadraticCurveTo(r*2,-r*.1,dx-r*.5,-r*.5);ctx.stroke();
  ctx.save();ctx.translate(dx,-r*.3);
  ctx.strokeStyle='#7b5233';ctx.lineWidth=r*.18;ctx.lineCap='round';
  for(const [lx,ph] of [[-.45,0],[-.2,Math.PI],[.3,.5],[.55,Math.PI+.5]]){const a=reduceMotion?0:Math.sin(t*.02+ph)*.5;ctx.beginPath();ctx.moveTo(lx*r,r*.3);ctx.lineTo(lx*r+Math.sin(a)*r*.5,r*.95);ctx.stroke()}
  ctx.fillStyle='#9a6a42';ctx.beginPath();ctx.ellipse(0,0,r*.85,r*.52,-.08,0,TAU);ctx.fill();
  ctx.fillStyle='#f4e7d6';ctx.beginPath();ctx.ellipse(-r*.05,r*.18,r*.45,r*.22,0,0,TAU);ctx.fill();
  ctx.fillStyle='#9a6a42';ctx.beginPath();ctx.arc(r*.85,-r*.55,r*.5,0,TAU);ctx.fill();
  ctx.strokeStyle='#6b4428';ctx.lineWidth=r*.12;
  for(const s of [-1,1]){const bx=r*(.75+s*.18);ctx.beginPath();ctx.moveTo(bx,-r*.95);ctx.lineTo(bx+s*r*.15,-r*1.45);ctx.moveTo(bx+s*r*.07,-r*1.2);ctx.lineTo(bx+s*r*.42,-r*1.32);ctx.moveTo(bx+s*r*.12,-r*1.38);ctx.lineTo(bx-s*r*.12,-r*1.62);ctx.stroke()}
  ctx.fillStyle='#262626';ctx.beginPath();ctx.arc(r*.95,-r*.68,r*.09,0,TAU);ctx.fill();
  const glow=.55+.45*Math.sin(t*.008), b=ctx.globalAlpha;
  ctx.globalAlpha=b*.25*glow;ctx.fillStyle='#ff5a50';ctx.beginPath();ctx.arc(r*1.32,-r*.5,r*.42,0,TAU);ctx.fill();ctx.globalAlpha=b;
  ctx.fillStyle='#ef3d3d';ctx.beginPath();ctx.arc(r*1.32,-r*.5,r*.17,0,TAU);ctx.fill();
  ctx.restore();
  ctx.strokeStyle='#e0b545';ctx.lineWidth=r*.14;ctx.lineCap='round';   // 雪橇
  ctx.beginPath();ctx.moveTo(-r*1.5,r*.6);ctx.lineTo(r*1.1,r*.6);ctx.quadraticCurveTo(r*1.6,r*.6,r*1.5,r*.15);ctx.stroke();
  for(const sx of [-.8,.5]){ctx.beginPath();ctx.moveTo(sx*r,r*.6);ctx.lineTo(sx*r,r*.25);ctx.stroke()}
  ctx.fillStyle='#a9794d';ctx.beginPath();ctx.ellipse(-r*1.05,-r*.55,r*.55,r*.6,-.2,0,TAU);ctx.fill();
  ctx.fillStyle='#d8473e';ctx.beginPath();ctx.ellipse(r*.1,-r*.45,r*.55,r*.5,0,0,TAU);ctx.fill();
  ctx.fillStyle='#f7d2b8';ctx.beginPath();ctx.arc(r*.15,-r*1.05,r*.36,0,TAU);ctx.fill();
  fluff(r*.15,-r*.75,r*.34,r*.24,8,'#fbf8f3',seed);
  ctx.fillStyle='#262626';for(const s of [-1,1]){ctx.beginPath();ctx.arc(r*.15+s*r*.13+r*.06,-r*1.1,r*.06,0,TAU);ctx.fill()}
  ctx.fillStyle='#e0605a';ctx.beginPath();ctx.arc(r*.24,-r*.98,r*.07,0,TAU);ctx.fill();
  ctx.fillStyle='#d8473e';ctx.beginPath();ctx.moveTo(-r*.22,-r*1.25);ctx.quadraticCurveTo(r*.1,-r*1.95,r*.55,-r*1.25);ctx.closePath();ctx.fill();
  ctx.fillStyle='#fbf8f3';ctx.fillRect(-r*.24,-r*1.32,r*.8,r*.14);ctx.beginPath();ctx.arc(r*.12,-r*1.62,r*.13,0,TAU);ctx.fill();
  const bg=ctx.createLinearGradient(0,-r*.6,0,r*.4);bg.addColorStop(0,'#c8353a');bg.addColorStop(1,'#93222a');
  ctx.fillStyle=bg;ctx.beginPath();ctx.moveTo(-r*1.6,-r*.5);ctx.quadraticCurveTo(-r*1.75,r*.35,-r*1.1,r*.35);ctx.lineTo(r*.75,r*.35);
  ctx.quadraticCurveTo(r*1.25,r*.3,r*1.05,-r*.25);ctx.quadraticCurveTo(r*.3,-r*.05,-r*.4,-r*.25);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#e8bf52';ctx.lineWidth=r*.08;ctx.beginPath();ctx.moveTo(-r*1.45,-r*.1);ctx.quadraticCurveTo(-r*.3,r*.05,r*.85,-r*.02);ctx.stroke();
  ctx.restore();
}
// 土地上的雪橇：從左飛到右，經過 drops 的位置丟禮物
function drawSleigh(t){
  const sl=sleigh; if(!sl) return;
  const k=(t-sl.t0)/sl.d; if(k<0||k>1) return;
  const r=6.6*S, X=-30*S+k*(W+60*S), Y=sl.y*H+(reduceMotion?0:Math.sin(t*.004)*3*S);
  const b=ctx.globalAlpha; ctx.globalAlpha=b*.35;ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,sl.gy*H,r*2.6,r*.5,0,0,TAU);ctx.fill();ctx.globalAlpha=b;
  if(!reduceMotion&&Math.random()<.3) sparks.push({x:X-r*2.5,y:Y+r*.3,t0:t,c:'#f3c645'});
  drawSleighAt(X,Y,t,sl.seed);
  for(const d of sl.drops) if(!d.done&&k>=d.at){ d.done=1; if(gifts.length<6&&X>0&&X<W) gifts.push({x:clamp((X-r*.8)/W,.03,.97),y:clamp(sl.gy+(Math.random()-.5)*.06,.1,.97),fromY:Y/H,t0:t,col:Math.floor(Math.random()*4)}); }
}
/* ---------- v1.7 聖誕紅（drawNewPlant 的格式：g, v=階段, s=S） ---------- */
function poinBract(g,len,wid,rot,col,s){
  g.save();g.rotate(rot);g.fillStyle=col;
  g.beginPath();g.moveTo(0,0);g.bezierCurveTo(wid,-len*.25,wid*.8,-len*.75,0,-len);g.bezierCurveTo(-wid*.8,-len*.75,-wid,-len*.25,0,0);g.fill();
  g.strokeStyle='rgba(0,0,0,.12)';g.lineWidth=s*.25;g.beginPath();g.moveTo(0,-len*.1);g.lineTo(0,-len*.8);g.stroke();
  g.restore();
}
function drawPoinsettia(g,v,s,t,seed,rare){
  const sway=reduceMotion?0:Math.sin(t*.0016+seed*9)*.05, k=clamp((v-1)/2,0,1);
  g.save();g.rotate(sway);
  const sh=s*(3+3.4*k);
  g.strokeStyle='#3f7a3a';g.lineWidth=s*.8;g.lineCap='round';g.beginPath();g.moveTo(0,0);g.lineTo(0,-sh);g.stroke();
  for(const [a,l] of [[-1.2,5.5],[1.25,5.2],[-2.1,4.3],[2.05,4.6]]){g.save();g.translate(0,-sh*.5);g.rotate(a);g.fillStyle=a<0?'#3d7d3e':'#4c8f48';const L=l*s*(.7+.3*k);
    g.beginPath();g.moveTo(0,0);g.bezierCurveTo(1.6*s,-L*.3,1.4*s,-L*.8,0,-L);g.bezierCurveTo(-1.4*s,-L*.8,-1.6*s,-L*.3,0,0);g.fill();g.restore()}
  if(v>=1.4){
    const z=.45+.55*clamp((v-1.4)/1.6,0,1), C=rare?['#d9d2c2','#f2ede2','#fffdf8']:['#a8222c','#d23a3a','#ec5a50'];
    g.translate(0,-sh-s*.4);
    for(let i=0;i<6;i++) poinBract(g,5.4*s*z,1.9*s*z,i/6*TAU+seed,C[0],s);
    for(let i=0;i<6;i++) poinBract(g,4.4*s*z,1.7*s*z,(i+.5)/6*TAU+seed,C[1],s);
    for(let i=0;i<5;i++) poinBract(g,2.6*s*z,1.1*s*z,i/5*TAU+seed*2,C[2],s);
    g.fillStyle='#7fae3a';for(let i=0;i<5;i++){const a=i/5*TAU;g.beginPath();g.arc(Math.cos(a)*.6*s*z,Math.sin(a)*.6*s*z,.42*s*z,0,TAU);g.fill()}
    g.fillStyle='#f2cb45';g.beginPath();g.arc(0,0,.4*s*z,0,TAU);g.fill();
  }
  g.restore();
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

/* ---------- v2.0 水邊樹林的居民：畫法（照 docs/new-guide-candidates.html、forest-map-preview.html） ---------- */
function groundShadow(p,r,k){ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(p.cx,p.cy,r*k*Math.max(.5,1-p.lift/(30*S)),r*.3,0,0,TAU);ctx.fill()}
function drawFrog(c,t,p,g){   // 呱呱：青蛙
  const r=CR.frog*S*g, X=p.cx, Y=p.cy-p.lift;
  const col=c.v?['#ffd9e4','#f3a3bd','#d67596','#fff3f7']:['#cbe996','#8fc65c','#5d9a3a','#eef5cf'];
  groundShadow(p,r,1.1);
  ctx.save();ctx.translate(X,Y);ctx.scale(1-p.sq*.7,1+p.sq);
  ctx.fillStyle=col[2];for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*r*.95,-r*.32,r*.44,r*.3,s*.3,0,TAU);ctx.fill()}
  const gr=ctx.createRadialGradient(-r*.3,-r*1.15,r*.1,0,-r*.7,r*1.35);gr.addColorStop(0,col[0]);gr.addColorStop(.6,col[1]);gr.addColorStop(1,col[2]);
  ctx.fillStyle=gr;for(const s of [-1,1]){ctx.beginPath();ctx.arc(s*r*.5,-r*1.3,r*.37,0,TAU);ctx.fill()}
  ctx.beginPath();ctx.ellipse(0,-r*.72,r*1.1,r*.74,0,0,TAU);ctx.fill();
  ctx.fillStyle=col[3];ctx.beginPath();ctx.ellipse(0,-r*.4,r*.62,r*.34,0,0,TAU);ctx.fill();
  const ck=(t-c.croak)/800;
  if(ck>=0&&ck<1){const pf=Math.abs(Math.sin(ck*Math.PI*2));   // 鼓起喉嚨
    ctx.fillStyle=col[3];ctx.strokeStyle='rgba(214,117,150,.35)';ctx.lineWidth=S*.5;
    ctx.beginPath();ctx.ellipse(0,-r*.55,r*.12+r*.34*pf,r*.1+r*.26*pf,0,0,TAU);ctx.fill();ctx.stroke()}
  ctx.fillStyle=col[2];for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*r*.42,-r*.04,r*.22,r*.12,0,0,TAU);ctx.fill()}
  eyes(c,t,r*.5,-r*1.3,r*.17,lookAt(X,Y,r),true);
  cheeks(r*.74,-r*.86,r*.15);
  ctx.strokeStyle='#2a2a2a';ctx.lineWidth=r*.08;ctx.lineCap='round';
  ctx.beginPath();ctx.arc(0,-r*1.12,happy(c,t)?r*.48:r*.36,Math.PI*.25,Math.PI*.75);ctx.stroke();
  ctx.restore();
}
function drawPebble(c,t,p,g){   // 石石：水塘邊的小石頭
  const r=CR.pebble*S*g, X=p.cx, Y=p.cy;
  const k=(t-c.roll)/1100, rolling=k>=0&&k<1, wk=(t-c.wob)/700;
  const rot=rolling?c.dir*easeIO(k)*TAU:(wk>=0&&wk<1?Math.sin(wk*Math.PI*3)*.1*(1-wk):0);
  const lift=Math.abs(Math.sin(rot))*r*.5;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,Y,r*1.15,r*.3,0,0,TAU);ctx.fill();
  ctx.save();ctx.translate(X,Y-r*.62-lift);ctx.rotate(rot);
  const gr=ctx.createRadialGradient(-r*.4,-r*.45,r*.1,0,0,r*1.3);
  gr.addColorStop(0,c.v?'#f6ece0':'#cfcac1');gr.addColorStop(1,c.v?'#d8c5ad':'#8d877d');
  ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(0,0,r*1.12,r*.62,0,0,TAU);ctx.fill();
  if(c.v){const b=ctx.globalAlpha;ctx.save();ctx.beginPath();ctx.ellipse(0,0,r*1.12,r*.62,0,0,TAU);ctx.clip();
    ['#d9a98a','#b89ad0','#9cc3d6','#e8c9a8','#c79ad6'].forEach((cc,i)=>{ctx.strokeStyle=cc;ctx.globalAlpha=b*.65;ctx.lineWidth=r*.09;ctx.beginPath();ctx.ellipse(r*.35,-r*.25,r*(.25+i*.22),r*(.14+i*.13),.3,0,TAU);ctx.stroke()});
    ctx.restore();ctx.globalAlpha=b}
  for(const [x,y,s,cc] of [[-.25,-.5,.2,'#6b9a3c'],[.05,-.56,.24,'#7fa548'],[.35,-.48,.18,'#6b9a3c'],[.18,-.6,.13,'#9cc266']]){ctx.fillStyle=cc;ctx.beginPath();ctx.arc(x*r,y*r,s*r,0,TAU);ctx.fill()}
  ctx.fillStyle='rgba(255,255,255,.28)';ctx.beginPath();ctx.ellipse(-r*.55,-r*.2,r*.22,r*.1,-.3,0,TAU);ctx.fill();
  const awake=t-c.awake<2800||t-c.cheer<1100||t-c.poke<2800;
  eyes(c,t,r*.34,r*.04,r*.13,0,awake);
  cheeks(r*.62,r*.17,r*.13);
  if(awake) smile(r*.2,r,happy(c,t));
  ctx.restore();
  if(!awake&&!reduceMotion){
    const zk=(t*.00035+c.seed)%1, b=ctx.globalAlpha;ctx.globalAlpha=b*Math.sin(Math.PI*zk)*.7;ctx.fillStyle='#fff';
    ctx.font='700 '+Math.round(5*S+zk*3*S)+'px sans-serif';ctx.fillText('z',X+r*.9+zk*6*S,Y-r*1.4-zk*14*S);ctx.globalAlpha=b;
  }
}
function drawAcorn(c,t,p,g){   // 橡橡：橡實，被點會掀帽子
  const r=CR.acorn*S*g, X=p.cx, Y=p.cy-p.lift;
  const col=c.v?['#fff0b8','#f2c24e','#c9932a']:['#ecc189','#c98b4b','#9a6332'], cap=c.v?'#b5862a':'#7a5a36';
  groundShadow(p,r,.95);
  ctx.save();ctx.translate(X,Y);
  const rot=c.hop?Math.sin((t-c.hop.t0)/c.hop.d*Math.PI)*.18*c.face:(reduceMotion?0:Math.sin(t*.002+c.seed*7)*.03);
  ctx.rotate(rot);ctx.scale(1-p.sq*.6,1+p.sq);
  ctx.fillStyle='#6b4a2b';for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*r*.35,-r*.05,r*.22,r*.13,0,0,TAU);ctx.fill()}
  const gr=ctx.createRadialGradient(-r*.3,-r*1.3,r*.1,0,-r*.9,r*1.2);gr.addColorStop(0,col[0]);gr.addColorStop(.55,col[1]);gr.addColorStop(1,col[2]);
  ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(0,-r*.95,r*.82,r*.95,0,0,TAU);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.3)';ctx.beginPath();ctx.ellipse(-r*.38,-r*1.05,r*.12,r*.3,-.2,0,TAU);ctx.fill();
  eyes(c,t,r*.3,-r*.86,r*.14,lookAt(X,Y,r),true);
  cheeks(r*.52,-r*.62,r*.13);
  smile(-r*.68,r,happy(c,t));
  const k=(t-c.poke)/800, up=k>=0&&k<1?Math.sin(k*Math.PI):0;
  ctx.save();ctx.translate(0,-r*1.55-up*r*1.1);ctx.rotate(-up*.45*c.face);
  ctx.fillStyle=cap;ctx.beginPath();ctx.moveTo(-r*1.02,0);ctx.bezierCurveTo(-r*1.02,-r*.95,r*1.02,-r*.95,r*1.02,0);ctx.quadraticCurveTo(0,r*.34,-r*1.02,0);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.17)';
  for(let i=0;i<9;i++){const a=Math.PI*(1.1+i*.1);ctx.beginPath();ctx.arc(Math.cos(a)*r*.62,-r*.12+Math.sin(a)*r*.45,r*.09,0,TAU);ctx.fill()}
  ctx.strokeStyle=cap;ctx.lineWidth=r*.18;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,-r*.66);ctx.quadraticCurveTo(r*.02,-r*.95,r*.25,-r*1.05);ctx.stroke();
  ctx.restore();ctx.restore();
  if(c.v&&!reduceMotion){const tw=(t*.0007+c.seed)%1;pStar(ctx,X+r*.9,Y-r*2.1,r*.32*Math.sin(Math.PI*tw),Math.sin(Math.PI*tw))}
}
function drawLeaf(c,t,p,g){   // 葉葉：會飄的葉子
  const r=CR.leaf*S*g, X=p.cx, Y=p.cy-p.lift;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(p.cx,p.cy,r*.75*Math.max(.4,1-c.alt/30),r*.24,0,0,TAU);ctx.fill();
  const col=c.v?['#ffc27a','#e8603c','#b8322a','#ffd98a']:['#bfe08a','#8fbf55','#5f8a3a','#d9efb0'];
  ctx.save();ctx.translate(X,Y-r*1.35);
  const sk=(t-c.spin)/700;
  let rot=c.rot+(sk>=0&&sk<1?easeIO(sk)*TAU:0);
  if(c.lst==='sit'&&!reduceMotion) rot+=Math.sin(t*.002+c.seed*5)*.06;
  ctx.rotate(rot);ctx.translate(0,r*1.35);
  if(c.lst==='sit'&&t-c.land<240) ctx.scale(1+.15*(1-(t-c.land)/240),1-.2*(1-(t-c.land)/240));
  ctx.strokeStyle=col[2];ctx.lineWidth=r*.12;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,-r*.4);ctx.quadraticCurveTo(0,-r*.05,r*.2,0);ctx.stroke();
  const gr=ctx.createLinearGradient(-r,-r*2.4,r,-r*.4);gr.addColorStop(0,col[0]);gr.addColorStop(.5,col[1]);gr.addColorStop(1,col[2]);
  ctx.fillStyle=gr;ctx.beginPath();ctx.moveTo(0,-r*.35);
  ctx.bezierCurveTo(r*1.1,-r*.6,r*.98,-r*1.95,0,-r*2.5);ctx.bezierCurveTo(-r*.98,-r*1.95,-r*1.1,-r*.6,0,-r*.35);ctx.fill();
  const b=ctx.globalAlpha;ctx.strokeStyle=col[3];ctx.globalAlpha=b*.7;ctx.lineWidth=r*.07;
  ctx.beginPath();ctx.moveTo(0,-r*.45);ctx.lineTo(0,-r*.95);ctx.moveTo(0,-r*1.6);ctx.lineTo(0,-r*2.3);
  for(const [y,s] of [[-1.85,1],[-2.05,-1],[-.75,1],[-.6,-1]]){ctx.moveTo(0,y*r);ctx.lineTo(s*r*.5,(y-.25)*r)}
  ctx.stroke();ctx.globalAlpha=b;
  eyes(c,t,r*.3,-r*1.32,r*.14,lookAt(X,Y,r),true);
  cheeks(r*.55,-r*1.05,r*.13);
  smile(-r*1.12,r,happy(c,t)||c.alt>1);
  ctx.restore();
}
const BEANS=[['#f2dcc6','#dcb08c','#bd8a64'],['#d8e7d6','#a0c4a3','#76a07c'],['#e1dcee','#b3a8d0','#8e83b2']];   // 搬搬隊：杏、薄荷、薰衣草
function drawPetalAt(X,Y,w,h,rot,col){ctx.save();ctx.translate(X,Y);ctx.rotate(rot);ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,0);
  ctx.bezierCurveTo(-w,-h*.3,-w*.8,-h,0,-h);ctx.bezierCurveTo(w*.8,-h,w,-h*.3,0,0);ctx.fill();ctx.restore()}
function drawBeans(c,t,p,g){   // 搬搬隊：三隻小豆豆，扛著花瓣回窩
  const r=CR.beans*S*g;
  if(!c.bs) c.bs=[0,1,2].map(()=>({blinkT:-1e9,blinkAt:t+800+Math.random()*3000,poke:-1e9,cheer:-1e9}));
  const walking=!reduceMotion&&t-(c.moving||-1e9)<140, gk=(t-(c.grab||-1e9))/600, crouch=gk>=0&&gk<1?Math.sin(gk*Math.PI)*.2:0;
  for(let i=0;i<3;i++){
    const b=c.bs[i]; if(t>b.blinkAt){b.blinkT=t;b.blinkAt=t+1800+Math.random()*3800} b.poke=c.poke;b.cheer=c.cheer;
    const ph=Math.sin(t*.016+i*2.1+c.seed*6), bob=walking?Math.abs(ph)*r*.22:0;
    const X=p.cx+(i-1)*r*2.3*c.face, gy=p.cy+(i-1)*S*1.6, Y=gy-p.lift-bob, cs=BEANS[i];
    ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,gy,r,r*.3,0,0,TAU);ctx.fill();
    ctx.save();ctx.translate(X,Y);ctx.scale(c.face*(1-(p.sq+crouch)*.6),1+p.sq+crouch);
    ctx.fillStyle=cs[2];for(const s of [-1,1]){const lf=walking?Math.max(0,ph*s)*r*.35:0;ctx.beginPath();ctx.ellipse(s*r*.4,-r*.08-lf+bob,r*.3,r*.17,0,0,TAU);ctx.fill()}
    const gr=ctx.createRadialGradient(-r*.35,-r*1.6,r*.1,0,-r*1.0,r*1.4);gr.addColorStop(0,'rgba(255,255,255,.8)');gr.addColorStop(.25,cs[0]);gr.addColorStop(.75,cs[1]);gr.addColorStop(1,cs[2]);
    ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(0,-r*1.0,r*.98,r*1.1,0,0,TAU);ctx.fill();
    ctx.scale(c.face,1);
    eyes(b,t,r*.36,-r*1.2,r*.16,i===1?lookAt(X,Y,r):0,true);cheeks(r*.62,-r*.85,r*.15);smile(-r*.88,r,happy(b,t)||c.carry);
    ctx.restore();
    if(i===1&&c.carry) drawPetalAt(X-r*.55*c.face,Y-r*2.3,r*.42,r*1.1,Math.PI/2+(reduceMotion?0:Math.sin(t*.004+c.seed)*.2),'#e3a1b0');
  }
}
function drawPetals(){   // 地上的花瓣（搬搬隊會來扛；白花的花瓣畫淡紫一點，不然在土上看不到；快被吹走時慢慢變淡）
  const t=now();
  for(const q of petals){ const col=PAL.flower[q.col]||'#e3a1b0';
    ctx.globalAlpha=q.taken?1:clamp((45000-(t-q.t0))/3000,0,1);
    drawPetalAt(q.x*W,q.y*H,1.8*S,3.6*S,1.2+hash(q.x,3),col==='#f2f0f7'?'#ece6f3':col); }
  ctx.globalAlpha=1;
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
    if(s.text){   // v2.0 呱呱的「呱」
      ctx.font='700 '+Math.round(6*S)+'px sans-serif';ctx.textAlign='center';
      ctx.fillText(s.text,s.x+Math.sin(k*5)*2*S,s.y-k*16*S);ctx.textAlign='start';continue;
    }
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
    const d=Math.hypot(x*W-p.cx,y*H-(p.cy-p.lift-r*1.1))-(c.kind==='beans'?r*2:0);   // 搬搬隊是三隻排成一排，點到哪一隻都算
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
  else if(c.kind==='frog'){croak(c,t);if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,440,12);c.t0=t;c.wait=1100}}   // v2.0
  else if(c.kind==='pebble') pebbleRoll(c,t);
  else if(c.kind==='acorn'){c.t0=t;c.wait=Math.max(c.wait,900)}   // 掀帽子（畫的時候看 c.poke）
  else if(c.kind==='leaf'){c.spin=t;if(c.lst==='sit'&&!reduceMotion)leafRise(c,t)}
  else if(c.kind==='santa'){c.hoho=t;if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,380,8);c.t0=t;c.wait=1100}
    if(gifts.length<6) gifts.push({x:clamp(c.x+c.face*r*1.9/W,.03,.97),y:c.y+1.5*S/H,t0:t+250,col:Math.floor(Math.random()*4)})}
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
    if(c.kind==='pebble'){c.awake=t;c.wob=t;return}   // v2.0 石石醒來晃一下就好
    if(c.kind==='leaf'){c.spin=t;return}
    if(c.kind==='santa') c.hoho=t;
    if(!c.hop&&!reduceMotion){startHop(c,c.x,c.y,t,360,c.kind==='moss'||c.kind==='santa'?6:10);c.t0=t;c.wait=Math.max(c.wait,700)}
  },i*90+Math.random()*60));
}
const STAY={frog:1,pebble:1,leaf:1,beans:1};   // v2.0 這幾隻不會跑過來看水滴（呱呱離不開水塘、石石在睡、葉葉用飄的、搬搬隊在忙）
function critterNotice(x,y){ // a drop lands nearby: dew and moss come to look
  for(const c of critters){
    if(c.kind==='cap'||AIR[c.kind]||STAY[c.kind]||dist(c.x,c.y,x,y)>.16*U) continue;
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
  // v1.7：十二月，公公會揹著禮物走進來（只在記憶體，每次打開頁面要再來一次）；偶爾有雪橇從天上飛過（稀有）
  if(december()){
    // v1.8 機率調高：公公 12% → 30%；雪橇 3% → 8%（還沒看過雪橇 16%），90 → 60 秒最多一次；地上還沒有聖誕紅時每滴 25% 長第一株
    if(dry&&!nK('santa')&&chance(.3)) acts.push(()=>{const c=makeCritter('santa',x,y,[x,y]);if(c&&!reduceMotion){c.hoho=now()+700}});
    if(!sleigh&&!document.hidden&&Date.now()-lastSleigh>60000&&chance(found.santaR?.08:.16)) acts.push(startSleigh);
    if(dry&&!plants.some(p=>p.type==='poinsettia')&&chance(.25)) acts.push(()=>{if(!plants.some(p=>p.type==='poinsettia')){const [a,b]=around(x,y,.02,.05);addPoin(a,b)}});
  }
  if(inForest()) forestResidents(x,y,acts,bigTrees,fl,nK,near);
}
// v2.0 水邊樹林的居民（只在森林跑，第一塊地的亂數順序不變）
function forestResidents(x,y,acts,bigTrees,fl,nK,near){
  // 呱呱：睡蓮開了花的水塘（一個水塘最多 2 隻，整塊地最多 2 隻）；石石：水塘邊（一個水塘最多一顆，整塊地最多 2 顆）
  const fp=pondAt(x,y,2.4);
  if(fp){
    const pads=()=>plants.filter(p=>p.type==='lily'&&p.stage>=2&&inPond(fp,p.x,p.y));
    const frogs=()=>critters.filter(c=>c.kind==='frog'&&dist(c.hx,c.hy,fp.x,fp.y)<6).length;
    if(pads().length&&frogs()<2&&nK('frog')<2&&chance(.25)) acts.push(()=>{const l=pads();if(!l.length||frogs()>=2||nK('frog')>=2)return;const q=pick(l);makeCritter('frog',q.x,q.y,[fp.x,fp.y])});
    const rock=()=>critters.some(c=>c.kind==='pebble'&&dist(c.hx,c.hy,fp.x,fp.y)<6)||nK('pebble')>=2;
    if(!rock()&&chance(.18)) acts.push(()=>{if(rock())return;for(let i=0;i<6;i++){const [a,b]=pondEdge(fp);if(!inStream(a,b,1.3)){makeCritter('pebble',a,b,[fp.x,fp.y]);return}}});
  }
  if(bigTrees.length){
    const tr=bigTrees[0], grove=plants.filter(p=>p.type==='tree'&&p.stage===3&&dist(p.x,p.y,tr.x,tr.y)<.25*U).length;
    const spot=()=>{for(let i=0;i<6;i++){const q=around(tr.x,tr.y+.015*U/H,.02,.06);if(!wetAt(q[0],q[1]))return q}return null};
    // 橡橡：兩棵以上大樹長在一起（小樹林）
    if(grove>=2&&nK('acorn')<2&&!near('acorn',.12)&&chance(.15)) acts.push(()=>{if(near('acorn',.12))return;const q=spot();if(q)makeCritter('acorn',q[0],q[1],[tr.x,tr.y+.015*U/H])});
    // 葉葉：大樹下，偶爾有一片葉子醒過來（秋天比較常是楓紅的）
    if(nK('leaf')<2&&!near('leaf',.12)&&chance(.12)) acts.push(()=>{if(near('leaf',.12))return;const q=spot();if(q)makeCritter('leaf',q[0],q[1],[tr.x,tr.y+.015*U/H],{v:Math.random()<(autumn()?.2:.05)?1:0})});
  }
  // 搬搬隊：花開得多的地方，搬來一個小窩
  if(fl.length>=4&&!wetAt(x,y)&&!nK('beans')&&chance(.12)) acts.push(()=>{if(!nK('beans'))makeCritter('beans',x,y,[x,y])});
}
/* ---------- v1.7 十二月：禮物、雪橇、小雪（都只在記憶體） ---------- */
const gifts=[], flakes=[]; let sleigh=null, lastSleigh=0;
function startSleigh(){
  if(sleigh) return;
  lastSleigh=Date.now();
  sleigh={t0:now(),d:reduceMotion?3500:6000,y:.1+Math.random()*.08,gy:.3+Math.random()*.15,seed:Math.random(),drops:[{at:.35},{at:.65}]};
  emit('message','天上飛過一台雪橇！');
  record('santaR'); emit('discover',{kind:'santaR',x:.5,y:sleigh.y,map:activeMap});
}
function snowTick(t,dt){
  if(!december()||reduceMotion){flakes.length=0;return}
  if(flakes.length<Math.min(60,W*H/5000)&&Math.random()<dt*5) flakes.push({x:Math.random(),y:-.02,r:(.6+Math.random()*.8)*S,v:.03+Math.random()*.04,ph:Math.random()*9,end:.55+Math.random()*.45});
  for(let i=flakes.length-1;i>=0;i--){const f=flakes[i];f.y+=f.v*dt;f.x+=Math.sin(t*.001+f.ph)*.0004;if(f.y>f.end)flakes.splice(i,1)}
}
function drawSnow(){
  if(!flakes.length) return;
  ctx.fillStyle='rgba(255,255,255,.85)';
  for(const f of flakes){const k=f.y>f.end-.05?(f.end-f.y)/.05:1;ctx.globalAlpha=Math.max(0,k);ctx.beginPath();ctx.arc(f.x*W,f.y*H,f.r,0,TAU);ctx.fill()}
  ctx.globalAlpha=1;
}
const GIFT=[['#e45c55','#f6d36b'],['#4f9a6a','#f4efe4'],['#5b84c9','#f6d36b'],['#f0c24a','#d8473e']], GIFT_MS=6000;
function drawGift(gf,t){
  const age=t-gf.t0; if(age<0) return;
  const b=2.6*S, X=gf.x*W, gy=gf.y*H; let Y=gy, sc=1, a=1;
  if(gf.fromY!==undefined){const k=Math.min(1,age/700);Y=gf.fromY*H+(gy-gf.fromY*H)*k*k}
  else if(!reduceMotion) sc=easeBack(age/450);
  if(age>GIFT_MS-500) a=Math.max(0,(GIFT_MS-age)/500);
  if(age>GIFT_MS-500&&!gf.poof){gf.poof=1;sparks.push({x:X,y:Y-b*2,t0:t,c:'#f3c645'})}
  const base=ctx.globalAlpha; ctx.save();ctx.globalAlpha=base*a;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,gy,b*1.1,b*.35,0,0,TAU);ctx.fill();
  ctx.translate(X,Y);ctx.scale(sc,sc);
  const [c0,c1]=GIFT[gf.col];
  ctx.fillStyle=c0;ctx.fillRect(-b,-b*2,b*2,b*2);
  ctx.fillStyle='rgba(0,0,0,.12)';ctx.fillRect(b*.35,-b*2,b*.65,b*2);
  ctx.fillStyle=c0;ctx.fillRect(-b*1.12,-b*2.35,b*2.24,b*.5);
  ctx.fillStyle=c1;ctx.fillRect(-b*.2,-b*2.35,b*.4,b*2.35);ctx.fillRect(-b*1.12,-b*2.15,b*2.24,b*.22);
  for(const s of [-1,1]){ctx.beginPath();ctx.ellipse(s*b*.4,-b*2.55,b*.38,b*.22,s*.5,0,TAU);ctx.fill()}
  ctx.restore();
}
function tickDecember(t,dt){
  snowTick(t,dt);
  for(let i=gifts.length-1;i>=0;i--) if(t-gifts[i].t0>GIFT_MS) gifts.splice(i,1);
  if(sleigh&&t-sleigh.t0>sleigh.d) sleigh=null;
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
.map-btn{position:absolute;left:.75rem;top:3.2rem;display:flex;align-items:center;gap:.45rem;font-size:.9rem;color:var(--ink);background:var(--panel);border:0;border-radius:999px;padding:.35rem .9rem;cursor:pointer;opacity:.9}
.map-btn:hover{opacity:1}
.map-btn[hidden]{display:none}
.map-btn .dot{width:8px;height:8px;border-radius:50%;background:var(--wrong)}
.map-btn .dot[hidden]{display:none}
.stale:not([hidden]) ~ .map-btn{display:none}
.guide{position:fixed;inset:0;z-index:20;background:rgba(18,22,14,.5);display:grid;place-items:center;padding:1.25rem;animation:gfade .2s ease-out}
.guide[hidden]{display:none}
@keyframes gfade{from{opacity:0}to{opacity:1}}
.g-sheet{width:min(840px,100%);max-height:min(90vh,920px);background:var(--panel);border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3);animation:gup .28s cubic-bezier(.2,.9,.3,1.1)}
@keyframes gup{from{transform:translateY(16px);opacity:.4}to{transform:none;opacity:1}}
.g-head{display:flex;align-items:flex-start;gap:1rem;padding:1.2rem 1.5rem 1rem;border-bottom:1px solid var(--line)}
.g-head h2{margin:0;font-size:1.45rem}
.g-prog{display:flex;align-items:center;gap:.65rem;margin-top:.4rem;color:var(--muted);font-size:.9rem}
.g-land{margin:.35rem 0 0;color:var(--muted);font-size:.85rem}
.g-foot{border-top:1px solid var(--line);padding:.7rem 1.5rem .9rem;display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .9rem;font-size:.85rem}
.g-bk{display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap;color:var(--muted)}
.g-bk b{color:var(--ink)}
.g-bkbtns{display:flex;gap:.5rem;margin-left:auto}
.g-bkbtns button{border:1px solid var(--line);background:var(--opt);color:var(--ink);border-radius:999px;padding:.35rem .9rem;font:inherit;cursor:pointer}
.g-bknote{flex-basis:100%;margin:0;color:var(--muted);font-size:.78rem;line-height:1.5}
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
  .g-head{padding:1rem 1rem .8rem}.g-body{padding:.25rem 1rem 1.2rem}.g-foot{padding:.6rem 1rem calc(.8rem + env(safe-area-inset-bottom,0px))}.g-bkbtns{margin-left:0}
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
  // v2.0 換地圖的按鈕（水邊樹林開了才出現），放在圖鑑按鈕下面
  const mb=document.createElement('button');
  mb.className='map-btn'; mb.id='mapBtn'; mb.type='button'; mb.hidden=true;
  mb.innerHTML='<span class="ml"></span><i class="dot" hidden></i>';
  land.appendChild(mb);
  const dlg=document.createElement('div');
  dlg.className='guide'; dlg.id='guide'; dlg.hidden=true;
  dlg.setAttribute('role','dialog'); dlg.setAttribute('aria-modal','true'); dlg.setAttribute('aria-labelledby','gTitle');
  dlg.innerHTML='<div class="g-sheet"><header class="g-head"><div><h2 id="gTitle">土地圖鑑</h2>'+
    '<div class="g-prog"><span class="g-track"><i id="gBar"></i></span><span id="gSub"></span></div><p class="g-land" id="gLand"></p></div>'+
    '<button class="g-close" id="gClose" aria-label="關閉圖鑑">×</button></header>'+
    '<div class="g-body" id="gBody"></div>'+
    '<footer class="g-foot"><div class="g-bk"><b>備份</b><span id="gBkInfo"></span></div>'+
    '<div class="g-bkbtns"><button type="button" id="gBkSave">下載備份</button><button type="button" id="gBkLoad">從備份還原</button>'+
    '<input type="file" id="gBkFile" accept=".json,application/json" hidden></div><p class="g-bknote" id="gBkNote"></p></footer></div>';
  document.body.appendChild(dlg);
  Object.assign(G,{guideBtn:btn, mapBtn:mb, gcount:btn.querySelector('.gc'), gdot:btn.querySelector('.dot'), guide:dlg,
    gBar:dlg.querySelector('#gBar'), gSub:dlg.querySelector('#gSub'), gLand:dlg.querySelector('#gLand'), gClose:dlg.querySelector('.g-close'), gBody:dlg.querySelector('.g-body'),
    gBkInfo:dlg.querySelector('#gBkInfo'), gBkSave:dlg.querySelector('#gBkSave'), gBkLoad:dlg.querySelector('#gBkLoad'),
    gBkFile:dlg.querySelector('#gBkFile'), gBkNote:dlg.querySelector('#gBkNote')});
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
  {k:'santa', name:'呵呵公公', art:'critter',kind:'santa',v:0,
   desc:'只在十二月來玩的聖誕公公。點他一下，他會「呵呵」笑，從袋子裡拿禮物給你。',
   hint:'十二月的時候，多澆幾次水看看'},
  {k:'santaR', name:'雪橇', art:'sleigh',rare:true,
   desc:'十二月偶爾從天上飛過的雪橇，麋鹿的鼻子會發紅光，沿路丟下禮物。',
   hint:'十二月的時候，抬頭看看天上'},
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
  {k:'poinsettia', name:'聖誕紅', art:'plant',type:'poinsettia',color:0,ps:.024,
   desc:'只在十二月長。紅紅的不是花瓣，是葉子變的；中間黃綠色的小點點才是花。',
   hint:'十二月的時候，在花草旁邊澆水'},
  {k:'poinsettiaR', name:'白聖誕紅', art:'plant',type:'poinsettia',color:5,ps:.024,rare:true,
   desc:'白色的聖誕紅，很少見。',
   hint:'聖誕紅也有不是紅色的'},
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
  // v2.0 第二塊地「水邊樹林」（開了才顯示；map:'forest'）
  {sec:'水邊樹林',note:'第二塊地才有的居民和植物',map:'forest'},
  {k:'frog', name:'呱呱', art:'critter',kind:'frog',v:0,map:'forest',
   desc:'住在睡蓮葉上的小青蛙，最喜歡從一片葉子跳到另一片。點牠會鼓起喉嚨「呱」一聲。',
   hint:'睡蓮開花了，好像有誰想搬進來'},
  {k:'frogR', name:'粉紅呱呱', art:'critter',kind:'frog',v:1,rare:true,map:'forest',
   desc:'粉紅色的呱呱，叫聲比較細。',
   hint:'呱呱裡面，有一隻顏色不一樣'},
  {k:'pebble', name:'石石', art:'critter',kind:'pebble',v:0,map:'forest',
   desc:'水塘邊的小石頭，背上長了一點苔，幾乎都在睡覺。點它會醒來翻個滾。',
   hint:'水塘邊有一顆石頭，好像在打呼'},
  {k:'pebbleR', name:'花紋石石', art:'critter',kind:'pebble',v:1,rare:true,map:'forest',
   desc:'身上一圈一圈的花紋，像瑪瑙。',
   hint:'石石也有長得特別漂亮的'},
  {k:'acorn', name:'橡橡', art:'critter',kind:'acorn',v:0,map:'forest',
   desc:'從橡樹上掉下來的橡實，戴著一頂小帽子，搖搖擺擺地走。點它會掀帽子打招呼。',
   hint:'好幾棵大樹長在一起的地方'},
  {k:'acornR', name:'金橡橡', art:'critter',kind:'acorn',v:1,rare:true,map:'forest',
   desc:'金色的橡實，偶爾閃一下光。',
   hint:'橡橡裡面，有一顆會發光'},
  {k:'leaf', name:'葉葉', art:'critter',kind:'leaf',v:0,map:'forest',
   desc:'一片醒過來的葉子。風一吹就飛起來，再慢慢晃下來。',
   hint:'大樹底下的落葉，好像在動'},
  {k:'leafR', name:'楓紅葉葉', art:'critter',kind:'leaf',v:1,rare:true,map:'forest',
   desc:'轉紅的葉葉。秋天（10～11 月）比較常見。',
   hint:'秋天的時候，葉葉的顏色會變'},
  {k:'beans', name:'搬搬隊', art:'critter',kind:'beans',v:0,map:'forest',
   desc:'杏、薄荷、薰衣草三隻小豆豆。看到掉下來的花瓣，就一起扛回窩裡。',
   hint:'花開得很多的地方，好像有誰在搬東西'},
  {k:'cattail', name:'香蒲', art:'plant',type:'cattail',color:0,ps:.024,map:'forest',
   desc:'長在水邊的高草，頂端像一根咖啡色的小熱狗。熟了以後穗會爆開飛走。',
   hint:'在小溪或水塘邊澆水'},
  {k:'cattailR', name:'絨毛香蒲', art:'plant',type:'cattail',color:5,ps:.024,rare:true,map:'forest',
   desc:'小熱狗爆開成白絨毛，隨風一點一點飄走。',
   hint:'香蒲裡，有一叢毛茸茸的'},
  {k:'fern', name:'蕨', art:'plant',type:'fern',color:0,ps:.022,map:'forest',
   desc:'從一個小捲捲，慢慢打開成一大叢葉子。',
   hint:'大樹的樹蔭下'},
  {k:'fernR', name:'銀蕨', art:'plant',type:'fern',color:5,ps:.022,rare:true,map:'forest',
   desc:'葉子是銀藍色的蕨。',
   hint:'蕨也有不是綠色的'},
  {k:'lilyvalley', name:'鈴蘭', art:'plant',type:'lilyvalley',color:0,ps:.019,map:'forest',
   desc:'彎彎的花莖上掛著一串小白鈴，風吹會輕輕搖。',
   hint:'大樹的樹蔭下，仔細看看'},
  {k:'lilyvalleyR', name:'粉鈴蘭', art:'plant',type:'lilyvalley',color:5,ps:.019,rare:true,map:'forest',
   desc:'粉紅色的小鈴鐺。',
   hint:'鈴蘭也有不是白色的'},
  {k:'oak', name:'橡樹', art:'tree',tree:'oak',map:'forest',
   desc:'矮矮寬寬的大樹，樹幹粗粗的，長大後樹下會掉幾顆橡實。',
   hint:'水邊樹林的樹苗，一直照顧它'},
  {k:'willow', name:'垂柳', art:'tree',tree:'willow',map:'forest',
   desc:'長在小溪邊的樹，細細的枝條垂下來，風一吹整片晃。',
   hint:'小溪旁邊的樹苗，長大會不一樣'},
];
const G_ITEMS=GUIDE.filter(e=>e.k);
const shownItems=()=>G_ITEMS.filter(e=>!e.map||forestOpen);   // v2.0 水邊樹林的格子開了才算
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
function scanFound(fresh){ // fill in anything already on the land (older saves)；v2.0 fresh＝第一次開水邊樹林，標成「新發現」
  const t=Date.now(), mark=k=>{if(!found[k]){ found[k]=t; if(fresh) newFound[k]=1; }};
  critters.forEach(c=>mark(c.kind+(c.v?'R':'')));
  if(ponds.some(p=>!p.fixed)) mark('pond');
  if(plants.some(p=>p.type==='lily'&&p.stage>=2)) mark('lily');
  plants.filter(p=>p.type==='tree'&&p.stage>=3).forEach(p=>mark(treeKey(p)));
  if(plants.some(p=>p.type==='mushroom')) mark('ring');
  if(plants.some(p=>p.type==='flower'&&p.color===5)) mark('violet');
  if(flies.length) mark('fly');
  for(const k in PKEY){const d=PKEY[k];if(plants.some(p=>p.type===d.type&&(p.color===5)===d.rare&&p.stage>=d.min)) mark(k)}
}
function onLand(key){
  switch(key){
    case 'pond': return ponds.length;
    case 'lily': return plants.filter(p=>p.type==='lily'&&p.stage>=2).length;
    case 'tree': return inForest()?0:plants.filter(p=>p.type==='tree'&&p.stage>=3).length;
    case 'oak': case 'willow': return inForest()?plants.filter(p=>p.type==='tree'&&p.stage>=3&&treeKey(p)===key).length:0;
    case 'ring': return plants.filter(p=>p.type==='tree'&&p.stage>=3&&plants.some(q=>q.type==='mushroom'&&dist(q.x,q.y,p.x,p.y)<.1*U)).length;
    case 'fly': return flies.length;
    case 'violet': return plants.filter(p=>p.type==='flower'&&p.color===5).length;
    case 'santaR': return sleigh?1:0;
    default:
      if(PKEY[key]){const d=PKEY[key];return plants.filter(p=>p.type===d.type&&(p.color===5)===d.rare&&p.stage>=d.min).length}
      return critters.filter(c=>c.kind+(c.v?'R':'')===key).length;
  }
}
const UNIT_WORD={pond:'個',lily:'朵',tree:'棵',ring:'個',fly:'隻',violet:'朵',cloud:'朵',cloudR:'朵',puff:'團',puffR:'團',
  clover:'叢',cloverR:'叢',sunflower:'朵',sunflowerR:'朵',tulip:'朵',tulipR:'朵',pumpkin:'顆',pumpkinR:'顆',
  santa:'位',santaR:'台',poinsettia:'株',poinsettiaR:'株',
  frog:'隻',frogR:'隻',pebble:'顆',pebbleR:'顆',acorn:'顆',acornR:'顆',leaf:'片',leafR:'片',beans:'隊',
  cattail:'叢',cattailR:'叢',fern:'叢',fernR:'叢',lilyvalley:'株',lilyvalleyR:'株',oak:'棵',willow:'棵'};
function updateGuideBtn(){
  const items=shownItems(), n=items.filter(e=>found[e.k]).length;
  G.gcount.textContent=n+'/'+items.length;
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
  else if(c.kind==='pebble'){c.awake=t;c.dir=1;c.rd=0;c.roll=reduceMotion?-1e9:t}   // v2.0 圖鑑裡原地翻一圈
  else if(c.kind==='leaf') c.spin=t;
  else if(c.kind==='acorn'){}   // 掀帽子（畫的時候看 c.poke）
  else{ if(c.kind==='frog') c.croak=t; if(!c.hop&&!reduceMotion) startHop(c,c.x,c.y,t,440,15); }
}
function tickPortraitCritter(c,t){
  if(t>c.blinkAt){c.blinkT=t;c.blinkAt=t+1800+Math.random()*3800}
  if(c.kind==='moss'&&t>c.wakeAt){c.wakeT=t;c.wakeAt=t+7000+Math.random()*8000}
  if(c.hop&&t-c.hop.t0>=c.hop.d){c.hop=null;c.land=t}
  if(c.kind==='dew'&&!c.hop&&!reduceMotion&&t>c.nextHop){startHop(c,c.x,c.y,t,380,8);c.nextHop=t+2500+Math.random()*4000}
  if(c.kind==='bee'&&!reduceMotion&&t>c.nextHop){c.loop=t;c.nextHop=t+3500+Math.random()*3000}
  if(c.kind==='frog'&&!reduceMotion&&t>c.nextHop){c.croak=t;c.nextHop=t+4000+Math.random()*3000}   // v2.0
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
        S=P*({dew:.027,bee:.03,ladybug:.028,puff:.026,cloud:.024,santa:.025,frog:.026,pebble:.026,acorn:.03,leaf:.028,beans:.019}[e.kind]||.024);
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
        S=P*.0105; (e.tree==='oak'?drawOak:e.tree==='willow'?drawWillow:drawTree)({seed:.42},.5*W,.9*H,3,1,t);
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
      case 'sleigh':{
        S=P*.013; drawGrass({seed:.7},.16*W,.92*H,1.5,1,t);drawGrass({seed:.9},.85*W,.9*H,1.5,1,t);
        S=P*.024; drawSleighAt(.32*W,.56*H+(reduceMotion?0:Math.sin(t*.004)*P*.02),t,.4);
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
  const items=shownItems(), n=items.filter(e=>found[e.k]).length;
  G.gSub.textContent='已發現 '+n+' / '+items.length;
  G.gBar.style.width=(n/items.length*100)+'%';
  // v1.5：這塊地有幾株植物（上限 FULL）；長滿了就說明特殊植物會換掉普通草花
  showBackupInfo();
  if(inForest()) G.gLand.textContent='水邊樹林 '+plants.length+' 株・花草會慢慢換新，地不會塞滿';   // v2.0
  else G.gLand.textContent=(plants.length>FULL?'這塊地長滿了（'+plants.length+' 株）・新的特殊植物會取代普通花草':'這塊地 '+plants.length+'／'+FULL+' 株')+
    (forestOpen?'':'・長到 '+OPEN_AT+' 株會開一塊新的地');
  let grid=null;
  for(const e of GUIDE){
    if(e.map&&!forestOpen) continue;   // v2.0 水邊樹林還沒開：那一區先不顯示
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
// v1.4：精修的圓圓樹（照 docs/tree-candidates.html）：樹幹有樹根和陰影面、長大後有分岔樹枝，
// 樹冠分深／中／淺三層、左上受光、底下一圈陰影。只改畫法，存檔裡的樹（type、stage）完全不變。
const TREE_CL=[[-.62,.18,.5],[.6,.2,.5],[0,-.42,.58],[-.36,-.18,.55],[.36,-.2,.55],[0,.22,.6],[-.2,.05,.5],[.22,.02,.5]];
function drawTree(p,X,Y,v,a,time){
  // v1.2：外層可能已設了透明度（居民前面的植物）；這裡設 alpha 的地方都乘上它
  const base=ctx.globalAlpha;
  const s=S*a, cr=Math.max(0,(v-.9))*s*11.5, th=s*(7+v*9), tw=s*(1.1+v*1.25);
  const sway=reduceMotion?0:Math.sin(time*.0008+p.seed*12)*s*.9;
  const blob=(x,y,r,c)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,Math.max(.01,r),0,Math.PI*2);ctx.fill()};
  ctx.fillStyle=PAL.shadow;
  ctx.beginPath();ctx.ellipse(X+cr*.15,Y+s*.8,s*3+cr*1.15,s*1.2+cr*.38,0,0,Math.PI*2);ctx.fill();
  // 樹幹：底部張開成樹根，右半邊一層陰影
  const trunk=()=>{ctx.beginPath();ctx.moveTo(X-tw*1.45,Y);ctx.quadraticCurveTo(X-tw*.75,Y-th*.08,X-tw*.62,Y-th*.3);
    ctx.lineTo(X-tw*.45,Y-th);ctx.lineTo(X+tw*.45,Y-th);ctx.lineTo(X+tw*.62,Y-th*.3);ctx.quadraticCurveTo(X+tw*.75,Y-th*.08,X+tw*1.45,Y);ctx.closePath()};
  ctx.fillStyle=PAL.trunk;trunk();ctx.fill();
  ctx.save();trunk();ctx.clip();ctx.fillStyle=PAL.trunkDark;ctx.globalAlpha=base*.55;ctx.fillRect(X+tw*.1,Y-th-1,tw*2,th+2);ctx.restore();
  if(v>2){
    ctx.strokeStyle=PAL.trunk;ctx.lineCap='round';ctx.lineWidth=tw*.45;
    for(const d of [-1,1]){ctx.beginPath();ctx.moveTo(X,Y-th*.82);ctx.quadraticCurveTo(X+d*tw*1.2,Y-th*.95,X+d*cr*.45+sway*.5,Y-th-cr*.2);ctx.stroke()}
  }
  if(v<1.8){   // 小樹苗頂端三片有葉脈的葉子
    ctx.globalAlpha=base*Math.min(1,(1.8-v)*1.3);
    for(const [dx,dy,rot,c] of [[-3,-.6,.55,PAL.leafHi],[3,-1.6,-.55,PAL.leaf],[0,-3.2,0,PAL.leafHi]]){
      ctx.save();ctx.translate(X+dx*s+sway,Y-th+dy*s);ctx.rotate(rot);
      ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(0,0,s*1.6,s*3.2,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=s*.35;ctx.beginPath();ctx.moveTo(0,s*2.6);ctx.lineTo(0,-s*2.4);ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha=base;
  }
  if(cr>0){
    const cy=Y-th-cr*.3, j=k=>(hash(p.seed,k)-.5)*.12;   // 每棵樹的葉叢位置差一點點
    for(let k=0;k<TREE_CL.length;k++){const [x,y,r]=TREE_CL[k];blob(X+(x+j(k))*cr+sway,cy+(y+j(k+9))*cr+cr*.08,r*cr*1.06,PAL.canopy[2])}
    for(let k=0;k<TREE_CL.length;k++){const [x,y,r]=TREE_CL[k];blob(X+(x+j(k))*cr+sway,cy+(y+j(k+9))*cr,r*cr,PAL.canopy[1])}
    for(let k=0;k<TREE_CL.length;k++){const [x,y,r]=TREE_CL[k];if(y<.15)blob(X+(x+j(k)-.08)*cr+sway,cy+(y+j(k+9)-.1)*cr,r*cr*.66,PAL.canopy[0])}
    blob(X-cr*.3+sway,cy-cr*.42,cr*.3,PAL.canopyHi);blob(X-cr*.55+sway,cy-cr*.02,cr*.18,PAL.canopyHi);
    ctx.globalAlpha=base*.5;
    for(let i=0;i<9;i++) blob(X+(hash(p.seed,i+30)-.6)*cr*1.2+sway,cy+(hash(p.seed,i+40)-.7)*cr*.9,cr*.05,'#b5d07e');
    ctx.globalAlpha=base*.25;ctx.fillStyle='#2a3a1c';ctx.beginPath();ctx.ellipse(X+sway*.5,cy+cr*.62,cr*.6,cr*.14,0,0,Math.PI*2);ctx.fill();
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
/* ---------- v2.0 水邊樹林的植物：香蒲、蕨、鈴蘭（照 docs/new-guide-candidates.html；畫在原點、腳在 (0,0)） ---------- */
const qp=(a,c,b,k)=>[(1-k)*(1-k)*a[0]+2*(1-k)*k*c[0]+k*k*b[0],(1-k)*(1-k)*a[1]+2*(1-k)*k*c[1]+k*k*b[1]];
const qt=(a,c,b,k)=>{const x=2*(1-k)*(c[0]-a[0])+2*k*(b[0]-c[0]),y=2*(1-k)*(c[1]-a[1])+2*k*(b[1]-c[1]),l=Math.hypot(x,y)||1;return [x/l,y/l]};
function drawLilyvalley(g,v,s,t,seed,rare){
  const X=0,Y=0,Lh=s*(6+v*3.4);
  for(const [d,c] of [[-1,'#5f8a3a'],[1,'#6f9a45']]){
    g.save();g.translate(X+d*s*.8,Y);g.rotate(d*.18);
    g.fillStyle=c;g.beginPath();g.moveTo(0,0);g.bezierCurveTo(d*s*3.6,-Lh*.3,d*s*3,-Lh*.85,d*s*.6,-Lh);g.bezierCurveTo(-d*s*1.4,-Lh*.6,-d*s*1.2,-Lh*.25,0,0);g.fill();
    g.strokeStyle='rgba(255,255,255,.25)';g.lineWidth=s*.35;g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(d*s*1.2,-Lh*.5,d*s*.6,-Lh*.95);g.stroke();
    g.restore();
  }
  if(v<1.4) return;
  const gk=clamp((v-1.4)/.8,0,1), a=[X+s*.5,Y], c=[X+s*1.8,Y-Lh*1.45], b=[X+s*9.5,Y-Lh*.78];
  g.strokeStyle='#6b9a3c';g.lineWidth=s*.7;g.lineCap='round';g.beginPath();g.moveTo(a[0],a[1]);
  for(let i=1;i<=16;i++){const p=qp(a,c,b,i/16*(.5+.5*gk));g.lineTo(p[0],p[1])}g.stroke();
  const open=clamp((v-2.3)/.7,0,1);
  for(let i=0;i<5;i++){
    const k=.5+i*.11; if(k>.5+.5*gk) continue;
    const p=qp(a,c,b,k), sz=s*(2.1-i*.25), sw=reduceMotion?0:Math.sin(t*.0022+seed*4+i*.8)*.18;
    g.save();g.translate(p[0],p[1]);g.rotate(sw);
    g.strokeStyle='#6b9a3c';g.lineWidth=s*.35;g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(s*.4,s*.5,0,s*1.1);g.stroke();
    g.translate(0,s*1.1+sz*.75);
    if(open<=0){g.fillStyle='#9cc266';g.beginPath();g.arc(0,0,sz*.45,0,TAU);g.fill()}
    else{const b2=sz*(.55+.45*open);
      g.fillStyle=rare?'#f6bfd0':'#fbf8ef';g.strokeStyle='rgba(60,70,40,.18)';g.lineWidth=s*.3;
      g.beginPath();g.moveTo(-b2*.7,b2*.55);g.quadraticCurveTo(-b2*.85,-b2*.75,0,-b2*.75);g.quadraticCurveTo(b2*.85,-b2*.75,b2*.7,b2*.55);
      g.quadraticCurveTo(b2*.48,b2*.95,b2*.23,b2*.6);g.quadraticCurveTo(0,b2*.95,-b2*.23,b2*.6);g.quadraticCurveTo(-b2*.48,b2*.95,-b2*.7,b2*.55);
      g.fill();g.stroke();}
    g.restore();
  }
}
function drawCattail(g,v,s,t,seed,rare){
  const X=0,Y=0,base=g.globalAlpha;
  g.lineCap='round';
  for(let i=0;i<5;i++){
    const h=s*(8+v*5)*(.75+hash(seed,i)*.4), off=(i-2)*s*1.3, lean=(hash(seed,i+7)-.5)*s*7+off*.8;
    const sw=reduceMotion?0:Math.sin(t*.0012+seed*9+i*.6)*s*1.2;
    g.strokeStyle=['#6b8a3c','#7f9c47','#5f7f36'][i%3];g.lineWidth=s*1.3;
    g.beginPath();g.moveTo(X+off,Y);g.quadraticCurveTo(X+off+lean*.2,Y-h*.6,X+off+lean+sw,Y-h);g.stroke();
  }
  if(v<1.5) return;
  const open=clamp((v-2.3)/.7,0,1);
  for(const [dx,f] of [[-1.2,1],[2.2,.86]]){
    const Hs=s*(9+(v-1.5)*13)*f, sw=reduceMotion?0:Math.sin(t*.001+seed*5+dx)*s*.9, tx=X+dx*s+sw, ty=Y-Hs;
    g.strokeStyle='#6b8a3c';g.lineWidth=s*.8;g.beginPath();g.moveTo(X+dx*s,Y);g.lineTo(tx,ty);g.stroke();
    if(open<=0){g.strokeStyle='#8fae52';g.lineWidth=s*1.3;g.beginPath();g.moveTo(tx,ty+s*5);g.lineTo(tx,ty+s*1.2);g.stroke();continue}
    const hl=s*(3.5+3.5*open), hw=s*(1.3+1.1*open), hy=ty+s*1.6;
    g.lineWidth=s*.4;g.beginPath();g.moveTo(tx,hy);g.lineTo(tx,ty-s*1.5);g.stroke();
    if(rare&&open>.6){   // 絨毛香蒲：穗爆開成白絨毛，一點一點飄走
      for(let i=0;i<14;i++){const a=hash(seed,i+30)*TAU,rr=hw*(.8+hash(seed,i+40)*.6);g.fillStyle=i%2?'#f6f1e6':'#e9e1d0';g.beginPath();g.arc(tx+Math.cos(a)*rr*.7,hy+hl/2+Math.sin(a)*hl*.55,hw*.55,0,TAU);g.fill()}
      if(!reduceMotion) for(let i=0;i<5;i++){const k=((t*.00018)+i/5+dx)%1, fx=tx+k*s*22+Math.sin(k*9+i)*s*2, fy=hy+hl*.3-k*s*16;
        g.globalAlpha=base*Math.sin(Math.PI*k)*.9;g.fillStyle='#fff';g.beginPath();g.arc(fx,fy,s*.45,0,TAU);g.fill();
        g.strokeStyle='#fff';g.lineWidth=s*.2;g.beginPath();for(let j=0;j<4;j++){const a=-Math.PI/2+(j-1.5)*.45;g.moveTo(fx,fy);g.lineTo(fx+Math.cos(a)*s*1.4,fy+Math.sin(a)*s*1.4)}g.stroke();g.globalAlpha=base}
    }else{
      g.fillStyle='#7a4e2c';g.beginPath();g.ellipse(tx,hy+hl/2,hw/2,hl/2,0,0,TAU);g.fill();
      g.fillStyle='rgba(255,255,255,.2)';g.beginPath();g.ellipse(tx-hw*.18,hy+hl*.4,hw*.12,hl*.3,0,0,TAU);g.fill();
    }
  }
}
function drawFern(g,v,s,t,seed,rare){
  const X=0,Y=0,col=rare?'#93b2c2':'#6f9e45', col2=rare?'#c4dae4':'#8fbe5c';
  const curl=(x,y,R,dir)=>{g.beginPath();for(let a=0;a<TAU*1.5;a+=.18){const rr=R*(1-a/(TAU*1.7));g.lineTo(x+dir*Math.cos(a+Math.PI)*rr,y+Math.sin(a+Math.PI)*rr)}g.stroke()};
  g.lineCap='round';
  if(v<1.6){
    const h=s*(4+v*3),sw=reduceMotion?0:Math.sin(t*.0015+seed*7)*s*.4;
    g.strokeStyle=col;g.lineWidth=s*1.1;g.beginPath();g.moveTo(X,Y);g.quadraticCurveTo(X-s,Y-h*.6,X+sw,Y-h);g.stroke();
    g.lineWidth=s*1.2;curl(X+sw+s*1.2,Y-h-s*.2,s*1.8,1);
    g.fillStyle=col2;for(let i=0;i<5;i++){g.beginPath();g.arc(X+sw+s*1.2+(hash(seed,i)-.5)*s*2,Y-h+(hash(seed,i+5)-.5)*s*2,s*.25,0,TAU);g.fill()}
    return;
  }
  const n=v<2.5?3:5, u=clamp((v-1.6)/1.2,0,1);
  for(let i=0;i<n;i++){
    const off=i-(n-1)/2, ang=-Math.PI/2+off*.5, Lf=s*(9+9*u)*(1-.1*Math.abs(off));
    const sw=reduceMotion?0:Math.sin(t*.0011+seed*9+i)*s*.8;
    const a=[X,Y], c=[X+Math.cos(ang)*Lf*.5,Y+Math.sin(ang)*Lf*.85], b=[X+Math.cos(ang)*Lf*1.15+sw,Y+Math.sin(ang)*Lf*.55+Lf*.1*Math.abs(Math.cos(ang))];
    const reach=.55+.45*u, m=11;
    g.strokeStyle=col;g.lineWidth=s*.7;g.beginPath();g.moveTo(X,Y);
    for(let j=1;j<=20;j++){const p=qp(a,c,b,j/20*reach);g.lineTo(p[0],p[1])}g.stroke();
    for(let j=2;j<m;j++){
      const k=j/m*reach, p=qp(a,c,b,k), d=qt(a,c,b,k), size=s*(1.9*(1-j/m)+.5);
      for(const sd of [-1,1]){g.fillStyle=sd>0?col:col2;g.save();g.translate(p[0],p[1]);g.rotate(Math.atan2(d[1],d[0])+sd*1.1);
        g.beginPath();g.ellipse(size*.55,0,size*.6,size*.24,0,0,TAU);g.fill();g.restore()}
    }
    if(u<1){const p=qp(a,c,b,reach);g.lineWidth=s*.8;curl(p[0],p[1],s*1.4*(1-u)+s*.3,Math.cos(ang)>=0?1:-1)}
  }
}
/* ---------- v2.0 水邊樹林的樹：橡樹、垂柳（照 docs/tree-candidates.html）。存檔裡一樣是 type 'tree'，看位置決定畫哪一種 ---------- */
function treeTrunk(X,Y,th,tw,c,dark,lean){
  const base=ctx.globalAlpha;
  const path=()=>{ctx.beginPath();ctx.moveTo(X-tw*1.45,Y);ctx.quadraticCurveTo(X-tw*.75,Y-th*.08,X-tw*.62,Y-th*.3);
    ctx.lineTo(X-tw*.45+lean,Y-th);ctx.lineTo(X+tw*.45+lean,Y-th);ctx.lineTo(X+tw*.62,Y-th*.3);ctx.quadraticCurveTo(X+tw*.75,Y-th*.08,X+tw*1.45,Y);ctx.closePath()};
  ctx.fillStyle=c;path();ctx.fill();
  ctx.save();path();ctx.clip();ctx.fillStyle=dark;ctx.globalAlpha=base*.55;ctx.fillRect(X+tw*.1+lean*.5,Y-th-1,tw*2,th+2);ctx.restore();
}
function sproutLeaves(X,Y,s,col,col2,k,swv){   // 小樹苗頂端的三片葉子（有葉脈）
  const base=ctx.globalAlpha; ctx.globalAlpha=base*k;
  for(const [dx,dy,rot,c] of [[-3,-.6,.55,col],[3,-1.6,-.55,col2],[0,-3.2,0,col]]){
    ctx.save();ctx.translate(X+dx*s+swv,Y+dy*s);ctx.rotate(rot);
    ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(0,0,s*1.6,s*3.2,0,0,TAU);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=s*.35;ctx.beginPath();ctx.moveTo(0,s*2.6);ctx.lineTo(0,-s*2.4);ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha=base;
}
const tblob=(x,y,r,c)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,Math.max(.01,r),0,TAU);ctx.fill()};
const OAK_CL=[[-1,.15,.42],[-.55,-.2,.5],[0,-.32,.55],[.55,-.18,.5],[1,.15,.42],[-.45,.2,.45],[.45,.22,.45],[0,.12,.5]];
function drawOak(p,X,Y,v,a,time){
  const base=ctx.globalAlpha, s=S*a, seed=p.seed;
  const cr=Math.max(0,v-.9)*s*11, th=s*(6+v*8), tw=s*(1.5+v*1.55), w=reduceMotion?0:Math.sin(time*.0008+seed*12)*s*.7;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X,Y+s*.8,s*3+cr*1.35,s*1.2+cr*.36,0,0,TAU);ctx.fill();
  treeTrunk(X,Y,th,tw,'#6b4f35','#45311f',0);
  if(v>1.7){ctx.strokeStyle='#6b4f35';ctx.lineCap='round';
    for(const [d,h,lw] of [[-1,.75,.55],[1,.7,.5],[0,1,.45]]){ctx.lineWidth=tw*lw;ctx.beginPath();ctx.moveTo(X,Y-th*.9);
      ctx.quadraticCurveTo(X+d*cr*.3,Y-th-cr*.1,X+d*cr*.75*h+w*.5,Y-th-cr*(d?.25:.55));ctx.stroke()}}
  if(v<1.8) sproutLeaves(X,Y-th,s,'#6d8c44','#5b7a3a',Math.min(1,(1.8-v)*1.3),w);
  if(cr<=0) return;
  const cy=Y-th-cr*.55;
  for(const [x,y,r] of OAK_CL) tblob(X+x*cr*.8+w,cy+y*cr+cr*.08,r*cr*1.05,'#3f5428');
  for(const [x,y,r] of OAK_CL) tblob(X+x*cr*.8+w,cy+y*cr,r*cr,'#56703a');
  for(const [x,y,r] of OAK_CL) if(y<0) tblob(X+(x*.8-.06)*cr+w,cy+(y-.1)*cr,r*cr*.62,'#6d8a47');
  tblob(X-cr*.35+w,cy-cr*.45,cr*.24,'#8aa45c');tblob(X+cr*.2+w,cy-cr*.52,cr*.16,'#8aa45c');
  ctx.globalAlpha=base*.22;ctx.fillStyle='#2a3a1c';ctx.beginPath();ctx.ellipse(X+w*.5,cy+cr*.55,cr*.85,cr*.13,0,0,TAU);ctx.fill();ctx.globalAlpha=base;
  if(v>2.6){const k=clamp((v-2.6)/.4,0,1);   // 樹下的橡實
    for(const [dx,dy] of [[-.7,.1],[.55,.25],[.85,-.05]]){const ax=X+dx*cr,ay=Y+dy*s*3,r=s*1.7*k;
      ctx.fillStyle='#c98b4b';ctx.beginPath();ctx.ellipse(ax,ay-r,r*.8,r,0,0,TAU);ctx.fill();
      ctx.fillStyle='#7a5a36';ctx.beginPath();ctx.ellipse(ax,ay-r*1.7,r*.95,r*.5,0,Math.PI,0);ctx.fill()}}
}
function drawWillow(p,X,Y,v,a,time){
  const base=ctx.globalAlpha, s=S*a, seed=p.seed;
  const cr=Math.max(0,v-.9)*s*9.5, th=s*(8+v*10), tw=s*(1+v*1.1), lean=(hash(seed,1)-.5)*s*6;
  ctx.fillStyle=PAL.shadow;ctx.beginPath();ctx.ellipse(X+lean*.5,Y+s*.8,s*3+cr*1.15,s*1.2+cr*.35,0,0,TAU);ctx.fill();
  treeTrunk(X,Y,th,tw,'#6e5438','#48351f',lean);
  const tx=X+lean, ty=Y-th, w=reduceMotion?0:Math.sin(time*.0008+seed*12);
  const strand=(x0,y0,len,bow,c,lw)=>{   // 一條垂下來的細枝，上面一片一片的小葉子
    const ex=x0+bow*s*2+w*s*2.2*(len/(s*30)), ey=y0+len;
    ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(x0,y0);ctx.quadraticCurveTo(x0+bow*s*5,y0+len*.35,ex,ey);ctx.stroke();
    ctx.fillStyle=c;for(let k=.25;k<1;k+=.14){const px=(1-k)*(1-k)*x0+2*(1-k)*k*(x0+bow*s*5)+k*k*ex,py=(1-k)*(1-k)*y0+2*(1-k)*k*(y0+len*.35)+k*k*ey;
      ctx.beginPath();ctx.ellipse(px+(k*7%2?s*.7:-s*.7),py,s*.55,s*1.3,(k*7%2?-.5:.5),0,TAU);ctx.fill()}
  };
  ctx.lineCap='round';
  if(v<1.8){ctx.globalAlpha=base*Math.min(1,(1.8-v)*1.3);
    for(const d of [-1,0,1]) strand(tx+d*s*1.5,ty,s*(6+v*2),d,'#8fae52',s*.6);ctx.globalAlpha=base}
  if(cr<=0) return;
  const cy=ty-cr*.2, rx=cr*.95, ry=cr*.5, n=16;
  for(let i=0;i<n;i++){const f=i/(n-1)*2-1;   // 後排（深）
    strand(tx+f*rx*.85,cy+ry*.3*(1-f*f),cr*(1.3+hash(seed,i)*.5)*(1-.25*Math.abs(f)),f*1.2,'#6f8f3e',s*.7)}
  ctx.fillStyle='#6f8f3e';ctx.beginPath();ctx.ellipse(tx,cy,rx*.9,ry,0,0,TAU);ctx.fill();
  for(const [x,y,r] of [[-.45,-.1,.42],[.4,-.05,.4],[0,-.45,.45],[-.15,.1,.4],[.2,.12,.38]]) tblob(tx+x*rx,cy+y*ry,r*rx,'#7f9f48');
  for(let i=0;i<n;i++){const f=(i+.5)/n*2-1, top=cy-ry*.75*Math.sqrt(1-f*f*.8);   // 前排（亮），從樹冠上半部垂下
    strand(tx+f*rx*.82,top,cr*(.85+hash(seed,i+20)*1.0)*(1-.25*Math.abs(f)),f*.9,['#8fae52','#97b456','#aac868'][i%3],s*.75)}
  ctx.globalAlpha=base*.6;tblob(tx-rx*.3,cy-ry*.6,rx*.18,'#bcd47e');ctx.globalAlpha=base;
}
// 小溪（畫進土地的底圖 ground，只畫一次）
function drawStream(g){
  const st=stream, w=st.w*U, p=st.pts.map(([x,y])=>[x*W,y*H]);
  const path=()=>{g.beginPath();g.moveTo(p[0][0],p[0][1]);
    for(let i=1;i<p.length-1;i++){const mx=(p[i][0]+p[i+1][0])/2,my=(p[i][1]+p[i+1][1])/2;g.quadraticCurveTo(p[i][0],p[i][1],mx,my)}
    g.lineTo(p[p.length-1][0],p[p.length-1][1])};
  g.lineCap='round';g.lineJoin='round';g.globalAlpha=1;
  path();g.strokeStyle=PAL.pondRim;g.lineWidth=w*2.3;g.stroke();
  path();g.strokeStyle=PAL.pond;g.lineWidth=w*2;g.stroke();
  g.globalAlpha=.45;path();g.strokeStyle=PAL.pondDeep;g.lineWidth=w*.8;g.stroke();
  g.globalAlpha=.35;g.strokeStyle='#fff';g.lineWidth=1.2*S;
  for(let i=1;i<st.pts.length-1;i++){const [x,y]=st.pts[i];g.beginPath();g.moveTo(x*W-w*.6,y*H-w*.2);g.quadraticCurveTo(x*W-w*.2,y*H-w*.45,x*W+w*.2,y*H-w*.25);g.stroke()}
  g.globalAlpha=1;
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
    const p=critterPos(c,t), r=CR[c.kind]*S*(c.kind==='beans'?2.2:1);   // 搬搬隊三隻排開，透明的範圍寬一點
    const k=t-(c.reveal||-1e9);
    out.push({cx:p.cx, cy:p.cy, top:p.cy-p.lift-r*2.5, r, fresh:k<REVEAL_MS?1-k/REVEAL_MS:0});
  }
  return out;
}
const PLANT_BOX={grass:[7,24],flower:[8,34],tree:[29,95],mushroom:[4,8],clover:[9,17],sunflower:[10,42],tulip:[9,33],pumpkin:[12,15],poinsettia:[11,26],
  cattail:[8,34],fern:[22,22],lilyvalley:[14,26]};   // [half width, height] in S units（v2.0 香蒲、蕨、鈴蘭）
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
  tree:    {draw:(p,X,Y,a,t)=>(inForest()?(isWillow(p)?drawWillow:drawOak):drawTree)(p,X,Y,p.v,a,t)},   // v2.0 水邊樹林：靠溪的是垂柳，其他是橡樹
  mushroom:{draw:(p,X,Y,a)=>drawMushroom(p,X,Y,a)},
  lily:    {draw:(p,X,Y,a)=>drawLily(p,X,Y,p.v,a)},
  clover:   {draw:(p,X,Y,a,t)=>drawNewPlant(drawClover,p,X,Y,a,t,1.5)},
  sunflower:{draw:(p,X,Y,a,t)=>drawNewPlant(drawSunflower,p,X,Y,a,t,1)},
  tulip:    {draw:(p,X,Y,a,t)=>drawNewPlant(drawTulip,p,X,Y,a,t,1.3)},
  pumpkin:  {draw:(p,X,Y,a,t)=>drawNewPlant(drawPumpkin,p,X,Y,a,t,1.1)},
  poinsettia:{draw:(p,X,Y,a,t)=>drawNewPlant(drawPoinsettia,p,X,Y,a,t,1.9)},
  cattail:  {draw:(p,X,Y,a,t)=>drawNewPlant(drawCattail,p,X,Y,a,t,1.05)},
  fern:     {draw:(p,X,Y,a,t)=>drawNewPlant(drawFern,p,X,Y,a,t,1.3)},
  lilyvalley:{draw:(p,X,Y,a,t)=>drawNewPlant(drawLilyvalley,p,X,Y,a,t,1.5)},
};

let layer=null, lctx=null;
function drawLayered(fn,X,Y,alpha){
  const hw=Math.ceil(42*S), up=Math.ceil(112*S), down=Math.ceil(14*S), pw=Math.ceil(hw*2*DPR), ph=Math.ceil((up+down)*DPR);
  if(!layer){layer=document.createElement('canvas');lctx=layer.getContext('2d')}
  if(layer.width<pw||layer.height<ph){layer.width=Math.max(layer.width,pw);layer.height=Math.max(layer.height,ph)}
  lctx.setTransform(1,0,0,1,0,0);lctx.clearRect(0,0,pw,ph);
  lctx.setTransform(DPR,0,0,DPR,(hw-X)*DPR,(up-Y)*DPR);lctx.globalAlpha=1;
  const sv=ctx; ctx=lctx; try{fn()}finally{ctx=sv}
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=alpha;
  ctx.drawImage(layer,0,0,pw,ph,Math.round((X-hw)*DPR),Math.round((Y-up)*DPR),pw,ph);ctx.restore();
}
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
  if(petals.length) drawPetals();
  // lily pads lie flat on the water, so they go under everything standing
  const flat=plants.filter(p=>p.type==='lily'), up=plants.filter(p=>p.type!=='lily').concat(critters).sort((a,b)=>a.y-b.y);
  const views=critterViews(t);
  for(const p of flat.concat(up)){
    if(p.kind){ drawCritter(p,t); continue; }
    const a=reduceMotion?1:Math.max(.001,easeBack((t-p.born)/700));
    const X=p.x*W,Y=p.y*H;
    let fade=views.length&&p.type!=='lily'?foliageAlpha(p,X,Y,views):1;
    if(p.type==='tree'&&!treeZone(p.x,p.y)) fade=Math.min(fade,1-.55*clamp((p.v-1.2)/1.6,0,1));   // v1.7：樹區外的大樹半透明，後面的花草看得到
    const sp=SPECIES[p.type];
    if(sp&&p.type==='tree'&&fade<.999) drawLayered(()=>sp.draw(p,X,Y,a,t),X,Y,fade);   // v1.7：整棵樹先畫好再一起變淡（樹冠一團一團疊著，直接設透明度會疊回不透明）
    else{ ctx.globalAlpha=fade; if(sp) sp.draw(p,X,Y,a,t); ctx.globalAlpha=1; }
  }
  for(const gf of gifts) drawGift(gf,t);
  for(const f of flies) drawFly(f,t);
  drawSleigh(t);
  drawSparks(t);
  if(!withHover) return;
  drawSnow();
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
  tickDecember(now(),dt);
  paint(t,true);
  renderPortraits(t);
  requestAnimationFrame(frame);
}


bindMap();

/* ================= v2.0 兩塊地：開門、切換 ================= */
let forestSeen=false;   // 去過水邊樹林沒（還沒去過，切換鈕上有小紅點）
function withMap(name,fn){ const sv=activeMap; activeMap=name; bindMap(); try{ return fn(); }finally{ activeMap=sv; bindMap(); } }
// 開門提示要短：頁面的 toast 不換行，手機 390 寬要放得下
function openForest(quiet){
  if(forestOpen) return;
  forestOpen=true;
  if(!maps.forest){ maps.forest=newMapData(); seedForest(maps.forest); }
  withMap('forest',()=>scanFound(!quiet));   // 開局就有的橡樹、香蒲、蕨…登錄圖鑑（標成新發現）
  updateMapBtn(); updateGuideBtn();
  writeNow();   // 立刻寫（不用 save() 的 250ms 延遲）：別的分頁才會馬上看到森林 key，也不會把剛答完那題的存檔再往後延
  if(!quiet){ emit('message','開了一塊新的地：水邊樹林！'); emit('mapopen',{map:'forest'}); }
}
// 換地圖：還有水滴在半空中、或還沒長完時，等它長完再換（這段時間不接新的水滴）
function switchMap(name){
  if(name===activeMap||!maps[name]||(name==='forest'&&!forestOpen)) return false;
  const wait=busyUntil-now();
  if(wait>0){ if(!switching){ switching=true; setTimeout(()=>{ switching=false; switchMap(name); },wait+30); } return true; }
  gen++;
  for(const a of [falls,rings,sparks,puffSeeds,gifts,petals]) a.length=0;
  sleigh=null; hover=null;
  activeMap=name; bindMap(); buildGround();
  if(name==='forest') forestSeen=true;
  updateMapBtn(); updateHint(); save();
  emit('map',{map:name});
  return true;
}
function updateMapBtn(){
  const b=G.mapBtn; b.hidden=!forestOpen;
  b.querySelector('.ml').textContent=inForest()?'← 回第一塊地':'去水邊樹林 →';
  b.querySelector('.dot').hidden=forestSeen||inForest();
}
G.mapBtn.onclick=()=>switchMap(inForest()?'home':'forest');

/* ================= 存檔 =================
   第一塊地：寫回頁面原本的 key，v1 格式不變（一律從 maps.home 寫，不管現在在哪塊地）。
   這個 key 只有 world 會寫（單一寫入者）。題庫進度欄位由頁面的 getProgress() 提供，依原本順序排在 water 後面。
   v2.0 水邊樹林：寫在 FKEY（KEY+'.forest'），開門以後每次一起寫。 */
let saveT=null, ready=false, frozen=false;   // ready：load() 之後才准寫；frozen：頁面判定別的分頁改過存檔
const critterRow=c=>[c.kind,+c.x.toFixed(4),+c.y.toFixed(4),+c.seed.toFixed(6),c.v,+c.hx.toFixed(4),+c.hy.toFixed(4)];
const wetRows=m=>m.wets.slice(-400).map(w=>[+w.x.toFixed(4),+w.y.toFixed(4),+w.r.toFixed(1)]);
const flyRows=m=>m.flies.map(f=>[+f.x.toFixed(4),+f.y.toFixed(4),+f.seed.toFixed(6),f.c]);
function serialize(){
  const p=cfg.getProgress ? cfg.getProgress() : {}, m=maps.home;
  return JSON.stringify({
    v:1, water, ...p,
    plants:m.plants.map(p=>[p.type,+p.x.toFixed(4),+p.y.toFixed(4),p.stage,p.color,+p.seed.toFixed(6)]),
    wets:wetRows(m),
    ponds:m.ponds.map(p=>[+p.x.toFixed(4),+p.y.toFixed(4),+p.r.toFixed(4)]),
    flies:flyRows(m),
    critters:m.critters.filter(c=>!GUEST[c.kind]).map(critterRow).concat(m.keep), seenKinds, found, newFound
  });
}
// 水邊樹林的存檔：植物多一欄「第幾滴長出來的」（輪替用）；小溪和開局的小水潭每次從 LAYOUT 重建，不存
function serializeForest(){
  const m=maps.forest;
  return JSON.stringify({
    v:1, map:activeMap, seen:forestSeen?1:0, n:m.n,
    plants:m.plants.map(p=>[p.type,+p.x.toFixed(4),+p.y.toFixed(4),p.stage,p.color,+p.seed.toFixed(6),p.nb|0]),
    wets:wetRows(m),
    ponds:m.ponds.filter(p=>!p.fixed).map(p=>[+p.x.toFixed(4),+p.y.toFixed(4),+p.r.toFixed(4)]),
    flies:flyRows(m),
    critters:m.critters.filter(c=>!GUEST[c.kind]).map(critterRow).concat(m.keep)
  });
}
function writeNow(){
  clearTimeout(saveT);
  if(!ready||frozen) return;
  let err=null;
  try{ localStorage.setItem(KEY,serialize()); }catch(e){ err=e; }
  if(forestOpen&&maps.forest){ try{ localStorage.setItem(FKEY,serializeForest()); }catch(e){ err=err||e; } }
  if(err){ emit('saveerror',err); return; }      // 不再靜靜吞掉：頁面會持續顯示警告，直到下一次寫入成功
  emit('saved');
}
function save(){ clearTimeout(saveT); saveT=setTimeout(writeNow,250); }
addEventListener('pagehide',writeNow);          // 答完馬上離開也不漏存最後一筆
addEventListener('storage',e=>{
  if(e.key===KEY||e.key===FKEY||e.key===null) emit('external',e);   // 別的分頁（或 Painless 匯入備份）改了存檔；要不要停寫由頁面決定
});
// 讀進目前綁定的這塊地
function readLand(d,forest){
  (d.plants||[]).forEach(a=>{if(!Array.isArray(a)) return; const p={type:a[0],x:a[1],y:a[2],stage:a[3],v:a[3],color:a[4],seed:a[5],born:-1e9}; if(forest) p.nb=a[6]|0; plants.push(p)});
  (d.wets||[]).forEach(a=>wets.push({x:a[0],y:a[1],r:a[2],t0:-1e9}));
  (d.ponds||[]).forEach(a=>ponds.push({x:a[0],y:a[1],r:a[2],born:-1e9}));
  (d.flies||[]).forEach(a=>flies.push({x:a[0],y:a[1],seed:a[2],c:a[3],born:-1e9}));
  (d.critters||[]).forEach(a=>{if(!Array.isArray(a)) return; if(GUEST[a[0]]) return; if(CR[a[0]]) makeCritter(a[0],a[1],a[2],[a[5],a[6]],{seed:a[3],v:a[4],born:-1e9,quiet:true}); else keepCritters.push(a)});
}
// 讀檔：第一塊地放進 maps.home，回傳整包存檔物件（沒有存檔回傳 null）讓頁面還原題庫進度
function load(){
  let d=null;
  try{d=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
  if(d){
    water=Math.max(0,d.water|0);
    readLand(d,false);
    if(d.seenKinds&&typeof d.seenKinds==='object') seenKinds=d.seenKinds;
    if(d.found&&typeof d.found==='object') found=d.found;
    if(d.newFound&&typeof d.newFound==='object') newFound=d.newFound;
  }
  scanFound();          // 舊存檔沒有 found：從現有土地補登（例如已經有水塘就記為已發現）
  // v2.0 水邊樹林：森林 key 存在＝已經開門
  let fd=null;
  try{fd=JSON.parse(localStorage.getItem(FKEY)||'null')}catch(e){}
  if(fd&&typeof fd==='object'&&Array.isArray(fd.plants)){
    const m=maps.forest=newMapData(); fixedPond(m); m.n=Math.max(0,fd.n|0);
    forestOpen=true; forestSeen=!!fd.seen;
    withMap('forest',()=>{ readLand(fd,true); scanFound(); });
    if(fd.map==='forest'){ activeMap='forest'; bindMap(); }
  }
  updateGuideBtn(); updateMapBtn(); buildGround();
  ready=true;
  // 已經超過 300 株的舊存檔：打開頁面就開門（等頁面畫好再說，提示才看得到）
  if(!forestOpen&&maps.home.plants.length>=OPEN_AT) setTimeout(()=>openForest(false),1500);
  return d;
}

/* ================= 清空土地 ================= */
// v2.0 只清現在這塊地；清水邊樹林＝回到開局，地不會關掉。水照舊歸零。
function reset(){
  gen++;
  for(const a of [plants,wets,ponds,flies,falls,rings,critters,sparks,keepCritters,puffSeeds,gifts,flakes,petals]) a.length=0;
  sleigh=null;
  if(inForest()){ maps.forest.n=0; seedForest(maps.forest); }
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

/* ================= v1.5 進度備份 =================
   手機容量不夠時瀏覽器可能清掉 localStorage（iPAS 花園就這樣不見過）。
   備份檔＝這一頁存檔 key 的原始字串（頁面自己的欄位，例如 iPAS 的 starred/picks，也原樣帶著），外面包一層說明。
   還原：先 frozen 擋住 pagehide 的 writeNow（不然記憶體裡的舊土地會把剛寫進去的備份蓋回去），寫入後重新載入。 */
const BK_APP='one-drop-backup', BK_AT=KEY+'.backupAt';
const BK_NAME={'pg.drop.v1':'GRE','drop-vocab-v1':'單字','ipas-drop-v1':'iPAS'};
const bkName=k=>BK_NAME[k]||k;
const fmtDay=ms=>{const d=new Date(ms);return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()};
function showBackupInfo(){
  let at=null; try{ at=+localStorage.getItem(BK_AT)||null }catch(e){}
  G.gBkInfo.textContent=at?'上次下載備份：'+fmtDay(at):'還沒有下載過備份';
  G.gBkNote.textContent='備份檔包含'+(forestOpen?'兩塊地':'這塊地')+'和這一頁的答題紀錄。手機容量不夠時，瀏覽器可能會把資料清掉，偶爾下載一份比較安心。'+(cfg.backupNote?' '+cfg.backupNote:'');
}
// v2.0 備份檔多一個 forest 欄位：水邊樹林 key 的原始字串（還沒開就沒有）
function downloadBackup(){
  writeNow();                                   // 先把還沒寫出去的變動寫進存檔
  let raw=null, fraw=null; try{ raw=localStorage.getItem(KEY); fraw=localStorage.getItem(FKEY) }catch(e){}
  if(!raw){ alert('這塊地還沒有存檔，先滴幾滴水再備份。'); return; }
  const file={app:BK_APP, key:KEY, world:VERSION, savedAt:new Date().toISOString(), plants:maps.home.plants.length, data:raw};
  if(fraw){ file.forest=fraw; file.forestPlants=maps.forest?maps.forest.plants.length:0; }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(file)],{type:'application/json'}));
  a.download='一滴水備份-'+bkName(KEY)+'-'+stamp()+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  try{ localStorage.setItem(BK_AT,String(Date.now())) }catch(e){}
  showBackupInfo();
}
function restoreBackup(text){
  let b=null, d=null;
  try{ b=JSON.parse(text) }catch(e){}
  // v1.6：Painless 首頁「匯出進度」的完整備份（schema_version＋progress）放錯入口時，說清楚要去哪裡匯入
  if(b&&typeof b==='object'&&b.schema_version&&b.progress&&typeof b.progress==='object'){
    alert(KEY==='pg.drop.v1'
      ?'這是 Painless 的完整備份（單字進度＋一滴水花園），要從 Painless 首頁的「匯出／匯入」→「匯入」放回去，單字進度和花園會一起回來。'
      :'這是 Painless GRE 的備份，不能還原到這一頁。');
    return false;
  }
  if(!b||b.app!==BK_APP||typeof b.data!=='string'){ alert('這不是一滴水的備份檔。'); return false; }
  if(b.key!==KEY){ alert('這是「'+bkName(b.key)+'」那一頁的備份，不能還原到「'+bkName(KEY)+'」這一頁。'); return false; }
  try{ d=JSON.parse(b.data) }catch(e){}
  if(!d||!Array.isArray(d.plants)){ alert('備份檔壞掉了，讀不出土地。'); return false; }
  // v2.0 有水邊樹林就一起還原；舊備份沒有 forest：現在的水邊樹林留著不動
  let fd=null;
  if(b.forest!==undefined){
    try{ fd=JSON.parse(b.forest) }catch(e){}
    if(typeof b.forest!=='string'||!fd||!Array.isArray(fd.plants)){ alert('備份檔壞掉了，讀不出水邊樹林。'); return false; }
  }
  const when=b.savedAt?fmtDay(Date.parse(b.savedAt)):'不明日期';
  const nowF=forestOpen&&maps.forest?'、水邊樹林 '+maps.forest.plants.length+' 株':'';
  if(!confirm('要用 '+when+' 的備份（'+d.plants.length+' 株'+(fd?'、水邊樹林 '+fd.plants.length+' 株':'')+'）換掉現在的土地（'+maps.home.plants.length+' 株'+nowF+'）嗎？\n這一頁的答題紀錄也會一起換成備份裡的。'+
    (!fd&&nowF?'\n這份備份裡沒有水邊樹林，現在的水邊樹林會留著。':''))) return false;
  frozen=true; clearTimeout(saveT);
  let oldF=null; try{ oldF=localStorage.getItem(FKEY) }catch(e){}
  try{ if(fd) localStorage.setItem(FKEY,b.forest); localStorage.setItem(KEY,b.data); }
  catch(e){
    try{ if(fd){ if(oldF===null) localStorage.removeItem(FKEY); else localStorage.setItem(FKEY,oldF); } }catch(_){}   // 只寫進一半：把水邊樹林放回原樣
    frozen=false; alert('寫不進去（手機空間可能不夠），土地沒有改變。'); return false;
  }
  location.reload();
  return true;
}
G.gBkSave.onclick=()=>{
  // 請瀏覽器不要在空間不夠時自動清掉這個網站的資料。只在使用者自己按備份時才請求（Firefox 會跳權限詢問，不要一開頁就問）；
  // 瀏覽器可以不答應，真正的保險是備份檔
  try{ if(navigator.storage&&navigator.storage.persist) navigator.storage.persist().catch(()=>{}); }catch(e){}
  downloadBackup();
};
G.gBkLoad.onclick=()=>{ G.gBkFile.value=''; G.gBkFile.click(); };
G.gBkFile.onchange=()=>{ const f=G.gBkFile.files&&G.gBkFile.files[0]; if(!f) return; f.text().then(restoreBackup); };

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
  get forestOpen(){ return forestOpen; },   // v2.0
  switchMap,                                // v2.0 'home' | 'forest'（沒開門時不動）
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
      map:activeMap, forestOpen, n:maps.forest?maps.forest.n:0, homePlants:maps.home.plants.length, petals:petals.length,
      plantsFull:plants.map(p=>({type:p.type,x:p.x,y:p.y,stage:p.stage,color:p.color,nb:p.nb})),
    };
  },
  // v2.0 測試用（會改資料）：直接開水邊樹林
  _openForest(){ openForest(true); },
  // v1.2 測試用：假如畫面座標 (X,Y)（px，植物的腳）有一株 type（樹用 v），它現在的透明度（唯讀）
  _fadeAt(type,X,Y,v=3){ return foliageAlpha({type,v},X,Y,critterViews(now())); },
  // v1.2 測試用（會改資料）：直接呼叫 addPlant，看新植物落在哪（x,y 是 0～1）；頁面不要用
  _addPlant(type,x,y){ const p=addPlant(type,x,y); return p&&{x:p.x,y:p.y,inPond:!!pondAt(p.x,p.y)}; },
};
return api;
}

window.OneDropWorld={ VERSION, create };
})();
