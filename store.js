/* Stockage du Carnet : même interface que la base des artefacts claude.ai
   (collection(c).doc(id).set/update/delete, collection(c).onSnapshot), mais
   - copie locale complète dans IndexedDB : l'appli démarre et fonctionne sans réseau ;
   - chaque écriture part dans une file d'envoi persistante, poussée vers le Google Sheet (Apps Script) dès que possible ;
   - les changements faits sur l'autre appareil sont relus toutes les 45 s (et au retour sur l'appli). */
"use strict";
(function(){
const CFG_KEY="cs-cfg",DBN="carnet-store",PULL_MS=45000,OVERLAP=15000;
const cfg=()=>{try{return JSON.parse(localStorage.getItem(CFG_KEY)||"null")}catch(e){return null}};
const mem={},listeners={},status={state:"local",pending:0,lastSync:0,error:""};
const statusFns=new Set();
let idb=null,flushing=false,pulling=false,flushTimer=null,retryMs=5000;

function merge(a,b){const o=(a&&typeof a==="object"&&!Array.isArray(a))?{...a}:{};
  for(const k in b){const v=b[k];o[k]=(v&&typeof v==="object"&&!Array.isArray(v))?merge(o[k],v):v}return o}
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));

function openIdb(){return new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("docs",{keyPath:"k"});d.createObjectStore("outbox",{keyPath:"n",autoIncrement:true});d.createObjectStore("meta")};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function tx(store,mode,fn){return new Promise((res,rej)=>{const t=idb.transaction(store,mode);const s=t.objectStore(store);let out;Promise.resolve(fn(s)).then(v=>out=v);t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})}
const reqP=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function getAll(store){return tx(store,"readonly",s=>reqP(s.getAll()))}
async function metaGet(k){return tx("meta","readonly",s=>reqP(s.get(k)))}
async function metaSet(k,v){return tx("meta","readwrite",s=>{s.put(v,k)})}

function setStatus(p){Object.assign(status,p);statusFns.forEach(f=>{try{f({...status})}catch(e){}})}
function snapshot(c){const m=mem[c]||new Map();const docs=[...m.entries()].map(([id,d])=>({id,exists:true,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}}));
  return{docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}}
const emitQ=new Set();let emitScheduled=false;
function emit(c){emitQ.add(c);if(emitScheduled)return;emitScheduled=true;
  queueMicrotask(()=>{emitScheduled=false;const cs=[...emitQ];emitQ.clear();
    for(const col of cs)for(const fn of listeners[col]||[])try{fn.next(snapshot(col))}catch(e){console.error(e)}})}

async function localWrite(op,c,id,data){
  const m=mem[c]||(mem[c]=new Map());
  if(op==="delete")m.delete(id);
  else if(op==="update"){if(!m.has(id))throw Object.assign(new Error("Document absent"),{code:"invalid_argument"});m.set(id,Object.freeze(merge(m.get(id),clone(data))))}
  else m.set(id,Object.freeze(clone(data)));
  const k=c+"/"+id;
  await new Promise((res,rej)=>{const t=idb.transaction(["docs","outbox"],"readwrite");
    if(op==="delete")t.objectStore("docs").delete(k);else t.objectStore("docs").put({k,c,id,data:m.get(id)});
    t.objectStore("outbox").add({op,c,id,data:op==="delete"?null:clone(data),at:Date.now()});
    t.oncomplete=res;t.onerror=()=>rej(t.error)});
  emit(c);countPending();scheduleFlush(300);
}
async function countPending(){const n=await tx("outbox","readonly",s=>reqP(s.count()));setStatus({pending:n});return n}

function scheduleFlush(ms){clearTimeout(flushTimer);flushTimer=setTimeout(flush,ms)}
async function api(method,body,params){
  const c=cfg();if(!c||!c.url||!c.k)throw new Error("non configuré");
  if(method==="GET"){const u=new URL(c.url);u.searchParams.set("k",c.k);for(const[k,v]of Object.entries(params||{}))u.searchParams.set(k,v);
    const r=await fetch(u.toString(),{cache:"no-store",redirect:"follow"});const j=await r.json();if(!j.ok)throw new Error(j.error||"erreur serveur");return j}
  const r=await fetch(c.url,{method:"POST",redirect:"follow",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({k:c.k,...body})});
  const j=await r.json();if(!j.ok)throw new Error(j.error||"erreur serveur");return j}

/* Envoie la file par lots (~400 ko). Une opération n'est retirée de la file qu'après confirmation du serveur. */
async function flush(){
  if(flushing||!idb)return;if(!cfg()){setStatus({state:"local"});return}
  flushing=true;
  try{
    for(;;){
      const ops=await getAll("outbox");if(!ops.length)break;
      setStatus({state:"sync"});
      const batch=[];let size=0;
      for(const o of ops){const s=JSON.stringify(o.data||{}).length+200;if(batch.length&&size+s>400000)break;batch.push(o);size+=s}
      await api("POST",{ops:batch.map(o=>({op:o.op,c:o.c,id:o.id,data:o.data}))});
      await tx("outbox","readwrite",s=>{for(const o of batch)s.delete(o.n)});
    }
    retryMs=5000;setStatus({state:"ok",error:"",lastSync:Date.now()});
  }catch(e){setStatus({state:"error",error:String(e.message||e)});scheduleFlush(retryMs);retryMs=Math.min(retryMs*2,120000)}
  finally{flushing=false;countPending()}
}

/* Relit ce qui a changé sur le serveur. Une fiche avec une écriture locale en attente garde la version locale. */
async function pull(full){
  if(pulling||!idb||!cfg())return;pulling=true;
  try{
    const since=full?0:Math.max(0,((await metaGet("since"))||0)-OVERLAP);
    const j=await api("GET",null,{a:"pull",since:String(since)});
    const pend=new Set((await getAll("outbox")).map(o=>o.c+"/"+o.id));
    const touched=new Set();
    await new Promise((res,rej)=>{const t=idb.transaction("docs","readwrite"),s=t.objectStore("docs");
      for(const d of j.docs){const k=d.c+"/"+d.id;if(pend.has(k))continue;const m=mem[d.c]||(mem[d.c]=new Map());
        if(d.del){if(m.has(d.id)){m.delete(d.id);s.delete(k);touched.add(d.c)}}
        else{const prev=m.get(d.id);const nx=JSON.stringify(d.data);if(!prev||JSON.stringify(prev)!==nx){m.set(d.id,Object.freeze(d.data));s.put({k,c:d.c,id:d.id,data:d.data});touched.add(d.c)}}}
      t.oncomplete=res;t.onerror=()=>rej(t.error)});
    await metaSet("since",j.now);
    touched.forEach(emit);
    if(status.state!=="sync")setStatus({state:status.pending?"sync":"ok",error:"",lastSync:Date.now()});
  }catch(e){setStatus({state:"error",error:String(e.message||e)})}
  finally{pulling=false}
}

const Store={
  async ready(){
    idb=await openIdb();
    for(const r of await getAll("docs")){(mem[r.c]||(mem[r.c]=new Map())).set(r.id,Object.freeze(r.data))}
    await countPending();
    setStatus({state:cfg()?"sync":"local"});
    if(cfg()){flush().then(()=>pull())}
    setInterval(()=>{if(!document.hidden&&cfg())pull()},PULL_MS);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&cfg()){flush();pull()}});
    addEventListener("online",()=>{flush();pull()});
    return Store;
  },
  collection(c){return{
    path:c,
    doc(id){return{id,path:c+"/"+id,
      set:d=>localWrite("set",c,id,d),update:d=>localWrite("update",c,id,d),delete:()=>localWrite("delete",c,id,null),
      get:async()=>{const d=(mem[c]||new Map()).get(id);return{id,exists:!!d,data:()=>d}}}},
    onSnapshot(next,error){const L=listeners[c]||(listeners[c]=new Set());const h={next,error};L.add(h);queueMicrotask(()=>next(snapshot(c)));return()=>L.delete(h)}
  }},
  /* --- réglages et outils --- */
  config:cfg,
  async configure(url,k){
    const u=String(url||"").trim(),key=String(k||"").trim();
    if(!/^https:\/\/script\.google(usercontent)?\.com\//.test(u))throw new Error("L'adresse doit commencer par https://script.google.com/");
    localStorage.setItem(CFG_KEY,JSON.stringify({url:u,k:key}));
    try{await api("GET",null,{a:"ping"})}catch(e){localStorage.removeItem(CFG_KEY);throw new Error(e.message==="cle"?"Clé refusée par le script.":"Script injoignable ("+e.message+").")}
    await metaSet("since",0);await flush();await pull(true);return true},
  disconnect(){localStorage.removeItem(CFG_KEY);setStatus({state:"local"})},
  onStatus(f){statusFns.add(f);f({...status});return()=>statusFns.delete(f)},
  status:()=>({...status}),
  syncNow(){flush().then(()=>pull())},
  /* Sauvegarde complète (toutes collections) et restauration. */
  dump(){const out={format:"carnet-backup-v1",exported:new Date().toISOString(),collections:{}};
    for(const[c,m]of Object.entries(mem)){out.collections[c]={};for(const[id,d]of m)out.collections[c][id]=d}return out},
  async restore(bk,onProgress){
    if(!bk||bk.format!=="carnet-backup-v1"||!bk.collections)throw new Error("Fichier de sauvegarde non reconnu.");
    const items=[];for(const[c,docs]of Object.entries(bk.collections))for(const[id,d]of Object.entries(docs))items.push([c,id,d]);
    let i=0;for(const[c,id,d]of items){await localWrite("set",c,id,d);if(onProgress&&++i%10===0)onProgress(i,items.length)}
    onProgress&&onProgress(items.length,items.length);return items.length}
};
window.Store=Store;
})();
