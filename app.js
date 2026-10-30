/* Carnet d'entraîneur — ajouts de l'appli autonome :
   1. LIVE : résultats en direct de live.swimrankings.net dans l'onglet Compétition ;
   2. SYNC : réglages de synchronisation Google Sheet, sauvegarde / restauration, lien pour un autre appareil.
   Ce fichier est chargé avant le code du carnet ; ses fonctions ne sont appelées qu'une fois le carnet prêt. */
"use strict";
(function(){
const API="https://live.swimrankings.net";
const POLL_MS=30000;
const SR_STROKE={"1":"FREE","2":"BACK","3":"BREAST","4":"FLY","5":"MEDLEY"};
const SR_GENDER={"1":"M","2":"F","3":"X"};
/* Codes de tour Splash observés sur 5 compétitions : 8 et 9 = finales, 2 et 99 = séries du matin, 3 à 7 = demi-finales (supposé). */
const srRound=e=>{const r=String(e.round||"");return r==="8"||r==="9"?"FIN":/^[3-7]$/.test(r)?"SEM":r==="2"||r==="99"?"PRE":"TIM"};
const RSTAT={"1":"Hors concours","2":"Disqualifié","3":"Forfait","4":"Abandon"};
const h=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sl=s=>(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
function cs(s){if(s==null)return null;s=String(s).trim().split(/\s+/)[0].replace(",",".");if(!s||/^NT$/i.test(s))return null;
  const m=s.match(/^(?:(\d+):)?(\d{1,2})\.(\d{1,2})$/);return m?(+(m[1]||0)*60+ +m[2])*100+ +m[3].padEnd(2,"0"):null}
const tf=c=>{if(c==null)return"—";const m=Math.floor(c/6000),s=(c%6000)/100;return m?`${m}:${s.toFixed(2).padStart(5,"0")}`:s.toFixed(2)};
const gp=(d)=>d==null||Number.isNaN(d)?'<span class="muted">—</span>':`<span class="dlt" style="color:${d<0?"var(--good)":d>0?"var(--lane)":"var(--muted)"}">${d<0?"−":d>0?"+":"±"}${tf(Math.abs(d))}</span>`;
const arr=x=>Array.isArray(x)?x:Object.values(x||{}).filter(v=>v&&typeof v==="object"&&v.id!=null);
const ls={get(k,d){try{return JSON.parse(localStorage.getItem(k)||"null")??d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
async function getJ(p){const r=await fetch(API+p,{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
async function pool(items,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;try{out[k]=await fn(items[k])}catch(e){out[k]=null}}}));return out}

/* ================= LIVE ================= */
const L={links:ls.get("cl-links",{}),sr:{},meetList:null,meetListAt:0,editing:null,picker:false,pickNation:"SUI",busy:false};
async function meetList(){if(L.meetList&&Date.now()-L.meetListAt<600000)return L.meetList;const j=await getJ("/index.php?Cmd=Meets");L.meetList=j.meetgroups||[];L.meetListAt=Date.now();return L.meetList}
async function autoLink(m){
  if(L.links[m.id]!==undefined)return L.links[m.id];
  try{const groups=await meetList();const all=groups.flatMap(g=>g.meets||[]);
    const c=sl(m.info.city);const hit=all.find(x=>x.startdate===m.info.start&&sl(x.city)===c)||all.find(x=>x.startdate===m.info.start&&(sl(x.city).includes(c)||c.includes(sl(x.city))));
    L.links[m.id]=hit?String(hit.id):null;ls.set("cl-links",L.links);return L.links[m.id]}catch(e){return null}}
/* --- données du direct, gardées sur l'appareil : sans réseau, la dernière version chargée reste affichée --- */
function rosterKeys(){return new Set(typeof S!=="undefined"?Object.keys(S.athletes||{}):[])}
function saveSr(st){
  const keep=rosterKeys(),byKey={};for(const[k,a]of Object.entries(st.byKey||{}))if(keep.has(k)||(st.club&&String(a.clubid)===st.club))byKey[k]=a;
  const base={id:st.id,main:st.main,events:st.events,agegroups:st.agegroups,byKey,club:st.club,ath:st.ath,heats:st.heats,stamp:st.stamp,lastOk:st.lastOk,clubFile:st.clubFile};
  try{localStorage.setItem("cl-sr-"+st.id,JSON.stringify({...base,res:st.res}))}
  catch(e){try{localStorage.setItem("cl-sr-"+st.id,JSON.stringify({...base,res:{}}))}catch(e2){}}}
function restoreSr(id){const c=ls.get("cl-sr-"+id,null);if(!c||!c.main)return null;return{...c,ath:c.ath||{},res:c.res||{},heats:c.heats||{},byKey:c.byKey||{},cached:true}}
function stOf(id){return L.sr[id]||(L.sr[id]=restoreSr(id)||{id,ath:{},res:{},heats:{},byKey:{},stamp:null,lastOk:0})}
async function loadSr(id,full){
  const st=stOf(id);
  if(st.full&&!full)return st;
  const [main,events,agegroups,athletes]=await Promise.all(["main","events","agegroups","athletes"].map(f=>getJ(`/meets/${id}/${f}.json`)));
  Object.assign(st,{main,events,agegroups,full:true});
  st.byKey={};for(const a of arr(athletes))st.byKey[sl(a.lastname)+"-"+sl(a.firstname)]=a;
  const cnt={};for(const k of rosterKeys()){const a=st.byKey[k];if(a)cnt[a.clubid]=(cnt[a.clubid]||0)+1}
  st.club=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  return st}
function carnetKeys(m){const s=new Set(rosterKeys());for(const x of m.entries||[]){if(x.relay)(x.legs||[]).forEach(l=>l.a&&s.add(l.a));else s.add(x.a)}return s}
const isRelayEv=x=>x&&typeof x==="object"&&x.isrelay;
async function refresh(m,force){
  const id=L.links[m.id];if(!id||L.busy)return;L.busy=true;
  const st=stOf(id);
  try{
    await loadSr(id,!st.full);
    st.main=await getJ(`/meets/${id}/main.json`).catch(()=>st.main);
    const lh=await getJ(`/meets/${id}/lastHeat.json`).catch(()=>null);
    const stamp=lh&&lh.lastupdate||st.main.lastupdate;
    if(force||stamp!==st.stamp){
      const list=[...carnetKeys(m)].map(k=>st.byKey[k]).filter(Boolean);
      const files=await pool(list,6,a=>getJ(`/meets/${id}/athletes/${a.id}.json`));list.forEach((a,i)=>{if(files[i])st.ath[a.id]=files[i]});
      const evR=new Set(),evE=new Set();
      for(const a of list){const f=st.ath[a.id];if(!f)continue;(f.results||[]).forEach(r=>evR.add(String(r.eventid)));(f.entries||[]).forEach(e=>evE.add(String(e.eventid)))}
      /* relais : classements et séries de toutes les épreuves de relais jusqu'à aujourd'hui (la composition y figure) */
      const td=todayIso();
      for(const[k,x]of Object.entries(st.events||{}))if(isRelayEv(x)&&x.date<=td){evR.add(k);evE.add(k)}
      const nR=[...evR].filter(e=>!st.res[e]||st.res[e].status!==5),rr=await pool(nR,6,e=>getJ(`/meets/${id}/results/${e}.json`));nR.forEach((e,i)=>{if(rr[i])st.res[e]=rr[i]});
      for(const e of evR)evE.add(e);
      const nH=[...evE].filter(e=>!st.heats[e]||st.heats[e].status!==5),hh=await pool(nH,6,e=>getJ(`/meets/${id}/heats/${e}.json`));nH.forEach((e,i)=>{if(hh[i])st.heats[e]=hh[i]});
      if(st.club)st.clubFile=await getJ(`/meets/${id}/clubs/${st.club}.json`).catch(()=>st.clubFile);
      detectNew(st);
      st.stamp=stamp;st.changed=true;
    }
    st.lastOk=Date.now();st.err=null;saveSr(st);
  }catch(e){st.err="hors ligne";st.changed=true}
  L.busy=false;
}
/* Nouveaux résultats de mes nageurs : vibration du téléphone et badge « Nouveau » pendant 15 min. */
const FRESH_MS=15*60000;
function resultKeys(st){
  const keys=[],roster=rosterKeys();
  for(const k of roster){const a=st.byKey[k];const f=a&&st.ath[a.id];if(!f)continue;for(const r of f.results||[])if(r.swimtime||r.status)keys.push(a.id+"|"+r.eventid)}
  const sw=new Set(Object.values(S.athletes||{}).map(a=>String(a.swrid||"")).filter(Boolean));
  for(const[eid,x]of Object.entries(st.events||{})){if(!isRelayEv(x))continue;for(const o of relayRows(st,eid)){const r=o.row;if(!o.res||!(r.swimtime||r.status))continue;
    if((r.athletes||[]).some(a=>sw.has(String(a.swrid||""))))keys.push("R|"+eid+"|"+(r.teamnumber||r.id))}}
  return keys}
function detectNew(st){
  const sk="cl-seen-"+st.id,seen=ls.get(sk,null),now=Date.now(),keys=resultKeys(st);
  st.fresh=st.fresh||ls.get("cl-fresh-"+st.id,{});
  if(seen){const S0=new Set(seen);let n=0;for(const k of keys)if(!S0.has(k)){st.fresh[k]=now;n++}
    if(n&&navigator.vibrate)try{navigator.vibrate([120,80,120])}catch(e){}}
  for(const k of Object.keys(st.fresh))if(now-st.fresh[k]>FRESH_MS)delete st.fresh[k];
  ls.set(sk,keys);ls.set("cl-fresh-"+st.id,st.fresh)}
function isFreshKey(st,k){const t=st&&st.fresh&&st.fresh[k];return!!t&&Date.now()-t<FRESH_MS}
function isFresh(m,e,a){const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return false;const sa=st.byKey[a];if(!sa)return false;const se=srEventFor(st,e);return!!se&&isFreshKey(st,sa.id+"|"+se.id)}
const NEW_PILL='<span class="pill" style="background:var(--lane);color:#fff;font-size:10px;padding:1px 7px;margin-left:6px">Nouveau</span>';
function todayIso(){const t=new Date();return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`}
/* Actualisation automatique seulement pendant la compétition : jour de compétition,
   d'une heure avant la première épreuve du jour à deux heures après la dernière. Sinon : bouton Actualiser. */
function inWindow(st){
  if(!st||!st.main||+st.main.status===5)return false;
  const td=todayIso(),evs=Object.values(st.events||{}).filter(x=>x&&typeof x==="object"&&x.date===td);if(!evs.length)return false;
  const ts=evs.map(x=>x.time).filter(t=>/^\d{1,2}:\d\d$/.test(t||"")).map(t=>{const[a,b]=t.split(":");return+a*60+ +b});
  const n=new Date(),mn=n.getHours()*60+n.getMinutes();
  return ts.length?mn>=Math.min(...ts)-60&&mn<=Math.max(...ts)+120:mn>=420&&mn<=1320}
function srEventFor(st,e){
  const direct=st.events[e.id];
  const ok=x=>x&&parseInt(x.distance,10)===e.d&&SR_STROKE[String(x.stroke)]===e.s&&!x.isrelay;
  if(ok(direct)&&(srRound(direct)==="FIN")===(e.r==="FIN"))return direct;
  return Object.values(st.events).find(x=>x&&typeof x==="object"&&ok(x)&&x.date===e.date&&(srRound(x)==="FIN")===(e.r==="FIN"))||null}
const parseSp=(sp,d,swim)=>{const a=Object.entries(sp||{}).map(([k,v])=>[parseInt(k,10),cs(v)]).filter(x=>x[0]>0&&x[1]!=null).sort((x,y)=>x[0]-y[0]);if(swim!=null&&d&&(!a.length||a[a.length-1][0]<d))a.push([d,swim]);return a};
/* Série d'un nageur : numéro, nombre total de séries de l'épreuve, heure exacte de la série. */
function heatOf(st,eid,aid,code){const H=st.heats[String(eid)];if(!H||!H.heats)return{};const hs=H.heats.filter(x=>x&&(x.entries||[]).length&&((x.heatinfo&&x.heatinfo.key)||"")!=="R"&&String((x.heatinfo&&x.heatinfo.code)||x.code)!=="R");
  const ht=hs.find(x=>(x.entries||[]).some(y=>String(y.athleteid)===String(aid)))||hs.find(x=>String((x.heatinfo&&x.heatinfo.code)||x.code)===String(code));
  const maxN=Math.max(0,...hs.map(x=>+((x.heatinfo&&x.heatinfo.code)||x.code)||0));
  return{total:Math.max(hs.length,maxN)||null,time:ht?((ht.heatinfo&&ht.heatinfo.time)||ht.time||""):"",code:ht?((ht.heatinfo&&ht.heatinfo.code)||ht.code):null,lane:ht?((ht.entries||[]).find(y=>String(y.athleteid)===String(aid))||{}).lane:null}}
/* « Série 4/9 » ; en finale, les séries s'appellent A, B, C : « Finale A ». */
function heatLabel(code,total){if(code==null||code==="")return"";return/^\d+$/.test(String(code))?`Série ${code}${total?"/"+total:""}`:`Finale ${code}`}
/* Résultat direct d'un nageur du carnet (clé a) sur une épreuve du carnet. */
function result(m,e,a){
  const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return null;
  const sa=st.byKey[a];if(!sa)return null;const f=st.ath[sa.id];if(!f)return null;
  const se=srEventFor(st,e);if(!se)return null;
  const r=(f.results||[]).find(x=>String(x.eventid)===String(se.id));
  if(r){const swim=cs(r.swimtime),place=+r.place;let field=null,winner=null,second=null,ranking=null,ag="";
    const R=st.res[String(r.eventid)],g=R&&(R.agegroups||[]).find(x=>String(x.id)===String(r.agegroupid));
    if(g){ranking=g.results||[];const ok=ranking.filter(x=>+x.place>0&&cs(x.swimtime)!=null).sort((x,y)=>x.place-y.place);field=ok.length;winner=ok[0]?cs(ok[0].swimtime):null;second=ok[1]?cs(ok[1].swimtime):null}
    const agd=st.agegroups&&st.agegroups[r.agegroupid];ag=agd&&agd.name?agd.name.trim():"";
    if(place===1&&winner==null)winner=swim;
    const hi=heatOf(st,r.eventid,sa.id,r.heatinfo&&r.heatinfo.code);
    return{kind:"res",swim,place,field,winner,second,ranking,ag,status:r.status?String(r.status):"",pb:r.pbest?cs(r.pbest.swimtime):null,flag:r.flag&&r.flag.text||"",
      fresh:isFreshKey(st,sa.id+"|"+r.eventid),points:+r.points||null,rt:r.reactiontime||"",heat:(r.heatinfo&&r.heatinfo.code)||hi.code,heats:hi.total,lane:r.lane||hi.lane,time:(r.heatinfo&&r.heatinfo.time)||hi.time,sp:parseSp(r.splits,e.d,swim),me:String(sa.id),d:e.d}}
  const hi=heatOf(st,se.id,sa.id,null);
  return hi.code?{kind:"entry",heat:hi.code,heats:hi.total,lane:hi.lane,time:hi.time}:null}
/* Temps des séries pour une carte de finale : remplace le temps d'inscription. */
function prelim(m,e,a){
  const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return null;
  const sa=st.byKey[a];const f=sa&&st.ath[sa.id];if(!f)return null;
  const c=(f.results||[]).map(r=>({r,x:st.events[r.eventid]})).filter(({x})=>x&&!x.isrelay&&srRound(x)!=="FIN"&&parseInt(x.distance,10)===e.d&&SR_STROKE[String(x.stroke)]===e.s&&x.date<=e.date)
    .sort((p,q)=>(q.x.date===e.date)-(p.x.date===e.date)||q.x.date.localeCompare(p.x.date))[0];
  return c?{swim:cs(c.r.swimtime),place:+c.r.place}:null}
const pct=(d,base)=>base?`${d>0?"+":d<0?"−":"±"}${Math.abs(100*d/base).toFixed(1)} %`:"";
/* Cases à ajouter dans la carte de course (même présentation que le carnet). */
function nums(lv,ref,et,isFinal){
  if(!lv||lv.kind!=="res")return"";
  const unr=!(lv.place>0);
  if(lv.swim==null)return`<div class="res"><dt>Direct</dt><dd><span class="pill dq">${h(RSTAT[lv.status]||"Non classé")}</span></dd></div>`;
  const toWin=lv.place===1?(lv.second!=null?lv.swim-lv.second:null):(lv.winner!=null?lv.swim-lv.winner:null);
  return`<div class="res"><dt>Réalisé <span class="pill" style="font-size:10px;padding:0 6px">direct</span>${lv.fresh?NEW_PILL:""}</dt><dd>${tf(lv.swim)}${ref?`<small>${gp(lv.swim-ref.t)} vs MPP</small>`:lv.pb!=null?`<small>${gp(lv.swim-lv.pb)} vs record</small>`:""}</dd></div>
    <div><dt>Place${lv.ag?" "+h(lv.ag):""}</dt><dd>${unr?`<span class="pill dq">${h(RSTAT[lv.status]||"Non classé")}</span>`:`${lv.place===1?"1er":lv.place+"e"}${lv.field?` <small style="display:inline">/ ${lv.field}</small>`:""}`}${lv.flag==="PB"?'<small style="color:var(--good)">record perso</small>':""}</dd></div>
    <div><dt>${lv.place===1?"Avance 2e":"Au 1er"}</dt><dd>${gp(toWin)}</dd></div>
    ${et?`<div><dt>${isFinal?"vs séries":"vs inscription"}</dt><dd>${gp(lv.swim-et)}</dd></div>`:""}`}
/* Temps de passage du direct : chaque 100 m et chaque 50 m comparés au même segment de la MPP (carnet). */
function extra(lv,ref){
  if(!lv||lv.kind!=="res"||lv.swim==null)return"";
  let out="";
  if(lv.sp.length>1){
    const T={0:0};for(const[d,t]of lv.sp)T[d]=t;
    const M={};if(ref){M[0]=0;for(const[d,t]of ref.sp||[])M[d]=t;M[lv.d]=ref.t}
    const seg=(X,a,b)=>X[a]!=null&&X[b]!=null?X[b]-X[a]:null;
    let pd=0;const rows=lv.sp.map(([d])=>{const len=d-pd,r={d,cum:T[d],len,lap:seg(T,pd,d),mlap:seg(M,pd,d),h:d%100===0&&d>=100?seg(T,d-100,d):null,mh:d%100===0&&d>=100?seg(M,d-100,d):null};pd=d;return r});
    const p=rows.map(x=>x.lap*50/x.len),body=p.slice(1),srt=(body.length?body:p).slice().sort((a,b)=>a-b),med=srt[Math.floor(srt.length/2)];
    const has100=lv.d>=200||rows.some(x=>x.h!=null&&x.d<lv.d),lapLbl=rows.every(x=>x.len===50)?"50 m":"Partiel";
    const cell=(t,m)=>t==null?"<td></td><td></td>":`<td class="r">${tf(t)}${m!=null?`<div class="pc">${tf(m)}</div>`:""}</td><td class="r">${m!=null?gp(t-m):""}</td>`;
    const half=T[lv.d/2],mh=M[lv.d/2];
    out+=`<details class="spl" data-k="sp"><summary>Temps de passage${ref?" · comparaison MPP":""}</summary><table class="splits cmp"><thead><tr><th class="muted" style="font-weight:500">Dist.</th>${has100?'<th class="r muted" style="font-weight:500">100 m</th><th></th>':""}<th class="r muted" style="font-weight:500">${lapLbl}</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td class="muted">${x.d}<div class="pc" style="text-align:left">${tf(x.cum)}</div></td>${has100?cell(x.h,x.mh):""}${cell(x.lap,x.mlap).replace('<td class="r">',i>0&&p[i]>med*1.03?'<td class="r" style="color:var(--lane);font-weight:600">':'<td class="r">')}</tr>`).join("")}</tbody></table>
      ${half!=null&&lv.d>=100?`<div class="legend" style="color:var(--fg)">1re moitié ${tf(half)} · 2e moitié ${tf(lv.swim-half)} · différentiel ${gp(lv.swim-2*half)} (${pct(lv.swim-2*half,half)})${mh!=null&&ref?`<br><span class="muted">MPP : ${tf(mh)} / ${tf(ref.t-mh)} · différentiel ${gp(ref.t-2*mh)} (${pct(ref.t-2*mh,mh)})</span>`:""}</div>`:""}
      <div class="legend">Chaque segment est comparé au même segment de la MPP (en petit dessous) ; sous la distance, le temps de passage. 50 m en orange : plus de 3 % plus lent que la médiane (départ exclu).</div></details>`}
  if(lv.ranking&&lv.ranking.length){const rows=lv.ranking.slice().sort((a,b)=>(+a.place>0?+a.place:999)-(+b.place>0?+b.place:999));
    out+=`<details class="spl" data-k="rk"><summary>Classement${lv.ag?" "+h(lv.ag):""}</summary><table class="splits"><tbody>${rows.map(x=>`<tr${String(x.athleteid)===lv.me?' style="font-weight:600;background:var(--accent-soft)"':""}><td>${+x.place>0?x.place:"—"}</td><td>${h(x.nametext||"")}<div class="muted" style="font-size:12px">${h(x.clubname||x.clubcode||"")}${x.agetext?" · "+h(x.agetext):""}</div></td><td class="r">${x.swimtime?h(x.swimtime):h(RSTAT[x.status]||"—")}</td></tr>`).join("")}</tbody></table></details>`}
  return out}
/* Finales récupérées automatiquement depuis le direct. */
function finals(m,evs,ents){
  const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return[];const out=[];
  for(const en of ents){if(en.relay)continue;const e=evs[en.ev];if(!e||e.r==="FIN")continue;
    const sa=st.byKey[en.a];if(!sa||!st.ath[sa.id])continue;
    const f=st.ath[sa.id];const ids=new Set([...(f.results||[]).map(r=>String(r.eventid)),...(f.entries||[]).map(r=>String(r.eventid))]);
    for(const sid of ids){const x=st.events[sid];if(!x||srRound(x)!=="FIN"||x.isrelay)continue;
      if(parseInt(x.distance,10)===e.d&&SR_STROKE[String(x.stroke)]===e.s)out.push({x:en,e:{...e,r:"FIN",date:x.date,sess:999,time:x.time||"",id:String(x.id),n:+x.number||e.n},src:null,live:true})}}
  return out}

/* ---------- relais (direct) ----------
   Le format exact des relais sur live.swimrankings.net n'a pas pu être vérifié : la composition est cherchée
   dans toute liste de nageurs contenue dans la ligne du relais (classement, séries, fichier du club). */
function legsOf(row){
  if(!row||typeof row!=="object")return[];
  for(const v of Object.values(row)){if(!Array.isArray(v)||!v.length||typeof v[0]!=="object")continue;
    if(!v.some(o=>o&&(o.athleteid!=null||(o.id!=null&&(o.lastname||o.nametext||o.fullname)))))continue;
    return v.map((o,i)=>({aid:String(o.athleteid??o.id),pos:+(o.number??o.position??o.leg??o.order??o.relayposition??(i+1))||i+1,name:o.nametext||o.fullname||[o.lastname,o.firstname].filter(Boolean).join(", "),rt:o.reactiontime||""})).sort((a,b)=>a.pos-b.pos)}
  return[]}
function relayRows(st,eid){
  const out=[],seen=new Set(),club=st.club;const isMine=r=>club&&String(r.clubid)===club;
  const R=st.res[eid];if(R)for(const g of R.agegroups||[])for(const r of g.results||[])if(isMine(r)){const k=r.id||r.teamnumber||r.nametext;if(seen.has(k))continue;seen.add(k);out.push({row:r,res:true,group:g})}
  if(!out.length){const H=st.heats[eid];if(H)for(const ht of H.heats||[])for(const r of ht.entries||[])if(isMine(r)){const k=r.id||r.teamnumber||r.nametext;if(seen.has(k))continue;seen.add(k);out.push({row:r,res:false,heat:ht})}}
  const cf=st.clubFile;
  for(const o of out)if(!legsOf(o.row).length&&cf){const pool=[...(cf.results||[]),...(cf.entries||[])].filter(x=>String(x.eventid)===String(eid));
    const hit=pool.find(x=>(x.teamnumber!=null&&String(x.teamnumber)===String(o.row.teamnumber))||(x.id!=null&&String(x.id)===String(o.row.id)))||(pool.length===1?pool[0]:null);if(hit)o.extra=hit}
  return out}
function relayCards(m,day,ath){
  const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return"";
  const course=String(st.main.course)==="1"?"LCM":"SCM";
  const bySr={},byId={};for(const[k,a]of Object.entries(S.athletes||{}))if(a.swrid)bySr[String(a.swrid)]=k;
  for(const[k,a]of Object.entries(st.byKey||{}))if(S.athletes[k])byId[String(a.id)]=k;
  const mineOf=l=>bySr[String(l.swrid||"")]||byId[l.aid]||null;
  const evs=Object.entries(st.events||{}).filter(([,x])=>isRelayEv(x)&&(!day||x.date===day)).sort((p,q)=>(p[1].date+(p[1].time||"")).localeCompare(q[1].date+(q[1].time||""))||(+p[1].number)-(+q[1].number));
  let html="";
  for(const[eid,x]of evs){
    const legN=parseInt(String(x.distance).replace(/^.*x\s*/i,""),10)||0,count=parseInt(x.distance,10)||4,stroke=SR_STROKE[String(x.stroke)]||"FREE";
    const e={id:eid,n:+x.number||0,d:legN,s:stroke,rc:count,relay:true,r:srRound(x),date:x.date,c:course};
    for(const o of relayRows(st,eid)){
      const r=o.row,raw=(r.athletes&&r.athletes.length?r.athletes:(o.extra&&o.extra.athletes)||[]);
      const legs=raw.map((a,i)=>({pos:i+1,aid:String(a.id??a.athleteid),swrid:a.swrid,name:a.fullname||a.nametext||"",t:cs(a.swimtime)}));
      const mineLegs=legs.filter(mineOf);if(!mineLegs.length)continue;
      if(ath&&!legs.some(l=>mineOf(l)===ath))continue;
      const swim=cs(r.swimtime),place=+r.place,sp=parseSp(r.splits,legN*count,swim),T={0:0};for(const[d,t]of sp)T[d]=t;
      const ok=o.group?(o.group.results||[]).filter(y=>+y.place>0&&cs(y.swimtime)!=null).sort((p,q)=>p.place-q.place):[];
      const hi=heatOf(st,eid,"",(r.heatinfo&&r.heatinfo.code)||((o.heat||{}).heatinfo||{}).code);
      const legHtml=legs.map(l=>{const key=mineOf(l),mine=key&&S.athletes[key];
        const st2=stroke==="MEDLEY"?(["BACK","BREAST","FLY","FREE"][l.pos-1]||"FREE"):stroke;
        const a0=legN*(l.pos-1),a1=legN*l.pos;const legT=l.t!=null?l.t:(T[a1]!=null&&T[a0]!=null?T[a1]-T[a0]:null);
        const nm=mine?`${mine.first} ${mine.last}`:(l.name?l.name.split(", ").reverse().join(" "):"Relayeur");
        let det="";
        if(mine){const mp=typeof mppOf==="function"?mppOf(key,legN,st2,course,m.info.start):null;
          const inner=[];for(let d=a0+50;d<=a1;d+=50)if(T[d]!=null&&T[a0]!=null)inner.push(`<span class="num">${d-a0} m ${tf(T[d]-T[a0])}${d>a0+50&&T[d-50]!=null?` <span class="muted">(${tf(T[d]-T[d-50])})</span>`:""}</span>`);
          det=`<div class="legend" style="color:var(--fg);margin:2px 0 0">${l.pos===1&&legT!=null?'<span class="pill" style="font-size:10px;padding:1px 7px;background:var(--good-soft);color:var(--good)">Temps individuel</span> ':""}${inner.length>1?"Passages : "+inner.join(" · "):""}${mp?`${inner.length>1?"<br>":""}<span class="muted">MPP ${legN} ${STROKES[st2]||st2} : ${tf(mp.t)} (${fmtDate(mp.date)}, départ plongé)</span>`:""}</div>`+
            noteBox(nidRel(key,e),{...noteMeta(m,e,key,`Relais ${count}×${legN} ${STROKES[stroke]||""}`),d:legN,s:st2,leg:l.pos})}
        return`<div class="leg"><div class="who"><span><b>${l.pos}.</b> ${mine?`<b>${h(nm)}</b>`:h(nm)} <span class="muted">${legN} ${STROKES[st2]||st2}</span></span><span class="num">${legT!=null?`<b>${tf(legT)}</b>`:""}</span></div>${det}</div>`}).join("");
      const where=[heatLabel(hi.code||(r.heatinfo&&r.heatinfo.code),hi.total),r.lane?`couloir ${r.lane}`:"",hi.time||""].filter(Boolean).join(" · ");
      const fr=isFreshKey(st,"R|"+eid+"|"+(r.teamnumber||r.id));
      html+=`<div class="ccard${o.res?" fin":""}${fr?" fresh":""}"><h4>Relais ${count}×${legN} ${h(STROKES[stroke]||stroke)}${fr?NEW_PILL:""}<small>Épr. ${h(x.number)}${x.time?" · "+h(x.time):""}${e.r==="FIN"?" · finale":""}</small></h4>
        <div class="muted" style="font-size:13px;margin-top:-4px">Équipe ${h(r.teamnumber||"")}${where?" · "+h(where):""}</div>
        <dl class="nums"><div><dt>Inscription</dt><dd>${r.entrytime&&r.entrytime!=="NT"?h(r.entrytime):"NT"}</dd></div>
          ${o.res?`<div class="res"><dt>Réalisé</dt><dd>${swim!=null?tf(swim):`<span class="pill dq">${h(RSTAT[r.status]||"Non classé")}</span>`}</dd></div><div><dt>Place</dt><dd>${place>0?(place===1?"1er":place+"e"):"—"}${ok.length?` <small style="display:inline">/ ${ok.length}</small>`:""}</dd></div>`:""}</dl>
        ${legHtml}</div>`}}
  return html?`<section class="sess"><h3 class="sh">Relais <span class="muted shm">direct</span></h3><div class="cgrid">${html}</div></section>`:""}

function ago(t){if(!t)return"…";const s=Math.round((Date.now()-t)/1000);return s<60?`il y a ${s} s`:s<3600?`il y a ${Math.round(s/60)} min`:"à "+new Date(t).toLocaleTimeString("fr-CH",{hour:"2-digit",minute:"2-digit"})}
function liveText(st){
  if(!st||!st.main)return st&&st.err?"hors ligne · pas encore de données":"chargement…";
  const when=st.lastOk?new Date(st.lastOk).toLocaleString("fr-CH",{weekday:"short",hour:"2-digit",minute:"2-digit"}):"";
  if(st.err)return`hors ligne · données de ${when}`;
  if(+st.main.status===5)return`compétition terminée · données de ${when}`;
  if(inWindow(st))return"en direct · mise à jour "+ago(st.lastOk);
  return`actualisation manuelle · données de ${when}`}
/* Bandeau en tête de l'onglet Compétition. */
function bar(m){
  watch(m);
  const id=L.links[m.id];
  if(L.editing===m.id)return`<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><b>Résultats en direct</b><input id="liveId" class="tsel" inputmode="numeric" placeholder="n° ou lien live.swimrankings.net" value="${h(id||"")}" style="flex:1;min-width:180px"><button class="btn" data-live-act="save">Lier</button><button class="btn ghost" data-live-act="unlink">Aucun direct</button><button class="btn ghost" data-live-act="cancel">Annuler</button></div>`;
  if(id===undefined)return`<div class="legend" style="margin:0 0 10px">Recherche de la compétition sur live.swimrankings.net…</div>`;
  if(!id)return`<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span class="muted">Pas de résultats en direct liés à cette compétition.</span><button class="btn ghost" data-live-act="edit">Lier le direct</button></div>`;
  const st=L.sr[id];const on=st&&!st.err&&inWindow(st);
  return`<div class="card" style="padding:8px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:14px">
    <span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${st&&st.err?"var(--lane)":on?"var(--good)":"var(--muted)"}"></i><b>Direct</b></span>
    <span class="muted" id="liveAgo">${h(liveText(st))}</span>
    <span style="flex:1"></span><button class="btn ghost" data-live-act="now" style="padding:4px 10px">Actualiser</button><button class="btn ghost" data-live-act="edit" style="padding:4px 10px">Changer</button>
    ${st&&st.main?`<button class="btn ghost" data-live-act="save2" style="padding:4px 10px">${st.savedAt?"Réenregistrer":"Enregistrer"} dans le carnet</button>`:""}
    <a href="https://live.swimrankings.net/${h(id)}/" target="_blank" rel="noopener" class="muted" style="font-size:13px">swimrankings ↗</a></div>`}
let watched=null,timer=null;
/* À l'ouverture : données gardées sur l'appareil tout de suite ; chargement réseau seulement si rien n'est gardé
   ou si la compétition est en cours. */
function watch(m){
  if(watched!==m.id){watched=m.id;
    const go=()=>{const id=L.links[m.id];if(!id)return rerender();const st=stOf(id);st.changed=true;
      if(!st.lastOk||inWindow(st))refresh(m,true).then(rerender);else rerender()};
    if(L.links[m.id]===undefined)autoLink(m).then(go);else go()}
  if(!timer)timer=setInterval(tick,5000)}
function tick(){
  const a=document.getElementById("liveAgo");const id=watched&&L.links[watched],st=id&&L.sr[id];
  if(a&&st)a.textContent=liveText(st);
  if(!watched||!id||document.hidden||typeof S==="undefined"||S.view!=="comp"||!inWindow(st))return;
  if(Date.now()-(st.lastOk||0)>=POLL_MS-1000||(st.err&&Date.now()-(st.lastTry||0)>=POLL_MS)){st.lastTry=Date.now();const m=(typeof C!=="undefined"?C.meets:[]).find(x=>x.id===watched);if(m)refresh(m,false).then(rerender)}}
function rerender(){
  const st=watched&&L.links[watched]&&L.sr[L.links[watched]];
  if(st&&st.changed===false)return;if(st)st.changed=false;
  if(typeof S!=="undefined"&&S.view==="comp"&&!typingNote()&&!document.activeElement?.classList?.contains("rt")&&document.activeElement?.id!=="liveId")renderComp()}

const SR_ST={"1":"EXH","2":"DSQ","3":"DNS","4":"DNF"};
function collectResults(st){
  const course=String(st.main.course)==="1"?"LCM":"SCM",per={};
  const add=(k,res)=>{(per[k]=per[k]||[]).push(res)};
  for(const k of rosterKeys()){const a=st.byKey[k],f=a&&st.ath[a.id],ca=S.athletes[k];if(!f||!ca)continue;
    for(const r of f.results||[]){const x=st.events[r.eventid];if(!x||x.isrelay)continue;const d=parseInt(x.distance,10),s=SR_STROKE[String(x.stroke)];if(!d||!s)continue;
      const t=cs(r.swimtime),stt=+r.place>0?"":(r.status?(t==null?"DNS":(SR_ST[String(r.status)]||"DSQ")):(t==null?"DNS":""));
      add(k,{d,s,r:srRound(x),c:course,date:x.date,t:stt==="DNS"?null:t,p:stt||t==null?0:(+r.points||aquaPts(ca.gender,course,d,s,t)),st:stt,sp:parseSp(r.splits,d,t).filter(z=>z[0]<d)})}}
  /* 1er relayeur : temps individuel officiel (départ plongé). */
  const bySr={};for(const[k,a]of Object.entries(S.athletes||{}))if(a.swrid)bySr[String(a.swrid)]=k;
  for(const[eid,x]of Object.entries(st.events||{})){if(!isRelayEv(x))continue;
    const legN=parseInt(String(x.distance).replace(/^.*x\s*/i,""),10)||0,stroke=SR_STROKE[String(x.stroke)]||"FREE",s1=stroke==="MEDLEY"?"BACK":stroke;
    for(const o of relayRows(st,eid)){const r=o.row,first=(r.athletes||[])[0];if(!o.res||!first)continue;const k=bySr[String(first.swrid||"")];if(!k)continue;
      const T={0:0};for(const[d,t]of parseSp(r.splits,0,null))T[d]=t;const t=cs(first.swimtime)??T[legN]??null;if(t==null)continue;
      const sp=[];for(let d=50;d<legN;d+=50)if(T[d]!=null)sp.push([d,T[d]]);
      add(k,{d:legN,s:s1,r:srRound(x),c:course,date:x.date,t,p:aquaPts(S.athletes[k].gender,course,legN,s1,t),st:"",sp,relay:true})}}
  return per}
async function saveToCarnet(m){
  const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return;
  const per=collectResults(st),ks=Object.keys(per);const n=ks.reduce((a,k)=>a+per[k].length,0);
  if(!n){alert("Aucun résultat de tes nageurs à enregistrer pour l'instant.");return}
  if(!confirm(`Enregistrer ${n} résultat(s) de ${ks.length} nageur(s) dans le carnet ?\nUn import Lenex des résultats de cette compétition remplacera ensuite ces données (sans doublon).`))return;
  const M=st.main,info={key:M.startdate+"-"+sl(M.city),name:M.name,city:M.city,nation:M.nation||"",course:String(M.course)==="1"?"LCM":"SCM",date:M.startdate};
  try{for(const k of ks)await S.db.collection("swims").doc(k+"__"+info.key).set({athlete:k,meet:info,results:per[k],source:"live:"+id,saved:new Date().toISOString()});
    st.savedAt=Date.now();saveSr(st);alert(`${n} résultat(s) enregistré(s). Ils apparaissent dans l'onglet Nageur et servent de MPP pour la suite.`);renderComp()}
  catch(e){alert("Enregistrement interrompu : "+(e.message||e))}}

/* Création d'une feuille de route à partir du direct (quand aucun Lenex d'engagements n'a été importé). */
function pickerHtml(){
  if(!L.picker)return`<div style="margin-top:14px"><button class="btn" data-live-act="picker">Créer depuis les résultats en direct</button></div>`;
  if(!L.meetList){meetList().then(()=>renderComp()).catch(()=>{});return`<p class="muted">Chargement de la liste des compétitions…</p>`}
  const g=L.meetList.find(x=>x.code===L.pickNation)||L.meetList[0];const ms=(g?g.meets:[]).filter(x=>x.status!==5).sort((a,b)=>a.startdate.localeCompare(b.startdate));
  return`<div style="margin-top:14px;text-align:left"><div class="ctl"><label class="l" for="livePickNat">Pays</label><select id="livePickNat" class="tsel">${L.meetList.map(x=>`<option value="${h(x.code)}"${g&&x.code===g.code?" selected":""}>${h(x.name)}</option>`).join("")}</select><button class="btn ghost" data-live-act="pickclose">Fermer</button></div>
    ${ms.length?`<div class="card">${ms.map(x=>`<button class="sw" style="padding:10px 12px;border-bottom:1px solid var(--line);border-radius:0" data-live-create="${h(x.id)}"><span><b>${h(x.name)}</b><br><span class="muted">${h(x.city)} · ${h(x.startdate)}${x.enddate!==x.startdate?" – "+h(x.enddate):""}</span></span><span class="pts">créer ›</span></button>`).join("")}</div>`:`<p class="muted">Aucune compétition à venir dans ce pays.</p>`}
    <p class="legend">Seuls tes nageurs (ceux de la liste du carnet) sont repris, avec leurs épreuves individuelles. Les relais de ton club s\u2019affichent tout seuls depuis le direct.</p><div id="liveMsg" class="msg"></div></div>`}
async function createFromLive(id){
  const msg=t=>{const el=document.getElementById("liveMsg");if(el)el.textContent=t};
  msg("Lecture du direct…");
  try{
    const st=await loadSr(id,true);const roster=Object.entries(S.athletes).filter(([,a])=>a.mine!==false);
    const mine=roster.map(([k])=>[k,st.byKey[k]]).filter(x=>x[1]);
    if(!mine.length){msg("Aucun de tes nageurs n'est inscrit à cette compétition (ou les inscriptions ne sont pas encore publiées).");return}
    const files=await pool(mine,6,([,a])=>getJ(`/meets/${id}/athletes/${a.id}.json`));
    const course=String(st.main.course)==="1"?"LCM":"SCM";
    const dates=[...new Set(Object.values(st.events).filter(x=>x&&x.date).map(x=>x.date))].sort();
    const sessN=d=>dates.indexOf(d)+1;
    const events={},entries=[];
    mine.forEach(([k,a],i)=>{const f=files[i];if(!f)return;const ca=S.athletes[k];
      const items=[...(f.entries||[]).map(x=>({eid:String(x.eventid),et:cs(x.entrytime),ec:x.entrycourse})),...(f.results||[]).map(x=>({eid:String(x.eventid),et:cs(x.entrytime),ec:x.entrycourse,heat:x.heatinfo&&+x.heatinfo.code,lane:x.lane}))];
      for(const it of items){const x=st.events[it.eid];if(!x||x.isrelay||!SR_STROKE[String(x.stroke)])continue;
        events[it.eid]={id:it.eid,n:+x.number||0,d:parseInt(x.distance,10),s:SR_STROKE[String(x.stroke)],rc:1,relay:false,r:srRound(x),g:SR_GENDER[String(x.gender)]||"",date:x.date,sess:sessN(x.date),time:x.time||"",c:course};
        if(!entries.some(e=>e.a===k&&e.ev===it.eid))entries.push({a:k,first:ca.first,last:ca.last,ev:it.eid,et:it.et,ec:it.ec?(String(it.ec)==="1"?"LCM":"SCM"):"",heat:it.heat||null,lane:it.lane||null,st:""})}});
    if(!entries.length){msg("Tes nageurs sont inscrits, mais aucune épreuve individuelle n'est encore publiée.");return}
    const evs=Object.values(events);
    const sessions=dates.filter(d=>evs.some(e=>e.date===d)).map(d=>({n:sessN(d),date:d,warm:"",time:evs.filter(e=>e.date===d).map(e=>e.time).filter(Boolean).sort()[0]||"",c:course}));
    const info={key:st.main.startdate+"-"+sl(st.main.city),name:st.main.name,city:st.main.city,course,start:st.main.startdate,end:st.main.enddate||st.main.startdate};
    if(C.meets.some(x=>x.id===info.key)&&!confirm("Une feuille de route existe déjà pour cette compétition. La remplacer ? Les notes sont conservées."))return msg("");
    await S.db.collection("meets").doc(info.key).set({info,sessions,events:evs,entries,imported:new Date().toISOString(),source:"live:"+id});
    L.links[info.key]=String(id);ls.set("cl-links",L.links);L.picker=false;C.pick=info.key;C.day=null;renderComp();
  }catch(e){msg("Création impossible ("+e.message+").")}}

document.addEventListener("click",e=>{
  const b=e.target.closest("[data-live-act],[data-live-create]");if(!b)return;
  if(b.dataset.liveCreate){createFromLive(b.dataset.liveCreate);return}
  const m=(typeof curMeet==="function")&&curMeet();const act=b.dataset.liveAct;
  if(act==="picker"){L.picker=true;renderComp();return}
  if(act==="pickclose"){L.picker=false;renderComp();return}
  if(!m)return;
  if(act==="edit"){L.editing=m.id;renderComp();setTimeout(()=>document.getElementById("liveId")?.focus(),0)}
  else if(act==="cancel"){L.editing=null;renderComp()}
  else if(act==="unlink"){L.links[m.id]=null;ls.set("cl-links",L.links);L.editing=null;renderComp()}
  else if(act==="save"){const v=(document.getElementById("liveId").value||"").match(/(\d{3,})/);if(!v)return;L.links[m.id]=v[1];ls.set("cl-links",L.links);L.editing=null;watched=null;renderComp()}
  else if(act==="save2"){saveToCarnet(m)}
  else if(act==="now"){refresh(m,true).then(()=>{const st=L.sr[L.links[m.id]];if(st)st.changed=true;rerender()})}
});
document.addEventListener("change",e=>{if(e.target.id==="livePickNat"){L.pickNation=e.target.value;renderComp()}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="liveId"){e.preventDefault();document.querySelector('[data-live-act="save"]')?.click()}});

{const st=document.createElement("style");st.textContent=".ccard.fresh{border-color:var(--lane);box-shadow:0 0 0 1px var(--lane)}.splits.cmp td,.splits.cmp th{padding:3px 4px;font-size:13px}.splits.cmp .pc{text-align:right}";document.head.appendChild(st)}
const OPEN=new Set(ls.get("cl-open",[]));
function detKey(d){const c=d.closest(".ccard");const id=c&&(c.querySelector(".nbox")||{}).dataset;return(id&&id.nid||(c&&c.querySelector("h4")?.textContent)||"")+"|"+(d.dataset.k||d.querySelector("summary")?.textContent||"")}
document.addEventListener("toggle",e=>{const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.closest("#viewComp"))return;const k=detKey(d);if(d.open)OPEN.add(k);else OPEN.delete(k);ls.set("cl-open",[...OPEN].slice(-300))},true);
function restoreOpen(){document.querySelectorAll("#viewComp details").forEach(d=>{const o=OPEN.has(detKey(d));if(d.open!==o)d.open=o})}
window.LIVE={restoreOpen,isFresh,heatLabel,result,nums,extra,finals,bar,pickerHtml,prelim,relayCards};

/* ================= SYNC ================= */
function syncBadge(st){
  const t=st.state==="ok"?(st.pending?`${st.pending} en attente`:"Synchronisé"):st.state==="sync"?"Synchronisation…":st.state==="error"?`Hors ligne${st.pending?` · ${st.pending} en attente`:""}`:"Non connecté";
  const c=st.state==="ok"&&!st.pending?"var(--good)":st.state==="error"?"var(--lane)":st.state==="local"?"var(--lane)":"var(--accent)";
  return`<i style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block"></i><span>${t}</span>`}
let bkText="",bkErr=false;
function panelHtml(){
  const c=Store.config(),st=Store.status();
  const link=c?location.href.split("#")[0]+"#cfg="+btoa(unescape(encodeURIComponent(JSON.stringify(c)))):"";
  return`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0;font-family:var(--display);font-size:22px">Synchronisation</h3><button class="btn ghost" id="syncClose">Fermer</button></div>
  <p style="display:flex;gap:8px;align-items:center;margin:10px 0">${syncBadge(st)}${st.lastSync?`<span class="muted" style="font-size:13px">· dernier échange ${new Date(st.lastSync).toLocaleTimeString("fr-CH",{hour:"2-digit",minute:"2-digit"})}</span>`:""}</p>
  ${st.error?`<p class="msg err">${h(st.error)}</p>`:""}
  ${c?`<p class="muted" style="font-size:14px">Connecté au Google Sheet. Tes données sont aussi gardées sur cet appareil : l'appli fonctionne sans réseau et envoie les changements au retour de la connexion.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="syncNow">Synchroniser maintenant</button><button class="btn ghost" id="syncOff">Déconnecter cet appareil</button></div>
    <h4 class="sh" style="font-size:16px;margin:18px 0 6px">Connecter un autre appareil</h4><p class="muted" style="font-size:14px;margin:0 0 6px">Envoie-toi ce lien et ouvre-le sur le téléphone : il se connecte tout seul. Il contient ta clé : ne le partage pas.</p>
    <div style="display:flex;gap:8px"><input class="tsel" id="syncLink" readonly value="${h(link)}" style="flex:1;min-width:0"><button class="btn ghost" id="syncCopy">Copier</button></div>`
  :`<p style="font-size:14px">Tes données restent sur cet appareil tant que le Google Sheet n'est pas connecté.</p>
    <label class="l" for="syncUrl">Adresse du script (Application Web)</label><input class="tsel" id="syncUrl" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%;margin:4px 0 10px">
    <label class="l" for="syncKey">Clé</label><input class="tsel" id="syncKey" autocomplete="off" style="width:100%;margin:4px 0 10px">
    <button class="btn" id="syncGo">Connecter</button><div id="syncMsg" class="msg"></div>`}
  <h4 class="sh" style="font-size:16px;margin:18px 0 6px">Sauvegarde</h4>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="bkOut">Télécharger une sauvegarde</button><button class="btn ghost" id="bkIn">Restaurer une sauvegarde…</button><input type="file" id="bkFile" accept=".json,application/json" hidden></div><div id="bkMsg" class="msg${bkErr?" err":""}">${h(bkText)}</div>`}
function openPanel(){const p=document.getElementById("syncPanel");p.innerHTML=panelHtml();p.hidden=false;bindPanel()}
function bindPanel(){
  const $$=id=>document.getElementById(id);
  $$("syncClose").onclick=()=>{$$("syncPanel").hidden=true};
  if($$("syncGo"))$$("syncGo").onclick=async()=>{const b=$$("syncGo");b.disabled=true;$$("syncMsg").className="msg";$$("syncMsg").textContent="Connexion…";
    try{await Store.configure($$("syncUrl").value,$$("syncKey").value);openPanel()}catch(e){$$("syncMsg").className="msg err";$$("syncMsg").textContent=e.message;b.disabled=false}};
  if($$("syncNow"))$$("syncNow").onclick=()=>{Store.syncNow();setTimeout(openPanel,1500)};
  if($$("syncOff"))$$("syncOff").onclick=()=>{if(confirm("Déconnecter cet appareil du Google Sheet ? Les données restent sur l'appareil et dans le Sheet.")){Store.disconnect();openPanel()}};
  if($$("syncCopy"))$$("syncCopy").onclick=async()=>{const i=$$("syncLink");i.select();try{await navigator.clipboard.writeText(i.value);$$("syncCopy").textContent="Copié"}catch(e){document.execCommand("copy")}};
  $$("bkOut").onclick=()=>{const b=new Blob([JSON.stringify(Store.dump())],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`carnet-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)};
  $$("bkIn").onclick=()=>$$("bkFile").click();
  $$("bkFile").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;const msg=$$("bkMsg");
    try{const bk=JSON.parse(await f.text());if(!confirm("Restaurer cette sauvegarde ? Les fiches du fichier remplacent celles du même nom ; les autres sont conservées."))return;
      bkErr=false;const n=await Store.restore(bk,(i,t)=>{bkText=`Restauration ${i} / ${t}…`;const el=document.getElementById("bkMsg");if(el)el.textContent=bkText});bkText=`${n} fiches restaurées. Envoi vers le Google Sheet : suis l'état en haut de cette fenêtre.`;openPanel()}
    catch(err){bkErr=true;bkText=err.message;openPanel()}};
}
/* Lien de connexion d'un autre appareil : …/#cfg=<base64> */
async function hashConfig(){
  const m=location.hash.match(/cfg=([^&]+)/);if(!m)return;
  history.replaceState(null,"",location.href.split("#")[0]);
  try{const c=JSON.parse(decodeURIComponent(escape(atob(m[1]))));await Store.configure(c.url,c.k);const p=document.getElementById("syncPanel");if(p)p.hidden=true;alert("Appareil connecté au Google Sheet. Tes données arrivent.")}catch(e){alert("Connexion impossible : "+e.message)}}
function mountSync(){
  const hd=document.querySelector("header.top > div");if(!hd)return;
  const b=document.createElement("button");b.className="btn ghost";b.id="syncBtn";b.style.cssText="display:inline-flex;gap:6px;align-items:center";b.title="Synchronisation";
  hd.appendChild(b);b.onclick=openPanel;
  const p=document.createElement("div");p.id="syncPanel";p.className="card";p.hidden=true;p.style.cssText="padding:16px;margin-bottom:16px";
  document.querySelector("header.top").after(p);
  Store.onStatus(st=>{b.innerHTML=syncBadge(st);if(!p.hidden&&!p.contains(document.activeElement))p.innerHTML=panelHtml(),bindPanel()});
  if(!Store.config()&&!/cfg=/.test(location.hash))setTimeout(openPanel,300);
}
window.SYNC={mount:mountSync,hashConfig};
})();
