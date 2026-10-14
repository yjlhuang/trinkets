/* ================= 單字水彩：答題 → 顏料 → 解鎖區塊 =================
   State ownership（誰能寫什麼）：
   - credits（手上還能塗幾塊新區塊）：只有「答對」會加、只有 gate()「解鎖新區塊」會減。
   - unlocked[畫作 id]（塗過的區塊編號）：只有 gate() 會加；洗掉、復原、重新開始都不會拿掉。
   - 畫面上的顏色歸水彩引擎管（自己存在 IndexedDB），這裡不碰；引擎的復原只動顏色，不退顏料。
   引擎在使用者用「上色」點到一個區塊時，先問 window.__vwGate(畫作 id, 區塊編號)，回傳 false 就不上色。 */
(() => {
const PAGE_VERSION = '__PAGE_VERSION__';
const REWARD = { e2c: 5, c2e: 5, spell: 10 };
// github.io 上所有 trinkets 頁面共用同一個 localStorage / IndexedDB：key 一律帶頁名
const SAVE_KEY = 'vocab-watercolor-v1';

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
    WORDS[w.id]={id:w.id,word:w.word.trim(),meaning,pk:posKey(pos),unit:un.unit,gl:glosses(meaning),spell:spellForm(w.word)};
    UNIT_IDS[un.unit].push(w.id);
  });
});
const ALL_IDS=Object.keys(WORDS).map(Number);
const overlap=(a,b)=>a.some(x=>b.includes(x));

/* ================= state ================= */
// 新學生預設勾最新的四回（同 one-drop.html）
let sel=UNITS.slice(-4).map(u=>u.unit), modes={e2c:true,c2e:true,spell:false}, weakOnly=false;
let stats={};             // id → [streak, right, wrong]
let order=[], qi=-1, Q=null, again=false, answered=false, shown=0;
let retry=[];             // [{id, due}]
let credits=0;            // 手上還能塗幾塊新區塊
let unlocked={};          // 畫作 id → [區塊編號…]
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
function save(){
  if(stale) return;
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({v:1, credits, unlocked, tab,
      sel, modes, weakOnly, stats, order, qi, shown, retry, Q, again, answered}));
  }catch(e){}
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
let curArt=null, curTotal=0;
function renderCredits(gained){
  const box=$('vw-credits');
  $('vw-n').textContent=credits;
  box.classList.toggle('zero', credits===0);
  box.setAttribute('aria-label','還可以塗 '+credits+' 塊新區塊');
  if(gained){ box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); }
  const n=curArt?(unlocked[curArt]||[]).length:0;
  $('vw-prog').textContent=curTotal?('這張塗過 '+Math.min(n,curTotal)+' / '+curTotal+' 塊'):'';
}
window.__vwOnDrawing=(id, set)=>{
  curArt=id; curTotal=set&&set.regions?set.regions.length:0;
  renderCredits(false);
};
window.__vwGate=(id, rid)=>{
  if(stale){ toast('另一個分頁也開著這頁，請重新載入'); return false; }
  const list=unlocked[id]||(unlocked[id]=[]);
  if(list.includes(rid)) return true;
  // 小到引擎不會上色的碎塊：放行但不扣（不然顏料白花）
  const r=window.__aw&&window.__aw.regions&&window.__aw.regions.regions[rid-1];
  if(r && r.area<4) return true;
  if(credits<=0){
    toast('這塊還沒塗過：答對一題，就能再塗 5 塊');
    setTab('quiz');
    return false;
  }
  credits--; list.push(rid);
  renderCredits(false); save();
  if(credits===0) toast('顏料用完了，回去答題吧');
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
    const got=REWARD[Q.type]||5;
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
let draft=null;
function openPick(){
  draft={sel:[...sel],modes:{...modes},weakOnly};
  renderPick();
  $('q-quiz').hidden=true; $('q-pick').hidden=false; $('vw-quiz').scrollTop=0;
}
function renderPick(){
  const box=$('q-units'); box.innerHTML='';
  UNITS.forEach(un=>{
    const ids=UNIT_IDS[un.unit], m=ids.filter(mastered).length;
    const b=document.createElement('button');
    b.type='button';
    b.className='q-unit'; b.setAttribute('aria-pressed',draft.sel.includes(un.unit));
    b.innerHTML='<span class="pg"></span><span class="meta"></span><span class="bar"><i></i></span>';
    b.querySelector('.pg').textContent=un.unit_label||('Unit '+un.unit);
    b.querySelector('.meta').textContent=ids.length+' 字 · 熟 '+m;
    b.querySelector('i').style.width=(ids.length?m/ids.length*100:0)+'%';
    b.onclick=()=>{
      const i=draft.sel.indexOf(un.unit);
      if(i>=0) draft.sel.splice(i,1); else draft.sel.push(un.unit);
      draft.sel.sort((a,b)=>a-b); renderPick();
    };
    box.appendChild(b);
  });
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
$('q-all').onclick=()=>{draft.sel=UNITS.map(u=>u.unit);renderPick()};
$('q-none').onclick=()=>{draft.sel=[];renderPick()};
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

/* ================= start ================= */
$('q-ver').textContent='版本 '+PAGE_VERSION;
$('vw-ver').textContent='版本 '+PAGE_VERSION+'。';
const resumed=load();
if(resumed==='question'){ $('q-quiz').hidden=false; showQuestion(); }
else if(resumed==='next'){ $('q-quiz').hidden=false; nextQuestion(); }
else openPick();
setTab(tab);
renderCredits(false);
})();
