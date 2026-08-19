/* prospect-db.js — separate IndexedDB for prospects (does NOT touch baqeriDB) */
const PROSPECT_DB_NAME = 'ProspectScoutDB';
const PROSPECT_DB_VERSION = 1;
let prospectDbInstance = null;

function openProspectDatabase(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(PROSPECT_DB_NAME, PROSPECT_DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('shops')) db.createObjectStore('shops',{keyPath:'id'});
      if(!db.objectStoreNames.contains('routes')) db.createObjectStore('routes',{keyPath:'id'});
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
    };
    req.onsuccess = (e)=>{ prospectDbInstance = e.target.result; resolve(prospectDbInstance); };
    req.onerror = (e)=>{ reject(e.target.error); };
  });
}
function prospectStore(name, mode){ return prospectDbInstance.transaction(name, mode).objectStore(name); }
function prospectDbGetAll(name){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readonly').getAll();
    r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error);
  });
}
function prospectDbGet(name,key){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readonly').get(key);
    r.onsuccess=()=>resolve(r.result||null); r.onerror=()=>reject(r.error);
  });
}
function prospectDbPut(name,value){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readwrite').put(value);
    r.onsuccess=()=>resolve(value); r.onerror=()=>reject(r.error);
  });
}
function prospectDbDelete(name,key){
  return new Promise((resolve,reject)=>{
    const r = prospectStore(name,'readwrite').delete(key);
    r.onsuccess=()=>resolve(true); r.onerror=()=>reject(r.error);
  });
}

function normalizeProspectVisit(raw){
  return {
    id: raw.id || (typeof uid==='function'?uid():String(Date.now())),
    date: raw.date || prospectNowISO(),
    answers: (raw.answers && typeof raw.answers==='object') ? raw.answers : {},
    score: typeof raw.score==='number' ? raw.score : 0,
    rank: raw.rank || prospectScoreToRank(typeof raw.score==='number'?raw.score:0),
    scoringVersion: raw.scoringVersion || 1,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}
function normalizeProspectShop(raw){
  return {
    id: raw.id || (typeof uid==='function'?uid():String(Date.now())),
    schemaVersion: 1,
    name: raw.name || '(بدون نام)',
    routeId: raw.routeId || null,
    neighborhoodId: raw.neighborhoodId || null,
    status: raw.status==='converted' ? 'converted' : 'active',
    linkedCustomerId: raw.linkedCustomerId || null,
    createdAt: raw.createdAt || prospectNowISO(),
    updatedAt: raw.updatedAt || raw.createdAt || prospectNowISO(),
    latestScore: typeof raw.latestScore==='number' ? raw.latestScore : 0,
    latestRank: raw.latestRank || prospectScoreToRank(typeof raw.latestScore==='number'?raw.latestScore:0),
    visits: Array.isArray(raw.visits) ? raw.visits.map(normalizeProspectVisit) : [],
  };
}
function normalizeProspectRoute(raw){
  return {
    id: raw.id || (typeof uid==='function'?uid():String(Date.now())),
    schemaVersion: 1,
    name: raw.name || '(بدون نام)',
    createdAt: raw.createdAt || prospectNowISO(),
    neighborhoods: Array.isArray(raw.neighborhoods) ? raw.neighborhoods.map(n=>({id:n.id||(typeof uid==='function'?uid():String(Date.now())), name:n.name||''})) : [],
  };
}
