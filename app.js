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
async function loadSr(id){
  if(L.sr[id]&&L.sr[id].main)return L.sr[id];
  const st=L.sr[id]||(L.sr[id]={id,ath:{},res:{},heats:{},stamp:null,lastOk:0,err:null});
  const [main,events,agegroups,athletes]=await Promise.all(["main","events","agegroups","athletes"].map(f=>getJ(`/meets/${id}/${f}.json`)));
  Object.assign(st,{main,events,agegroups,athletes:arr(athletes)});
  st.byKey={};for(const a of st.athletes)st.byKey[sl(a.lastname)+"-"+sl(a.firstname)]=a;
  return st}
function carnetKeys(m){const s=new Set();for(const x of m.entries||[]){if(x.relay)(x.legs||[]).forEach(l=>l.a&&s.add(l.a));else s.add(x.a)}return s}
async function refresh(m,force){
  const id=L.links[m.id];if(!id||L.busy)return;L.busy=true;
  const st=L.sr[id]||(L.sr[id]={id,ath:{},res:{},heats:{}});
  try{
    await loadSr(id);
    const lh=await getJ(`/meets/${id}/lastHeat.json`).catch(()=>null);
    const stamp=lh&&lh.lastupdate||st.main.lastupdate;
    if(force||stamp!==st.stamp){
      const list=[...carnetKeys(m)].map(k=>st.byKey[k]).filter(Boolean);
      const files=await pool(list,6,a=>getJ(`/meets/${id}/athletes/${a.id}.json`));list.forEach((a,i)=>{if(files[i])st.ath[a.id]=files[i]});
      const evR=new Set(),evE=new Set();
      for(const a of list){const f=st.ath[a.id];if(!f)continue;(f.results||[]).forEach(r=>evR.add(String(r.eventid)));(f.entries||[]).forEach(e=>evE.add(String(e.eventid)))}
      const nR=[...evR].filter(e=>!st.res[e]||st.res[e].status!==5),rr=await pool(nR,6,e=>getJ(`/meets/${id}/results/${e}.json`));nR.forEach((e,i)=>{if(rr[i])st.res[e]=rr[i]});
      const nH=[...evE].filter(e=>!st.heats[e]||st.heats[e].status!==5),hh=await pool(nH,6,e=>getJ(`/meets/${id}/heats/${e}.json`));nH.forEach((e,i)=>{if(hh[i])st.heats[e]=hh[i]});
      st.stamp=stamp;st.changed=true;
    }
    st.lastOk=Date.now();st.err=null;
  }catch(e){st.err="Direct injoignable ("+e.message+")"}
  L.busy=false;
}
function srEventFor(st,e){
  const direct=st.events[e.id];
  const ok=x=>x&&parseInt(x.distance,10)===e.d&&SR_STROKE[String(x.stroke)]===e.s&&!x.isrelay;
  if(ok(direct)&&(srRound(direct)==="FIN")===(e.r==="FIN"))return direct;
  return Object.values(st.events).find(x=>x&&typeof x==="object"&&ok(x)&&x.date===e.date&&(srRound(x)==="FIN")===(e.r==="FIN"))||null}
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
    const sp=Object.entries(r.splits||{}).map(([k,v])=>[parseInt(k,10),cs(v)]).filter(x=>x[0]>0&&x[1]!=null).sort((x,y)=>x[0]-y[0]);
    if(swim!=null&&(!sp.length||sp[sp.length-1][0]<e.d))sp.push([e.d,swim]);
    return{kind:"res",swim,place,field,winner,second,ranking,ag,status:r.status?String(r.status):"",pb:r.pbest?cs(r.pbest.swimtime):null,flag:r.flag&&r.flag.text||"",
      points:+r.points||null,rt:r.reactiontime||"",heat:r.heatinfo&&r.heatinfo.code,lane:r.lane,time:r.heatinfo&&r.heatinfo.time,sp,me:String(sa.id),d:e.d}}
  const H=st.heats[String(se.id)];
  if(H)for(const ht of H.heats||[])for(const x of ht.entries||[])if(String(x.athleteid)===String(sa.id))return{kind:"entry",heat:(ht.heatinfo&&ht.heatinfo.code)||ht.code,lane:x.lane,time:(ht.heatinfo&&ht.heatinfo.time)||ht.time};
  return null}
/* Cases à ajouter dans la carte de course (même présentation que le carnet). */
function nums(lv,ref,et){
  if(!lv||lv.kind!=="res")return"";
  const unr=!(lv.place>0);
  if(lv.swim==null)return`<div class="res"><dt>Direct</dt><dd><span class="pill dq">${h(RSTAT[lv.status]||"Non classé")}</span></dd></div>`;
  const toWin=lv.place===1?(lv.second!=null?lv.swim-lv.second:null):(lv.winner!=null?lv.swim-lv.winner:null);
  return`<div class="res"><dt>Réalisé <span class="pill" style="font-size:10px;padding:0 6px">direct</span></dt><dd>${tf(lv.swim)}${ref?`<small>${gp(lv.swim-ref.t)} vs MPP</small>`:lv.pb!=null?`<small>${gp(lv.swim-lv.pb)} vs record</small>`:""}</dd></div>
    <div><dt>Place${lv.ag?" "+h(lv.ag):""}</dt><dd>${unr?`<span class="pill dq">${h(RSTAT[lv.status]||"Non classé")}</span>`:`${lv.place===1?"1er":lv.place+"e"}${lv.field?` <small style="display:inline">/ ${lv.field}</small>`:""}`}${lv.flag==="PB"?'<small style="color:var(--good)">record perso</small>':""}</dd></div>
    <div><dt>${lv.place===1?"Avance 2e":"Au 1er"}</dt><dd>${gp(toWin)}</dd></div>
    ${et?`<div><dt>vs inscription</dt><dd>${gp(lv.swim-et)}</dd></div>`:""}`}
function extra(lv){
  if(!lv||lv.kind!=="res"||lv.swim==null)return"";
  let out="";
  if(lv.sp.length>1){let pd=0,pt=0;const rows=lv.sp.map(([d,t])=>{const lap=t-pt,len=d-pd;pd=d;pt=t;return{d,t,lap,len,p50:lap*50/len}});
    const p=rows.map(x=>x.p50),body=p.slice(1),mn=Math.min(...p),mx=Math.max(...p),srt=(body.length?body:p).slice().sort((a,b)=>a-b),med=srt[Math.floor(srt.length/2)];
    const half=rows.find(x=>x.d===lv.d/2);
    out+=`<details class="spl"><summary>Répartition de course</summary><table class="splits"><tbody>${rows.map((x,i)=>`<tr><td class="muted">${x.d} m</td><td class="r">${tf(x.t)}</td><td class="r muted">${tf(x.lap)}</td><td style="width:40%"><span class="pace${i>0&&x.p50>med*1.03?" slow":""}" style="width:${mx===mn?100:Math.round(35+65*(x.p50-mn)/(mx-mn))}%"></span></td></tr>`).join("")}</tbody></table>
      ${half&&lv.d>=100?`<div class="legend" style="color:var(--fg)">1re moitié ${tf(half.t)} · 2e moitié ${tf(lv.swim-half.t)} · différentiel ${gp(lv.swim-2*half.t)}</div>`:""}
      ${body.length>=2?`<div class="legend" style="color:var(--fg)">Écart entre partiels hors départ : ${tf(Math.round(Math.max(...body)-Math.min(...body)))} /50</div>`:""}
      <div class="legend">Barre plus longue = segment plus lent (ramené au 50 m). Orange : plus de 3 % au-dessus de la médiane (départ exclu).</div></details>`}
  if(lv.ranking&&lv.ranking.length){const rows=lv.ranking.slice().sort((a,b)=>(+a.place>0?+a.place:999)-(+b.place>0?+b.place:999));
    out+=`<details class="spl"><summary>Classement${lv.ag?" "+h(lv.ag):""}</summary><table class="splits"><tbody>${rows.map(x=>`<tr${String(x.athleteid)===lv.me?' style="font-weight:600;background:var(--accent-soft)"':""}><td>${+x.place>0?x.place:"—"}</td><td>${h(x.nametext||"")}<div class="muted" style="font-size:12px">${h(x.clubname||x.clubcode||"")}${x.agetext?" · "+h(x.agetext):""}</div></td><td class="r">${x.swimtime?h(x.swimtime):h(RSTAT[x.status]||"—")}</td></tr>`).join("")}</tbody></table></details>`}
  return out}
/* Finales détectées en direct (le carnet n'a pas besoin du bouton « Finale »). */
function finals(m,evs,ents){
  const id=L.links[m.id],st=id&&L.sr[id];if(!st||!st.main)return[];const out=[];
  for(const en of ents){if(en.relay)continue;const e=evs[en.ev];if(!e||e.r==="FIN")continue;
    const sa=st.byKey[en.a];if(!sa||!st.ath[sa.id])continue;
    const f=st.ath[sa.id];const ids=new Set([...(f.results||[]).map(r=>String(r.eventid)),...(f.entries||[]).map(r=>String(r.eventid))]);
    for(const sid of ids){const x=st.events[sid];if(!x||srRound(x)!=="FIN"||x.isrelay)continue;
      if(parseInt(x.distance,10)===e.d&&SR_STROKE[String(x.stroke)]===e.s)out.push({x:en,e:{...e,r:"FIN",date:x.date,sess:999,time:x.time||"",id:String(x.id)},src:null,live:true})}}
  return out}
function ago(t){if(!t)return"…";const s=Math.round((Date.now()-t)/1000);return s<60?`il y a ${s} s`:`il y a ${Math.round(s/60)} min`}
/* Bandeau en tête de l'onglet Compétition. */
function bar(m){
  watch(m);
  const id=L.links[m.id];
  if(L.editing===m.id)return`<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><b>Résultats en direct</b><input id="liveId" class="tsel" inputmode="numeric" placeholder="n° ou lien live.swimrankings.net" value="${h(id||"")}" style="flex:1;min-width:180px"><button class="btn" data-live-act="save">Lier</button><button class="btn ghost" data-live-act="unlink">Aucun direct</button><button class="btn ghost" data-live-act="cancel">Annuler</button></div>`;
  if(id===undefined)return`<div class="legend" style="margin:0 0 10px">Recherche de la compétition sur live.swimrankings.net…</div>`;
  if(!id)return`<div class="card" style="padding:10px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span class="muted">Pas de résultats en direct liés à cette compétition.</span><button class="btn ghost" data-live-act="edit">Lier le direct</button></div>`;
  const st=L.sr[id]||{};const fin=st.main&&st.main.status===5;
  return`<div class="card" style="padding:8px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:14px">
    <span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${st.err?"var(--lane)":fin?"var(--muted)":"var(--good)"}"></i><b>Direct</b></span>
    <span class="muted" id="liveAgo">${st.err?h(st.err):fin?"compétition terminée":"mise à jour "+ago(st.lastOk)}</span>
    <span style="flex:1"></span><button class="btn ghost" data-live-act="now" style="padding:4px 10px">Actualiser</button><button class="btn ghost" data-live-act="edit" style="padding:4px 10px">Changer</button>
    <a href="https://live.swimrankings.net/${h(id)}/" target="_blank" rel="noopener" class="muted" style="font-size:13px">swimrankings ↗</a></div>`}
let watched=null,timer=null;
function watch(m){
  if(watched!==m.id){watched=m.id;
    if(L.links[m.id]===undefined)autoLink(m).then(()=>{if(L.links[m.id])refresh(m,true).then(rerender);else rerender()});
    else if(L.links[m.id])refresh(m,true).then(rerender)}
  if(!timer)timer=setInterval(tick,5000)}
function tick(){
  const a=document.getElementById("liveAgo");const id=watched&&L.links[watched],st=id&&L.sr[id];
  if(a&&st&&!st.err&&st.main&&st.main.status!==5)a.textContent="mise à jour "+ago(st.lastOk);
  if(!watched||!id||document.hidden||typeof S==="undefined"||S.view!=="comp")return;
  if(st&&st.main&&st.main.status===5)return;
  const m=(typeof C!=="undefined"?C.meets:[]).find(x=>x.id===watched);if(!m||!isActive(m))return;
  if(!st||Date.now()-(st.lastOk||0)>=POLL_MS-1000)refresh(m,false).then(rerender)}
function rerender(){
  const st=watched&&L.links[watched]&&L.sr[L.links[watched]];
  if(st&&st.changed===false)return;if(st)st.changed=false;
  if(typeof S!=="undefined"&&S.view==="comp"&&!typingNote()&&!document.activeElement?.classList?.contains("rt")&&document.activeElement?.id!=="liveId")renderComp()}

/* Création d'une feuille de route à partir du direct (quand aucun Lenex d'engagements n'a été importé). */
function pickerHtml(){
  if(!L.picker)return`<div style="margin-top:14px"><button class="btn" data-live-act="picker">Créer depuis les résultats en direct</button></div>`;
  if(!L.meetList){meetList().then(()=>renderComp()).catch(()=>{});return`<p class="muted">Chargement de la liste des compétitions…</p>`}
  const g=L.meetList.find(x=>x.code===L.pickNation)||L.meetList[0];const ms=(g?g.meets:[]).filter(x=>x.status!==5).sort((a,b)=>a.startdate.localeCompare(b.startdate));
  return`<div style="margin-top:14px;text-align:left"><div class="ctl"><label class="l" for="livePickNat">Pays</label><select id="livePickNat" class="tsel">${L.meetList.map(x=>`<option value="${h(x.code)}"${g&&x.code===g.code?" selected":""}>${h(x.name)}</option>`).join("")}</select><button class="btn ghost" data-live-act="pickclose">Fermer</button></div>
    ${ms.length?`<div class="card">${ms.map(x=>`<button class="sw" style="padding:10px 12px;border-bottom:1px solid var(--line);border-radius:0" data-live-create="${h(x.id)}"><span><b>${h(x.name)}</b><br><span class="muted">${h(x.city)} · ${h(x.startdate)}${x.enddate!==x.startdate?" – "+h(x.enddate):""}</span></span><span class="pts">créer ›</span></button>`).join("")}</div>`:`<p class="muted">Aucune compétition à venir dans ce pays.</p>`}
    <p class="legend">Seuls tes nageurs (ceux de la liste du carnet) sont repris, avec leurs épreuves individuelles. Les relais restent à importer par Lenex.</p><div id="liveMsg" class="msg"></div></div>`}
async function createFromLive(id){
  const msg=t=>{const el=document.getElementById("liveMsg");if(el)el.textContent=t};
  msg("Lecture du direct…");
  try{
    const st=await loadSr(id);const roster=Object.entries(S.athletes).filter(([,a])=>a.mine!==false);
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
  else if(act==="now"){refresh(m,true).then(()=>{const st=L.sr[L.links[m.id]];if(st)st.changed=true;rerender()})}
});
document.addEventListener("change",e=>{if(e.target.id==="livePickNat"){L.pickNation=e.target.value;renderComp()}});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="liveId"){e.preventDefault();document.querySelector('[data-live-act="save"]')?.click()}});

window.LIVE={result,nums,extra,finals,bar,pickerHtml};

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
