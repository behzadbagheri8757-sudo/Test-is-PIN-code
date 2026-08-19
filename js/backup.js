/* backup.js — export/import JSON, auto-backup, undo restore, excel export
   Phase 0 extract: no logic changes.
*/
// ---------- backup / restore ----------
async function downloadFile(filename, blobParts, mime){
  const blob = (blobParts instanceof Blob) ? blobParts : new Blob([blobParts], {type:mime});
  // iOS Safari often just previews a blob link instead of saving it — the
  // share sheet's "Save to Files" is the reliable path on iPhone.
  try{
    if(navigator.canShare){
      const file = new File([blob], filename, {type:mime});
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:filename});
        return;
      }
    }
  }catch(e){
    // user cancelled the share sheet, or share isn't available — fall back below
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/** کلید اسنپ‌شات Prospect قبل از Restore (داخل همان baqeriDB، جدا از CRM) */
const PRERESTORE_PROSPECT_KEY = 'preRestoreProspect';

/**
 * دسترسی مستقیم به ProspectScoutDB (بدون وابستگی به لود بودن prospect-db.js)
 * تا Backup از صفحه تنظیمات هم کار کند.
 */
function openProspectScoutDbForBackup(){
  return new Promise((resolve, reject)=>{
    try{
      const req = indexedDB.open('ProspectScoutDB', 1);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains('shops')) db.createObjectStore('shops',{keyPath:'id'});
        if(!db.objectStoreNames.contains('routes')) db.createObjectStore('routes',{keyPath:'id'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
      };
      req.onsuccess = (e)=> resolve(e.target.result);
      req.onerror = (e)=> reject(e.target.error);
    }catch(e){ reject(e); }
  });
}
function prospectBackupGetAll(db, storeName){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    r.onsuccess = ()=> resolve(r.result||[]);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupGet(db, storeName, key){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    r.onsuccess = ()=> resolve(r.result||null);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupPut(db, storeName, value){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    r.onsuccess = ()=> resolve(value);
    r.onerror = ()=> reject(r.error);
  });
}
function prospectBackupDelete(db, storeName, key){
  return new Promise((resolve, reject)=>{
    const r = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    r.onsuccess = ()=> resolve(true);
    r.onerror = ()=> reject(r.error);
  });
}

/** خواندن بسته‌ی Prospect برای Backup — در صورت نبود DB یا خطا null */
async function exportProspectScoutBundle(){
  try{
    const db = await openProspectScoutDbForBackup();
    const shops = await prospectBackupGetAll(db, 'shops');
    const routes = await prospectBackupGetAll(db, 'routes');
    const dtRec = await prospectBackupGet(db, 'meta', 'dailyTarget');
    try{ db.close(); }catch(e){}
    return {
      version: 1,
      shops: shops || [],
      routes: routes || [],
      dailyTarget: (dtRec && dtRec.value) ? dtRec.value : null,
    };
  }catch(e){
    console.error('exportProspectScoutBundle failed', e);
    return null;
  }
}

/** جایگزینی کامل داده‌ی Prospect از bundle بکاپ — فقط وقتی bundle معتبر است */
async function restoreProspectScoutBundle(bundle){
  if(!bundle || typeof bundle !== 'object') return false;
  if(!Array.isArray(bundle.shops) && !Array.isArray(bundle.routes) && bundle.dailyTarget == null) return false;
  try{
    const db = await openProspectScoutDbForBackup();
    const oldShops = await prospectBackupGetAll(db, 'shops');
    const oldRoutes = await prospectBackupGetAll(db, 'routes');
    for(const s of (oldShops||[])) await prospectBackupDelete(db, 'shops', s.id);
    for(const r of (oldRoutes||[])) await prospectBackupDelete(db, 'routes', r.id);
    for(const s of (bundle.shops||[])) await prospectBackupPut(db, 'shops', s);
    for(const r of (bundle.routes||[])) await prospectBackupPut(db, 'routes', r);
    if(bundle.dailyTarget != null){
      await prospectBackupPut(db, 'meta', {key:'dailyTarget', value: bundle.dailyTarget});
    }
    try{ db.close(); }catch(e){}
    return true;
  }catch(e){
    console.error('restoreProspectScoutBundle failed', e);
    return false;
  }
}

async function exportBackupJSON(){
  const stamp = todayISO();
  // سازگاری: همان فیلدهای data در ریشه؛ prospectScout اختیاری و اضافه
  const payload = JSON.parse(JSON.stringify(data));
  const prospect = await exportProspectScoutBundle();
  if(prospect) payload.prospectScout = prospect;
  await downloadFile(`baqeri-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast('فایل بکاپ آماده شد');
}

function validateBackupShape(parsed){
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const arrays = ['products','customers','invoices','payments','checks','suppliers'];
  // FIX (independent audit, round 2): require ALL six known arrays to be
  // present — not just "at least one" (previous FIX 2) or "undefined is ok"
  // (original code). Every real backup produced by this app — old or new —
  // always includes all six as arrays (even empty ones), because emptyData()
  // and normalizeData() always populate them before export. So a real backup
  // still passes, while a JSON missing a whole section (e.g. no "invoices"
  // key at all) is now correctly rejected instead of silently wiping that
  // section to [] on restore.
  return arrays.every(k => Array.isArray(parsed[k]));
}

async function importBackupJSON(file){
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    if(!validateBackupShape(parsed)){
      showToast('این فایل، فایل بکاپ معتبری نیست');
      return;
    }
    // safety net: keep a snapshot of what's about to be overwritten
    await dbPut(PRERESTORE_KEY, JSON.stringify(data));
    // اسنپ‌شات Prospect فعلی برای Undo (حتی اگر فایل بکاپ Prospect نداشته باشد)
    try{
      const pSnap = await exportProspectScoutBundle();
      if(pSnap) await dbPut(PRERESTORE_PROSPECT_KEY, JSON.stringify(pSnap));
    }catch(e){ console.error('prospect pre-restore snapshot failed', e); }

    // FIX 4: keep the previous in-memory data so a failed save doesn't leave
    // the app running on an unsaved/half-applied dataset.
    const previousData = data;
    data = normalizeData(parsed);
    try{
      await saveData();
    }catch(saveErr){
      data = previousData;
      throw saveErr;
    }
    // فقط اگر بکاپ جدید شامل prospectScout باشد جایگزین می‌شود؛ بکاپ قدیمی Prospect فعلی را دست نمی‌زند
    if(parsed.prospectScout){
      await restoreProspectScoutBundle(parsed.prospectScout);
    }
    render();
    showToast('اطلاعات با موفقیت بازیابی شد');
  }catch(e){
    console.error(e);
    showToast('فایل بکاپ معتبر نیست یا خراب است');
  }
}

async function undoLastRestore(){
  try{
    const snap = await dbGet(PRERESTORE_KEY);
    if(!snap || !snap.value){ showToast('نسخه‌ی قبل از بازیابی موجود نیست'); return; }
    // FIX 4: keep the previous in-memory data so a failed save doesn't leave
    // the app running on an unsaved/half-applied dataset.
    const previousData = data;
    data = normalizeData(JSON.parse(snap.value));
    try{
      await saveData();
    }catch(saveErr){
      data = previousData;
      throw saveErr;
    }
    // FIX 3: the snapshot has now been successfully consumed — invalidate it so
    // it can't remain permanently reusable / silently reapplied months later.
    // Only removed AFTER a successful save (a failed save keeps it for recovery).
    try{ await dbDelete(PRERESTORE_KEY); }catch(e){ console.error('pre-restore snapshot cleanup failed', e); }
    try{
      const pSnap = await dbGet(PRERESTORE_PROSPECT_KEY);
      if(pSnap && pSnap.value){
        await restoreProspectScoutBundle(JSON.parse(pSnap.value));
      }
    }catch(e){ console.error('prospect undo restore failed', e); }
    render();
    showToast('به حالت قبل از بازیابی برگشت');
  }catch(e){
    console.error(e);
    showToast('بازگرداندن ممکن نشد');
  }
}

// ---------- بکاپ خودکار ساده (fire-and-forget، هیچ‌وقت نباید جلوی ذخیره‌ی اصلی را بگیرد) ----------
async function getAutoBackupList(){
  const rec = await dbGet(AUTO_BACKUP_LIST_KEY);
  return (rec && rec.value) ? JSON.parse(rec.value) : [];
}

async function autoBackupTick(){
  const list = await getAutoBackupList();
  const last = list.length ? list[list.length-1].ts : 0;
  if(Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return; // هنوز زوده، لازم نیست نسخه‌ی جدید بگیریم
  const ts = Date.now();
  const key = AUTO_BACKUP_PREFIX + ts;
  await dbPut(key, JSON.stringify(data));
  list.push({key, ts});
  while(list.length > AUTO_BACKUP_MAX){
    const old = list.shift();
    try{ await dbDelete(old.key); }catch(e){ /* نبود یا حذف نشد، مهم نیست */ }
  }
  await dbPut(AUTO_BACKUP_LIST_KEY, JSON.stringify(list));
}

async function restoreFromAutoBackup(key){
  if(!confirm('مطمئنی؟ اطلاعات فعلی با این نسخه‌ی بکاپ خودکار جایگزین می‌شه.')) return;
  try{
    const snap = await dbGet(key);
    if(!snap || !snap.value){ showToast('این نسخه‌ی بکاپ پیدا نشد'); return; }
    // مثل بازیابی از فایل: قبل از جایگزینی، وضعیت فعلی هم نگه داشته می‌شود
    await dbPut(PRERESTORE_KEY, JSON.stringify(data));
    // FIX 4: keep the previous in-memory data so a failed save doesn't leave
    // the app running on an unsaved/half-applied dataset.
    const previousData = data;
    data = normalizeData(JSON.parse(snap.value));
    try{
      await saveData();
    }catch(saveErr){
      data = previousData;
      throw saveErr;
    }
    render();
    showToast('از بکاپ خودکار بازیابی شد');
  }catch(e){
    console.error(e);
    showToast('بازیابی از بکاپ خودکار ممکن نشد');
  }
}

function exportExcel(){
  if(typeof XLSX === 'undefined'){
    showToast('کتابخانه اکسل لود نشد؛ برای این خروجی به اینترنت نیاز است');
    return;
  }
  const wb = XLSX.utils.book_new();

  const custRows = data.customers.map(c=>{
    const t = customerTotals(c.id);
    return {
      'نام فروشگاه': c.name, 'صاحب فروشگاه': c.ownerName||'', 'شماره تماس': c.phone||'',
      'منطقه': c.region||'', 'مسیر': c.route||'',
      'جمع فاکتورها': t.invTotal, 'مانده حساب': t.balance,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(custRows.length?custRows:[{'نام فروشگاه':''}]), 'مشتریان');

  const invRows = [];
  data.invoices.forEach(i=>{
    const cust = data.customers.find(c=>c.id===i.customerId);
    i.items.forEach(it=>{
      invRows.push({
        'شماره فاکتور': i.number||'', 'تاریخ': i.date, 'مشتری': cust?cust.name:'',
        'کالا': it.name, 'تعداد': it.qty, 'قیمت واحد': it.price, 'جمع': it.qty*it.price - (it.discount||0),
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows.length?invRows:[{'شماره فاکتور':''}]), 'فاکتورها');

  const prodRows = data.products.map(p=>({
    'نام کالا': p.name, 'دسته‌بندی': p.category||'', 'قیمت خرید (FIFO)': Math.round(productFifoUnitCost(p.id)),
    'قیمت خرید (مبنای پیش‌فرض)': p.buy,
    'قیمت عمده': p.wholesale, 'قیمت مصرف‌کننده': p.retail, 'موجودی': p.stockQty,
    'ارزش ریالی موجودی (FIFO)': Math.round(productInventoryValue(p.id)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows.length?prodRows:[{'نام کالا':''}]), 'کالاها');

  const supRows = data.suppliers.map(s=>{
    const t = supplierTotals(s.id);
    return { 'تامین‌کننده': s.name, 'جمع خرید': t.purchaseTotal, 'جمع پرداخت': t.payTotal, 'بدهی': t.balance };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(supRows.length?supRows:[{'تامین‌کننده':''}]), 'تامین‌کننده‌ها');

  const wbArray = XLSX.write(wb, {bookType:'xlsx', type:'array'});
  const blob = new Blob([wbArray], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  downloadFile(`baqeri-report-${todayISO()}.xlsx`, blob).then(()=>{
    showToast('فایل اکسل آماده شد');
  });
}

