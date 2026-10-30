/* ================= 單字水彩：答題 → 顏料 → 解鎖區塊 =================
   State ownership（誰能寫什麼）：
   - credits（手上還能塗幾塊新區塊）：只有「答對」會加、只有 gate()「解鎖新區塊」會減。
   - unlocked[畫作 id]（塗過的區塊編號）：只有 gate() 會加；洗掉、復原、重新開始都不會拿掉。
   - done[畫作 id]（整張塗完）：只有 gate() 解鎖最後一塊、或載入時發現已經塗完，才會設成 true。
   - 畫面上的顏色歸水彩引擎管（自己存在 IndexedDB），平常不碰；只有「從備份檔還原」會整批換掉，
     而且換之前先設 window.__vwHold 擋住引擎的自動存檔。引擎的復原只動顏色，不退顏料。
   引擎在使用者用「上色」點到一個區塊時，先問 window.__vwGate(畫作 id, 區塊編號)，回傳 false 就不上色。
   unlocked / done / IndexedDB 都以畫作 id 為 key，線稿一改區塊編號就變，所以改線稿要用新 id（舊版標 legacy，見檔案最後一段與 README.md）。 */
(() => {
const PAGE_VERSION = '__PAGE_VERSION__';
const REWARD = { e2c: 1, c2e: 1, spell: 2 };
// github.io 上所有 trinkets 頁面共用同一個 localStorage / IndexedDB：key 一律帶頁名
const SAVE_KEY = 'vocab-watercolor-v1';
const UI_KEY = 'vocab-watercolor.ui';      // 引擎的設定（顏色、線稿、目前畫作），build.py 換的名字
const DB_NAME = 'vocab-watercolor';        // 引擎的 IndexedDB（store "paint"，key "paint:<畫作 id>"）
// 太小的碎塊（面積 < TAP_MIN 平方像素，約 17×17，手指很難點準）：免費塗，也不算進「整張塗完」
const TAP_MIN = 300;

/* ================= 單字資料（build.py 從 ../one-drop.html 的 UNITS 複製過來，兩頁共用同一份） ================= */
const UNITS = __UNITS__;

/* ================= words（同 one-drop.html） ================= */
const $ = id => document.getElementById(id);
const POS_OK = /^(n|v|vt|vi|adj|adv|a|prep|phr|aux|conj|pron|int)(\/(n|v|adj|adv))?$/i;
function posKey(p){ p=(p||'').toLowerCase().split('/')[0]; return p==='vt'||p==='vi'?'v':p==='a'?'adj':p; }
function cleanMeaning(m){
  return m.trim().replace(/^([a-z]+(?:\/[a-z]+)?)\.?\s*/i,(x,p)=>POS_OK.test(p)?p+'. ':x);
}
function glosses(m){
  const s=m.replace(/\([^)]*\)|（[^）]*）/g,' ').replace(/\b(n|v|vt|vi|adj|adv|a|prep|phr|aux|conj)\b\.?/gi,' ');
  return s.split(/[；;，,、\/\s]+/).map(x=>x.replace(/[～~.。]/g,'').replace(/[的地]$/,'')).filter(x=>/[一-鿿]/.test(x));
}
function spellForm(w){
  const s=w.replace(/\(=[^)]*\)/g,'').trim().toLowerCase().replace(/\s+/g,' ');
  return /^[a-z][a-z' \-]*$/.test(s)?s:null;
}
const normWord=w=>w.replace(/\(=[^)]*\)/g,'').trim().toLowerCase();
const WORDS={}, UNIT_IDS={};
UNITS.forEach(un=>{
  UNIT_IDS[un.unit]=[];
  un.words.forEach(w=>{
    const meaning=cleanMeaning(w.meaning);
    let pos=w.pos; if(!pos){const m=meaning.match(/^([a-z]+(?:\/[a-z]+)?)\./i); pos=m?m[1]:'';}
    WORDS[w.id]={id:w.id,word:w.word.trim(),meaning,pk:posKey(pos),unit:un.unit,gl:glosses(meaning),spell:spellForm(w.word),ex:w.example||'',ez:w.example_zh||''};
    UNIT_IDS[un.unit].push(w.id);
  });
});
const ALL_IDS=Object.keys(WORDS).map(Number);
const overlap=(a,b)=>a.some(x=>b.includes(x));

/* ================= state ================= */
// ★ 考試範圍（換考試只改這一行，跟 one-drop.html 的 EXAM_RANGE 一起改，再升 build.py 的 PAGE_VERSION 重 build）
// [第幾回, 到第幾回]：第 9–16 回＝p.17-32。選單上的「考試範圍」鈕和新學生的預設範圍都用它；舊學生照自己存的範圍
const EXAM_RANGE=[9,16];
let sel=UNITS.filter(u=>u.unit>=EXAM_RANGE[0]&&u.unit<=EXAM_RANGE[1]).map(u=>u.unit), modes={e2c:true,c2e:true,spell:false}, weakOnly=false;
let stats={};             // id → [streak, right, wrong]
let order=[], qi=-1, Q=null, again=false, answered=false, shown=0;
let retry=[];             // [{id, due}]
let credits=0;            // 手上還能塗幾塊新區塊
let unlocked={};          // 畫作 id → [區塊編號…]
let done={};              // 畫作 id → true（整張塗完）
let backupAt=0, backupMark=0;   // 上次下載備份的時間、當時總共塗過幾塊
let tab='quiz';
const mastered=id=>(stats[id]&&stats[id][0]>=2);
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function selIds(){ return sel.flatMap(u=>UNIT_IDS[u]||[]); }
function pool(){
  const all=selIds();
  if(!weakOnly) return all;
  const weak=all.filter(id=>!mastered(id));
  if(!weak.length){ toast('這個範圍的字全都熟了，改成全部出'); return all; }
  return weak;
}

/* ================= 存檔 ================= */
let stale=false;
function snapshot(){
  return {v:1, credits, unlocked, done, backupAt, backupMark, tab,
    sel, modes, weakOnly, stats, order, qi, shown, retry, Q, again, answered};
}
function save(){
  if(stale) return;
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); }catch(e){}
}
// 另一個分頁也開著這頁：先停止存檔，免得兩邊互相蓋掉（顏料數會對不上）
window.addEventListener('storage', e=>{
  if(e.key!==SAVE_KEY || stale) return;
  stale=true; $('vw-stale').hidden=false;
});
// returns 'question' / 'next' / false (fresh start)
function load(){
  let d=null;
  try{ d=JSON.parse(localStorage.getItem(SAVE_KEY)||'null'); }catch(e){}
  if(!d || typeof d!=='object') return false;
  credits=Math.max(0, d.credits|0);
  if(d.unlocked && typeof d.unlocked==='object')
    for(const k in d.unlocked) if(Array.isArray(d.unlocked[k])) unlocked[k]=d.unlocked[k].filter(n=>Number.isInteger(n)&&n>0);
  if(d.done && typeof d.done==='object') for(const k in d.done) if(d.done[k]===true) done[k]=true;
  backupAt=Number(d.backupAt)||0; backupMark=Number(d.backupMark)||0;
  if(d.tab==='paint') tab='paint';
  if(d.stats && typeof d.stats==='object') for(const k in d.stats) if(WORDS[k]) stats[k]=d.stats[k];
  if(d.modes && typeof d.modes==='object') modes={e2c:!!d.modes.e2c,c2e:!!d.modes.c2e,spell:!!d.modes.spell};
  if(!modes.e2c&&!modes.c2e&&!modes.spell) modes.e2c=true;
  weakOnly=!!d.weakOnly;
  if(Array.isArray(d.sel)){
    const ok=d.sel.filter(u=>UNIT_IDS[u]);
    if(ok.length) sel=ok; else return false;
  }else return false;
  const inSel=new Set(selIds());
  if(Array.isArray(d.order) && d.order.length && d.order.every(id=>WORDS[id])){
    order=d.order; qi=d.qi|0; shown=d.shown|0;
  }
  retry=Array.isArray(d.retry)?d.retry.filter(x=>x&&WORDS[x.id]&&inSel.has(x.id)):[];
  const q=d.Q;
  if(q && WORDS[q.id] && !d.answered && (q.type==='spell' || (Array.isArray(q.opts)&&q.opts.every(id=>WORDS[id])))){
    Q=q; again=!!d.again; return 'question';
  }
  return 'next';
}

/* ================= 顏料與解鎖 ================= */
let toastT=0;
function toast(t, ms=2600){
  const el=$('toast'); if(!el) return;
  el.textContent=t; el.classList.add('on');
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'), ms);
}
let curArt=null, curNeed=new Set(), curTotal=0;
const painted=()=>curArt?(unlocked[curArt]||[]).filter(r=>curNeed.has(r)).length:0;
const totalPainted=()=>Object.values(unlocked).reduce((s,l)=>s+l.length,0);
function renderCredits(gained){
  const box=$('vw-credits');
  $('vw-n').textContent=credits;
  box.classList.toggle('zero', credits===0);
  box.setAttribute('aria-label','還可以塗 '+credits+' 塊新區塊');
  if(gained){ box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
  $('vw-prog').textContent=!curTotal?'':done[curArt]?'這張塗完了 ✓':('這張塗過 '+painted()+' / '+curTotal+' 塊');
}
window.__vwOnDrawing=(id, set)=>{
  curArt=id;
  curNeed=new Set(set&&set.regions?set.regions.map((r,i)=>r.area>=TAP_MIN?i+1:0).filter(Boolean):[]);
  curTotal=curNeed.size;
  // 之前就塗完的：默默記下來，不放彩紙
  if(curTotal && !done[id] && painted()>=curTotal){ done[id]=true; save(); }
  renderCredits(false);
};
// 剛塗完最後一塊 → 彩紙；全部的圖都塗完 → 大彩紙
function checkDone(id){
  if(id!==curArt || done[id] || !curTotal || painted()<curTotal) return false;
  done[id]=true; save(); renderCredits(false);
  const arts=(window.__VW_ART||[]).filter(a=>!a.legacy), all=arts.length>0 && arts.every(a=>done[a.id]);
  confetti(all);
  toast(all?'全部 '+arts.length+' 張都塗完了！太厲害了':'整張都塗過了！可以到「調色」存成圖片', 4500);
  return true;
}
let persistAsked=false, reminded=false;
function askPersist(){
  // 請瀏覽器不要在空間不夠時自動清掉這頁的資料（不保證每個瀏覽器都答應）
  if(persistAsked) return; persistAsked=true;
  try{ const s=navigator.storage; if(s&&s.persist&&s.persisted) s.persisted().then(p=>p||s.persist()).catch(()=>{}); }catch(e){}
}
window.__vwGate=(id, rid)=>{
  if(stale){ toast('另一個分頁也開著這頁，請重新載入'); return false; }
  const list=unlocked[id]||(unlocked[id]=[]);
  if(list.includes(rid)) return true;
  // 小到引擎不會上色的碎塊：放行但不扣（不然顏料白花）
  const r=window.__aw&&window.__aw.regions&&window.__aw.regions.regions[rid-1];
  if(r && r.area<TAP_MIN) return true;
  if(credits<=0){
    toast('這塊還沒塗過：答對一題，就能再塗一塊');
    setTab('quiz');
    return false;
  }
  credits--; list.push(rid);
  renderCredits(false); save(); askPersist();
  if(checkDone(id)) return true;
  if(credits===0) toast('顏料用完了，回去答題吧');
  else if(!reminded && totalPainted()-backupMark>=30){ reminded=true; toast('已經塗了不少，記得到「調色」下載備份檔', 3600); }
  return true;
};

/* ================= 分頁 ================= */
function setTab(t){
  tab=t;
  document.querySelectorAll('[data-vwtab]').forEach(b=>b.setAttribute('aria-selected', String(b.dataset.vwtab===t)));
  $('vw-quiz').hidden=t!=='quiz';
  $('vw-paint').hidden=t!=='paint';
  save();
}
document.querySelectorAll('[data-vwtab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.vwtab)));

/* ================= 出題（同 one-drop.html） ================= */
function distractors(t){
  const out=[];
  const fits=id=>{
    const c=WORDS[id];
    if(!c || id===t.id || out.includes(id)) return false;
    if(normWord(c.word)===normWord(t.word) || overlap(c.gl,t.gl)) return false;
    return out.every(o=>normWord(WORDS[o].word)!==normWord(c.word) && !overlap(WORDS[o].gl,c.gl));
  };
  const fill=list=>{for(const id of shuffle(list)){ if(out.length>=3) break; if(fits(id)) out.push(id); }};
  const inSel=selIds(), same=id=>WORDS[id].pk===t.pk;
  if(Math.random()<.7){
    for(const id of shuffle(inSel.filter(id=>same(id)&&Math.abs(id-t.id)<=6))){ if(fits(id)){out.push(id);break} }
  }
  fill(inSel.filter(same));
  if(out.length<3) fill(ALL_IDS.filter(same));
  if(out.length<3) fill(ALL_IDS);
  return out;
}
function buildQ(id){
  const w=WORDS[id], types=[];
  if(modes.e2c) types.push('e2c');
  if(modes.c2e) types.push('c2e');
  if(modes.spell && w.spell) types.push('spell');
  if(!types.length) types.push('e2c');
  const type=types[Math.floor(Math.random()*types.length)];
  if(type==='spell') return {id,type};
  const opts=shuffle([id,...distractors(w)]);
  return {id,type,opts,a:opts.indexOf(id)};
}
function nextQuestion(){
  shown++;
  const r=retry.findIndex(x=>x.due<=shown);
  let id;
  if(r>=0){ id=retry.splice(r,1)[0].id; again=true; }
  else{
    qi++;
    if(qi>=order.length){
      if(order.length) toast('這個範圍全部出過一輪了，重新洗牌');
      order=shuffle(pool()); qi=0;
      if(Q && order.length>1 && order[0]===Q.id) order.push(order.shift());
    }
    id=order[qi]; again=false;
    retry=retry.filter(x=>x.id!==id);
  }
  Q=buildQ(id);
  showQuestion();
  save();
}

const SPEAK_SVG='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
function sayBtn(word){
  const b=document.createElement('button');
  b.className='q-say'; b.type='button'; b.innerHTML=SPEAK_SVG; b.setAttribute('aria-label','唸出 '+word);
  b.hidden=!canSpeak; b.onclick=()=>speak(word);
  return b;
}
const KIND={e2c:'看英文選中文',c2e:'看中文選英文',spell:'看中文拼英文'};
function showQuestion(){
  const w=WORDS[Q.id];
  answered=false;
  $('q-kind').textContent=KIND[Q.type];
  $('q-again').hidden=!again;
  updateScope();
  const pr=$('q-prompt'); pr.innerHTML='';
  if(Q.type==='e2c'){
    const s=document.createElement('span'); s.className='word'; s.textContent=w.word; pr.append(s, sayBtn(w.word));
  }else{
    const s=document.createElement('span'); s.className='mean'; s.textContent=w.meaning; pr.append(s);
  }
  const ul=$('q-opts'); ul.innerHTML='';
  $('q-spell').hidden=Q.type!=='spell';
  if(Q.type==='spell'){
    const t=$('q-typed'); t.value=''; t.disabled=false; t.className='';
    $('q-check').disabled=false; $('q-giveup').disabled=false;
    $('q-letters').textContent=w.spell.split('').map((c,i)=>i===0?c:c===' '?' ':c==='-'||c==="'"?c:'_').join(' ');
    const cnt=document.createElement('small'); cnt.textContent='（'+w.spell.replace(/[^a-z]/g,'').length+' 個字母）'; $('q-letters').append(cnt);
    if(matchMedia('(pointer:fine)').matches && tab==='quiz') t.focus({preventScroll:true});
  }else{
    Q.opts.forEach((oid,i)=>{
      const o=WORDS[oid];
      const li=document.createElement('li');
      const b=document.createElement('button');
      b.type='button';
      b.className='q-opt'+(Q.type==='c2e'?' en':'');
      b.innerHTML='<span class="k">'+'ABCD'[i]+'</span><span></span>';
      b.lastChild.textContent=Q.type==='c2e'?o.word:o.meaning;
      b.onclick=()=>answer(i);
      li.appendChild(b); ul.appendChild(li);
    });
  }
  $('q-after').classList.remove('on');
  $('vw-quiz').scrollTop=0;
}
function record(id,ok){
  const s=stats[id]||[0,0,0];
  if(ok){s[0]++;s[1]++}else{s[0]=0;s[2]++}
  stats[id]=s;
}
function finish(ok,badText){
  const w=WORDS[Q.id];
  record(Q.id,ok);
  const msg=$('q-msg');
  if(ok){
    const got=REWARD[Q.type]||1;
    const first=credits===0;
    credits+=got;
    renderCredits(true);
    msg.className='q-msg good';
    msg.textContent=(Q.type==='spell'?'拼對了，':'答對了，')+'可以多塗 '+got+' 塊。'
      +(first?'直接點畫紙上的區塊上色；想換顏色到「調色」。':'')
      +(mastered(Q.id)&&stats[Q.id][0]===2?'這個字熟了。':'');
  }else{
    retry.push({id:Q.id,due:shown+3+Math.floor(Math.random()*3)});
    msg.className='q-msg bad';
    msg.textContent=badText+'這個字過一會兒會再出現。';
  }
  const card=$('q-card'); card.innerHTML='';
  const b=document.createElement('b'); b.textContent=w.word;
  const s=document.createElement('span'); s.textContent=w.meaning;
  card.append(b, sayBtn(w.word), s);
  if(w.ex){const d=document.createElement('div'); d.className='q-ex'; const e=document.createElement('p'); e.textContent=w.ex; d.append(e); if(w.ez){const z=document.createElement('p'); z.className='q-ez'; z.textContent=w.ez; d.append(z)} card.append(d)}
  $('q-after').classList.add('on');
  $('q-nextq').focus({preventScroll:true});
  requestAnimationFrame(()=>$('q-after').scrollIntoView({block:'nearest',behavior:'smooth'}));
  save();
}
function answer(i){
  if(answered||Q.type==='spell'||i>=Q.opts.length) return;
  answered=true;
  [...document.querySelectorAll('.q-opt')].forEach((b,k)=>{
    b.disabled=true;
    if(k===Q.a) b.classList.add('right');
    else if(k===i) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  finish(i===Q.a,'答案是 '+'ABCD'[Q.a]+'。');
}
const tidy=s=>s.toLowerCase().replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim();
function submitSpell(giveUp){
  if(answered||Q.type!=='spell') return;
  const w=WORDS[Q.id], t=$('q-typed'), v=tidy(t.value);
  if(!giveUp && !v){ t.focus(); return; }
  answered=true;
  const ok=!giveUp && v===w.spell;
  t.disabled=true; t.className=ok?'ok':'no';
  $('q-check').disabled=true; $('q-giveup').disabled=true;
  finish(ok, giveUp?'沒關係，記一下拼法。':'正確拼法是 '+w.spell+'。');
}
$('q-spell').onsubmit=e=>{e.preventDefault();submitSpell(false)};
$('q-giveup').onclick=()=>submitSpell(true);
$('q-nextq').onclick=nextQuestion;
document.addEventListener('keydown',e=>{
  if(tab!=='quiz' || !$('q-pick').hidden || $('q-quiz').hidden) return;
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  const dlg=$('dialog'); if(dlg && !dlg.hidden) return;
  if(e.target.tagName==='INPUT') return;
  if(e.target.tagName==='BUTTON' && (e.key==='Enter'||e.key===' ')) return;
  const k=e.key.toUpperCase();
  const idx='ABCD'.indexOf(k)>=0?'ABCD'.indexOf(k):'1234'.indexOf(k);
  if(!answered && Q && Q.type!=='spell' && idx>=0 && k.length===1){answer(idx)}
  else if(answered && e.key==='Enter'){nextQuestion()}
});

/* ---------- speech ---------- */
const canSpeak='speechSynthesis' in window && typeof SpeechSynthesisUtterance!=='undefined';
let enVoice=null;
function pickVoice(){ try{const vs=speechSynthesis.getVoices(); enVoice=vs.find(v=>/^en-US/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang))||null;}catch(e){} }
if(canSpeak){ pickVoice(); try{speechSynthesis.addEventListener('voiceschanged',pickVoice)}catch(e){} }
function speak(t){
  if(!canSpeak) return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(t.replace(/\([^)]*\)/g,' ').replace(/…/g,' '));
    u.lang='en-US'; u.rate=.85; if(enVoice) u.voice=enVoice;
    speechSynthesis.speak(u);
  }catch(e){}
}

/* ---------- 範圍 ---------- */
function pageSpan(units){
  const r=units.map(u=>{const un=UNITS.find(x=>x.unit===u);const m=(un&&un.unit_label||'').match(/(\d+)\D+(\d+)/);return m?[+m[1],+m[2],un.unit_label]:[null,null,un?un.unit_label:'']});
  const parts=[]; let cur=null;
  for(const [a,b,l] of r){
    if(a===null){parts.push(l);cur=null;continue}
    if(cur && a===cur[1]+1){cur[1]=b} else {cur=[a,b];parts.push(cur)}
  }
  return parts.map(p=>typeof p==='string'?p:'p.'+p[0]+'-'+p[1]).join('、');
}
function updateScope(){
  const ids=selIds(), m=ids.filter(mastered).length;
  $('q-scope').textContent=pageSpan(sel)+' · 熟 '+m+'/'+ids.length;
}
/* 「點頭點尾」選連續一段（同 one-drop.html、班網 vocabulary_hub）：第 1 下＝單回；第 2 下＝從頭到尾整段；第 3 下重新開始。
   這份狀態只屬於選單（draft）；draft.sel 由它算出來，按「開始」才寫回 sel。
   舊存檔若是跳著選的（改版前可以），打開選單時照原樣顯示，點了才換成一段，不會自己偷改。 */
let draft=null;
const unitIdx=u=>UNITS.findIndex(x=>x.unit===u);
function rangeSel(lo,hi){ return UNITS.slice(Math.min(lo,hi),Math.max(lo,hi)+1).map(x=>x.unit); }
function setDraftRange(lo,hi){ draft.anchor=lo; draft.head=hi; draft.closed=true; draft.sel=rangeSel(lo,hi); }
function isRun(s){ const ix=s.map(unitIdx); return ix.every((v,k)=>v>=0&&(k===0||v===ix[k-1]+1)); }
function openPick(){
  draft={sel:[...sel],modes:{...modes},weakOnly,anchor:null,head:null,closed:true};
  if(sel.length && isRun(sel)) setDraftRange(unitIdx(sel[0]),unitIdx(sel[sel.length-1]));
  renderPick();
  $('q-quiz').hidden=true; $('q-pick').hidden=false; $('vw-quiz').scrollTop=0;
}
function tapUnit(i){
  if(draft.anchor===null||draft.closed){ draft.anchor=i; draft.head=null; draft.closed=false; draft.sel=rangeSel(i,i); }
  else setDraftRange(draft.anchor,i);
  renderPick();
}
function renderPick(){
  const box=$('q-units'); box.innerHTML='';
  const run=draft.sel.length && isRun(draft.sel);
  const lo=run?unitIdx(draft.sel[0]):-1, hi=run?unitIdx(draft.sel[draft.sel.length-1]):-1;
  UNITS.forEach((un,i)=>{
    const ids=UNIT_IDS[un.unit], m=ids.filter(mastered).length, on=draft.sel.includes(un.unit);
    const b=document.createElement('button');
    b.type='button';
    b.className='q-unit'+(on&&run&&hi>lo?(i===lo||i===hi?' end':' mid'):'')+(!draft.closed&&i===draft.anchor?' anchor':'');
    b.setAttribute('aria-pressed',on);
    b.innerHTML='<span class="pg"></span><span class="meta"></span><span class="bar"><i></i></span>';
    b.querySelector('.pg').textContent=un.unit_label||('Unit '+un.unit);
    b.querySelector('.meta').textContent='熟 '+m+'/'+ids.length;
    b.querySelector('i').style.width=(ids.length?m/ids.length*100:0)+'%';
    b.onclick=()=>tapUnit(i);
    box.appendChild(b);
  });
  const words=draft.sel.flatMap(u=>UNIT_IDS[u]||[]).length;
  let v='還沒選範圍', h='點一回＝單回；點「頭」再點「尾」，中間整段一起選。';
  if(draft.sel.length){
    const cnt=draft.sel.length;
    v=pageSpan(draft.sel)+' · '+(cnt===1?'單回':cnt+' 回')+' · '+words+' 字';
    h=!run?'這是之前跳著選的範圍。點任何一回就重新選一段。'
      :!draft.closed?'再點另一回當結尾就能選整段，或直接開始。'
      :'再點一下就重新選。';
  }
  $('q-rsum-v').textContent=v; $('q-rsum-h').textContent=h;
  $('q-exam').textContent='考試範圍 '+pageSpan(rangeSel(unitIdx(EXAM_RANGE[0]),unitIdx(EXAM_RANGE[1])));
  $('q-exam').setAttribute('aria-pressed',run&&lo===unitIdx(EXAM_RANGE[0])&&hi===unitIdx(EXAM_RANGE[1]));
  $('q-all').setAttribute('aria-pressed',run&&lo===0&&hi===UNITS.length-1);
  document.querySelectorAll('#q-modes .q-chip').forEach(c=>{
    c.setAttribute('aria-pressed',!!draft.modes[c.dataset.m]);
    c.onclick=()=>{draft.modes[c.dataset.m]=!draft.modes[c.dataset.m];renderPick()};
  });
  $('q-weak').setAttribute('aria-pressed',draft.weakOnly);
  $('q-back').hidden=!Q;
  const n=draft.sel.flatMap(u=>UNIT_IDS[u]||[]).length;
  const anyMode=draft.modes.e2c||draft.modes.c2e||draft.modes.spell;
  const go=$('q-go');
  go.disabled=!n||!anyMode;
  go.textContent=!n?'至少選一個範圍':!anyMode?'至少選一種題型':'開始（'+pageSpan(draft.sel)+'，共 '+n+' 字）';
}
$('q-weak').onclick=()=>{draft.weakOnly=!draft.weakOnly;renderPick()};
$('q-exam').onclick=()=>{setDraftRange(unitIdx(EXAM_RANGE[0]),unitIdx(EXAM_RANGE[1]));renderPick()};
$('q-all').onclick=()=>{setDraftRange(0,UNITS.length-1);renderPick()};
$('q-range').onclick=openPick;
function closePick(apply){
  if(apply){
    const changed=JSON.stringify([sel,weakOnly])!==JSON.stringify([draft.sel,draft.weakOnly]);
    const modesChanged=JSON.stringify(modes)!==JSON.stringify(draft.modes);
    sel=draft.sel; modes=draft.modes; weakOnly=draft.weakOnly;
    if(changed || !Q){
      const inSel=new Set(selIds());
      order=[]; qi=-1; retry=retry.filter(x=>inSel.has(x.id));
      $('q-pick').hidden=true; $('q-quiz').hidden=false;
      nextQuestion(); return;
    }
    if(modesChanged && !answered){ Q=buildQ(Q.id); showQuestion(); }
    save();
  }
  if(!Q) return;
  $('q-pick').hidden=true; $('q-quiz').hidden=false;
  updateScope();
}
$('q-go').onclick=()=>closePick(true);
$('q-back').onclick=()=>closePick(false);
let wipeT=null;
$('q-wipe').onclick=()=>{
  const b=$('q-wipe');
  if(!b.classList.contains('armed')){
    b.classList.add('armed'); b.textContent='再按一次清除（顏料和塗過的區塊會留著）';
    clearTimeout(wipeT); wipeT=setTimeout(()=>{b.classList.remove('armed');b.textContent='清除單字紀錄'},3000);
    return;
  }
  clearTimeout(wipeT); b.classList.remove('armed'); b.textContent='清除單字紀錄';
  stats={}; retry=[]; order=[]; qi=-1; Q=null;
  renderPick(); save(); toast('單字紀錄清掉了');
};

/* ================= 彩紙 ================= */
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
function confetti(big){
  if(reduceMotion.matches) return;
  const cv=document.createElement('canvas'); cv.className='vw-confetti'; cv.setAttribute('aria-hidden','true');
  document.body.appendChild(cv);
  const W=innerWidth, H=innerHeight, dpr=Math.min(2,devicePixelRatio||1);
  cv.width=W*dpr; cv.height=H*dpr;
  const g=cv.getContext('2d'); g.scale(dpr,dpr);
  const COLORS=['#d4544a','#e8a33d','#f2d15c','#6aa84f','#3b8fc4','#7b5ea7','#e57fa8'];
  const P=[], sp=Math.max(.75,Math.min(1.2,H/800));
  const burst=(x,y,ang,n)=>{ for(let i=0;i<n;i++){
    const a=ang+(Math.random()-.5)*1.1, v=(10+Math.random()*10)*sp;
    P.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,w:5+Math.random()*6,h:8+Math.random()*8,
      r:Math.random()*6.3,vr:(Math.random()-.5)*.35,t:Math.random()*6.3,c:COLORS[i%COLORS.length]});
  }};
  burst(0,H,-Math.PI/3,big?110:70); burst(W,H,-Math.PI*2/3,big?110:70);
  const DUR=big?4600:3200, t0=performance.now(); let last=t0, extra=big;
  (function step(now){
    const el=now-t0, f=Math.min(3,(now-last)/16.7); last=now;
    if(extra && el>500){ extra=false; burst(W/2,H,-Math.PI/2,130); }
    g.clearRect(0,0,W,H);
    g.globalAlpha=Math.max(0,Math.min(1,(DUR-el)/700));
    for(const p of P){
      p.vy+=.32*f; p.vx*=Math.pow(.985,f); p.vy*=Math.pow(.985,f);
      p.x+=p.vx*f; p.y+=p.vy*f; p.r+=p.vr*f; p.t+=.12*f;
      g.save(); g.translate(p.x,p.y); g.rotate(p.r); g.scale(1,Math.cos(p.t));
      g.fillStyle=p.c; g.fillRect(-p.w/2,-p.h/2,p.w,p.h); g.restore();
    }
    if(el<DUR) requestAnimationFrame(step); else cv.remove();
  })(t0);
}
// 「存成圖片」＝作品完成要帶走：放個彩紙
$('save').addEventListener('click',()=>setTimeout(()=>confetti(false),300));

/* ================= 進度備份：存成檔案，瀏覽器資料被清掉或換手機時可以還原 =================
   檔案內容：答題層存檔（顏料、塗過哪些塊、單字紀錄）＋引擎設定＋每張畫的顏色（IndexedDB 原樣，二進位轉 base64）。
   還原是「整份取代」，不是合併。 */
const BK_APP='vocab-watercolor';
function idb(){
  return new Promise((res,rej)=>{
    const q=indexedDB.open(DB_NAME,1);
    q.onupgradeneeded=()=>q.result.createObjectStore('paint');
    q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error||new Error('打不開資料庫'));
  });
}
function b64(buf){
  const u=new Uint8Array(buf); let s='';
  for(let i=0;i<u.length;i+=32768) s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
  return btoa(s);
}
function unb64(s){ const t=atob(s), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return u.buffer; }
const TA={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};
const enc=v=>v instanceof ArrayBuffer?{$b:b64(v)}
  :ArrayBuffer.isView(v)?{$t:v.constructor.name,$b:b64(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength))}
  :Array.isArray(v)?v.map(enc)
  :v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,enc(x)])):v;
const dec=v=>Array.isArray(v)?v.map(dec)
  :v&&typeof v==='object'?('$b' in v?(v.$t?new TA[v.$t](unb64(v.$b)):unb64(v.$b))
    :Object.fromEntries(Object.entries(v).map(([k,x])=>[k,dec(x)]))):v;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function makeBackup(){
  // 先把引擎還沒寫進去的顏色存好（平常是停筆 1.8 秒後才存）
  try{ window.__aw.finishRun(); await window.__aw.saveNow(); await sleep(400); await window.__aw.saveNow(); }catch(e){}
  const db=await idb();
  const paint=await new Promise((res,rej)=>{
    const out={}, tx=db.transaction('paint','readonly'), q=tx.objectStore('paint').openCursor();
    q.onsuccess=()=>{ const c=q.result; if(!c) return; if(String(c.key).startsWith('paint:')) out[c.key]=enc(c.value); c.continue(); };
    tx.oncomplete=()=>res(out); tx.onerror=tx.onabort=()=>rej(tx.error||new Error('讀不到畫'));
  });
  db.close();
  let ui=null; try{ ui=JSON.parse(localStorage.getItem(UI_KEY)||'null'); }catch(e){}
  const at=Date.now();
  return {app:BK_APP, v:1, at, page:PAGE_VERSION, quiz:{...snapshot(), backupAt:at, backupMark:totalPainted()}, ui, paint};
}
const pad=n=>String(n).padStart(2,'0');
const fmtDate=t=>{ const d=new Date(t); return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+pad(d.getHours())+':'+pad(d.getMinutes()); };
function renderBackup(){
  let s='還沒備份過';
  if(backupAt){
    const days=Math.floor((Date.now()-backupAt)/864e5);
    s='上次：'+(days<1?'今天 ':days+' 天前，')+fmtDate(backupAt).split(' ')[days<1?1:0];
  }
  $('vw-bk-when').textContent=s;
}
async function downloadBackup(){
  if(stale){ toast('另一個分頁也開著這頁，請先重新載入'); return; }
  const btn=$('vw-bk-save'); btn.disabled=true;
  try{
    const data=await makeBackup();
    const d=new Date(data.at);
    const name='單字水彩備份-'+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'-'+pad(d.getHours())+pad(d.getMinutes())+'.json';
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    let shared=false;
    // 手機：用分享選單（iPhone 可以「儲存到檔案」）；不支援就直接下載
    try{
      const file=new File([blob],name,{type:'application/json'});
      if(matchMedia('(pointer:coarse)').matches && navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:'單字水彩備份'}); shared=true;
      }
    }catch(e){ if(e && e.name==='AbortError') return; }
    if(!shared){
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),60000);
    }
    backupAt=data.at; backupMark=data.quiz.backupMark; reminded=false; save(); renderBackup();
    toast('備份檔（'+Math.max(1,Math.round(blob.size/1024))+' KB）要存在找得到的地方。沒看到下載的話，請改用 Safari 或 Chrome 開這頁', 6000);
  }catch(e){ toast('備份失敗：'+(e&&e.message||e), 5000); }
  finally{ btn.disabled=false; }
}
function showDialog(html){ const dlg=$('dialog'); dlg.querySelector('.card').innerHTML=html; dlg.hidden=false; }
function summary(q){
  const n=q&&q.unlocked?Object.values(q.unlocked).reduce((s,l)=>s+(Array.isArray(l)?l.length:0),0):0;
  return '可塗 '+((q&&q.credits)|0)+' 塊、塗過 '+n+' 塊';
}
async function pickBackup(f){
  let data=null;
  try{ data=JSON.parse(await f.text()); }catch(e){}
  if(!data || data.app!==BK_APP || data.v!==1 || !data.quiz || typeof data.quiz!=='object' || !data.paint || typeof data.paint!=='object'){
    toast('這不是單字水彩的備份檔，請選「單字水彩備份-….json」', 4500); return;
  }
  if(Object.values(data.paint).some(r=>r&&r.gz) && typeof DecompressionStream==='undefined'){
    toast('這個瀏覽器太舊，沒辦法還原這份備份。請換新版的 Safari 或 Chrome', 5000); return;
  }
  showDialog('<h2>從備份檔還原？</h2>'
    +'<p>這份備份存於 '+fmtDate(data.at)+'：'+summary(data.quiz)+'。</p>'
    +'<p>還原會<b>取代</b>這台裝置上現在的進度（現在：'+summary(snapshot())+'），單字紀錄也會換成備份裡的。</p>'
    +'<div class="dlg-actions"><button type="button" class="quiet" data-close>取消</button>'
    +'<button type="button" class="primary" id="vw-do-restore">還原</button></div>');
  $('vw-do-restore').onclick=e=>{ e.currentTarget.disabled=true; restore(data); };
}
async function restore(data){
  // 先擋住引擎與答題層的存檔，免得 reload 前把現在的進度寫回去
  window.__vwHold=true; stale=true;
  try{
    const recs=Object.entries(data.paint).filter(([k])=>k.startsWith('paint:')).map(([k,v])=>[k,dec(v)]);
    const db=await idb();
    await new Promise((res,rej)=>{
      const tx=db.transaction('paint','readwrite'), st=tx.objectStore('paint'), q=st.getAllKeys();
      q.onsuccess=()=>{
        q.result.filter(k=>String(k).startsWith('paint:')).forEach(k=>st.delete(k));
        recs.forEach(([k,v])=>st.put(v,k));
      };
      tx.oncomplete=res; tx.onerror=tx.onabort=()=>rej(tx.error||new Error('寫不進資料庫'));
    });
    db.close();
    localStorage.setItem(SAVE_KEY, JSON.stringify(data.quiz));
    if(data.ui && typeof data.ui==='object') localStorage.setItem(UI_KEY, JSON.stringify(data.ui));
  }catch(e){
    window.__vwHold=false; stale=false;
    $('dialog').hidden=true;
    toast('還原失敗：'+(e&&e.message||e)+'（原本的進度沒有動）', 5000); return;
  }
  try{ sessionStorage.setItem('vocab-watercolor.restored','1'); }catch(e){}
  location.reload();
}
$('vw-bk-save').onclick=downloadBackup;
$('vw-bk-load').onclick=()=>$('vw-bk-file').click();
$('vw-bk-file').onchange=e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(f) pickBackup(f); };
window.__vwBackup={make:makeBackup, restore};   // 測試用：在 console 匯出／還原，不經過下載

/* ================= start ================= */
$('q-ver').textContent='版本 '+PAGE_VERSION;
$('vw-ver').textContent='版本 '+PAGE_VERSION+'。';
let resumed=load();
// 從班網單字 hub 帶範圍過來：vocab-watercolor.html?units=9-16（或 ?units=9）。跟存檔的範圍不同就換過去、從新範圍出題。
// 用完就從網址拿掉，之後重新整理才不會又蓋掉學生自己選的範圍（同 one-drop.html）
(function(){
  const p=new URLSearchParams(location.search), m=(p.get('units')||'').match(/^(\d+)(?:-(\d+))?$/);
  if(!m) return;
  const a=unitIdx(+m[1]), b=unitIdx(+(m[2]||m[1]));
  p.delete('units'); history.replaceState(null,'',location.pathname+(p.toString()?'?'+p:'')+location.hash);
  if(a<0||b<0) return;
  const want=rangeSel(a,b);
  if(resumed && JSON.stringify(want)===JSON.stringify(sel)) return;
  sel=want; order=[]; qi=-1; Q=null; answered=false;
  const inSel=new Set(selIds()); retry=retry.filter(x=>inSel.has(x.id));
  resumed='next'; toast('範圍：'+pageSpan(sel));
})();
if(resumed==='question'){ $('q-quiz').hidden=false; showQuestion(); }
else if(resumed==='next'){ $('q-quiz').hidden=false; nextQuestion(); }
else openPick();
setTab(tab);
renderCredits(false);
renderBackup();
try{
  if(sessionStorage.getItem('vocab-watercolor.restored')){
    sessionStorage.removeItem('vocab-watercolor.restored');
    setTimeout(()=>toast('已從備份檔還原', 3500), 1800);
  }
}catch(e){}
/* ================= 舊版畫作（build.py ART 裡有 legacy 的；issue #1 換線稿） =================
   舊版的 id、圖、存檔都還在，只是：沒在舊版塗過的學生，選單看不到它、也不會被帶去開它。
   「塗過」＝ 解鎖過區塊、或標過塗完（localStorage），或 IndexedDB 有這張的顏色（只塗免費碎塊也算）。
   讀不到 IndexedDB（私密瀏覽、被擋）就當作有，寧可多顯示舊版，也不要讓學生找不到作品。 */
const LEGACY={};          // 舊版 id → 新版 id
for(const a of window.__VW_ART||[]) if(a.legacy) LEGACY[a.id]=a.legacy;
const legacyShown=new Set(Object.keys(LEGACY));   // 查完之前先全部顯示
const legacyReady=(async()=>{
  const ids=Object.keys(LEGACY); if(!ids.length) return;
  let keys=null;
  try{
    const db=await idb();
    keys=await new Promise((res,rej)=>{
      const q=db.transaction('paint','readonly').objectStore('paint').getAllKeys();
      q.onsuccess=()=>res(q.result.map(String)); q.onerror=()=>rej(q.error);
    });
    db.close();
  }catch(e){ keys=null; }
  for(const id of ids){
    const has=keys===null || keys.includes('paint:'+id) || (unlocked[id]||[]).length>0 || done[id]===true;
    if(!has) legacyShown.delete(id);
  }
})();
window.__vwHideArt=id=>id in LEGACY && !legacyShown.has(id);
window.__vwStartArt=async id=>{
  if(!(id in LEGACY)) return id;
  try{ await legacyReady; }catch(e){ return id; }
  return legacyShown.has(id)?id:LEGACY[id];
};
})();
