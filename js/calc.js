/* calc.js — balances, profit, inventory value, filters (read-only derived data)
   Phase 0 extract: no logic changes.
*/
// ---------- derived calculations ----------
function customerInvoices(cid){ return data.invoices.filter(i=>i.customerId===cid); }
function customerPayments(cid){ return data.payments.filter(p=>p.customerId===cid); }
function customerChecks(cid){ return data.checks.filter(c=>c.customerId===cid); }

// برای هشدار «برگشت بیشتر از فروش قبلی»: مجموع فروخته‌شده و مجموع قبلاً برگشت‌داده‌شده‌ی
// یک کالای مشخص به یک مشتری مشخص
function productSoldQtyToCustomer(cid, productId){
  return customerInvoices(cid).reduce((s,inv)=>
    s + inv.items.filter(it=>it.productId===productId).reduce((a,it)=>a+(it.qty||0),0), 0);
}
function productReturnedQtyByCustomer(cid, productId){
  return customerPayments(cid).filter(p=>p.method==='return').reduce((s,p)=>
    s + (p.returnItems||[]).filter(ri=>ri.productId===productId).reduce((a,ri)=>a+(ri.qty||0),0), 0);
}
function productReturnAvailableQty(cid, productId){
  return Math.max(0, productSoldQtyToCustomer(cid, productId) - productReturnedQtyByCustomer(cid, productId));
}

function customerTotals(cid){
  const invTotal = customerInvoices(cid).reduce((s,i)=>s+i.total,0);
  const payTotal = customerPayments(cid).reduce((s,p)=>s+p.amount,0);
  const checkTotal = customerChecks(cid).reduce((s,c)=>s+c.amount,0);
  const cashOnlyTotal = customerPayments(cid).filter(p=>['cash','card','transfer'].includes(p.method)).reduce((s,p)=>s+p.amount,0);
  const discountTotal = customerPayments(cid).filter(p=>p.method==='discount').reduce((s,p)=>s+p.amount,0);
  const returnTotal = customerPayments(cid).filter(p=>p.method==='return').reduce((s,p)=>s+p.amount,0);
  const c = data.customers.find(x=>x.id===cid);
  const openingBalance = c ? (c.openingBalance||0) : 0;
  const balance = openingBalance + invTotal - payTotal - checkTotal;
  return { invTotal, payTotal, checkTotal, cashOnlyTotal, discountTotal, returnTotal, openingBalance, balance };
}

// تخفیف کلی فاکتور: مبلغ ثابت (پیش‌فرض/قدیمی) یا درصد از جمع جزء فاکتور
function invoiceDiscountAmount(inv){
  if(inv.discountType==='percent'){
    const subtotal = (inv.items||[]).reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0);
    return subtotal*(inv.discount||0)/100;
  }
  return inv.discount||0;
}

/** مبلغ ثبت‌شده روی خود فاکتور (فیلدهای cash/card/transfer/check) — بدون تغییر منطق ذخیره */
function invoiceOnRecordPaid(inv){
  return (inv.cashPaid||0) + (inv.cardPaid||0) + (inv.transferPaid||0) + (inv.checkPaid||0);
}

/**
 * پوشش نمایشی فاکتور: مبلغ روی فاکتور + تخصیص FIFO از دریافت‌های بدون invoiceId همان مشتری.
 * فقط برای نمایش وضعیت/مانده فاکتور؛ customerTotals و ذخیره را تغییر نمی‌دهد.
 * پرداخت‌های لینک‌شده به فاکتور (ساخته‌شده با pushInvoicePayments) در pool نیستند تا دوبار شمرده نشوند.
 */
function invoiceEffectivePaid(inv){
  if(!inv) return 0;
  const onRec = invoiceOnRecordPaid(inv);
  const cid = inv.customerId;
  if(!cid || typeof data === 'undefined' || !data) return onRec;

  const invs = (data.invoices||[])
    .filter(i => i.customerId === cid)
    .slice()
    .sort((a,b)=> (a.date||'').localeCompare(b.date||'')
      || String(a.number||'').localeCompare(String(b.number||''))
      || String(a.id||'').localeCompare(String(b.id||'')));

  let pool = 0;
  (data.payments||[]).forEach(p=>{
    if(p.customerId !== cid) return;
    if(p.invoiceId) return;
    if(['cash','card','transfer','discount','return'].includes(p.method)) pool += (p.amount||0);
  });
  (data.checks||[]).forEach(c=>{
    if(c.customerId !== cid) return;
    if(c.invoiceId) return;
    pool += (c.amount||0);
  });

  let covered = onRec;
  for(const i of invs){
    const base = invoiceOnRecordPaid(i);
    const need = Math.max(0, (i.total||0) - base);
    const fromPool = Math.min(need, pool);
    pool -= fromPool;
    if(i.id === inv.id){
      covered = base + fromPool;
      break;
    }
  }
  return covered;
}

function invoiceEffectiveRemain(inv){
  return Math.max(0, (inv.total||0) - invoiceEffectivePaid(inv));
}

function customerProfit(cid){
  // سود فاکتورها (با تخفیف ردیف و تخفیف کلی)
  let s = customerInvoices(cid).reduce((sum,inv)=>{
    const itemsProfit = inv.items.reduce((a,it)=>a + (it.price - (it.buyPrice||0)) * it.qty - (it.discount||0), 0);
    return sum + itemsProfit - invoiceDiscountAmount(inv);
  },0);
  // کسر حاشیه برگشت از فروش: (قیمت برگشت − قیمت خرید) × تعداد — فقط وقتی returnItems ثبت شده
  customerPayments(cid).filter(p=>p.method==='return').forEach(p=>{
    (p.returnItems||[]).forEach(ri=>{
      if(!(ri.qty>0)) return;
      const sold = customerInvoices(cid).flatMap(inv=>inv.items.filter(it=>it.productId===ri.productId));
      const lastSold = sold.length ? sold[sold.length-1] : null;
      const prod = data.products.find(x=>x.id===ri.productId);
      const buy = (lastSold && lastSold.buyPrice!==undefined) ? (lastSold.buyPrice||0) : (prod ? (prod.buy||0) : 0);
      const sell = (ri.price>0) ? ri.price : (lastSold ? (lastSold.price||0) : 0);
      s -= (sell - buy) * ri.qty;
    });
  });
  // کسر تراکنش «تخفیف (کاهش بدهی)» از سود گزارش‌شده
  s -= customerPayments(cid).filter(p=>p.method==='discount').reduce((a,p)=>a+(p.amount||0),0);
  return s;
}

function customerStats(cid){
  const invs = customerInvoices(cid);
  const pays = customerPayments(cid);
  const t = customerTotals(cid);
  const sortedInvs = invs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const lastInvoice = sortedInvs[sortedInvs.length-1];
  const firstInvoice = sortedInvs[0];
  const lastPayment = pays.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  return {
    count: invs.length,
    avgInvoice: invs.length ? t.invTotal/invs.length : 0,
    firstInvoiceDate: firstInvoice ? firstInvoice.date : null,
    lastInvoiceDate: lastInvoice ? lastInvoice.date : null,
    lastPaymentDate: lastPayment ? lastPayment.date : null,
    profit: customerProfit(cid),
    daysSinceLast: lastInvoice ? daysAgo(lastInvoice.date) : Infinity,
  };
}

function customerStatus(cid){
  const st = customerStats(cid);
  if(st.count===0) return 'new';
  if(st.daysSinceLast > 60) return 'lost';
  if(st.daysSinceLast > 21) return 'inactive';
  return 'active';
}

function supplierTotals(sid){
  const s = data.suppliers.find(x=>x.id===sid);
  if(!s) return {purchaseTotal:0, payTotal:0, returnTotal:0, balance:0};
  const purchaseTotal = (s.purchases||[]).reduce((a,p)=>a+p.amount,0);
  const returnTotal = (s.purchases||[]).reduce((a,p)=>a+(p.returns||[]).reduce((b,r)=>b+(r.amount||0),0),0);
  const payTotal = (s.payments||[]).reduce((a,p)=>a+p.amount,0);
  const openingBalance = s.openingBalance||0;
  return { purchaseTotal, payTotal, returnTotal, openingBalance, balance: openingBalance + purchaseTotal - payTotal - returnTotal };
}

// قیمت خرید یک کالا به روش FIFO: میانگین وزنیِ لایه‌های باز (چیزی که واقعاً در انبار مانده و نوبت مصرفشه).
// اگر کالا هیچ لایه‌ی بازی نداشته باشه (هنوز خریدی/ورودی ثبت نشده)، برمی‌گرده به فیلد دستی p.buy.
function productFifoUnitCost(pid){
  const layers = (data.inventoryLayers||[]).filter(l=>l.productId===pid && l.status==='open' && (l.qtyRemaining||0)>0);
  if(!layers.length){
    const prod = data.products.find(p=>p.id===pid);
    return prod ? (prod.buy||0) : 0;
  }
  const qty = layers.reduce((s,l)=>s+(l.qtyRemaining||0),0);
  const val = layers.reduce((s,l)=>s+(l.qtyRemaining||0)*(l.unitCost||0),0);
  return qty>0 ? val/qty : 0;
}
// ارزش ریالی موجودی یک کالای مشخص، از لایه‌های FIFO باز (زیرمجموعه‌ی همون چیزی که inventoryValue() جمع می‌زنه)
function productInventoryValue(pid){
  return (data.inventoryLayers||[]).filter(l=>l.productId===pid && l.status==='open')
    .reduce((s,l)=>s+(l.qtyRemaining||0)*(l.unitCost||0), 0);
}

function inventoryValue(){
  // FIFO: ارزش انبار از لایه‌های قابل مصرف (open + qtyRemaining>0)
  const layers = (data.inventoryLayers||[]);
  if(layers.length){
    return layers.reduce((s,l)=>{
      if(l.status!=='open') return s;
      const q = l.qtyRemaining||0;
      if(!(q>0)) return s;
      return s + q * (l.unitCost||0);
    }, 0);
  }
  // fallback legacy قبل از migration
  return data.products.reduce((s,p)=>s + (p.stockQty||0)*(p.buy||0), 0);
}

// یک نقطه‌ی واحد برای خوندن اقلام یک خرید: چندقلمی جدید، یا تک‌کالای قدیمی، یا بدون کالا
function purchaseLines(p){
  if(Array.isArray(p.items) && p.items.length) return p.items;
  if(p.productId && p.qty>0) return [{productId:p.productId, name:(data.products.find(x=>x.id===p.productId)||{}).name||'', qty:p.qty}];
  return [];
}
// مقدار قابل‌برگشت (qty) برای یک خرید — سازگار با تک‌قلمی و چندقلمی
function purchaseReturnRemainingQty(p){
  const already = (p.returns||[]).reduce((a,r)=>a+(Number(r.qty)||0),0);
  if(p.productId){
    return Math.max(0, (Number(p.qty)||0) - already);
  }
  const lines = purchaseLines(p);
  if(lines.length){
    const purchased = lines.reduce((s,l)=>s+(Number(l.qty)||0),0);
    return Math.max(0, purchased - already);
  }
  return 0;
}
function purchaseReturnRemainingAmount(p){
  const already = (p.returns||[]).reduce((a,r)=>a+(Number(r.amount)||0),0);
  return Math.max(0, (Number(p.amount)||0) - already);
}
// مقدار قابل‌برگشتِ یک قلمِ مشخص از یک خرید چندقلمی (با احتساب برگشت‌های قبلی همون قلم)
function purchaseLineRemainingQty(p, itemId){
  const line = (p.items||[]).find(it=>it.id===itemId);
  if(!line) return 0;
  const already = (p.returns||[]).reduce((a,r)=>a+((r.items||[]).filter(x=>x.itemId===itemId).reduce((b,x)=>b+(Number(x.qty)||0),0)),0);
  return Math.max(0, (Number(line.qty)||0) - already);
}
// اثر موجودی خرید تامین‌کننده (ایجاد) — فقط روی خطوط دارای productId و qty>0
function lowStockProducts(){
  return data.products.filter(p => (p.minStock||0) > 0 && (p.stockQty||0) <= p.minStock);
}

function isSameMonth(iso, ref){
  // Shamsi/Jalali month for «این ماه» — storage remains Gregorian YYYY-MM-DD
  if(typeof isSameJalaliMonth === 'function') return isSameJalaliMonth(iso, ref);
  const d = new Date(iso), r = ref;
  return d.getFullYear()===r.getFullYear() && d.getMonth()===r.getMonth();
}
function isSameDay(iso, ref){
  // Same civil day (Gregorian local == same real day as Shamsi «امروز»)
  const p = (typeof parseISODateParts === 'function') ? parseISODateParts(iso) : null;
  if(p && ref && !isNaN(ref.getTime())){
    return p.y === ref.getFullYear() && p.m === (ref.getMonth()+1) && p.d === ref.getDate();
  }
  const d = new Date(iso);
  return d.toDateString() === ref.toDateString();
}

function globalTotals(){
  const totalSales = data.invoices.reduce((s,i)=>s+i.total,0);
  // همان منطق customerProfit برای همه مشتریان (فاکتور − حاشیه برگشت − تخفیف تراکنشی)
  const totalProfit = data.customers.reduce((s,c)=>s + customerProfit(c.id), 0);
  const totalReceived = data.payments.filter(p=>['cash','card','transfer'].includes(p.method)).reduce((s,p)=>s+p.amount,0);
  const outstandingChecks = data.checks.filter(c=>c.status!=='cleared').reduce((s,c)=>s+c.amount,0);
  const customerDebt = data.customers.reduce((s,c)=>{
    const t = customerTotals(c.id);
    return s + Math.max(t.balance,0);
  },0);
  const supplierDebt = data.suppliers.reduce((s,sp)=>s+supplierTotals(sp.id).balance,0);

  const now = new Date();
  const todaySales = data.invoices.filter(i=>isSameDay(i.date, now)).reduce((s,i)=>s+i.total,0);
  const todayCount = data.invoices.filter(i=>isSameDay(i.date, now)).length;
  const monthSales = data.invoices.filter(i=>isSameMonth(i.date, now)).reduce((s,i)=>s+i.total,0);
  const monthCount = data.invoices.filter(i=>isSameMonth(i.date, now)).length;

  return { totalSales, totalProfit, totalReceived, outstandingChecks, customerDebt, supplierDebt,
    todaySales, todayCount, monthSales, monthCount };
}

function checksDueSoon(){
  const now = new Date();
  return data.checks.filter(c=>{
    if(c.status==='cleared') return false;
    const due = new Date(c.dueDate);
    const diffDays = (due - now)/86400000;
    return diffDays <= 3;
  }).sort((a,b)=> new Date(a.dueDate)-new Date(b.dueDate));
}

/* ============================================================
   کشمش پلویی — سازگاری گزارش با دو قرارداد قدیمی/جدید ثبت qty (READ-ONLY)
   قدیمی: qty همان وزن به کیلوگرم است (مثلاً 8.5 / 17 / 25.5).
   جدید: qty تعداد بسته/کارتن است (1 / 2 / 3 ...) و فیلد weight همان ردیف
   (که در زمان ثبت فاکتور برابر packageWeight × qty محاسبه و ذخیره شده)
   وزن واقعی به کیلوگرم است.
   تشخیص: هر ردیفی که weight>0 دارد فقط با روش جدید (qty=تعداد بسته) ساخته
   شده، چون این فیلد فقط توسط کدی محاسبه می‌شود که qty را «تعداد بسته»
   می‌داند؛ نبودن/صفر بودن weight یعنی ردیف قدیمی است و qty خودش کیلوگرم
   است. این هیچ داده‌ای را تغییر نمی‌دهد؛ فقط در محاسبه‌ی گزارش استفاده
   می‌شود. تطبیق کالا با productId انجام می‌شود؛ نام فقط fallback است
   (برای رکوردهای یتیم بدون productId).
   ============================================================ */
const RAISIN_PILAF_NAME = 'کشمش پلویی';

function _raisinPilafProductIds(){
  const ids = new Set();
  (data.products||[]).forEach(p=>{ if((p.name||'').trim() === RAISIN_PILAF_NAME) ids.add(p.id); });
  return ids;
}
function _isRaisinPilafItem(it, raisinIds){
  if(!it) return false;
  if(it.productId) return raisinIds.has(it.productId);
  return (it.name||'').trim() === RAISIN_PILAF_NAME;
}
/** وزن واقعی به کیلوگرم برای یک ردیف فروش این کالا (برای گزارش «پرفروش‌ترین کالاها»). */
function _raisinPilafKg(it){
  if(it.weight && it.weight > 0) return it.weight;
  return it.qty || 0;
}
/** تعداد بسته/کارتن برای یک ردیف فروش این کالا (برای تاریخچه خرید مشتری). */
function _raisinPilafPackages(it){
  if(it.weight && it.weight > 0) return it.qty || 0;
  const prod = (data.products||[]).find(p=>p.id===it.productId);
  const pw = prod && prod.packageWeight;
  if(!pw) return it.qty || 0;
  return Math.round(((it.qty||0) / pw) * 100) / 100;
}

function topProducts(limit){
  const map = {};
  const raisinIds = _raisinPilafProductIds();
  data.invoices.forEach(inv=>inv.items.forEach(it=>{
    if(!map[it.productId]) map[it.productId] = {productId: it.productId, name:it.name, qty:0, revenue:0, qtyUnit:'count'};
    if(_isRaisinPilafItem(it, raisinIds)){
      map[it.productId].qty += _raisinPilafKg(it);
      map[it.productId].qtyUnit = 'kg';
    } else {
      map[it.productId].qty += it.qty;
    }
    map[it.productId].revenue += it.qty*it.price - (it.discount||0);
  }));
  return Object.values(map).sort((a,b)=>b.qty-a.qty).slice(0, limit||5);
}
function topCustomers(limit){
  return data.customers.map(c=>({ c, t: customerTotals(c.id) }))
    .sort((a,b)=>b.t.invTotal-a.t.invTotal)
    .slice(0, limit||5)
    .filter(x=>x.t.invTotal>0);
}
function debtorList(limit){
  return data.customers.map(c=>({ c, t: customerTotals(c.id) }))
    .filter(x=>x.t.balance>0)
    .sort((a,b)=>b.t.balance-a.t.balance)
    .slice(0, limit||10000);
}
function inactiveCustomers(){
  return data.customers.filter(c=>{
    const status = customerStatus(c.id);
    return status==='inactive' || status==='lost';
  }).map(c=>({c, st:customerStats(c.id)})).sort((a,b)=>b.st.daysSinceLast-a.st.daysSinceLast);
}

/* ============================================================
   Customer Behavior — pure derived metrics (READ-ONLY)
   Purchase truth = invoices (all-time baseline). Visits = observation only.
   No metrics stored in DB. No financial side effects.
   ============================================================ */

function _behaviorSalesInRange(invs, startISO, endISO){
  return invs.reduce((s, inv)=>{
    const d = inv.date || '';
    if(startISO && d < startISO) return s;
    if(endISO && d > endISO) return s;
    return s + (inv.total || 0);
  }, 0);
}

/** Sales-return payments only (method==='return'). READ-ONLY. Does not touch stock/FIFO. */
function _behaviorReturnPayments(cid){
  return (typeof customerPayments === 'function' ? customerPayments(cid) : [])
    .filter(p => p && p.method === 'return');
}

function _behaviorReturnsInRange(returns, startISO, endISO){
  return returns.reduce((s, p)=>{
    const d = p.date || '';
    if(startISO && d < startISO) return s;
    if(endISO && d > endISO) return s;
    return s + (p.amount || 0);
  }, 0);
}

function _behaviorISODaysAgo(n){
  const ref = new Date();
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Runtime derived behavior profile for sales decisions.
 * Purchase truth = invoices minus sales-returns (payments method==='return').
 * Visits = observation only. Returns null when data is insufficient. Never mutates data.
 */
function customerBehavior(cid){
  const invs = customerInvoices(cid).slice().sort((a,b)=>
    (a.date||'').localeCompare(b.date||'') || String(a.number||'').localeCompare(String(b.number||'')));
  const returns = _behaviorReturnPayments(cid);
  const cust = (data.customers || []).find(c => c.id === cid);
  const visits = ((cust && cust.visits) || []).slice().sort((a,b)=>
    (b.date||'').localeCompare(a.date||'') || (b.time||'').localeCompare(a.time||''));

  const count = invs.length;
  const firstInvoiceDate = count ? invs[0].date : null;
  const lastInvoiceDate = count ? invs[count - 1].date : null;
  const invTotalGross = invs.reduce((s,i)=> s + (i.total||0), 0);
  const returnTotal = returns.reduce((s,p)=> s + (p.amount||0), 0);
  const invTotal = invTotalGross - returnTotal;
  const avgInvoice = count ? invTotal / count : null;

  let avgIntervalDays = null;
  if(count >= 2){
    const intervals = [];
    for(let i = 1; i < count; i++){
      const p0 = (typeof parseISODateParts === 'function') ? parseISODateParts(invs[i-1].date) : null;
      const p1 = (typeof parseISODateParts === 'function') ? parseISODateParts(invs[i].date) : null;
      if(p0 && p1){
        const t0 = new Date(p0.y, p0.m - 1, p0.d).getTime();
        const t1 = new Date(p1.y, p1.m - 1, p1.d).getTime();
        if(!isNaN(t0) && !isNaN(t1)) intervals.push(Math.round((t1 - t0) / 86400000));
      } else {
        const t0 = new Date(invs[i-1].date).getTime();
        const t1 = new Date(invs[i].date).getTime();
        if(!isNaN(t0) && !isNaN(t1)) intervals.push(Math.round((t1 - t0) / 86400000));
      }
    }
    if(intervals.length){
      avgIntervalDays = intervals.reduce((a,b)=>a+b, 0) / intervals.length;
    }
  }

  const daysSinceLastRaw = lastInvoiceDate ? daysAgo(lastInvoiceDate) : null;
  const daysSinceLast = (daysSinceLastRaw != null && isFinite(daysSinceLastRaw)) ? daysSinceLastRaw : null;
  const behindPattern = (avgIntervalDays != null && daysSinceLast != null)
    ? (daysSinceLast > avgIntervalDays + 0.5)
    : null;

  const today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0,10);
  const d30 = _behaviorISODaysAgo(30);
  const d60 = _behaviorISODaysAgo(60);
  const d90 = _behaviorISODaysAgo(90);
  const d31 = _behaviorISODaysAgo(31);
  const sales30 = _behaviorSalesInRange(invs, d30, today) - _behaviorReturnsInRange(returns, d30, today);
  const sales90 = _behaviorSalesInRange(invs, d90, today) - _behaviorReturnsInRange(returns, d90, today);
  const salesPrev30 = _behaviorSalesInRange(invs, d60, d31) - _behaviorReturnsInRange(returns, d60, d31);

  let amountTrend = null;
  if(count >= 2){
    const a = sales30, b = salesPrev30;
    if(b === 0 && a === 0) amountTrend = 'flat';
    else if(b === 0 && a > 0) amountTrend = 'up';
    else if(a === 0 && b > 0) amountTrend = 'down';
    else if(b > 0){
      const ratio = a / b;
      if(ratio >= 1.15) amountTrend = 'up';
      else if(ratio <= 0.85) amountTrend = 'down';
      else amountTrend = 'flat';
    }
  }

  /* Net product qty/revenue: sold from invoices minus returnItems on return payments.
     کشمش پلویی: در این لیست («کالاهای اصلی مشتری» / تاریخچه خرید) qty باید تعداد
     بسته/کارتن باشد، نه کیلوگرم — رجوع کن به توضیح _raisinPilafPackages در بالای فایل. */
  const prodMap = {};
  const _raisinIdsForBehavior = _raisinPilafProductIds();
  invs.forEach(inv => {
    (inv.items || []).forEach(it => {
      if(!it.productId && !it.name) return;
      const key = it.productId || ('n:' + (it.name || ''));
      if(!prodMap[key]) prodMap[key] = { productId: it.productId || null, name: it.name || '—', qty: 0, revenue: 0 };
      prodMap[key].qty += _isRaisinPilafItem(it, _raisinIdsForBehavior) ? _raisinPilafPackages(it) : (it.qty || 0);
      prodMap[key].revenue += (it.qty || 0) * (it.price || 0) - (it.discount || 0);
    });
  });
  returns.forEach(p => {
    (p.returnItems || []).forEach(ri => {
      if(!ri.productId && !ri.name) return;
      const key = ri.productId || ('n:' + (ri.name || ''));
      if(!prodMap[key]) prodMap[key] = { productId: ri.productId || null, name: ri.name || '—', qty: 0, revenue: 0 };
      prodMap[key].qty -= (ri.qty || 0);
      prodMap[key].revenue -= (ri.qty || 0) * (ri.price || 0);
    });
  });
  const topProductsList = Object.values(prodMap)
    .filter(p => p.qty > 0.0001)
    .sort((a,b)=> b.qty - a.qty)
    .slice(0, 5);

  let decliningProducts = [];
  if(count >= 4){
    const mid = Math.floor(count / 2);
    const early = invs.slice(0, mid);
    const late = invs.slice(mid);
    const earlyMap = {}, lateMap = {};
    function accSold(list, map){
      list.forEach(inv => (inv.items||[]).forEach(it=>{
        const key = it.productId || ('n:' + (it.name||''));
        if(!map[key]) map[key] = { productId: it.productId||null, name: it.name||'—', qty: 0 };
        map[key].qty += (it.qty||0);
      }));
    }
    accSold(early, earlyMap);
    accSold(late, lateMap);
    /* Approximate return allocation by return payment date vs mid invoice date */
    const midDate = invs[mid] && invs[mid].date ? invs[mid].date : null;
    if(midDate){
      returns.forEach(p => {
        const target = (p.date || '') < midDate ? earlyMap : lateMap;
        (p.returnItems || []).forEach(ri => {
          const key = ri.productId || ('n:' + (ri.name||''));
          if(!target[key]) target[key] = { productId: ri.productId||null, name: ri.name||'—', qty: 0 };
          target[key].qty -= (ri.qty||0);
        });
      });
    }
    Object.keys(earlyMap).forEach(key => {
      const e = earlyMap[key].qty;
      const l = (lateMap[key] && lateMap[key].qty) || 0;
      if(e >= 2 && l < e * 0.6){
        decliningProducts.push({
          name: earlyMap[key].name,
          productId: earlyMap[key].productId,
          earlyQty: Math.max(0, Math.round(e * 100) / 100),
          lateQty: Math.max(0, Math.round(l * 100) / 100)
        });
      }
    });
    decliningProducts.sort((a,b)=> (b.earlyQty - b.lateQty) - (a.earlyQty - a.lateQty));
    decliningProducts = decliningProducts.slice(0, 5);
  }

  const visitCount = visits.length;
  let orderedCount = 0;
  visits.forEach(v=>{
    if(v.ordered === true || (typeof VISIT_RESULTS !== 'undefined' && v.result === VISIT_RESULTS[0])) orderedCount++;
  });
  const conversionRate = visitCount ? (orderedCount / visitCount) : null;
  const lastVisit = visitCount ? visits[0] : null;
  const lastNextAction = (lastVisit && lastVisit.nextAction) ? lastVisit.nextAction : null;
  let consecutiveNoOrder = 0;
  for(const v of visits){
    const ordered = v.ordered === true || (typeof VISIT_RESULTS !== 'undefined' && v.result === VISIT_RESULTS[0]);
    if(ordered) break;
    consecutiveNoOrder++;
  }

  return {
    invoiceCount: count,
    firstInvoiceDate,
    lastInvoiceDate,
    invTotalGross,
    returnTotal,
    invTotal,
    avgInvoice,
    avgIntervalDays,
    daysSinceLast,
    behindPattern,
    sales30,
    sales90,
    salesPrev30,
    amountTrend,
    topProducts: topProductsList,
    decliningProducts,
    visitCount,
    orderedCount,
    conversionRate,
    consecutiveNoOrder,
    lastVisit,
    lastNextAction,
  };
}

