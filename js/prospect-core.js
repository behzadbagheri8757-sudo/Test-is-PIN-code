/* prospect-core.js — prospects state & ops. Separate from CRM finance. */
const prospectState = {
  shops: [],
  routes: [],
  dailyTarget: null,
  ready: false,
};

async function loadProspectData(){
  if(!prospectDbInstance) await openProspectDatabase();
  const [shopsRaw, routesRaw] = await Promise.all([
    prospectDbGetAll('shops'),
    prospectDbGetAll('routes'),
  ]);
  prospectState.shops = shopsRaw.map(normalizeProspectShop);
  prospectState.routes = routesRaw.map(normalizeProspectRoute);
  await ensureProspectDailyTarget();
  prospectState.ready = true;
}

function prospectRouteName(routeId){
  const r = prospectState.routes.find(x=>x.id===routeId);
  return r ? r.name : '—';
}
function prospectNeighborhoodName(routeId, neighborhoodId){
  const r = prospectState.routes.find(x=>x.id===routeId);
  if(!r) return '—';
  const n = r.neighborhoods.find(x=>x.id===neighborhoodId);
  return n ? n.name : '—';
}

async function persistProspectShop(shop){
  shop.updatedAt = prospectNowISO();
  await prospectDbPut('shops', shop);
}

async function createProspectShop(payload){
  const score = prospectComputeScore(payload.answers||{});
  const rank = prospectScoreToRank(score);
  const visit = normalizeProspectVisit({
    date: prospectNowISO(),
    answers: {...(payload.answers||{})},
    score, rank,
    scoringVersion: PROSPECT_SCORING_VERSION,
    tags: [...(payload.tags||[])],
  });
  const shop = normalizeProspectShop({
    name: (payload.name||'').trim(),
    routeId: payload.routeId || null,
    neighborhoodId: payload.neighborhoodId || null,
    latestScore: score,
    latestRank: rank,
    visits: [visit],
    status: (payload.tags||[]).includes('became_customer') ? 'converted' : 'active',
  });
  await persistProspectShop(shop);
  prospectState.shops.push(shop);
  await registerProspectVisitForTarget();
  return shop;
}

async function addProspectVisit(shopId, payload){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop) return null;
  const score = prospectComputeScore(payload.answers||{});
  const rank = prospectScoreToRank(score);
  const visit = normalizeProspectVisit({
    date: prospectNowISO(),
    answers: {...(payload.answers||{})},
    score, rank,
    scoringVersion: PROSPECT_SCORING_VERSION,
    tags: [...(payload.tags||[])],
  });
  shop.visits.push(visit);
  shop.latestScore = score;
  shop.latestRank = rank;
  if((payload.tags||[]).includes('became_customer')) shop.status = 'converted';
  await persistProspectShop(shop);
  await registerProspectVisitForTarget();
  return shop;
}

async function deleteProspectShop(id){
  prospectState.shops = prospectState.shops.filter(s=>s.id!==id);
  await prospectDbDelete('shops', id);
}

async function addProspectRoute(name){
  const route = normalizeProspectRoute({name});
  await prospectDbPut('routes', route);
  prospectState.routes.push(route);
  return route;
}
async function deleteProspectRoute(id){
  prospectState.routes = prospectState.routes.filter(r=>r.id!==id);
  await prospectDbDelete('routes', id);
}
async function addProspectNeighborhood(routeId, name){
  const r = prospectState.routes.find(x=>x.id===routeId);
  if(!r) return;
  r.neighborhoods.push({id: typeof uid==='function'?uid():String(Date.now()), name: name.trim()});
  await prospectDbPut('routes', r);
}

/* ---- daily target ---- */
function defaultProspectDailyTarget(prevTarget, prevLastMsg){
  return { date: prospectTodayStr(), target: prevTarget||0, count:0, hit:{}, lastMsg: prevLastMsg||{} };
}
async function ensureProspectDailyTarget(){
  let rec = await prospectDbGet('meta','dailyTarget');
  let dt = rec ? rec.value : null;
  if(!dt || dt.date !== prospectTodayStr()){
    dt = defaultProspectDailyTarget(dt?dt.target:0, dt?dt.lastMsg:{});
    await prospectDbPut('meta', {key:'dailyTarget', value:dt});
  }
  prospectState.dailyTarget = dt;
  return dt;
}
async function setProspectDailyTargetValue(newTarget){
  const dt = await ensureProspectDailyTarget();
  dt.target = newTarget;
  prospectState.dailyTarget = dt;
  await prospectDbPut('meta', {key:'dailyTarget', value:dt});
}
async function registerProspectVisitForTarget(){
  const dt = await ensureProspectDailyTarget();
  dt.count += 1;
  if(dt.target > 0){
    const pct = (dt.count/dt.target)*100;
    if(pct>=100) dt.hit['100']=true;
    else if(pct>=80) dt.hit['80']=true;
    else if(pct>=50) dt.hit['50']=true;
  }
  prospectState.dailyTarget = dt;
  await prospectDbPut('meta', {key:'dailyTarget', value:dt});
}

/* ---- UI-only random milestone messages (no DB / no target logic change) ---- */
const PROSPECT_TARGET_MILESTONE_MSGS = {
  '50': [
    'نصف راه رو اومدی؛ عالی بود 👏',
    '۵۰٪ تارگت زده شد؛ همین‌طور ادامه بده',
    'نیمه راه پشت سر گذاشته شد؛ قوی باش'
  ],
  '80': [
    '۸۰٪ تموم شد؛ فقط یک قدم تا قهرمانی',
    'تقریباً رسیدی؛ عالی پیش می‌ری 🔥',
    '۸۰٪ تارگت؛ تمرکز روی خط پایان'
  ],
  '100': [
    'تارگت امروز کامل شد؛ آفرین 🎉',
    '۱۰۰٪ زدی؛ روزت عالی بود',
    'تارگت پر شد؛ کارت درسته 💪'
  ]
};

function _prospectTargetMsgStoreKey(dateStr){
  return 'baqeri_pt_msg_' + (dateStr || (typeof prospectTodayStr==='function' ? prospectTodayStr() : ''));
}

function _getShownProspectTargetMilestones(dateStr){
  try{
    return JSON.parse(sessionStorage.getItem(_prospectTargetMsgStoreKey(dateStr)) || '{}') || {};
  }catch(e){
    return {};
  }
}

function _markProspectTargetMilestoneShown(dateStr, key){
  const o = _getShownProspectTargetMilestones(dateStr);
  o[String(key)] = true;
  // prevent lower milestones from showing later in the same day
  if(key === '100'){ o['50']=true; o['80']=true; }
  if(key === '80'){ o['50']=true; }
  try{
    sessionStorage.setItem(_prospectTargetMsgStoreKey(dateStr), JSON.stringify(o));
  }catch(e){}
}

function _pickProspectTargetMilestoneMsg(key){
  const list = PROSPECT_TARGET_MILESTONE_MSGS[String(key)] || [];
  if(!list.length) return '';
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * READ-ONLY vs target logic: uses current count/target only.
 * Does not write ProspectScoutDB / dailyTarget.
 * Queues a single toast (via sessionStorage) so navigation does not lose the message.
 */
function queueProspectTargetMilestoneMessage(dt){
  if(!dt || !(Number(dt.target) > 0)) return;
  const target = Number(dt.target) || 0;
  const count = Number(dt.count) || 0;
  const pct = (count / target) * 100;
  let key = null;
  if(pct >= 100) key = '100';
  else if(pct >= 80) key = '80';
  else if(pct >= 50) key = '50';
  else return;

  const dateStr = dt.date || (typeof prospectTodayStr==='function' ? prospectTodayStr() : '');
  const shown = _getShownProspectTargetMilestones(dateStr);
  if(shown[key]) return;

  _markProspectTargetMilestoneShown(dateStr, key);
  const msg = _pickProspectTargetMilestoneMsg(key);
  if(!msg) return;
  try{
    sessionStorage.setItem('baqeri_prospect_pending_toast', msg);
  }catch(e){}
  // If still on same page, show immediately as well
  if(typeof showToast === 'function'){
    try{ showToast(msg); }catch(e){}
  }
}

function flushProspectPendingToast(){
  try{
    const msg = sessionStorage.getItem('baqeri_prospect_pending_toast');
    if(!msg) return;
    sessionStorage.removeItem('baqeri_prospect_pending_toast');
    if(typeof showToast === 'function') showToast(msg);
  }catch(e){}
}

/**
 * Convert prospect shop → CRM customer (baqeri data.customers).
 * Does NOT copy evaluation visits into customer.visits.
 * Idempotent: if already linked, returns existing customer id.
 */
async function convertProspectToCustomer(shopId){
  const shop = prospectState.shops.find(s=>s.id===shopId);
  if(!shop) throw new Error('مغازه پیدا نشد');

  if(shop.linkedCustomerId){
    const existing = (typeof data!=='undefined' && data.customers)
      ? data.customers.find(c=>c.id===shop.linkedCustomerId) : null;
    if(existing){
      shop.status = 'converted';
      await persistProspectShop(shop);
      return { customerId: existing.id, created: false, customer: existing };
    }
  }

  // prevent duplicate by exact name match among active customers
  const name = (shop.name||'').trim();
  if(typeof data!=='undefined' && data.customers){
    const dup = data.customers.find(c =>
      (c.name||'').trim() === name && c.active !== false && !c._fromProspectId
    );
    // allow if linked to this shop via note marker
    const already = data.customers.find(c => c.prospectShopId === shop.id);
    if(already){
      shop.linkedCustomerId = already.id;
      shop.status = 'converted';
      await persistProspectShop(shop);
      if(typeof saveData==='function') await saveData();
      return { customerId: already.id, created: false, customer: already };
    }
    // FIX (independent audit): `dup` above was computed but never used, so a
    // customer with the exact same active name could be created a second
    // time. Reuse the existing customer instead of creating a duplicate —
    // no merge, no id change, no touching of its balance/history/invoices.
    if(dup){
      shop.linkedCustomerId = dup.id;
      shop.status = 'converted';
      await persistProspectShop(shop);
      return { customerId: dup.id, created: false, customer: dup };
    }
  }

  const region = prospectRouteName(shop.routeId);
  const route = prospectNeighborhoodName(shop.routeId, shop.neighborhoodId);
  const noteParts = [
    'تبدیل‌شده از ارزیابی مغازه',
    'امتیاز آخرین ارزیابی: ' + shop.latestScore + ' (رتبه ' + shop.latestRank + ')',
  ];
  const customer = {
    id: typeof uid==='function' ? uid() : ('c'+Date.now()),
    name: name,
    ownerName: '',
    phone: '',
    region: region !== '—' ? region : '',
    route: route !== '—' ? route : '',
    address: '',
    note: noteParts.join(' — '),
    openingBalance: 0,
    visits: [],
    active: true,
    prospectShopId: shop.id,
  };
  if(typeof data==='undefined' || !data.customers){
    throw new Error('داده CRM در دسترس نیست');
  }
  data.customers.push(customer);
  if(typeof saveData==='function') await saveData();

  shop.linkedCustomerId = customer.id;
  shop.status = 'converted';
  await persistProspectShop(shop);

  return { customerId: customer.id, created: true, customer };
}

async function bootProspectPage(activeNavId, afterLoad){
  try{
    /* PIN gate (minimal): unlock before any CRM/prospect render. Does not touch data/FIFO. */
    try{
      var pinConfigured = false;
      try{ pinConfigured = !!(localStorage.getItem('baqeri_pin_lock_v1')); }catch(_e){}
      if(pinConfigured){
        if(!window.pinLock || typeof window.pinLock.ensureUnlocked !== 'function'){
          document.body.innerHTML = '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">قفل PIN فعال است اما ماژول قفل بارگذاری نشد. صفحه را دوباره باز کنید.</div>';
          return;
        }
        await window.pinLock.ensureUnlocked();
      } else if(window.pinLock && typeof window.pinLock.ensureUnlocked === 'function'){
        await window.pinLock.ensureUnlocked();
      }
    }catch(pinErr){
      console.error('pin lock gate failed', pinErr);
      document.body.innerHTML = '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">خطا در قفل PIN. صفحه را دوباره باز کنید.</div>';
      return;
    }
    if(typeof loadData==='function') await loadData();
    if(typeof renderSharedNav==='function') renderSharedNav(activeNavId);
    if(typeof renderBottomNav==='function') renderBottomNav(activeNavId);
    if(typeof ensureAppBackButton==='function') ensureAppBackButton(activeNavId);
    await loadProspectData();
    if(typeof afterLoad==='function') await afterLoad();
    if(typeof flushProspectPendingToast==='function') flushProspectPendingToast();
  }catch(e){
    console.error('bootProspectPage failed', e);
    if(typeof showToast==='function') showToast('خطا در بارگذاری ارزیابی مغازه‌ها');
  }
}
