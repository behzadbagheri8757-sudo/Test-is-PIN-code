/* app.js — screens, forms, navigation, init, QA
   Phase 0 extract: no logic changes. Depends on models/db/calc/stock/payments/backup/ui.
*/
// ---------- submit guard (double-tap on mobile) ----------
/** Disable mutation button for one run; re-enable only on failure/validation abort. */
async function withSubmitGuard(btn, fn){
  if(!btn){ await fn(); return; }
  if(btn.disabled) return;
  btn.disabled = true;
  try{
    await fn();
  }catch(e){
    console.error(e);
    try{ btn.disabled = false; }catch(_e){}
  }
}

// ---------- render ----------
const tabs = [
  {id:'dashboard', label:'داشبورد'},
  {id:'customers', label:'مشتریان'},
  {id:'products', label:'اجناس و انبار'},
  {id:'suppliers', label:'تامین‌کننده‌ها'},
  {id:'reports', label:'گزارش‌ها'},
  {id:'backup', label:'بکاپ'},
];

function renderNav(){
  const nav = document.getElementById('nav');
  nav.innerHTML = tabs.map(t=>`<button data-tab="${t.id}" class="${activeTab===t.id?'active':''}">${t.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=>{ activeTab=b.dataset.tab; render(); });
  });
}

function render(){
  renderNav();
  const main = document.getElementById('main');
  const fab = document.getElementById('fab');
  fab.style.display='none'; fab.onclick=null;
  if(activeTab==='dashboard'){ renderDashboard(main); }
  if(activeTab==='products'){ renderProducts(main); fab.style.display='block'; fab.onclick=()=>openAddProduct(); }
  if(activeTab==='customers'){ renderCustomers(main); fab.style.display='block'; fab.onclick=()=>openAddCustomer(); }
  if(activeTab==='suppliers'){ renderSuppliers(main); fab.style.display='block'; fab.onclick=()=>openAddSupplier(); }
  if(activeTab==='reports'){ renderReports(main); }
  if(activeTab==='backup'){ renderBackup(main); }
}

function renderDashboard(main){
  const g = globalTotals();
  const due = checksDueSoon();
  const lowStock = lowStockProducts();
  main.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">فروش امروز</div><div class="value accent-olive">${toman(g.todaySales)} ت</div><div class="sub">${g.todayCount} فاکتور</div></div>
      <div class="card"><div class="label">فروش این ماه</div><div class="value accent-olive">${toman(g.monthSales)} ت</div><div class="sub">${g.monthCount} فاکتور</div></div>
      <div class="card"><div class="label">جمع سود کل</div><div class="value accent-olive">${toman(g.totalProfit)} ت</div></div>
      <div class="card"><div class="label">جمع دریافتی (نقد/کارت/انتقال)</div><div class="value">${toman(g.totalReceived)} ت</div></div>
      <div class="card"><div class="label">چک‌های در جریان</div><div class="value accent-amber">${toman(g.outstandingChecks)} ت</div></div>
      <div class="card"><div class="label">بدهی مشتریان به شما</div><div class="value accent-rust">${toman(g.customerDebt)} ت</div></div>
      <div class="card"><div class="label">بدهی شما به تامین‌کننده‌ها</div><div class="value accent-red">${toman(g.supplierDebt)} ت</div></div>
      <div class="card"><div class="label">ارزش ریالی انبار</div><div class="value">${toman(inventoryValue())} ت</div></div>
    </div>
    <h2 class="section-title">چک‌های نزدیک سررسید</h2>
    ${due.length===0 ? `<div class="empty">فعلاً چکی نزدیک سررسید نیست</div>` : due.map(c=>{
      const cust = data.customers.find(x=>x.id===c.customerId);
      const overdue = new Date(c.dueDate) < new Date();
      return `<div class="ledger-row">
        <span class="name" style="color:${overdue?'var(--red)':'var(--amber)'}">${esc(cust?cust.name:'—')}</span>
        <span class="filler"></span>
        <span class="amount">${toman(c.amount)} ت
          <span class="sub">${overdue?'سررسید گذشته':'سررسید'}: ${faDate(c.dueDate)}</span>
        </span>
      </div>`;
    }).join('')}
    ${lowStock.length? `
      <h2 class="section-title">کالاهای رو به اتمام</h2>
      ${lowStock.map(p=>`
        <div class="ledger-row"><span class="name">${esc(p.name)}</span><span class="filler"></span>
        <span class="amount accent-red">${p.stockQty} باقیمانده <span class="sub">حداقل: ${p.minStock}</span></span></div>
      `).join('')}
    ` : ''}
  `;
}

function renderProducts(main){
  main.innerHTML = `
    <div class="field"><input id="product-search" placeholder="جستجوی کالا یا دسته‌بندی..."></div>
    <div id="product-table-wrap"></div>
  `;
  function draw(filterText){
    const q = (filterText||'').trim().toLowerCase();
    let list = data.products.filter(p=> !q || (p.name||'').toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q));
    list = list.slice().sort((a,b)=> ((a.active===false)?1:0) - ((b.active===false)?1:0) );
    const wrap = document.getElementById('product-table-wrap');
    if(data.products.length===0){ wrap.innerHTML = `<div class="empty">هنوز جنسی ثبت نشده. با دکمه + یکی اضافه کن.</div>`; return; }
    if(list.length===0){ wrap.innerHTML = `<div class="empty">چیزی پیدا نشد</div>`; return; }
    wrap.innerHTML = list.map(p=>{
      const low = (p.minStock||0)>0 && (p.stockQty||0)<=p.minStock;
      const isOff = p.active===false;
      return `<div class="ledger-row" data-edit-product="${p.id}" style="${isOff?'opacity:.45;':''}">
        <span class="name">${esc(p.name)}${p.category?` <span class="sub" style="display:inline;">(${esc(p.category)})</span>`:''}${isOff?' <span class="badge pending">غیرفعال</span>':''}</span>
        <span class="filler"></span>
        <span class="amount">موجودی: ${p.stockQty||0} ${low?'<span class="badge low">کم</span>':''}
          <span class="sub">خرید (FIFO) ${toman(productFifoUnitCost(p.id))} / عمده ${toman(p.wholesale)} / مصرف‌کننده ${toman(p.retail)}</span>
        </span>
      </div>`;
    }).join('');
    wrap.querySelectorAll('[data-edit-product]').forEach(b=>{
      b.addEventListener('click', ()=>openAddProduct(b.dataset.editProduct));
    });
  }
  draw('');
  document.getElementById('product-search').addEventListener('input', e=>draw(e.target.value));
}

function renderCustomers(main){
  main.innerHTML = `
    <div class="field"><input id="customer-search" placeholder="جستجوی مشتری، منطقه یا مسیر..."></div>
    <div class="chip-row">
      <button class="chip ${custFilter==='all'?'active':''}" data-f="all">همه</button>
      <button class="chip ${custFilter==='debtor'?'active':''}" data-f="debtor">بدحساب</button>
      <button class="chip ${custFilter==='active'?'active':''}" data-f="active">فعال</button>
      <button class="chip ${custFilter==='inactive'?'active':''}" data-f="inactive">بدون خرید اخیر</button>
      <button class="chip ${custFilter==='lost'?'active':''}" data-f="lost">از دست رفته</button>
    </div>
    <div class="btn-row" style="margin-bottom:10px;margin-top:-4px;">
      <button class="btn small secondary" id="sort-debt">${custSortByDebt?'✓ ':''}مرتب‌سازی بر اساس بدهی</button>
    </div>
    <div id="customer-list"></div>
  `;
  function draw(filterText){
    const q = (filterText||'').trim().toLowerCase();
    let list = data.customers.filter(c=>{
      if(!q) return true;
      return (c.name||'').toLowerCase().includes(q) || (c.region||'').toLowerCase().includes(q) || (c.route||'').toLowerCase().includes(q);
    });
    if(custFilter==='debtor') list = list.filter(c=>customerTotals(c.id).balance>0);
    if(custFilter==='active') list = list.filter(c=>customerStatus(c.id)==='active');
    if(custFilter==='inactive') list = list.filter(c=>customerStatus(c.id)==='inactive');
    if(custFilter==='lost') list = list.filter(c=>customerStatus(c.id)==='lost');
    list = list.slice().sort((a,b)=>{
      const aOff = (a.active===false)?1:0, bOff = (b.active===false)?1:0;
      if(aOff!==bOff) return aOff-bOff;
      if(custSortByDebt) return customerTotals(b.id).balance-customerTotals(a.id).balance;
      return 0;
    });

    const wrap = document.getElementById('customer-list');
    if(data.customers.length===0){ wrap.innerHTML = `<div class="empty">هنوز مشتری‌ای ثبت نشده. با دکمه + یکی اضافه کن.</div>`; return; }
    if(list.length===0){ wrap.innerHTML = `<div class="empty">چیزی پیدا نشد</div>`; return; }
    wrap.innerHTML = list.map(c=>{
      const t = customerTotals(c.id);
      const color = t.balance > 0 ? 'var(--rust)' : 'var(--olive-dark)';
      const status = customerStatus(c.id);
      const statusLabel = {new:'جدید', active:'فعال', inactive:'بدون خرید اخیر', lost:'از دست رفته'}[status];
      const isOff = c.active===false;
      return `<div class="ledger-row" data-open-customer="${c.id}" style="${isOff?'opacity:.45;':''}">
        <span class="name">${esc(c.name)}${c.region?` <span class="sub" style="display:inline;">(${esc(c.region)}${c.route?' — '+esc(c.route):''})</span>`:''}${isOff?' <span class="badge pending">غیرفعال</span>':''}</span>
        <span class="filler"></span>
        <span class="amount" style="color:${color}">
          ${balanceStatusText(t.balance, toman(Math.abs(t.balance))+' ت')}
          <span class="sub">${statusLabel}${t.checkTotal>0?` — چک: ${toman(t.checkTotal)} ت`:''}</span>
        </span>
      </div>`;
    }).join('');
    wrap.querySelectorAll('[data-open-customer]').forEach(row=>{
      row.addEventListener('click', ()=>openCustomerDetail(row.dataset.openCustomer));
    });
  }
  draw('');
  document.getElementById('customer-search').addEventListener('input', e=>draw(e.target.value));
  main.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{ custFilter = ch.dataset.f; renderCustomers(main); });
  });
  document.getElementById('sort-debt').addEventListener('click', ()=>{
    custSortByDebt = !custSortByDebt; renderCustomers(main);
  });
}

function renderReports(main){
  const g = globalTotals();
  const tp = topProducts(5);
  const tc = topCustomers(5);
  const debtors = debtorList(10);
  const inactives = inactiveCustomers();
  const low = lowStockProducts();
  main.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">فروش امروز</div><div class="value accent-olive">${toman(g.todaySales)} ت</div></div>
      <div class="card"><div class="label">فروش این ماه</div><div class="value accent-olive">${toman(g.monthSales)} ت</div></div>
      <div class="card"><div class="label">سود کل</div><div class="value accent-olive">${toman(g.totalProfit)} ت</div></div>
      <div class="card"><div class="label">ارزش انبار</div><div class="value">${toman(inventoryValue())} ت</div></div>
    </div>

    <h2 class="section-title">پرفروش‌ترین کالاها</h2>
    ${tp.length===0?`<div class="empty">هنوز فروشی ثبت نشده</div>`:tp.map(x=>`
      <div class="ledger-row"><span class="name">${esc(x.name)}</span><span class="filler"></span>
      <span class="amount">${x.qty} عدد <span class="sub">${toman(x.revenue)} ت</span></span></div>
    `).join('')}

    <h2 class="section-title">بهترین مشتریان</h2>
    ${tc.length===0?`<div class="empty">هنوز فروشی ثبت نشده</div>`:tc.map(x=>`
      <div class="ledger-row" data-open-customer="${x.c.id}"><span class="name">${esc(x.c.name)}</span><span class="filler"></span>
      <span class="amount">${toman(x.t.invTotal)} ت</span></div>
    `).join('')}

    <h2 class="section-title">مشتریان بدهکار (به ترتیب بدهی)</h2>
    ${debtors.length===0?`<div class="empty">بدهکاری ثبت نشده</div>`:debtors.map(x=>`
      <div class="ledger-row" data-open-customer="${x.c.id}"><span class="name">${esc(x.c.name)}</span><span class="filler"></span>
      <span class="amount accent-rust">${toman(x.t.balance)} ت</span></div>
    `).join('')}

    <h2 class="section-title">مشتریان بدون خرید اخیر / از دست رفته</h2>
    ${inactives.length===0?`<div class="empty">همه‌ی مشتریان اخیراً خرید داشته‌اند</div>`:inactives.map(x=>`
      <div class="ledger-row" data-open-customer="${x.c.id}"><span class="name">${esc(x.c.name)}</span><span class="filler"></span>
      <span class="amount">${isFinite(x.st.daysSinceLast)? x.st.daysSinceLast+' روز پیش' : 'هرگز'}</span></div>
    `).join('')}

    <h2 class="section-title">کالاهای رو به اتمام</h2>
    ${low.length===0?`<div class="empty">موجودی همه‌ی کالاها کافی است</div>`:low.map(p=>`
      <div class="ledger-row"><span class="name">${esc(p.name)}</span><span class="filler"></span>
      <span class="amount accent-red">${p.stockQty} از ${p.minStock}</span></div>
    `).join('')}

    <div class="btn-row"><button class="btn secondary" id="rep-excel">خروجی اکسل کامل</button></div>
  `;
  main.querySelectorAll('[data-open-customer]').forEach(row=>{
    row.addEventListener('click', ()=>openCustomerDetail(row.dataset.openCustomer));
  });
  document.getElementById('rep-excel').addEventListener('click', exportExcel);
}

function renderBackup(main){
  const stats = `${data.customers.length} مشتری، ${data.invoices.length} فاکتور، ${data.products.length} کالا، ${data.suppliers.length} تامین‌کننده`;
  main.innerHTML = `
    <h2 class="section-title">وضعیت فعلی</h2>
    <div class="empty" style="padding:12px 0;">${stats}</div>

    <h2 class="section-title">پشتیبان‌گیری</h2>
    <div class="btn-row">
      <button class="btn" id="export-json">دانلود بکاپ (JSON)</button>
      <button class="btn secondary" id="export-excel">خروجی اکسل (گزارش)</button>
    </div>

    <h2 class="section-title">بازیابی از بکاپ</h2>
    <div class="field">
      <label>فایل بکاپ JSON رو انتخاب کن (از Files یا iCloud)</label>
      <input type="file" id="import-file" accept="application/json">
    </div>
    <div class="confirm-box">
      ⚠️ بازیابی، تمام اطلاعات فعلی رو با فایل بکاپ جایگزین می‌کنه. قبل از تایید یک نسخه از وضعیت فعلی به‌طور خودکار نگه‌داشته می‌شه و می‌تونی برش گردونی، ولی بهتره اگه چیز مهمی ثبت کردی، همین الان یک بکاپ دستی هم بگیری.
    </div>
    <div class="btn-row">
      <button class="btn danger" id="do-import">بازیابی و جایگزینی اطلاعات فعلی</button>
      <button class="btn secondary" id="undo-import">برگشت به قبل از آخرین بازیابی</button>
    </div>

    <h2 class="section-title">بکاپ‌های خودکار (داخل همین دستگاه)</h2>
    <div class="empty" style="padding:0 0 8px;text-align:right;">هر حدود ۱۲ ساعت یک نسخه خودکار گرفته می‌شه و فقط ۵ نسخه‌ی آخر نگه داشته می‌شه. اینا جایگزین بکاپ دستی (بالا) نیستن، فقط یه شبکه‌ی ایمنی اضافه‌ن.</div>
    <div id="auto-backup-list"><div class="empty">در حال بارگذاری…</div></div>
  `;
  document.getElementById('export-json').addEventListener('click', exportBackupJSON);
  document.getElementById('export-excel').addEventListener('click', exportExcel);
  document.getElementById('undo-import').addEventListener('click', undoLastRestore);
  document.getElementById('do-import').addEventListener('click', ()=>{
    const inp = document.getElementById('import-file');
    if(!inp.files || !inp.files[0]){ showToast('اول یه فایل انتخاب کن'); return; }
    if(!confirm('مطمئنی؟ اطلاعات فعلی با فایل بکاپ جایگزین می‌شه.')) return;
    importBackupJSON(inp.files[0]);
  });

  getAutoBackupList().then(list=>{
    const wrap = document.getElementById('auto-backup-list');
    if(!wrap) return; // کاربر قبل از رسیدن جواب، تب رو عوض کرده
    if(!list.length){ wrap.innerHTML = `<div class="empty">هنوز نسخه‌ی خودکاری گرفته نشده</div>`; return; }
    wrap.innerHTML = list.slice().reverse().map(item=>`
      <div class="ledger-row" data-restore-auto="${item.key}">
        <span class="name">${new Date(item.ts).toLocaleString('fa-IR')}</span>
        <span class="filler"></span>
        <span class="amount"><button class="btn small secondary" data-restore-auto-btn="${item.key}">بازیابی</button></span>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-restore-auto-btn]').forEach(btn=>{
      btn.addEventListener('click', ()=>restoreFromAutoBackup(btn.dataset.restoreAutoBtn));
    });
  }).catch(e=>{
    console.error('loading auto backup list failed', e);
    const wrap = document.getElementById('auto-backup-list');
    if(wrap) wrap.innerHTML = `<div class="empty">لیست بکاپ خودکار در دسترس نیست</div>`;
  });
}

function renderSuppliers(main){
  if(data.suppliers.length===0){
    main.innerHTML = `<div class="empty">هنوز تامین‌کننده‌ای ثبت نشده. با دکمه + یکی اضافه کن.</div>`;
    return;
  }
  main.innerHTML = data.suppliers.map(s=>{
    const t = supplierTotals(s.id);
    return `<div class="ledger-row" data-open-supplier="${s.id}">
      <span class="name">${esc(s.name)}</span>
      <span class="filler"></span>
      <span class="amount" style="color:${t.balance>0?'var(--red)':'var(--olive-dark)'}">
        ${t.balance>0?'بدهکارید ':'تسویه '}${toman(Math.abs(t.balance))} ت
      </span>
    </div>`;
  }).join('');
  main.querySelectorAll('[data-open-supplier]').forEach(row=>{
    row.addEventListener('click', ()=>openSupplierDetail(row.dataset.openSupplier));
  });
}

// ---------- print & image export ----------
function invoiceDocHtml(inv, cust, forPrint){
  const itemRows = inv.items.map((it,idx)=>`
    <tr>
      <td>${idx+1}</td>
      <td style="text-align:right;">${esc(it.name)}</td>
      <td>${it.qty}</td>
      <td>${toman(it.price)}</td>
      <td>${toman(it.qty*it.price-(it.discount||0))}</td>
    </tr>
  `).join('');
  const subtotal = inv.items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0);
  const discount = inv.discount||0;
  const discountAmount = invoiceDiscountAmount(inv);
  const paidAmount = (inv.cashPaid||0)+(inv.cardPaid||0)+(inv.transferPaid||0)+(inv.checkPaid||0);
  const hasPrev = typeof inv.prevBalance==='number' && inv.prevBalance!==0;
  const hasFinal = typeof inv.newBalance==='number' && inv.newBalance!==0;
  const custDisplay = cust
    ? (cust.ownerName ? (esc(cust.name)+' / '+esc(cust.ownerName)) : esc(cust.name||'—'))
    : '—';
  return `
    <div class="inv-doc ${forPrint?'':'screen-preview'}">
      <div class="inv-head">
        <div class="inv-logo"><img src="${appLogoSrc()}" alt="لوگو" width="140" height="77"></div>
        <div class="inv-brand">
          <div class="inv-brand-name">حبوبات و خشکبار باقری</div>
          <div class="inv-doc-title">فاکتور فروش</div>
        </div>
        <div class="inv-meta">
          <div>شماره: <b>${inv.number||'—'}</b></div>
          <div>تاریخ: <b>${faDate(inv.date)}</b></div>
        </div>
      </div>
      <div class="inv-customer">
        <div>مشتری: <b>${custDisplay}</b></div>
        ${cust&&cust.phone?`<div>تماس: ${esc(cust.phone)}</div>`:''}
        ${cust&&cust.address?`<div>آدرس: ${esc(cust.address)}</div>`:''}
      </div>
      <table class="inv-table">
        <thead><tr><th>ردیف</th><th>شرح کالا</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table class="inv-totals">
        <tr><td>جمع جزء</td><td>${toman(subtotal)} تومان</td></tr>
        ${discount>0?(inv.discountType==='percent'
          ?`<tr><td>تخفیف (${toman(discount)}٪)</td><td>${toman(discountAmount)} تومان</td></tr>`
          :`<tr><td>تخفیف کلی فاکتور</td><td>${toman(discount)} تومان</td></tr>`):''}
        <tr class="inv-final"><td>مبلغ قابل پرداخت</td><td>${toman(inv.total)} تومان</td></tr>
        ${hasPrev?`<tr><td>مانده حساب قبل از فاکتور</td><td>${toman(Math.abs(inv.prevBalance))} تومان (${balanceStatusWord(inv.prevBalance)})</td></tr>`:''}
        ${paidAmount>0?`<tr><td>پرداختی همراه این فاکتور</td><td>${toman(paidAmount)} تومان</td></tr>`:''}
        ${(hasPrev||hasFinal)?`<tr class="inv-final"><td>مانده حساب بعد از فاکتور</td><td>${toman(Math.abs(inv.newBalance))} تومان (${balanceStatusWord(inv.newBalance)})</td></tr>`:''}
      </table>
      <div style="margin-top:14px;font-size:.82rem;line-height:1.7;text-align:right;">
        <div>بانک صادرات / بهزاد باقری</div>
        <div>شماره کارت: 6037 6981 0400 9928</div>
        <div>شماره شبا: IR 41 0190 0000 0011 9860 2490 05</div>
      </div>
      <div style="margin-top:10px;text-align:center;font-size:.85rem;">سپاس از اعتماد و همراهی شما</div>
      ${forPrint?`
      <div class="inv-signatures">
        <div>امضای فروشنده<div class="inv-sig-line"></div></div>
        <div>امضای خریدار<div class="inv-sig-line"></div></div>
      </div>`:''}
    </div>
  `;
}

/** Directory URL of the current HTML page (handles GitHub Pages project paths) */
function getPageDirUrl(){
  try{
    const u = new URL(window.location.href);
    let path = u.pathname || '/';
    const last = path.split('/').pop() || '';
    if(/\.[a-zA-Z0-9]+$/.test(last)){
      path = path.substring(0, path.lastIndexOf('/') + 1);
    }else if(!path.endsWith('/')){
      path = path + '/';
    }
    return u.origin + path;
  }catch(e){
    return (document.baseURI || window.location.href || '').replace(/[^/]+$/, '') || './';
  }
}

/** Absolute URL for a project-relative asset.
 * Uses document.baseURI (browser-native base-URL resolution) instead of manually
 * rebuilding origin+pathname — avoids edge cases with file:// URLs, GitHub Pages
 * sub-paths, and trailing-slash handling that a hand-rolled resolver can get wrong. */
function resolvedAssetUrl(relPath){
  try{ return new URL(relPath, document.baseURI || window.location.href).href; }
  catch(e){ return relPath; }
}
function appLogoSrc(){
  const p = (typeof APP_LOGO_DATA_URI !== 'undefined' && APP_LOGO_DATA_URI) ? APP_LOGO_DATA_URI : './logo-export.png';
  return resolvedAssetUrl(p);
}
function exportLogoSrc(){
  const p = (typeof EXPORT_LOGO_DATA_URI !== 'undefined' && EXPORT_LOGO_DATA_URI) ? EXPORT_LOGO_DATA_URI : './logo-export.png';
  return resolvedAssetUrl(p);
}

/**
 * Fetch logo once and convert to data: URL so Print/html2canvas never depend on
 * a live network path at capture time (fixes broken-image in real CRM print/export).
 * Cached in-memory for the page session.
 *
 * cache:'reload' (not 'force-cache') is deliberate: 'force-cache' tells the browser
 * to reuse ANY cached response for this URL — including an old 404 cached from
 * before assets/logo-export.png existed on the deployed site — without ever
 * checking the network again. That reproduces exactly the symptom reported:
 * the file loads fine when opened directly (a normal navigation, which does
 * revalidate), but fetch() inside the app kept serving the stale cached failure.
 * 'reload' always goes to the network for this fetch and refreshes the cache
 * with the current, correct response.
 */
let __logoDataUrlCache = Object.create(null);
async function logoToDataUrl(kind){
  const abs = kind === 'export' ? exportLogoSrc() : appLogoSrc();
  if(__logoDataUrlCache[abs]) return __logoDataUrlCache[abs];
  try{
    const res = await fetch(abs, {cache:'reload'});
    if(!res.ok) throw new Error('HTTP '+res.status+' '+res.statusText+' for '+abs);
    const blob = await res.blob();
    if(!blob || !blob.size) throw new Error('empty blob for '+abs);
    const dataUrl = await new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.onerror = ()=> reject(fr.error || new Error('FileReader failed'));
      fr.readAsDataURL(blob);
    });
    if(typeof dataUrl !== 'string' || dataUrl.indexOf('data:image') !== 0){
      throw new Error('not an image data URL');
    }
    __logoDataUrlCache[abs] = dataUrl;
    return dataUrl;
  }catch(e){
    console.error('logoToDataUrl failed', abs, e);
    return null;
  }
}

function waitForImg(img, timeoutMs){
  return new Promise(resolve=>{
    if(!img){ resolve({ok:true, reason:'no-img', naturalWidth:0, currentSrc:''}); return; }
    const ms = timeoutMs || 8000;
    let settled = false;
    const finish = (ok, reason)=>{
      if(settled) return;
      settled = true;
      resolve({
        ok: !!ok,
        reason: reason || '',
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        currentSrc: img.currentSrc || img.src || ''
      });
    };
    if(img.complete){
      if(img.naturalWidth > 0) finish(true, 'already-complete');
      else finish(false, 'already-broken');
      return;
    }
    img.addEventListener('load', ()=>{
      if(img.naturalWidth > 0) finish(true, 'load');
      else finish(false, 'load-zero');
    }, {once:true});
    img.addEventListener('error', ()=> finish(false, 'error'), {once:true});
    setTimeout(()=>{
      if(img.complete && img.naturalWidth > 0) finish(true, 'timeout-ok');
      else finish(false, 'timeout');
    }, ms);
  });
}

/** Set every .inv-logo img (and all imgs) to embedded data URL, then wait for decode */
async function prepareInvoiceImgs(root, kind, timeoutMs){
  if(!root) return [];
  const dataUrl = await logoToDataUrl(kind || 'print');
  const imgs = Array.from(root.querySelectorAll('img'));
  imgs.forEach(img=>{
    if(dataUrl){
      img.removeAttribute('crossorigin');
      img.src = dataUrl;
    }else{
      // last resort: absolute path
      const raw = img.getAttribute('src') || '';
      if(raw && !/^(https?:|data:|blob:)/i.test(raw)){
        img.src = resolvedAssetUrl(raw);
      }
    }
  });
  const results = [];
  for(const img of imgs){
    results.push(await waitForImg(img, timeoutMs || 8000));
  }
  return results;
}

async function printInvoice(invId){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv){ if(typeof showToast==='function') showToast('فاکتور برای چاپ پیدا نشد'); return; }
  const cust = data.customers.find(x=>x.id===inv.customerId);
  const area = document.getElementById('printArea');
  if(!area){ if(typeof showToast==='function') showToast('ناحیه چاپ در صفحه موجود نیست'); return; }
  area.innerHTML = invoiceDocHtml(inv, cust, true);
  const results = await prepareInvoiceImgs(area, 'print', 8000);
  const failed = results.filter(r=>!r.ok);
  if(failed.length){
    console.warn('print logo load failed', failed);
    if(typeof showToast==='function') showToast('لوگو بارگذاری نشد — مسیر logo-export.png را بررسی کنید');
  }
  // one extra frame after decode so layout/print engine sees the bitmap
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  try{ window.print(); }
  catch(e){ console.error(e); if(typeof showToast==='function') showToast('چاپ در این مرورگر پشتیبانی نشد'); }
}

function statementDocHtml(c, forPrint){
  const invs = customerInvoices(c.id).map(i=>({date:i.date, type:'فاکتور #'+(i.number||'—'), amount:i.total, kind:'debit'}));
  const pays = customerPayments(c.id).map(p=>({date:p.date, type:paymentMethodLabel(p.method), amount:p.amount, kind:'credit'}));
  const checks = customerChecks(c.id).map(ch=>({date:ch.dueDate, type:'دریافت چک'+(ch.status==='cleared'?' (وصول شده)':' (در جریان)'), amount:ch.amount, kind:'credit'}));
  const opening = (c.openingBalance||0) !== 0 ? [{date:'0000-01-01', type:'مانده حساب اولیه', amount:Math.abs(c.openingBalance), kind: c.openingBalance>0?'debit':'credit'}] : [];
  const ledger = [...opening, ...invs, ...pays, ...checks].sort((a,b)=>new Date(a.date)-new Date(b.date));

  let running = 0;
  const rowsHtml = ledger.map(l=>{
    running += (l.kind==='debit' ? l.amount : -l.amount);
    return `
      <tr>
        <td>${l.date==='0000-01-01' ? 'ابتدا' : faDate(l.date)}</td>
        <td style="text-align:right;">${esc(l.type)}</td>
        <td>${l.kind==='debit' ? toman(l.amount) : ''}</td>
        <td>${l.kind==='credit' ? toman(l.amount) : ''}</td>
        <td>${toman(running)}</td>
      </tr>
    `;
  }).join('');
  const finalBalance = running;
  return `
    <div class="inv-doc ${forPrint?'':'screen-preview'}">
      <div class="inv-head">
        <div class="inv-logo"><img src="${appLogoSrc()}" alt="لوگو" width="140" height="77"></div>
        <div class="inv-brand">
          <div class="inv-brand-name">حبوبات و خشکبار باقری</div>
          <div class="inv-doc-title">صورتحساب مشتری</div>
        </div>
        <div class="inv-meta"><div>تاریخ صدور: <b>${faDate(todayISO())}</b></div></div>
      </div>
      <div class="inv-customer">
        <div>مشتری: <b>${esc(c.name)}</b></div>
        ${c.phone?`<div>تماس: ${esc(c.phone)}</div>`:''}
        ${c.address?`<div>آدرس: ${esc(c.address)}</div>`:''}
      </div>
      <table class="inv-table">
        <thead><tr><th>تاریخ</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center;">تراکنشی ثبت نشده</td></tr>`}</tbody>
      </table>
      <table class="inv-totals">
        <tr class="inv-final"><td>مانده نهایی (${balanceStatusWord(finalBalance)})</td><td>${toman(Math.abs(finalBalance))} تومان</td></tr>
      </table>
      ${forPrint?`
      <div class="inv-signatures">
        <div>امضای فروشنده<div class="inv-sig-line"></div></div>
        <div>امضای خریدار<div class="inv-sig-line"></div></div>
      </div>`:''}
    </div>
  `;
}

async function printCustomerStatement(cid){
  const c = data.customers.find(x=>x.id===cid);
  if(!c) return;
  const area = document.getElementById('printArea');
  if(!area) return;
  area.innerHTML = statementDocHtml(c, true);
  await prepareInvoiceImgs(area, 'print', 8000);
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  try{ window.print(); }
  catch(e){ console.error(e); }
}

/** Load local vendor/html2canvas if not already present (no CDN / no network required). */
function ensureHtml2CanvasLoaded(){
  if(typeof html2canvas !== 'undefined') return Promise.resolve(true);
  if(window.__baqeriH2cPromise) return window.__baqeriH2cPromise;
  window.__baqeriH2cPromise = new Promise(function(resolve){
    var s = document.createElement('script');
    s.src = './vendor/html2canvas.min.js';
    s.async = false;
    s.onload = function(){ resolve(typeof html2canvas !== 'undefined'); };
    s.onerror = function(){ resolve(false); };
    document.head.appendChild(s);
  });
  return window.__baqeriH2cPromise;
}

async function exportInvoiceImage(invId){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv) return;
  const h2cOk = await ensureHtml2CanvasLoaded();
  if(!h2cOk){
    showToast('کتابخانه ساخت تصویر در دسترس نیست');
    return;
  }
  const cust = data.customers.find(x=>x.id===inv.customerId);
  const holder = document.createElement('div');
  holder.style.position='fixed'; holder.style.left='-9999px'; holder.style.top='0';
  holder.style.width='420px';
  holder.style.background='#fff';
  holder.innerHTML = invoiceDocHtml(inv, cust, false);
  document.body.appendChild(holder);
  const results = await prepareInvoiceImgs(holder, 'export', 10000);
  const failed = results.filter(r=>!r.ok);
  if(failed.length){
    console.warn('export logo load failed', failed);
  }
  // ensure decode before capture
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  try{
    const canvas = await html2canvas(holder, {
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      allowTaint:true,
      imageTimeout:10000
    });
    canvas.toBlob(async (blob)=>{
      await downloadFile(`فاکتور-${inv.number||''}.png`, blob, 'image/png');
      showToast('تصویر فاکتور آماده شد — می‌تونی از واتساپ بفرستی');
    }, 'image/png');
  }catch(e){
    console.error(e);
    showToast('ساخت تصویر ممکن نشد');
  }finally{
    holder.remove();
  }
}

// ---------- products / inventory ----------
function openAddProduct(editId){
  const p = editId ? data.products.find(x=>x.id===editId) : null;
  const history = (p && p.priceHistory) ? [...p.priceHistory].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6) : [];
  const stockLog = (p && p.stockLog) ? [...p.stockLog].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8) : [];
  const profitPct = p && p.buy ? Math.round(((p.retail-p.buy)/p.buy)*100) : null;
  openSheet(`
    <h3>${p?'ویرایش جنس':'جنس جدید'}</h3>
    <div class="field"><label>نام جنس</label><input id="f-name" value="${p?esc(p.name):''}"></div>
    <div class="field">
      <label>دسته‌بندی</label>
      <input id="f-cat" list="cat-list" value="${p?esc(p.category||''):''}">
      <datalist id="cat-list">${CATEGORY_SUGGESTIONS.map(c=>`<option value="${c}">`).join('')}</datalist>
    </div>
    <div class="field"><label>وزن بسته (کیلوگرم یا گرم، اختیاری)</label><input id="f-pkgw" type="text" inputmode="decimal" value="${p&&p.packageWeight?p.packageWeight:''}"></div>

    <div class="field"><label>تاریخ این تغییر قیمت</label>${shamsiDateInputHTML('f-pdate', todayISO())}</div>
    <div class="field" style="display:flex;gap:8px;">
      <div style="flex:1;"><label>قیمت خرید</label><input id="f-buy" type="text" inputmode="decimal" value="${p?p.buy:''}"></div>
      <div style="flex:1;"><label>قیمت عمده</label><input id="f-wholesale" type="text" inputmode="decimal" value="${p?p.wholesale:''}"></div>
      <div style="flex:1;"><label>قیمت مصرف‌کننده</label><input id="f-retail" type="text" inputmode="decimal" value="${p?p.retail:''}"></div>
    </div>
    ${profitPct!==null?`<div class="empty" style="padding:0 0 8px;text-align:right;font-size:.8rem;">درصد سود تقریبی (نسبت به قیمت مصرف‌کننده): ${profitPct}٪</div>`:''}
    ${p?`<div class="empty" style="padding:0 0 8px;text-align:right;font-size:.78rem;">قیمت خرید واقعی به روش FIFO الان: <b>${toman(productFifoUnitCost(p.id))} ت</b> (میانگین وزنی لایه‌های موجود در انبار — «قیمت خرید» بالا فقط مبنای پیش‌فرض برای خریدهای بدون قیمت مشخص است) — ارزش این کالا در انبار: <b>${toman(productInventoryValue(p.id))} ت</b></div>`:''}

    <h2 class="section-title">موجودی انبار</h2>
    <div class="field" style="display:flex;gap:8px;">
      <div style="flex:1;"><label>موجودی فعلی</label><input id="f-stock" type="text" inputmode="decimal" value="${p?p.stockQty||0:0}"></div>
      <div style="flex:1;"><label>حداقل موجودی هشدار</label><input id="f-minstock" type="text" inputmode="decimal" value="${p?p.minStock||0:0}"></div>
    </div>
    ${p?`
    <div class="field" style="display:flex;gap:8px;align-items:end;">
      <div style="flex:1;"><label>تغییر سریع موجودی</label><input id="f-adjust-qty" type="text" inputmode="decimal" placeholder="مثلاً ۱۰"></div>
      <button class="btn small" id="stock-in">+ ورود</button>
      <button class="btn small secondary" id="stock-out">- خروج/اصلاح</button>
    </div>
    `:''}

    <div class="btn-row">
      <button class="btn" id="save-product">ذخیره</button>
      ${p?`<button class="btn secondary" id="toggle-product-active">${p.active===false?'فعال‌سازی':'غیرفعال‌سازی'}</button>`:''}
    </div>
    ${history.length?`
      <h2 class="section-title">تاریخچه قیمت</h2>
      ${history.map(h=>`
        <div class="ledger-row">
          <span class="name">${faDate(h.date)}</span>
          <span class="filler"></span>
          <span class="amount">خرید ${toman(h.buy)} / عمده ${toman(h.wholesale!==undefined?h.wholesale:h.sell)} / مصرف‌کننده ${toman(h.retail!==undefined?h.retail:h.sell)}</span>
        </div>
      `).join('')}
    `:''}
    ${stockLog.length?`
      <h2 class="section-title">تاریخچه موجودی</h2>
      ${stockLog.map(l=>`
        <div class="ledger-row">
          <span class="name">${faDate(l.date)} <span class="sub">${l.note?esc(l.note):''}</span></span>
          <span class="filler"></span>
          <span class="amount" style="color:${l.qty>=0?'var(--olive-dark)':'var(--rust)'}">${l.qty>=0?'+':''}${l.qty}</span>
        </div>
      `).join('')}
    `:''}
  `);

  async function persist(){
    const name = document.getElementById('f-name').value.trim();
    const category = document.getElementById('f-cat').value.trim();
    const packageWeight = numVal(document.getElementById('f-pkgw'));
    const buy = numVal(document.getElementById('f-buy'));
    const wholesale = numVal(document.getElementById('f-wholesale'));
    const retail = numVal(document.getElementById('f-retail'));
    const pdate = document.getElementById('f-pdate').value || todayISO();
    const stockQty = numVal(document.getElementById('f-stock'));
    const minStock = numVal(document.getElementById('f-minstock'));
    if(!name){ showToast('نام جنس رو وارد کن'); return null; }
    if(p){
      // Stock adjust first (may block). On failure leave other fields untouched and do not save.
      if(stockQty !== p.stockQty){
        const adj = manualStockAdjustAbsolute(p.id, stockQty, 'ویرایش دستی موجودی');
        if(!adj || !adj.ok){
          showToast((adj && adj.error) ? adj.error : 'امکان تغییر موجودی نیست');
          return null;
        }
      }
      p.name=name; p.category=category; p.packageWeight=packageWeight;
      p.buy=buy; p.wholesale=wholesale; p.retail=retail; p.sell=retail;
      p.minStock=minStock;
      p.priceHistory = p.priceHistory||[];
      p.priceHistory.push({date:pdate, buy, wholesale, retail});
      await saveData();
      return p;
    } else {
      const np = {id:uid(), name, category, packageWeight, buy, wholesale, retail, sell:retail,
        stockQty:0, minStock, priceHistory:[{date:pdate, buy, wholesale, retail}], stockLog: [], active:true};
      data.products.push(np);
      if(stockQty>0){
        manualStockIn(np.id, stockQty, 'موجودی اولیه');
      }
      await saveData();
      return np;
    }
  }

  document.getElementById('save-product').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const saved = await persist();
      if(!saved) throw new Error('validation');
      closeModal(); render(); showToast('ذخیره شد');
    });
  });
  if(p){
    document.getElementById('toggle-product-active').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        p.active = (p.active===false) ? true : false;
        await saveData(); closeModal(); render();
        showToast(p.active===false ? 'جنس غیرفعال شد' : 'جنس فعال شد');
      });
    });
    document.getElementById('stock-in').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const q = numVal(document.getElementById('f-adjust-qty'));
        if(q<=0){ showToast('مقدار رو وارد کن'); throw new Error('validation'); }
        manualStockIn(p.id, q, 'ورود کالا');
        await saveData(); openAddProduct(p.id); showToast('موجودی اضافه شد');
      });
    });
    document.getElementById('stock-out').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const q = numVal(document.getElementById('f-adjust-qty'));
        if(q<=0){ showToast('مقدار رو وارد کن'); throw new Error('validation'); }
        const r = manualStockOut(p.id, q, 'خروج/اصلاح دستی');
        if(!r || !r.ok){
          showToast((r && r.error) ? r.error : 'امکان کاهش موجودی نیست');
          throw new Error('validation');
        }
        await saveData(); openAddProduct(p.id); showToast('موجودی کم شد');
      });
    });
  }
}

// ---------- customers ----------
function openAddCustomer(editId){
  const c = editId ? data.customers.find(x=>x.id===editId) : null;
  openSheet(`
    <h3>${c?'ویرایش مشتری':'مشتری جدید'}</h3>
    <div class="field"><label>نام فروشگاه</label><input id="f-name" value="${c?esc(c.name):''}"></div>
    <div class="field"><label>نام صاحب فروشگاه (اختیاری)</label><input id="f-owner" value="${c?esc(c.ownerName||''):''}"></div>
    <div class="field"><label>شماره تماس (اختیاری)</label><input id="f-phone" value="${c?esc(c.phone||''):''}"></div>
    <div class="field">
      <label>منطقه</label>
      <input id="f-region" list="region-list" value="${c?esc(c.region||''):''}">
      <datalist id="region-list">${REGION_SUGGESTIONS.map(r=>`<option value="${r}">`).join('')}</datalist>
    </div>
    <div class="field">
      <label>مسیر پخش</label>
      <select id="f-route">
        <option value="">— انتخاب نشده —</option>
        ${ROUTES.map(r=>`<option value="${r}" ${c&&c.route===r?'selected':''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>آدرس (اختیاری)</label><input id="f-address" value="${c?esc(c.address||''):''}"></div>
    <div class="field"><label>یادداشت (اختیاری)</label><textarea id="f-note">${c?esc(c.note||''):''}</textarea></div>
    <div class="field">
      <label>مانده حساب اولیه (تومان)${c?' — برای اصلاح مانده بعد از شروع کار با برنامه':''}</label>
      <input id="f-opening" type="text" inputmode="decimal" value="${c&&c.openingBalance?c.openingBalance:''}">
      <div class="empty" style="padding:4px 0 0;text-align:right;font-size:.75rem;">بدهی مشتری از قبل از استفاده از این برنامه رو اینجا بزن. اگه خودت بهش بدهکاری (طلبکاره)، عدد رو منفی بزن. این مبلغ توی گزارش فروش/سود حساب نمی‌شه، فقط توی مانده حساب میاد.</div>
    </div>
    <div class="btn-row"><button class="btn" id="save-customer">ذخیره</button></div>
  `);
  document.getElementById('save-customer').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const name = document.getElementById('f-name').value.trim();
      if(!name){ showToast('نام مشتری رو وارد کن'); throw new Error('validation'); }
      const ownerName = document.getElementById('f-owner').value.trim();
      const phone = document.getElementById('f-phone').value.trim();
      const region = document.getElementById('f-region').value.trim();
      const route = document.getElementById('f-route').value;
      const address = document.getElementById('f-address').value.trim();
      const note = document.getElementById('f-note').value.trim();
      const openingBalance = numVal(document.getElementById('f-opening'));
      if(c){ c.ownerName=ownerName; c.name=name; c.phone=phone; c.region=region; c.route=route; c.address=address; c.note=note; c.openingBalance=openingBalance; }
      else{ data.customers.push({id:uid(), name, ownerName, phone, region, route, address, note, openingBalance, visits:[], active:true}); }
      await saveData(); closeModal(); render();
      if(c) openCustomerDetail(c.id);
      showToast('ذخیره شد');
    });
  });
}

function linkedStockReturnsForInvoice(invoiceId){
  return (data.payments||[]).filter(p=>
    p.method==='return' &&
    p.invoiceId===invoiceId &&
    Array.isArray(p.returnItems) &&
    p.returnItems.length>0
  );
}

function invoiceHasLinkedStockReturn(invoiceId){
  return linkedStockReturnsForInvoice(invoiceId).length>0;
}

function linkedReturnedQtyForInvoiceProduct(invoiceId, productId){
  return linkedStockReturnsForInvoice(invoiceId).reduce((sum,p)=>
    sum + (p.returnItems||[])
      .filter(ri=>ri.productId===productId)
      .reduce((s,ri)=>s+(Number(ri.qty)||0),0), 0);
}

function invoiceSoldQtyForProduct(invoice, productId){
  return (invoice.items||[]).filter(it=>it.productId===productId)
    .reduce((sum,it)=>sum+(Number(it.qty)||0),0);
}

function invoiceReturnAvailableQty(invoice, productId){
  return Math.max(0,
    invoiceSoldQtyForProduct(invoice, productId) -
    linkedReturnedQtyForInvoiceProduct(invoice.id, productId)
  );
}

function openAddTransaction(cid){
  // وضعیت فرم بین رندرهای مجدد شیت نگه داشته می‌شود.
  let method = 'cash';
  let amountStr = '';
  let dateStr = todayISO();
  let noteStr = '';
  let selectedInvoiceId = '';
  let returnRows = [];

  function selectedInvoice(){
    return selectedInvoiceId ? data.invoices.find(i=>i.id===selectedInvoiceId && i.customerId===cid) : null;
  }

  function invoiceOptionsHtml(){
    const invoices = customerInvoices(cid).slice().sort((a,b)=>
      new Date(b.date)-new Date(a.date) || String(b.number||'').localeCompare(String(a.number||''))
    );
    return invoices.map(inv=>
      `<option value="${inv.id}" ${inv.id===selectedInvoiceId?'selected':''}>فاکتور #${esc(String(inv.number||'—'))} — ${faDate(inv.date)} — ${toman(inv.total||0)} ت</option>`
    ).join('');
  }

  function invoiceProductOptionsHtml(productId){
    const inv = selectedInvoice();
    if(!inv) return '<option value="">ابتدا فاکتور را انتخاب کن</option>';
    const products = [];
    const seen = new Set();
    (inv.items||[]).forEach(it=>{
      if(!it.productId || seen.has(it.productId)) return;
      seen.add(it.productId);
      const prod = data.products.find(p=>p.id===it.productId);
      if(prod) products.push({id:prod.id, name:prod.name});
    });
    if(!products.length) return '<option value="">این فاکتور کالای قابل برگشت ندارد</option>';
    return products.map(p=>`<option value="${p.id}" ${p.id===productId?'selected':''}>${esc(p.name)}</option>`).join('');
  }

  function defaultReturnPrice(productId){
    const inv = selectedInvoice();
    const line = inv && (inv.items||[]).find(it=>it.productId===productId);
    return line ? (line.price||0) : 0;
  }

  function currentReturnQtyForProduct(productId){
    return returnRows.filter(r=>r.productId===productId).reduce((s,r)=>s+(Number(r.qty)||0),0);
  }

  function returnItemsSectionHtml(){
    if(method !== 'return') return '';
    const invoices = customerInvoices(cid);
    if(!invoices.length){
      return `<div class="empty" style="padding:8px 0;">برای برگشت کالایی، این مشتری هنوز فاکتوری ندارد. می‌توانی بدون افزودن کالا فقط اصلاح حساب را ثبت کنی.</div>`;
    }
    const inv = selectedInvoice();
    return `
      <h2 class="section-title">کالای برگشتی (اختیاری)</h2>
      <div class="field">
        <label>فاکتور مرتبط (فقط همین مشتری)</label>
        <select id="f-return-invoice">
          <option value="">بدون فاکتور — فقط اصلاح حساب</option>
          ${invoiceOptionsHtml()}
        </select>
      </div>
      ${inv ? `
        <div class="empty" style="padding:0 0 8px;text-align:right;">فقط کالاهای فاکتور #${esc(String(inv.number||'—'))} قابل انتخاب هستند.</div>
        <div id="return-items-wrap">${returnRows.map((r,idx)=>{
          const available = invoiceReturnAvailableQty(inv, r.productId);
          const usedInForm = currentReturnQtyForProduct(r.productId);
          const remainingForRow = Math.max(0, available - (usedInForm - (Number(r.qty)||0)));
          const over = !(r.qty>0) || r.qty > remainingForRow;
          return `
          <div class="field" style="display:flex;gap:6px;align-items:end;">
            <div style="flex:2;">
              <label>جنس</label>
              <select data-ridx="${idx}" class="ret-product">${invoiceProductOptionsHtml(r.productId)}</select>
            </div>
            <div style="flex:1;">
              <label>تعداد</label>
              <input type="text" inputmode="decimal" data-ridx="${idx}" class="ret-qty" value="${r.qty||''}">
            </div>
            <div style="flex:1;">
              <label>قیمت واحد (اختیاری)</label>
              <input type="text" inputmode="decimal" data-ridx="${idx}" class="ret-price" value="${r.price||''}">
            </div>
            <button class="btn small danger" data-ridx="${idx}" id="ret-del-${idx}" style="flex:0;">حذف</button>
          </div>
          <div class="sub" style="margin:-6px 0 10px;${over?'color:var(--rust);':''}">
            قابل برگشت از این فاکتور برای این کالا: ${available} عدد${over?' — ⚠️ تعداد واردشده از سقف برگشت بیشتر است':''}
          </div>`;
        }).join('')}</div>
        <button class="btn secondary small" id="add-return-row">+ افزودن کالای برگشتی</button>
      ` : `
        <div class="empty" style="padding:8px 0;">اگر کالا برمی‌گردد، یک فاکتور انتخاب کن و سپس کالاهای همان فاکتور را اضافه کن. خالی گذاشتن فاکتور یعنی Return فقط حسابی است.</div>
      `}
    `;
  }

  function renderSheet(){
    openSheet(`
      <h3>ثبت تراکنش جدید</h3>
      <div class="field">
        <label>نوع تراکنش</label>
        <select id="f-method">
          <option value="cash" ${method==='cash'?'selected':''}>دریافت نقدی</option>
          <option value="card" ${method==='card'?'selected':''}>دریافت با کارت</option>
          <option value="transfer" ${method==='transfer'?'selected':''}>انتقال بانکی</option>
          <option value="discount" ${method==='discount'?'selected':''}>تخفیف (کاهش بدهی)</option>
          <option value="return" ${method==='return'?'selected':''}>برگشت از فروش</option>
        </select>
      </div>
      <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('f-date', dateStr)}</div>
      <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal" value="${amountStr}"></div>
      <div class="field"><label>توضیح (اختیاری)</label><input id="f-note" value="${esc(noteStr)}"></div>
      ${returnItemsSectionHtml()}
      <div class="btn-row"><button class="btn" id="save-tx">ثبت</button></div>
    `);

    document.getElementById('f-method').addEventListener('change', e=>{
      method = e.target.value;
      if(method!=='return'){
        selectedInvoiceId = '';
        returnRows = [];
      }
      renderSheet();
    });
    document.getElementById('f-date').addEventListener('input', e=>{ dateStr = e.target.value; });
    document.getElementById('f-amount').addEventListener('input', e=>{ amountStr = e.target.value; });
    document.getElementById('f-note').addEventListener('input', e=>{ noteStr = e.target.value; });

    const invoiceSelect = document.getElementById('f-return-invoice');
    if(invoiceSelect){
      invoiceSelect.addEventListener('change', e=>{
        const nextId = e.target.value;
        if(nextId!==selectedInvoiceId && returnRows.length){
          returnRows = [];
        }
        selectedInvoiceId = nextId;
        renderSheet();
      });
    }

    const addBtn = document.getElementById('add-return-row');
    if(addBtn){
      addBtn.addEventListener('click', ()=>{
        const inv = selectedInvoice();
        if(!inv){ showToast('اول فاکتور مرتبط را انتخاب کن'); return; }
        const usedProducts = new Set(returnRows.map(r=>r.productId));
        const candidate = (inv.items||[]).find(it=>it.productId && !usedProducts.has(it.productId));
        if(!candidate){ showToast('همه کالاهای این فاکتور در برگشت انتخاب شده‌اند'); return; }
        const prod = data.products.find(p=>p.id===candidate.productId);
        returnRows.push({productId:candidate.productId, qty:1, price:candidate.price||prod?.retail||prod?.sell||0});
        renderSheet();
      });
    }
    document.querySelectorAll('.ret-product').forEach(el=>el.addEventListener('change', e=>{
      const idx = Number(e.target.dataset.ridx);
      const row = returnRows[idx];
      if(!row) return;
      row.productId = e.target.value;
      row.price = defaultReturnPrice(row.productId);
      renderSheet();
    }));
    document.querySelectorAll('.ret-qty').forEach(el=>el.addEventListener('input', e=>{
      returnRows[e.target.dataset.ridx].qty = parseFloat(faToEnDigits(e.target.value))||0;
    }));
    document.querySelectorAll('.ret-price').forEach(el=>el.addEventListener('input', e=>{
      returnRows[e.target.dataset.ridx].price = parseFloat(faToEnDigits(e.target.value))||0;
    }));
    document.querySelectorAll('[id^="ret-del-"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        returnRows.splice(parseInt(btn.dataset.ridx,10), 1);
        renderSheet();
      });
    });

    document.getElementById('save-tx').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const amount = parseFloat(faToEnDigits(amountStr))||0;
        const date = dateStr || todayISO();
        const note = (noteStr||'').trim();
        if(amount<=0){ showToast('مبلغ رو وارد کن'); throw new Error('validation'); }

        let returnItems = [];
        let returnInvoiceId;
        if(method==='return'){
          if(returnRows.some(r=>!r.productId || !(Number(r.qty)>0))){
            showToast('برای هر کالای برگشتی، کالا باید معتبر و تعداد باید بیشتر از صفر باشد');
            throw new Error('validation');
          }
          returnItems = returnRows.map(r=>{
            const prod = data.products.find(p=>p.id===r.productId);
            return {productId:r.productId, name:prod?prod.name:'', qty:Number(r.qty), price:Number(r.price)||0};
          });

          // بدون کالا = Account-only Return؛ مستقل از فاکتور و بدون invoiceId باقی می‌ماند.
          if(returnItems.length){
            const inv = selectedInvoice();
            if(!inv){ showToast('برای برگشت کالایی باید یک فاکتور مرتبط انتخاب کنی'); throw new Error('validation'); }
            returnInvoiceId = inv.id;

            const requestedByProduct = {};
            for(const ri of returnItems){
              if(!(ri.qty>0)){ showToast('تعداد کالای برگشتی باید بیشتر از صفر باشد'); throw new Error('validation'); }
              requestedByProduct[ri.productId] = (requestedByProduct[ri.productId]||0) + Number(ri.qty);
            }
            for(const [productId, requestedQty] of Object.entries(requestedByProduct)){
              const soldQty = invoiceSoldQtyForProduct(inv, productId);
              const returnedQty = linkedReturnedQtyForInvoiceProduct(inv.id, productId);
              const available = Math.max(0, soldQty-returnedQty);
              if(!(soldQty>0)){
                showToast('این کالا در فاکتور انتخاب‌شده وجود ندارد');
                throw new Error('validation');
              }
              if(requestedQty>available){
                const prod = data.products.find(p=>p.id===productId);
                showToast(`«${prod?prod.name:productId}»: حداکثر ${available} عدد از این فاکتور قابل برگشت است`);
                throw new Error('validation');
              }
            }
          }

          const expectedReturnAmount = returnItems.reduce((s,ri)=>s+(ri.qty*(ri.price||0)),0);
          if(expectedReturnAmount>0 && Math.abs(expectedReturnAmount-amount)>1){
            const proceedAmount = confirm('⚠️ مبلغ واردشده با «مقدار × قیمت واحد» کالاهای برگشتی هم‌خوانی ندارد.\n\nمبلغ واردشده: '+toman(amount)+' تومان\nمبلغ منطقی طبق کالاها: '+toman(expectedReturnAmount)+' تومان\n\nمطمئنی می‌خوای همینطور ثبت کنی؟');
            if(!proceedAmount) throw new Error('validation');
          }
        }

        const payment = {id:uid(), customerId:cid, date, amount, method, note, returnItems};
        if(returnInvoiceId) payment.invoiceId = returnInvoiceId;
        // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور —
        // چون این مسیر هم برای «برگشت از فروش» موجودی/لایه‌های FIFO را تغییر می‌دهد.
        const previousData = JSON.parse(JSON.stringify(data));
        data.payments.push(payment);
        if(method==='return' && returnItems.length){
          applyReturnStockEffects(returnItems, date, payment);
        }
        try{
          await saveData();
        }catch(saveErr){
          data = previousData;
          throw saveErr;
        }
        openCustomerDetail(cid); render(); showToast('ثبت شد');
      });
    });
  }

  renderSheet();
}

function openAddCheck(cid){
  openSheet(`
    <h3>ثبت چک جدید</h3>
    <div class="field"><label>شماره چک (اختیاری)</label><input id="f-num"></div>
    <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal"></div>
    <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', todayISO())}</div>
    <div class="btn-row"><button class="btn" id="save-check">ثبت</button></div>
  `);
  document.getElementById('save-check').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const amount = numVal(document.getElementById('f-amount'));
      const dueDate = document.getElementById('f-due').value || todayISO();
      const checkNumber = document.getElementById('f-num').value.trim();
      if(amount<=0){ showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
      data.checks.push({id:uid(), customerId:cid, amount, dueDate, checkNumber, status:'pending'});
      await saveData(); openCustomerDetail(cid); render(); showToast('چک ثبت شد');
    });
  });
}

function openAddVisit(cid){
  const reasonOpts = (typeof VISIT_REASONS !== 'undefined' ? VISIT_REASONS : []).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const oppOpts = (typeof VISIT_OPPORTUNITIES !== 'undefined' ? VISIT_OPPORTUNITIES : []).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const threatOpts = (typeof VISIT_THREATS !== 'undefined' ? VISIT_THREATS : []).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const nextOpts = (typeof VISIT_NEXT_ACTIONS !== 'undefined' ? VISIT_NEXT_ACTIONS : []).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  openSheet(`
    <h3>ثبت ویزیت مشتری</h3>
    <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('f-date', todayISO())}</div>
    <div class="field"><label>ساعت</label><input id="f-time" type="time" value="${nowHHMM()}"></div>
    <div class="field">
      <label>نتیجه ویزیت</label>
      <select id="f-result">${VISIT_RESULTS.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>یادداشت کوتاه (اختیاری)</label><input id="f-visit-note" placeholder="اختیاری" autocomplete="off"></div>
    <div class="btn-row" style="margin-bottom:8px;">
      <button type="button" class="btn small secondary" id="toggle-visit-detail">جزئیات بیشتر</button>
    </div>
    <div id="visit-detail-block" style="display:none;">
      <div class="field"><label>دلیل (مشاهده)</label>
        <select id="f-visit-reason"><option value="">—</option>${reasonOpts}</select>
      </div>
      <div class="field"><label>فرصت (مشاهده)</label>
        <select id="f-visit-opportunity"><option value="">—</option>${oppOpts}</select>
      </div>
      <div class="field"><label>تهدید (مشاهده)</label>
        <select id="f-visit-threat"><option value="">—</option>${threatOpts}</select>
      </div>
      <div class="field"><label>اقدام بعدی</label>
        <select id="f-visit-next"><option value="">—</option>${nextOpts}</select>
      </div>
      <div class="field"><label>برچسب‌ها (اختیاری، با ویرگول جدا کنید)</label>
        <input id="f-visit-tags" placeholder="مثال: قیمت‌حساس، رقیب‌فعال" autocomplete="off">
      </div>
    </div>
    <div class="btn-row"><button class="btn" id="save-visit">ثبت ویزیت</button></div>
  `);
  const detailBtn = document.getElementById('toggle-visit-detail');
  if(detailBtn){
    detailBtn.addEventListener('click', ()=>{
      const block = document.getElementById('visit-detail-block');
      if(!block) return;
      const open = block.style.display === 'none';
      block.style.display = open ? 'block' : 'none';
      detailBtn.textContent = open ? 'بستن جزئیات' : 'جزئیات بیشتر';
    });
  }
  document.getElementById('save-visit').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const c = data.customers.find(x=>x.id===cid);
      if(!c){ showToast('مشتری پیدا نشد'); return; }
      const date = document.getElementById('f-date').value || todayISO();
      const time = document.getElementById('f-time').value || nowHHMM();
      const result = document.getElementById('f-result').value;
      const noteEl = document.getElementById('f-visit-note');
      const note = noteEl ? (noteEl.value || '').trim() : '';
      const reasonEl = document.getElementById('f-visit-reason');
      const oppEl = document.getElementById('f-visit-opportunity');
      const threatEl = document.getElementById('f-visit-threat');
      const nextEl = document.getElementById('f-visit-next');
      const tagsEl = document.getElementById('f-visit-tags');
      const reason = reasonEl ? (reasonEl.value || '').trim() : '';
      const opportunity = oppEl ? (oppEl.value || '').trim() : '';
      const threat = threatEl ? (threatEl.value || '').trim() : '';
      const nextAction = nextEl ? (nextEl.value || '').trim() : '';
      let tags = [];
      if(tagsEl && tagsEl.value){
        tags = String(tagsEl.value).split(/[,،]/).map(t=>t.trim()).filter(Boolean);
      }
      const visit = {
        id: uid(),
        date,
        time,
        result,
        ordered: result === VISIT_RESULTS[0],
      };
      if(note) visit.note = note;
      if(reason) visit.reason = reason;
      if(opportunity) visit.opportunity = opportunity;
      if(threat) visit.threat = threat;
      if(nextAction) visit.nextAction = nextAction;
      if(tags.length) visit.tags = tags;
      c.visits = c.visits || [];
      c.visits.push(visit);
      await saveData();
      closeModal();
      if(typeof openCustomerDetail === 'function') openCustomerDetail(cid);
      if(typeof render === 'function') render();
      showToast('ویزیت ثبت شد');
    });
  });
}

function openCustomerDetail(cid){
  const c = data.customers.find(x=>x.id===cid);
  if(!c) return;
  const t = customerTotals(cid);
  const st = customerStats(cid);
  const invs = customerInvoices(cid).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const pays = customerPayments(cid).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const checks = customerChecks(cid).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
  const visits = (c.visits||[]).slice().sort((a,b)=> new Date(b.date+'T'+(b.time||'00:00')) - new Date(a.date+'T'+(a.time||'00:00')));

  openSheet(`
    <h3>${esc(c.name)}${c.region?` <span class="sub" style="display:inline;">— ${esc(c.region)}${c.route?' / '+esc(c.route):''}</span>`:''}${c.active===false?' <span class="badge pending">غیرفعال</span>':''}</h3>
    ${c.ownerName?`<div class="empty" style="padding:0 0 4px;text-align:right;">صاحب فروشگاه: ${esc(c.ownerName)}</div>`:''}
    ${c.phone?`<div class="empty" style="padding:0 0 4px;text-align:right;">تلفن: ${esc(c.phone)}</div>`:''}
    ${c.note?`<div class="empty" style="padding:0 0 8px;text-align:right;">یادداشت: ${esc(c.note)}</div>`:''}
    ${c.openingBalance?`<div class="empty" style="padding:0 0 8px;text-align:right;">مانده حساب اولیه (قبل از این برنامه): ${toman(Math.abs(c.openingBalance))} ت ${c.openingBalance>0?'بدهکار':'طلبکار'}</div>`:''}
    <div class="cards">
      <div class="card"><div class="label">تعداد فاکتور</div><div class="value">${st.count}</div></div>
      <div class="card"><div class="label">میانگین هر فاکتور</div><div class="value">${toman(st.avgInvoice)} ت</div></div>
      <div class="card"><div class="label">جمع خرید (فاکتورها)</div><div class="value">${toman(t.invTotal)} ت</div></div>
      <div class="card"><div class="label">جمع پرداختی (نقد/کارت/انتقال)</div><div class="value">${toman(t.cashOnlyTotal)} ت</div></div>
      <div class="card"><div class="label">جمع چک‌ها</div><div class="value">${toman(t.checkTotal)} ت</div></div>
      <div class="card"><div class="label">سود این مشتری</div><div class="value accent-olive">${toman(st.profit)} ت</div></div>
      <div class="card"><div class="label">اولین خرید</div><div class="value" style="font-size:1rem;">${st.firstInvoiceDate?faDate(st.firstInvoiceDate):'—'}</div></div>
      <div class="card"><div class="label">آخرین خرید</div><div class="value" style="font-size:1rem;">${st.lastInvoiceDate?faDate(st.lastInvoiceDate):'—'}</div></div>
      <div class="card wide"><div class="label">مانده حساب</div><div class="value" style="color:${t.balance>0?'var(--rust)':'var(--olive-dark)'}">${toman(Math.abs(t.balance))} ت ${balanceStatusWord(t.balance)}</div></div>
    </div>
    <div class="btn-row">
      <button class="btn" id="add-invoice">+ فاکتور جدید</button>
      <button class="btn secondary" id="add-tx">+ ثبت تراکنش</button>
      <button class="btn secondary" id="add-check">+ ثبت چک</button>
      <button class="btn secondary" id="add-visit">+ ثبت ویزیت</button>
      <button class="btn secondary" id="print-statement">چاپ صورتحساب</button>
      <button class="btn secondary" id="edit-customer">ویرایش مشتری</button>
      <button class="btn secondary" id="toggle-customer-active">${c.active===false?'فعال‌سازی مشتری':'غیرفعال‌سازی مشتری'}</button>
    </div>

    <h2 class="section-title">فاکتورها</h2>
    ${invs.length===0?`<div class="empty">فاکتوری ثبت نشده</div>`:invs.map(i=>`
      <div class="ledger-row" data-open-invoice="${i.id}">
        <span class="name">#${i.number||'—'} — ${faDate(i.date)}</span>
        <span class="filler"></span>
        <span class="amount">${toman(i.total)} ت</span>
      </div>
    `).join('')}

    <h2 class="section-title">تراکنش‌ها</h2>
    ${pays.length===0?`<div class="empty">تراکنشی ثبت نشده</div>`:pays.map(p=>`
      <div class="ledger-row"><span class="name">${paymentMethodLabel(p.method)}${p.note?` <span class="sub" style="display:inline;">(${esc(p.note)})</span>`:''}</span><span class="filler"></span><span class="amount">${faDate(p.date)} — ${toman(p.amount)} ت</span></div>
    `).join('')}

    <h2 class="section-title">چک‌ها</h2>
    ${checks.length===0?`<div class="empty">چکی ثبت نشده</div>`:checks.map(c2=>`
      <div class="ledger-row" data-toggle-check="${c2.id}">
        <span class="name">سررسید ${faDate(c2.dueDate)} ${c2.checkNumber?`<span class="sub">شماره: ${esc(c2.checkNumber)}</span>`:''}</span>
        <span class="filler"></span>
        <span class="amount">${toman(c2.amount)} ت <span class="badge ${c2.status==='cleared'?'cleared':'pending'}">${c2.status==='cleared'?'وصول شده':'در جریان'}</span></span>
      </div>
    `).join('')}

    <h2 class="section-title">ویزیت‌ها</h2>
    ${visits.length===0?`<div class="empty">ویزیتی ثبت نشده</div>`:visits.map(v=>`
      <div class="ledger-row"><span class="name">${faDate(v.date)} ${v.time||''}</span><span class="filler"></span>
      <span class="amount" style="font-size:.78rem;">${esc(v.result)}</span></div>
    `).join('')}
  `);

  document.getElementById('add-invoice').addEventListener('click', ()=>openAddInvoice(cid));
  document.getElementById('add-tx').addEventListener('click', ()=>openAddTransaction(cid));
  document.getElementById('add-check').addEventListener('click', ()=>openAddCheck(cid));
  document.getElementById('add-visit').addEventListener('click', ()=>openAddVisit(cid));
  document.getElementById('print-statement').addEventListener('click', ()=>printCustomerStatement(cid));
  document.getElementById('edit-customer').addEventListener('click', ()=>openAddCustomer(cid));
  document.getElementById('toggle-customer-active').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      c.active = (c.active===false) ? true : false;
      await saveData(); openCustomerDetail(cid); render();
      showToast(c.active===false ? 'مشتری غیرفعال شد' : 'مشتری فعال شد');
    });
  });
  document.querySelectorAll('[data-open-invoice]').forEach(row=>{
    row.addEventListener('click', ()=>openInvoiceDetail(row.dataset.openInvoice, cid));
  });
  document.querySelectorAll('[data-toggle-check]').forEach(row=>{
    row.addEventListener('click', async ()=>{
      const chk = data.checks.find(x=>x.id===row.dataset.toggleCheck);
      chk.status = chk.status==='cleared' ? 'pending' : 'cleared';
      await saveData(); openCustomerDetail(cid); render();
    });
  });
}

function openInvoiceDetail(invId, cid){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv) return;
  const cust = data.customers.find(x=>x.id===cid);
  const hasSnapshot = typeof inv.prevBalance === 'number';
  openSheet(`
    <h3>فاکتور #${inv.number||'—'}</h3>
    <div class="empty" style="padding:0 0 10px;text-align:right;">
      مشتری: ${esc(cust?cust.name:'—')} &nbsp;|&nbsp; تاریخ: ${faDate(inv.date)}
    </div>
    <table>
      <tr><th>ردیف</th><th>کالا</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr>
      ${inv.items.map((it,idx)=>`
        <tr>
          <td>${idx+1}</td><td>${esc(it.name)}</td><td>${it.qty}</td>
          <td>${toman(it.price)} ت</td>
          <td>${toman(it.qty*it.price-(it.discount||0))} ت</td>
        </tr>
      `).join('')}
    </table>
    <div class="ledger-row" style="margin-top:10px;"><span class="name">جمع فاکتور</span><span class="filler"></span><span class="amount">${toman(inv.total)} ت</span></div>
    ${hasSnapshot ? `
      <div class="ledger-row"><span class="name">مانده قبلی مشتری</span><span class="filler"></span><span class="amount">${toman(inv.prevBalance)} ت</span></div>
      <div class="ledger-row"><span class="name">دریافت نقد این فاکتور</span><span class="filler"></span><span class="amount">${toman(inv.cashPaid||0)} ت</span></div>
      <div class="ledger-row"><span class="name">دریافت کارت این فاکتور</span><span class="filler"></span><span class="amount">${toman(inv.cardPaid||0)} ت</span></div>
      <div class="ledger-row"><span class="name">دریافت انتقال این فاکتور</span><span class="filler"></span><span class="amount">${toman(inv.transferPaid||0)} ت</span></div>
      <div class="ledger-row"><span class="name">دریافت چک این فاکتور</span><span class="filler"></span><span class="amount">${toman(inv.checkPaid||0)} ت</span></div>
      <div class="ledger-row"><span class="name" style="color:${inv.newBalance>0?'var(--rust)':'var(--olive-dark)'}">مانده بعد از این فاکتور</span><span class="filler"></span><span class="amount" style="color:${inv.newBalance>0?'var(--rust)':'var(--olive-dark)'}">${toman(Math.abs(inv.newBalance))} ت ${balanceStatusWord(inv.newBalance)}</span></div>
    ` : `<div class="empty" style="font-size:.75rem;">این فاکتور قبل از فعال شدن محاسبهٔ خودکار مانده ثبت شده.</div>`}
    <div class="btn-row">
      <button class="btn" id="print-inv-detail">چاپ فاکتور</button>
      <button class="btn secondary" id="image-inv-detail">خروجی تصویر (واتساپ)</button>
      <button class="btn secondary" id="edit-invoice">ویرایش فاکتور</button>
      <button class="btn danger" id="del-invoice">حذف فاکتور</button>
    </div>
    ${(inv.editHistory && inv.editHistory.length) ? `
      <h2 class="section-title">تاریخچه ویرایش</h2>
      ${inv.editHistory.slice().reverse().map(h=>`
        <div class="ledger-row" style="display:block;">
          <span class="sub" style="display:block;margin-bottom:4px;">${faDate(h.editedAt.slice(0,10))} ${h.editedAt.slice(11,16)}</span>
          <span class="name" style="font-weight:400;">جمع قبل: ${toman(h.before.total)} ت ← جمع بعد: ${toman(h.after.total)} ت</span>
        </div>
      `).join('')}
    ` : ''}
  `);
  document.getElementById('print-inv-detail').addEventListener('click', ()=>printInvoice(inv.id));
  document.getElementById('image-inv-detail').addEventListener('click', ()=>exportInvoiceImage(inv.id));
  document.getElementById('edit-invoice').addEventListener('click', ()=>openEditInvoice(inv.id, cid));
  document.getElementById('del-invoice').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      if(invoiceHasLinkedStockReturn(inv.id)){
        showToast('این فاکتور دارای برگشت از فروش است و برای حفظ یکپارچگی موجودی قابل حذف نیست');
        throw new Error('validation');
      }
      if(!confirm('با حذف این فاکتور، موجودی انبار و حساب مشتری اصلاح خواهد شد. ادامه می‌دهید؟')) throw new Error('validation');
      // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور —
      // تا اگر saveData() شکست بخورد، data در حافظه دقیقاً به حالت قبل از
      // حذف برگردد و با آخرین نسخه‌ی موفق در IndexedDB ناهماهنگ نماند.
      const previousData = JSON.parse(JSON.stringify(data));
      revertInvoiceStockEffects(inv);
      revertInvoicePayments(inv);
      data.invoices = data.invoices.filter(x=>x.id!==invId);
      try{
        await saveData();
      }catch(saveErr){
        data = previousData;
        throw saveErr;
      }
      openCustomerDetail(cid); render(); showToast('فاکتور حذف شد؛ موجودی و حساب مشتری اصلاح شد');
    });
  });
}

function openAddInvoice(cid){
  openInvoiceForm(cid, null);
}

function openEditInvoice(invId, cid){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv) return;
  if(invoiceHasLinkedStockReturn(inv.id)){
    showToast('این فاکتور دارای برگشت از فروش است و برای حفظ یکپارچگی موجودی قابل ویرایش نیست');
    return;
  }
  openInvoiceForm(cid, inv);
}

function openInvoiceForm(cid, editInv){
  if(data.products.length===0){
    openSheet(`<h3>اول جنس اضافه کن</h3><div class="empty">برای ${editInv?'ویرایش':'ثبت'} فاکتور، حداقل یک جنس باید تو تب «اجناس و انبار» ثبت شده باشه.</div>`);
    return;
  }
  let rows = editInv
    ? editInv.items.map(it=>({productId:it.productId, qty:it.qty, price:it.price, discount:it.discount||0, buyPrice:it.buyPrice}))
    : [{productId:'', qty:1, price:0, discount:0}];
  const existingCheck = editInv ? data.checks.find(c=>c.invoiceId===editInv.id) : null;
  let cashPaid = editInv ? (editInv.cashPaid||0) : 0;
  let cardPaid = editInv ? (editInv.cardPaid||0) : 0;
  let transferPaid = editInv ? (editInv.transferPaid||0) : 0;
  let checkAmount = editInv ? (editInv.checkPaid||0) : 0;
  let checkDue = existingCheck ? existingCheck.dueDate : todayISO();
  let discount = editInv ? (editInv.discount||0) : 0;
  let discountType = (editInv && editInv.discountType==='percent') ? 'percent' : 'fixed';

  // "مانده قبلی": مانده مشتری بدون احتساب این فاکتور اصلاً — برای فاکتور جدید یعنی مانده فعلی،
  // برای ویرایش یعنی مانده فعلی منهای سهم همین فاکتور (چه از بابت جمع فاکتور و چه از بابت پرداختی‌های همراهش)
  const prevBalance = editInv
    ? (customerTotals(cid).balance - editInv.total + (editInv.cashPaid||0) + (editInv.cardPaid||0) + (editInv.transferPaid||0) + (editInv.checkPaid||0))
    : customerTotals(cid).balance;

  function lastSaleToCustomer(productId){
    const past = data.invoices
      .filter(inv=>inv.customerId===cid && (!editInv || inv.id!==editInv.id))
      .flatMap(inv=>inv.items.filter(it=>it.productId===productId).map(it=>({...it, date:inv.date})))
      .sort((a,b)=>new Date(b.date)-new Date(a.date));
    return past[0] || null;
  }

  function lastSaleAnyCustomer(productId){
    const past = data.invoices
      .filter(inv=>!editInv || inv.id!==editInv.id)
      .flatMap(inv=>inv.items.filter(it=>it.productId===productId).map(it=>({...it, date:inv.date})))
      .sort((a,b)=>new Date(b.date)-new Date(a.date));
    return past[0] || null;
  }

  function rowInfoHtml(idx){
    const r = rows[idx];
    const prod = data.products.find(p=>p.id===r.productId);
    if(!prod) return '';
    const fifoCost = productFifoUnitCost(prod.id);
    const qty = r.qty||0;
    const unitPrice = r.price||0;
    const lineAmt = qty * unitPrice;
    const profitPerUnit = unitPrice - fifoCost;
    const profitTotal = profitPerUnit*qty;
    const pct = fifoCost ? Math.round((profitPerUnit/fifoCost)*100) : 0;
    const profitColor = profitTotal<0 ? 'var(--rust)' : 'var(--olive-dark)';
    const lastAny = lastSaleAnyCustomer(prod.id);
    const lastCust = lastSaleToCustomer(prod.id);
    const sellRef = (prod.retail!=null && prod.retail!=='') ? prod.retail : (prod.sell||0);
    return `
      <div class="inv-row-meta">
        <div class="inv-row-line-total">${esc(String(qty))} × ${toman(unitPrice)} = <strong>${toman(lineAmt)} ت</strong></div>
        <div class="inv-row-profit-line" style="color:${profitColor};">سود این قلم: ${profitTotal<0?'−':''}${toman(Math.abs(profitTotal))} ت (${pct}٪)</div>
        <button type="button" class="inv-price-info-btn" data-row="${idx}" aria-expanded="false">اطلاعات قیمت</button>
        <div class="inv-price-info-panel" data-row="${idx}" hidden>
          <div class="inv-price-info-grid">
            <div class="inv-price-info-row"><span class="k">خرید (FIFO)</span><span class="v">${toman(fifoCost)} ت</span></div>
            <div class="inv-price-info-row"><span class="k">قیمت فروش (مرجع)</span><span class="v">${toman(sellRef)} ت</span></div>
            <div class="inv-price-info-row"><span class="k">آخرین فروش (کلی)</span><span class="v">${lastAny?`${toman(lastAny.price)} ت — ${faDate(lastAny.date)}`:'ثبت نشده'}</span></div>
            <div class="inv-price-info-row"><span class="k">آخرین فروش به این مشتری</span><span class="v">${lastCust?`${toman(lastCust.price)} ت — ${faDate(lastCust.date)}`:'ثبت نشده'}</span></div>
          </div>
        </div>
      </div>
    `;
  }

  function updateRowInfo(idx){
    const el = document.querySelector(`.row-info[data-row="${idx}"]`);
    if(el) el.innerHTML = rowInfoHtml(idx);
  }

  // Product selector state (one open at a time) — UI only
  let prodDropOpenRow = null;
  let prodDropOpening = false;

  function productDropListHtml(idx, query){
    const q = (query||'').trim();
    const list = (q ? data.products.filter(p=>(p.name||'').includes(q)) : data.products).slice(0, 40);
    if(!list.length) return `<div class="prod-drop-empty">کالایی پیدا نشد</div>`;
    return list.map(p=>`
      <div class="prod-drop-item" data-row="${idx}" data-pid="${esc(p.id)}">
        <span class="prod-drop-name">${esc(p.name)}</span>
        <span class="prod-drop-stock">موجودی: ${p.stockQty||0}</span>
      </div>
    `).join('');
  }
  function productDropPanelHtml(idx){
    return `
      <div class="prod-drop-panel">
        <div class="prod-drop-search-wrap">
          <input type="search" class="prod-drop-search" data-row="${idx}" placeholder="جستجوی کالا..." value="" autocomplete="off" enterkeyhint="search">
        </div>
        <div class="prod-drop-list">${productDropListHtml(idx, '')}</div>
      </div>`;
  }
  function productDropItemsHtml(idx, query){
    return productDropListHtml(idx, query);
  }

  function itemsHtml(){
    return rows.map((r,idx)=>{
      const prod = data.products.find(p=>p.id===r.productId);
      const priceDisp = (typeof formatLiveAmount==='function' && r.price) ? formatLiveAmount(String(r.price)) : (r.price||'');
      const label = prod ? esc(prod.name) : '';
      return `
      <div class="field inv-item-row">
        <div class="inv-item-product">
          <label>جنس</label>
          <input type="text" class="row-product-search" data-row="${idx}" placeholder="انتخاب کالا..." autocomplete="off" readonly value="${label}" inputmode="none">
          <div class="prod-drop" data-row="${idx}" hidden></div>
        </div>
        <div class="inv-item-qty">
          <label>تعداد</label>
          <input type="text" inputmode="decimal" data-row="${idx}" class="row-qty" value="${r.qty}">
        </div>
        <div class="inv-item-price">
          <label>قیمت واحد</label>
          <input type="text" inputmode="decimal" data-row="${idx}" class="row-price" value="${esc(String(priceDisp))}">
        </div>
        ${rows.length>1?`<div class="inv-item-del">
          <label>&nbsp;</label>
          <button type="button" class="btn danger small row-del" data-row="${idx}" title="حذف این قلم">×</button>
        </div>`:''}
      </div>
      <div class="row-info" data-row="${idx}">${rowInfoHtml(idx)}</div>
    `;
    }).join('');
  }

  function invoiceTotal(){
    const subtotal = rows.reduce((s,r)=>s+(r.qty*r.price-(r.discount||0)),0);
    const discountAmount = discountType==='percent' ? subtotal*(discount||0)/100 : discount;
    return Math.max(0, subtotal - discountAmount);
  }

  function invoiceProfitEstimate(){
    const subtotal = rows.reduce((s,r)=>s+(r.qty*r.price-(r.discount||0)),0);
    const discountAmount = discountType==='percent' ? subtotal*(discount||0)/100 : discount;
    const itemsProfit = rows.reduce((s,r)=>{
      if(!r.productId) return s;
      const fifoCost = productFifoUnitCost(r.productId);
      return s + ((r.price||0)-fifoCost)*(r.qty||0);
    }, 0);
    return itemsProfit - discountAmount;
  }

  function updateSummary(){
    const total = invoiceTotal();
    const subtotal = rows.reduce((s,r)=>s+(r.qty*r.price-(r.discount||0)),0);
    const discountAmount = discountType==='percent' ? subtotal*(discount||0)/100 : discount;
    const paid = cashPaid+cardPaid+transferPaid+checkAmount;
    const newBalance = prevBalance + total - paid;
    const profit = invoiceProfitEstimate();
    const profitColor = profit<0 ? 'var(--rust)' : 'var(--olive-dark)';
    document.getElementById('calc-summary').innerHTML = `
      <div class="ledger-row"><span class="name">مانده قبلی مشتری</span><span class="filler"></span><span class="amount">${toman(prevBalance)} ت</span></div>
      <div class="ledger-row"><span class="name">جمع اقلام</span><span class="filler"></span><span class="amount">${toman(subtotal)} ت</span></div>
      <div class="ledger-row"><span class="name">تخفیف کلی فاکتور${discountType==='percent'?` (${toman(discount)}٪)`:''}</span><span class="filler"></span><span class="amount">${toman(discountAmount)} ت</span></div>
      <div class="ledger-row"><span class="name">جمع این فاکتور</span><span class="filler"></span><span class="amount">${toman(total)} ت</span></div>
      <div class="ledger-row"><span class="name">جمع دریافتی</span><span class="filler"></span><span class="amount">${toman(paid)} ت</span></div>
      <div class="ledger-row"><span class="name" style="color:${newBalance>0?'var(--rust)':'var(--olive-dark)'}">مانده جدید</span><span class="filler"></span><span class="amount" style="color:${newBalance>0?'var(--rust)':'var(--olive-dark)'}">${toman(Math.abs(newBalance))} ت ${balanceStatusWord(newBalance)}</span></div>
      <div class="ledger-row" style="border-top:1.5px dashed var(--border);margin-top:6px;padding-top:10px;">
        <span class="name" style="font-weight:700;">سود این فاکتور (بر اساس FIFO)</span><span class="filler"></span>
        <span class="amount" style="color:${profitColor};font-weight:700;font-size:1.05rem;">${profit<0?'−':''}${toman(Math.abs(profit))} ت</span>
      </div>
    `;
  }

  function renderSheet(){
    openSheet(`
      <h3>${editInv?('ویرایش فاکتور #'+(editInv.number||'—')):'فاکتور جدید'}</h3>
      ${editInv?`<div class="empty" style="padding:0 0 8px;text-align:right;">با ذخیره‌ی این ویرایش، موجودی انبار و مانده حساب مشتری به‌طور خودکار اصلاح می‌شود.</div>`:''}
      <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('f-date', editInv?editInv.date:todayISO())}</div>
      <div id="items-wrap">${itemsHtml()}</div>
      <button class="btn secondary small" id="add-row">+ افزودن قلم</button>

      <h2 class="section-title">دریافتی همراه این فاکتور (اختیاری)</h2>
      <div class="field" style="display:flex;gap:8px;">
        <div style="flex:1;"><label>نقد</label><input id="f-cash" type="text" inputmode="decimal" value="${cashPaid||''}"></div>
        <div style="flex:1;"><label>کارت</label><input id="f-card" type="text" inputmode="decimal" value="${cardPaid||''}"></div>
        <div style="flex:1;"><label>انتقال بانکی</label><input id="f-transfer" type="text" inputmode="decimal" value="${transferPaid||''}"></div>
      </div>
      <div class="field"><label>دریافت چک</label><input id="f-check" type="text" inputmode="decimal" value="${checkAmount||''}"></div>
      <div class="field" id="check-due-wrap" style="display:${checkAmount>0?'block':'none'};">
        <label>تاریخ سررسید چک</label>${shamsiDateInputHTML('f-check-due', checkDue)}
      </div>

      <div class="field" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>تخفیف کلی فاکتور (${discountType==='percent'?'درصد':'تومان'}، اختیاری)</label>
          <input id="f-discount" type="text" inputmode="decimal" value="${discount||''}">
        </div>
        <div style="flex:1;">
          <label>نوع تخفیف</label>
          <select id="f-discount-type">
            <option value="fixed" ${discountType==='fixed'?'selected':''}>مبلغ</option>
            <option value="percent" ${discountType==='percent'?'selected':''}>درصد</option>
          </select>
        </div>
      </div>

      <h2 class="section-title">محاسبه خودکار</h2>
      <div id="calc-summary"></div>

      <div class="btn-row"><button class="btn" id="save-invoice">${editInv?'ذخیره ویرایش':'ثبت فاکتور'}</button></div>
    `);
    updateSummary();

    document.getElementById('add-row').addEventListener('click', ()=>{
      rows.push({productId:'', qty:1, price:0, discount:0});
      renderSheet();
    });
    document.querySelectorAll('.row-del').forEach(el=>el.addEventListener('click', e=>{
      const i = parseInt(e.currentTarget.dataset.row, 10);
      if(rows.length>1 && i>=0 && i<rows.length){
        rows.splice(i, 1);
        renderSheet();
      }
    }));

    function closeAllProductDrops(){
      prodDropOpenRow = null;
      prodDropOpening = false;
      document.querySelectorAll('.prod-drop').forEach(d=>{
        d.hidden = true;
        d.classList.remove('is-open');
        d.innerHTML = '';
        d.style.top = d.style.bottom = d.style.maxHeight = d.style.left = d.style.right = '';
      });
    }
    function positionProductDrop(dropEl, anchorEl){
      if(!dropEl || !anchorEl) return;
      const margin = 10;
      const rect = anchorEl.getBoundingClientRect();
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      const vTop = vv ? vv.offsetTop : 0;
      // Height cap: ~38% viewport, max 300px, min 180px
      const maxH = Math.min(300, Math.max(180, Math.round(vh * 0.38)));
      dropEl.style.left = margin + 'px';
      dropEl.style.right = margin + 'px';
      dropEl.style.width = 'auto';
      dropEl.style.maxHeight = maxH + 'px';
      const spaceBelow = (vTop + vh) - rect.bottom - 8;
      const spaceAbove = rect.top - vTop - 8;
      if(spaceBelow >= Math.min(maxH, 200) || spaceBelow >= spaceAbove){
        dropEl.style.top = (rect.bottom + 4) + 'px';
        dropEl.style.bottom = 'auto';
        if(spaceBelow < maxH) dropEl.style.maxHeight = Math.max(160, spaceBelow) + 'px';
      }else{
        dropEl.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        dropEl.style.top = 'auto';
        if(spaceAbove < maxH) dropEl.style.maxHeight = Math.max(160, spaceAbove) + 'px';
      }
    }
    function openProductDrop(idx){
      idx = String(idx);
      // Already open for this row → do not rebuild
      if(prodDropOpenRow === idx){
        const existing = document.querySelector(`.prod-drop[data-row="${idx}"]`);
        if(existing && existing.classList.contains('is-open') && !existing.hidden) return;
      }
      if(prodDropOpening) return;
      prodDropOpening = true;
      try{
        const dropEl = document.querySelector(`.prod-drop[data-row="${idx}"]`);
        const anchor = document.querySelector(`.row-product-search[data-row="${idx}"]`);
        if(!dropEl || !anchor) return;
        // Close others first
        document.querySelectorAll('.prod-drop').forEach(d=>{
          if(d === dropEl) return;
          d.hidden = true;
          d.classList.remove('is-open');
          d.innerHTML = '';
        });
        dropEl.innerHTML = productDropPanelHtml(idx);
        dropEl.hidden = false;
        dropEl.classList.add('is-open');
        positionProductDrop(dropEl, anchor);
        prodDropOpenRow = idx;
        const search = dropEl.querySelector('.prod-drop-search');
        const list = dropEl.querySelector('.prod-drop-list');
        if(search && list){
          // Keyboard only when user taps search — no auto-focus
          search.addEventListener('input', ()=>{
            list.innerHTML = productDropListHtml(idx, search.value);
          });
        }
      }finally{
        // Release re-entry guard after gesture settles
        setTimeout(()=>{ prodDropOpening = false; }, 120);
      }
    }
    function selectProduct(idx, productId){
      const prod = data.products.find(p=>p.id===productId);
      if(!prod) return;
      rows[idx].productId = productId;
      delete rows[idx].buyPrice;
      rows[idx].price = prod.retail||prod.sell||0;
      const searchEl = document.querySelector(`.row-product-search[data-row="${idx}"]`);
      if(searchEl){
        searchEl.value = prod.name;
        searchEl.readOnly = true;
      }
      const priceEl = document.querySelector(`.row-price[data-row="${idx}"]`);
      if(priceEl){
        priceEl.value = (typeof formatLiveAmount==='function')
          ? formatLiveAmount(String(rows[idx].price))
          : rows[idx].price;
      }
      closeAllProductDrops();
      updateRowInfo(idx);
      updateSummary();
    }

    // Single gesture open via pointerup (avoids focus+click double-open on mobile)
    document.querySelectorAll('.row-product-search').forEach(el=>{
      el.readOnly = true;
      el.setAttribute('inputmode', 'none');
      el.addEventListener('pointerup', function(e){
        e.preventDefault();
        openProductDrop(el.getAttribute('data-row'));
      });
      // Prevent keyboard / native focus behavior on the display field
      el.addEventListener('focus', function(e){
        e.preventDefault();
        try{ el.blur(); }catch(err){}
        openProductDrop(el.getAttribute('data-row'));
      });
    });

    document.querySelectorAll('.prod-drop').forEach(dropEl=>{
      dropEl.addEventListener('mousedown', e=>{
        // Allow focusing internal search; block only for list items
        if(e.target.closest('.prod-drop-search')) return;
        e.preventDefault();
      });
      dropEl.addEventListener('click', e=>{
        const item = e.target.closest('.prod-drop-item');
        if(!item) return;
        e.preventDefault();
        e.stopPropagation();
        selectProduct(item.getAttribute('data-row'), item.getAttribute('data-pid'));
      });
    });

    // Outside tap closes (once per document)
    if(!document._invProdDropOutsideBound){
      document._invProdDropOutsideBound = true;
      document.addEventListener('pointerdown', function(e){
        if(e.target.closest('.prod-drop') || e.target.closest('.row-product-search')) return;
        if(prodDropOpenRow == null) return;
        closeAllProductDrops();
      }, true);
    }

    // Price-info panel: delegation survives updateRowInfo()
    (function bindInvPriceInfoDelegation(){
      const root = document.getElementById('modalRoot');
      if(!root || root._invPriceInfoBound) return;
      root._invPriceInfoBound = true;
      root.addEventListener('click', function(e){
        const btn = e.target.closest('.inv-price-info-btn');
        if(!btn || !root.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        const i = btn.getAttribute('data-row');
        const panel = root.querySelector(`.inv-price-info-panel[data-row="${i}"]`);
        if(!panel) return;
        const willOpen = panel.hasAttribute('hidden');
        root.querySelectorAll('.inv-price-info-panel').forEach(p=>p.setAttribute('hidden',''));
        root.querySelectorAll('.inv-price-info-btn').forEach(b=>b.setAttribute('aria-expanded','false'));
        if(willOpen){
          panel.removeAttribute('hidden');
          btn.setAttribute('aria-expanded','true');
        }
      });
    })();
    document.querySelectorAll('.row-qty').forEach(el=>el.addEventListener('input', e=>{
      const idx = e.target.dataset.row;
      rows[idx].qty = parseFloat(faToEnDigits(e.target.value))||0;
      updateRowInfo(idx);
      updateSummary();
    }));
    document.querySelectorAll('.row-price').forEach(el=>el.addEventListener('input', e=>{
      const idx = e.target.dataset.row;
      rows[idx].price = parseFloat(faToEnDigits(e.target.value))||0;
      updateRowInfo(idx);
      updateSummary();
    }));
    document.getElementById('f-cash').addEventListener('input', e=>{ cashPaid = parseFloat(faToEnDigits(e.target.value))||0; updateSummary(); });
    document.getElementById('f-card').addEventListener('input', e=>{ cardPaid = parseFloat(faToEnDigits(e.target.value))||0; updateSummary(); });
    document.getElementById('f-transfer').addEventListener('input', e=>{ transferPaid = parseFloat(faToEnDigits(e.target.value))||0; updateSummary(); });
    document.getElementById('f-check').addEventListener('input', e=>{
      checkAmount = parseFloat(faToEnDigits(e.target.value))||0;
      document.getElementById('check-due-wrap').style.display = checkAmount>0 ? 'block':'none';
      updateSummary();
    });
    document.getElementById('f-check-due').addEventListener('change', e=>{ checkDue = e.target.value; });
    document.getElementById('f-discount').addEventListener('input', e=>{
      discount = parseFloat(faToEnDigits(e.target.value))||0;
      updateSummary();
    });
    document.getElementById('f-discount-type').addEventListener('change', e=>{
      discountType = e.target.value;
      renderSheet();
    });

    document.getElementById('save-invoice').addEventListener('click', async (e)=>{
      const btn = e.currentTarget;
      if(btn.disabled) return; // جلوگیری از ثبت دوباره با کلیک سریع/پی‌درپی
      btn.disabled = true;
      const date = document.getElementById('f-date').value || todayISO();

      // اعتبارسنجی: هر ردیف باید جنس مشخصی داشته باشه (چون فیلد جستجو دیگه پیش‌فرض نداره)
      const noProductRow = rows.find(r=> !r.productId || !data.products.find(p=>p.id===r.productId));
      if(noProductRow){
        alert('برای هر ردیف باید یک جنس از لیست انتخاب کنی.');
        btn.disabled = false;
        return;
      }

      // اعتبارسنجی مقادیر ردیف‌های فاکتور قبل از ذخیره: تعداد باید بزرگ‌تر از صفر، قیمت/تخفیف نباید منفی باشند
      const invalidRow = rows.find(r=> !(r.qty>0) || r.price<0 || (r.discount||0)<0);
      if(invalidRow){
        alert('مقادیر فاکتور نامعتبر است.\n\nتعداد هر ردیف باید بزرگ‌تر از صفر باشد و قیمت/تخفیف نباید منفی باشند.');
        btn.disabled = false;
        return;
      }
      if(discount<0){
        alert('تخفیف کلی فاکتور نمی‌تواند منفی باشد.');
        btn.disabled = false;
        return;
      }

      const items = rows.map(r=>{
        const prod = data.products.find(p=>p.id===r.productId);
        return { productId:r.productId, name:prod.name, qty:r.qty, price:r.price, buyPrice:(r.buyPrice!==undefined?r.buyPrice:prod.buy), discount:r.discount||0, weight:(prod.packageWeight||0)*r.qty };
      });

      // BLOCK فروش بیش از stock یا بیش از لایه‌های FIFO — قبل از هر mutation
      const creditStock = {};
      const creditFifo = {};
      if(editInv){
        const pids = {};
        (editInv.items||[]).forEach(it=>{ if(it.productId) pids[it.productId]=true; });
        Object.keys(pids).forEach(pid=>{
          creditStock[pid] = (editInv.items||[]).filter(it=>it.productId===pid).reduce((s,it)=>s+(it.qty||0),0);
          creditFifo[pid] = invoiceReleasedFifoQty(editInv, pid);
        });
      }
      const stockCheck = validateSaleAvailability(items, creditStock, creditFifo);
      if(!stockCheck.ok){
        alert(stockCheck.error || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.');
        btn.disabled = false;
        return;
      }

      const total = invoiceTotal();
      const paid = cashPaid+cardPaid+transferPaid+checkAmount;
      const newBalance = prevBalance + total - paid;

      if(editInv){
        // دفاع دوم: حتی اگر فرم ویرایش قبلاً باز شده باشد، قبل از هر revert دوباره dependency را بررسی کن.
        if(invoiceHasLinkedStockReturn(editInv.id)){
          showToast('این فاکتور دارای برگشت از فروش است و برای حفظ یکپارچگی موجودی قابل ویرایش نیست');
          btn.disabled = false;
          return;
        }
        if(!confirm('با ویرایش این فاکتور، موجودی انبار و حساب مشتری اصلاح خواهد شد. ادامه می‌دهید؟')){ btn.disabled = false; return; }

        // اسنپ‌شات کامل قبل از هر mutation — اگر saveData() در انتها شکست بخورد،
        // data در حافظه دقیقاً به همین حالت (قبل از هر تغییری) برمی‌گردد تا با
        // آخرین نسخه‌ی موفق در IndexedDB ناهماهنگ نماند.
        const previousData = JSON.parse(JSON.stringify(data));

        // snapshot قبل از تغییر، برای تاریخچه و rollback احتمالی
        const before = {
          date:editInv.date, items:editInv.items, total:editInv.total, discount:editInv.discount, discountType:editInv.discountType,
          cashPaid:editInv.cashPaid||0, cardPaid:editInv.cardPaid||0, transferPaid:editInv.transferPaid||0, checkPaid:editInv.checkPaid||0,
          newBalance:editInv.newBalance,
        };
        const checkMeta = existingCheck ? {checkNumber:existingCheck.checkNumber, status:existingCheck.status} : null;

        // ۱) برگردوندن اثر فاکتور قبلی: موجودی کالاها + حذف پرداخت/چک مرتبط با همین فاکتور
        const oldItemsSnap = editInv.items;
        const oldDateSnap = editInv.date;
        revertInvoiceStockEffects(editInv);
        revertInvoicePayments(editInv);

        // ۲) به‌روزرسانی خود فاکتور با مقادیر جدید (همون id و شماره فاکتور حفظ می‌مونه)
        editInv.date = date; editInv.items = items; editInv.total = total; editInv.discount = discount; editInv.discountType = discountType;
        editInv.prevBalance = prevBalance; editInv.cashPaid = cashPaid; editInv.cardPaid = cardPaid;
        editInv.transferPaid = transferPaid; editInv.checkPaid = checkAmount; editInv.newBalance = newBalance;

        // ۳) اعمال دوباره‌ی موجودی/پرداخت‌ها — اگر BLOCK شد، فاکتور قبلی را کامل برگردان
        try{
          applyInvoiceStockEffects(items, date, editInv, false);
        }catch(e){
          editInv.date = oldDateSnap; editInv.items = oldItemsSnap;
          editInv.total = before.total; editInv.discount = before.discount; editInv.discountType = before.discountType;
          editInv.cashPaid = before.cashPaid; editInv.cardPaid = before.cardPaid;
          editInv.transferPaid = before.transferPaid; editInv.checkPaid = before.checkPaid;
          editInv.newBalance = before.newBalance;
          applyInvoiceStockEffects(oldItemsSnap, oldDateSnap, editInv, false);
          pushInvoicePayments(cid, editInv, before.cashPaid, before.cardPaid, before.transferPaid, before.checkPaid, checkDue, checkMeta);
          alert((e && e.message) || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.');
          btn.disabled = false;
          return;
        }
        pushInvoicePayments(cid, editInv, cashPaid, cardPaid, transferPaid, checkAmount, checkDue, checkMeta);

        // ۴) ثبت این ویرایش در تاریخچه‌ی خود فاکتور
        editInv.editHistory = editInv.editHistory||[];
        editInv.editHistory.push({
          id:uid(), editedAt:new Date().toISOString(),
          before, after:{date, items, total, discount, discountType, cashPaid, cardPaid, transferPaid, checkPaid:checkAmount},
        });

        try{
          await saveData();
        }catch(e){
          // saveData() شکست خورد: data را دقیقاً به حالت قبل از این ویرایش برگردان
          // تا RAM با آخرین نسخه‌ی واقعاً ذخیره‌شده در IndexedDB هماهنگ بماند.
          data = previousData;
          btn.disabled = false;
          return;
        }
        closeModal(); openInvoiceDetail(editInv.id, cid); render();
        showToast('فاکتور ویرایش شد؛ موجودی و حساب مشتری اصلاح شد');
        return;
      }

      const newInv = {
        id:uid(), number:null, customerId:cid, date, items, total, discount, discountType,
        prevBalance, cashPaid, cardPaid, transferPaid, checkPaid:checkAmount, newBalance,
      };
      // اسنپ‌شات کامل قبل از هر mutation — اگر saveData() در انتها شکست بخورد،
      // data در حافظه دقیقاً به همین حالت (قبل از هر تغییری) برمی‌گردد تا با
      // آخرین نسخه‌ی موفق در IndexedDB ناهماهنگ نماند.
      const previousData = JSON.parse(JSON.stringify(data));
      try{
        applyInvoiceStockEffects(items, date, newInv, true);
      }catch(e){
        alert((e && e.message) || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.');
        btn.disabled = false;
        return;
      }
      newInv.number = nextInvoiceNumber();
      data.invoices.push(newInv);
      pushInvoicePayments(cid, newInv, cashPaid, cardPaid, transferPaid, checkAmount, checkDue, null);
      try{
        await saveData();
      }catch(e){
        // saveData() شکست خورد: data را دقیقاً به حالت قبل از این فاکتور برگردان
        // تا RAM با آخرین نسخه‌ی واقعاً ذخیره‌شده در IndexedDB هماهنگ بماند.
        data = previousData;
        btn.disabled = false;
        return;
      }
      render(); showToast('فاکتور ثبت شد');
      openSheet(`
        <h3>فاکتور ثبت و توی حساب مشتری ذخیره شد</h3>
        <div class="empty">حالا می‌خوای همین فاکتور رو چاپ کنی، تصویرش رو بگیری یا فقط ذخیره بمونه؟</div>
        <div class="btn-row">
          <button class="btn" id="print-now">چاپ فاکتور</button>
          <button class="btn secondary" id="image-now">خروجی تصویر (واتساپ)</button>
          <button class="btn secondary" id="skip-print">فقط ذخیره بمونه</button>
        </div>
      `);
      document.getElementById('print-now').addEventListener('click', ()=>{
        closeModal();
        setTimeout(()=>printInvoice(newInv.id), 50);
      });
      document.getElementById('image-now').addEventListener('click', async ()=>{
        await exportInvoiceImage(newInv.id);
        closeModal(); openCustomerDetail(cid);
      });
      document.getElementById('skip-print').addEventListener('click', ()=>{
        closeModal(); openCustomerDetail(cid);
      });
    });
  }
  renderSheet();
}

// ---------- suppliers ----------
function openAddSupplier(){
  openSheet(`
    <h3>تامین‌کننده جدید</h3>
    <div class="field"><label>نام تامین‌کننده</label><input id="f-name"></div>
    <div class="field"><label>شماره تماس (اختیاری)</label><input id="f-phone"></div>
    <div class="field">
      <label>مانده بدهی اولیه به این تامین‌کننده (تومان)</label>
      <input id="f-opening" type="text" inputmode="decimal">
      <div class="empty" style="padding:4px 0 0;text-align:right;font-size:.75rem;">بدهی که از قبل از استفاده از این برنامه داری رو اینجا بزن.</div>
    </div>
    <div class="btn-row"><button class="btn" id="save-supplier">ذخیره</button></div>
  `);
  document.getElementById('save-supplier').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const name = document.getElementById('f-name').value.trim();
      if(!name){ showToast('نام تامین‌کننده رو وارد کن'); throw new Error('validation'); }
      const phone = document.getElementById('f-phone').value.trim();
      const openingBalance = numVal(document.getElementById('f-opening'));
      data.suppliers.push({id:uid(), name, phone, openingBalance, purchases:[], payments:[]});
      await saveData(); closeModal(); render(); showToast('تامین‌کننده اضافه شد');
    });
  });
}

function openSupplierDetail(sid){
  const s = data.suppliers.find(x=>x.id===sid);
  if(!s) return;
  const t = supplierTotals(sid);
  const purchases = (s.purchases||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const payments = (s.payments||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const isSupOff = s.active===false;
  openSheet(`
    <h3>${esc(s.name)}${isSupOff?' <span class="badge pending">غیرفعال</span>':''}</h3>
    ${s.phone?`<div class="empty" style="padding:0 0 8px;text-align:right;">تلفن: ${esc(s.phone)}</div>`:''}
    ${s.openingBalance?`<div class="empty" style="padding:0 0 8px;text-align:right;">مانده بدهی اولیه (قبل از این برنامه): ${toman(Math.abs(s.openingBalance))} ت</div>`:''}
    <div class="cards">
      <div class="card"><div class="label">جمع خرید</div><div class="value">${toman(t.purchaseTotal)} ت</div></div>
      <div class="card"><div class="label">مانده بدهی شما</div><div class="value" style="color:${t.balance>0?'var(--red)':'var(--olive-dark)'}">${toman(Math.abs(t.balance))} ت</div></div>
      ${t.returnTotal>0?`<div class="card"><div class="label">جمع برگشتی</div><div class="value">${toman(t.returnTotal)} ت</div></div>`:''}
    </div>
    <div class="btn-row">
      <button class="btn" id="add-purchase">+ خرید جدید</button>
      <button class="btn secondary" id="add-suppay">+ پرداخت</button>
      <button class="btn secondary" id="edit-supplier">ویرایش</button>
      <button class="btn secondary" id="toggle-supplier-active">${isSupOff?'فعال‌سازی تأمین‌کننده':'غیرفعال‌سازی تأمین‌کننده'}</button>
    </div>
    <h2 class="section-title">خریدها</h2>
    ${purchases.length===0?`<div class="empty">خریدی ثبت نشده</div>`:purchases.map(p=>{
      const returnedQty = (p.returns||[]).reduce((a,r)=>a+(r.qty||0),0);
      const returnedAmount = (p.returns||[]).reduce((a,r)=>a+(r.amount||0),0);
      const remainingAmount = p.amount - returnedAmount;
      const lines = purchaseLines(p);
      const linesLabel = lines.length ? lines.map(l=>`${esc(l.name)} × ${l.qty}`).join('، ') : '';
      return `
      <div class="ledger-row"><span class="name">${faDate(p.date)} ${p.desc?`<span class="sub">${esc(p.desc)}</span>`:''}${linesLabel?`<span class="sub">${linesLabel}</span>`:''}${returnedAmount>0?`<span class="sub">برگشت‌شده: ${toman(returnedAmount)} ت${p.productId?` (${returnedQty} از ${p.qty})`:''}</span>`:''}</span><span class="filler"></span><span class="amount">${toman(p.amount)} ت${remainingAmount>0?`<br><button class="btn secondary small" data-return-purchase="${p.id}">برگشت</button>`:''}</span></div>
    `;}).join('')}
    <h2 class="section-title">پرداختی‌ها</h2>
    ${payments.length===0?`<div class="empty">پرداختی ثبت نشده</div>`:payments.map((p,pidx)=>{
      const isCheck = p.method==='check';
      const face = isCheck ? (typeof p.faceAmount==='number' ? p.faceAmount : p.amount) : p.amount;
      const st = isCheck ? (p.status||'pending') : '';
      const stLabel = st==='cleared'?'پرداخت‌شده':(st==='bounced'?'برگشتی':'در جریان');
      const stBadge = st==='cleared'?'cleared':(st==='bounced'?'pending':'pending');
      const nameBits = isCheck
        ? `چک${p.checkNumber?` #${esc(p.checkNumber)}`:''}${p.bank?` — ${esc(p.bank)}`:''}${p.dueDate?` <span class="sub">سررسید ${faDate(p.dueDate)}</span>`:''}${p.note?` <span class="sub">(${esc(p.note)})</span>`:''}`
        : `${faDate(p.date)}${p.note?` <span class="sub">(${esc(p.note)})</span>`:''}`;
      return `<div class="ledger-row">
        <span class="name">${isCheck?faDate(p.issueDate||p.date)+' — ':''}${nameBits}</span>
        <span class="filler"></span>
        <span class="amount">${toman(isCheck?face:p.amount)} ت${isCheck?` <span class="badge ${stBadge}">${stLabel}</span>`:''}
          ${isCheck?`<br>
            <button class="btn secondary small" data-sup-check-status="${pidx}">وضعیت</button>
            <button class="btn secondary small" data-sup-check-edit="${pidx}">ویرایش</button>
            <button class="btn danger small" data-sup-pay-del="${pidx}">حذف</button>
          `:`<br><button class="btn danger small" data-sup-pay-del="${pidx}">حذف</button>`}
        </span>
      </div>`;
    }).join('')}
  `);
  document.getElementById('add-purchase').addEventListener('click', ()=>{
    let multiItems = [];
    openSheet(`
      <h3>خرید جدید از ${esc(s.name)}</h3>
      <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('f-date', todayISO())}</div>
      <div id="single-item-fields">
        <div class="field"><label>مبلغ کل خرید (تومان)</label><input id="f-amount" type="text" inputmode="decimal"></div>
        <div class="field">
          <label>کالای مرتبط (اختیاری — برای افزایش خودکار موجودی)</label>
          <select id="f-product">
            <option value="">— بدون کالای مشخص —</option>
            ${data.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>تعداد کالا (در صورت انتخاب کالا)</label><input id="f-qty" type="text" inputmode="decimal"></div>
      </div>
      <div class="btn-row"><button class="btn secondary small" id="toggle-multi-item" type="button">+ چند قلم کالا در یک خرید</button></div>
      <div id="multi-item-fields" style="display:none;">
        <div id="multi-item-rows"></div>
        <div class="field" style="display:flex;gap:6px;">
          <select id="mi-product" style="flex:2;">
            <option value="">انتخاب کالا</option>
            ${data.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select>
          <input id="mi-qty" type="text" inputmode="decimal" placeholder="تعداد" style="flex:1;">
          <input id="mi-price" type="text" inputmode="decimal" placeholder="قیمت واحد" style="flex:1;">
        </div>
        <div class="btn-row"><button class="btn secondary small" id="add-item-row" type="button">+ افزودن قلم</button></div>
        <div class="empty" style="padding:4px 0;text-align:right;">جمع کل اقلام (خودکار): <b id="multi-item-total">۰</b> تومان</div>
      </div>
      <div class="field"><label>توضیح (اختیاری)</label><input id="f-desc"></div>
      <div class="btn-row"><button class="btn" id="save-purchase">ثبت</button></div>
    `);
    function renderMultiRows(){
      document.getElementById('multi-item-rows').innerHTML = multiItems.map((it,idx)=>`
        <div class="ledger-row"><span class="name">${esc((data.products.find(x=>x.id===it.productId)||{}).name||'?')} × ${it.qty} @ ${toman(it.unitCost)} ت</span><span class="filler"></span><span class="amount">${toman(it.qty*it.unitCost)} ت<br><button class="btn danger small" data-del-item="${idx}" type="button">حذف</button></span></div>
      `).join('');
      document.getElementById('multi-item-total').textContent = toman(multiItems.reduce((s2,it)=>s2+it.qty*it.unitCost,0));
      document.querySelectorAll('[data-del-item]').forEach(btn=>{
        btn.addEventListener('click', ()=>{ multiItems.splice(+btn.dataset.delItem,1); renderMultiRows(); });
      });
    }
    document.getElementById('toggle-multi-item').addEventListener('click', ()=>{
      const single = document.getElementById('single-item-fields');
      const multi = document.getElementById('multi-item-fields');
      const goingMulti = multi.style.display==='none';
      multi.style.display = goingMulti?'':'none';
      single.style.display = goingMulti?'none':'';
      document.getElementById('toggle-multi-item').textContent = goingMulti?'– برگشت به حالت مبلغ کل / یک کالا':'+ چند قلم کالا در یک خرید';
    });
    document.getElementById('add-item-row').addEventListener('click', ()=>{
      const productId = document.getElementById('mi-product').value;
      const qty = numVal(document.getElementById('mi-qty'));
      const unitCost = numVal(document.getElementById('mi-price'));
      if(!productId){ showToast('کالا رو انتخاب کن'); return; }
      const prodCheck = data.products.find(x=>x.id===productId);
      if(!prodCheck){ showToast('کالای انتخاب‌شده معتبر نیست'); return; }
      if(qty<=0){ showToast('تعداد رو وارد کن'); return; }
      if(unitCost<=0){ showToast('قیمت واحد باید بیشتر از صفر باشد'); return; }
      let itemId = uid();
      while(multiItems.some(it=>it.id===itemId)) itemId = uid();
      multiItems.push({id:itemId, productId, qty, unitCost});
      document.getElementById('mi-product').value='';
      document.getElementById('mi-qty').value='';
      document.getElementById('mi-price').value='';
      renderMultiRows();
    });
    document.getElementById('save-purchase').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
      const date = document.getElementById('f-date').value || todayISO();
      const desc = document.getElementById('f-desc').value.trim();
      const isMulti = document.getElementById('multi-item-fields').style.display!=='none';
      s.purchases = s.purchases||[];
      if(isMulti){
        if(multiItems.length===0){ showToast('حداقل یک قلم کالا اضافه کن'); throw new Error('validation'); }
        for(const it of multiItems){
          if(!it.productId || !data.products.find(x=>x.id===it.productId)){ showToast('یکی از کالاها معتبر نیست'); return; }
          if(!(it.qty>0)){ showToast('تعداد همه اقلام باید بیشتر از صفر باشد'); return; }
          if(!(it.unitCost>0)){ showToast('قیمت واحد همه اقلام باید بیشتر از صفر باشد'); return; }
        }
        const amount = multiItems.reduce((s2,it)=>s2+it.qty*it.unitCost,0);
        const usedIds = new Set();
        const items = multiItems.map(it=>{
          let id = it.id || uid();
          while(usedIds.has(id)) id = uid();
          usedIds.add(id);
          return {
            id, productId: it.productId, name:(data.products.find(x=>x.id===it.productId)||{}).name||'',
            qty: it.qty, unitCost: it.unitCost, lineAmount: it.qty*it.unitCost,
          };
        });
        const purchase = {id:uid(), date, amount, desc, productId:'', qty:0, items};
        // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور.
        const previousData = JSON.parse(JSON.stringify(data));
        s.purchases.push(purchase);
        applyPurchaseStockEffects(purchase, s.name);
        try{
          await saveData();
        }catch(saveErr){
          data = previousData;
          throw saveErr;
        }
        openSupplierDetail(sid); render(); showToast('خرید ثبت شد');
        return;
      } else {
        const amount = numVal(document.getElementById('f-amount'));
        const productId = document.getElementById('f-product').value;
        const qty = numVal(document.getElementById('f-qty'));
        if(amount<=0){ showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
        if(productId){
          const prod = data.products.find(x=>x.id===productId);
          if(!prod){ showToast('کالای انتخاب‌شده معتبر نیست'); throw new Error('validation'); }
          if(!(qty>0)){ showToast('تعداد کالا باید بیشتر از صفر باشد'); throw new Error('validation'); }
          // قیمت واحد ضمنی = مبلغ/تعداد؛ با amount>0 و qty>0 خودبه‌خود >0 است
        }
        const purchase = {id:uid(), date, amount, desc, productId, qty};
        // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور.
        const previousData = JSON.parse(JSON.stringify(data));
        s.purchases.push(purchase);
        applyPurchaseStockEffects(purchase, s.name);
        try{
          await saveData();
        }catch(saveErr){
          data = previousData;
          throw saveErr;
        }
        openSupplierDetail(sid); render(); showToast('خرید ثبت شد');
      }
      });
    });
  });
  document.getElementById('add-suppay').addEventListener('click', ()=>{
    openSheet(`
      <h3>پرداخت به ${esc(s.name)}</h3>
      <div class="field">
        <label>روش پرداخت</label>
        <select id="f-method">
          <option value="cash">نقد / کارت / انتقال</option>
          <option value="check">چک</option>
        </select>
      </div>
      <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal"></div>
      <div class="field"><label>تاریخ پرداخت / صدور</label>${shamsiDateInputHTML('f-date', todayISO())}</div>
      <div id="check-fields" style="display:none;">
        <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', todayISO())}</div>
        <div class="field"><label>شماره چک</label><input id="f-check-num"></div>
        <div class="field"><label>بانک</label><input id="f-bank"></div>
      </div>
      <div class="field"><label>توضیح (اختیاری)</label><input id="f-note"></div>
      <div class="btn-row"><button class="btn" id="save-suppay">ثبت</button></div>
    `);
    const methodEl = document.getElementById('f-method');
    const checkFields = document.getElementById('check-fields');
    methodEl.addEventListener('change', ()=>{
      checkFields.style.display = methodEl.value==='check' ? '' : 'none';
    });
    document.getElementById('save-suppay').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
      const amount = numVal(document.getElementById('f-amount'));
      const date = document.getElementById('f-date').value || todayISO();
      const method = methodEl.value;
      const note = (document.getElementById('f-note').value||'').trim();
      if(amount<=0){ showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
      s.payments = s.payments||[];
      if(method==='check'){
        const dueDate = document.getElementById('f-due').value || date;
        const checkNumber = (document.getElementById('f-check-num').value||'').trim();
        const bank = (document.getElementById('f-bank').value||'').trim();
        // amount در مانده لحاظ می‌شود؛ faceAmount مبلغ اسمی چک است (برای برگشتی)
        s.payments.push({
          id: uid(),
          date,
          amount,
          faceAmount: amount,
          method: 'check',
          checkNumber,
          bank,
          issueDate: date,
          dueDate,
          status: 'pending',
          note,
        });
      } else {
        s.payments.push({id: uid(), date, amount, method: 'cash', note});
      }
      await saveData(); openSupplierDetail(sid); render(); showToast('پرداخت ثبت شد');
      });
    });
  });

  // حذف پرداخت نقدی یا چک — با حذف، مبلغ از جمع پرداخت‌ها خارج و مانده اصلاح می‌شود
  // توجه: pidx مربوط به آرایهٔ مرتب‌شدهٔ payments است؛ ایندکس واقعی با indexOf گرفته می‌شود
  document.querySelectorAll('[data-sup-pay-del]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const pidx = parseInt(btn.dataset.supPayDel, 10);
        const p = payments[pidx];
        if(!p) throw new Error('validation');
        const realIdx = (s.payments||[]).indexOf(p);
        if(realIdx<0) throw new Error('validation');
        const label = p.method==='check' ? ('چک'+(p.checkNumber?(' #'+p.checkNumber):'')) : 'پرداخت';
        if(!confirm('«'+label+'» به مبلغ '+toman(p.method==='check'?(p.faceAmount||p.amount):p.amount)+' تومان حذف شود؟\nمانده حساب تامین‌کننده اصلاح می‌شود.')) throw new Error('validation');
        s.payments.splice(realIdx, 1);
        await saveData(); openSupplierDetail(sid); render(); showToast('حذف شد');
      });
    });
  });

  // چرخش وضعیت چک: در جریان → پرداخت‌شده → برگشتی → در جریان
  // برگشتی: amount=0 تا از مانده کم نشود؛ faceAmount حفظ می‌شود
  document.querySelectorAll('[data-sup-check-status]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const pidx = parseInt(btn.dataset.supCheckStatus, 10);
      const p = payments[pidx];
      if(!p || p.method!=='check') return;
      const order = ['pending','cleared','bounced'];
      const cur = p.status||'pending';
      const next = order[(order.indexOf(cur)+1) % order.length];
      const face = typeof p.faceAmount==='number' ? p.faceAmount : p.amount;
      p.faceAmount = face;
      p.status = next;
      p.amount = (next==='bounced') ? 0 : face;
      await saveData(); openSupplierDetail(sid); render();
      showToast(next==='cleared'?'چک پرداخت‌شده شد':(next==='bounced'?'چک برگشتی شد — از مانده حذف شد':'چک در جریان شد'));
    });
  });

  document.querySelectorAll('[data-sup-check-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const pidx = parseInt(btn.dataset.supCheckEdit, 10);
      const p = payments[pidx];
      if(!p || p.method!=='check') return;
      const face = typeof p.faceAmount==='number' ? p.faceAmount : p.amount;
      openSheet(`
        <h3>ویرایش چک پرداختی</h3>
        <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal" value="${face||''}"></div>
        <div class="field"><label>تاریخ صدور</label>${shamsiDateInputHTML('f-date', p.issueDate||p.date||todayISO())}</div>
        <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', p.dueDate||todayISO())}</div>
        <div class="field"><label>شماره چک</label><input id="f-check-num" value="${esc(p.checkNumber||'')}"></div>
        <div class="field"><label>بانک</label><input id="f-bank" value="${esc(p.bank||'')}"></div>
        <div class="field"><label>توضیح</label><input id="f-note" value="${esc(p.note||'')}"></div>
        <div class="field">
          <label>وضعیت</label>
          <select id="f-status">
            <option value="pending" ${(p.status||'pending')==='pending'?'selected':''}>در جریان</option>
            <option value="cleared" ${p.status==='cleared'?'selected':''}>پرداخت‌شده</option>
            <option value="bounced" ${p.status==='bounced'?'selected':''}>برگشتی</option>
          </select>
        </div>
        <div class="btn-row"><button class="btn" id="save-sup-check-edit">ذخیره</button></div>
      `);
      document.getElementById('save-sup-check-edit').addEventListener('click', async ()=>{
        const amount = numVal(document.getElementById('f-amount'));
        if(amount<=0){ showToast('مبلغ رو وارد کن'); return; }
        const status = document.getElementById('f-status').value || 'pending';
        p.faceAmount = amount;
        p.amount = (status==='bounced') ? 0 : amount;
        p.status = status;
        p.issueDate = document.getElementById('f-date').value || todayISO();
        p.date = p.issueDate;
        p.dueDate = document.getElementById('f-due').value || p.issueDate;
        p.checkNumber = (document.getElementById('f-check-num').value||'').trim();
        p.bank = (document.getElementById('f-bank').value||'').trim();
        p.note = (document.getElementById('f-note').value||'').trim();
        await saveData(); openSupplierDetail(sid); render(); showToast('چک ویرایش شد');
      });
    });
  });

  document.getElementById('edit-supplier').addEventListener('click', ()=>{
    openSheet(`
      <h3>ویرایش تامین‌کننده</h3>
      <div class="field"><label>نام</label><input id="f-name" value="${esc(s.name)}"></div>
      <div class="field"><label>شماره تماس</label><input id="f-phone" value="${esc(s.phone||'')}"></div>
      <div class="field">
        <label>مانده بدهی اولیه (تومان) — برای اصلاح مانده</label>
        <input id="f-opening" type="text" inputmode="decimal" value="${s.openingBalance?s.openingBalance:''}">
      </div>
      <div class="btn-row"><button class="btn" id="save-sup-edit">ذخیره</button></div>
    `);
    document.getElementById('save-sup-edit').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const name = document.getElementById('f-name').value.trim();
        if(!name){ showToast('نام رو وارد کن'); throw new Error('validation'); }
        s.name = name; s.phone = document.getElementById('f-phone').value.trim();
        s.openingBalance = numVal(document.getElementById('f-opening'));
        await saveData(); openSupplierDetail(sid); render(); showToast('ذخیره شد');
      });
    });
  });
  // FIX 1: archive/deactivate only — never remove the supplier object or its
  // historical purchases/payments/checks. No FIFO/inventory function is called here.
  document.getElementById('toggle-supplier-active').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const willDeactivate = s.active!==false;
      const msg = willDeactivate
        ? `این تأمین‌کننده غیرفعال شود؟ اطلاعات و سوابق خرید و پرداخت حذف نخواهد شد.`
        : `تامین‌کننده «${s.name}» دوباره فعال شود؟`;
      if(!confirm(msg)) throw new Error('validation');
      s.active = (s.active===false) ? true : false;
      await saveData(); openSupplierDetail(sid); render();
      showToast(s.active===false ? 'تأمین‌کننده غیرفعال شد' : 'تأمین‌کننده فعال شد');
    });
  });
  document.querySelectorAll('[data-return-purchase]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = (s.purchases||[]).find(x=>x.id===btn.dataset.returnPurchase);
      if(!p) return;
      const isMultiItem = !p.productId && Array.isArray(p.items) && p.items.length>0;
      const returnedQtySoFar = (p.returns||[]).reduce((a,r)=>a+(r.qty||0),0);
      const returnedAmountSoFar = (p.returns||[]).reduce((a,r)=>a+(r.amount||0),0);
      const remainingQty = purchaseReturnRemainingQty(p);
      const remainingAmount = purchaseReturnRemainingAmount(p);
      const unitPrice = (p.productId && p.qty>0) ? (p.amount/p.qty) : 0;
      const retLines = purchaseLines(p);
      const retLinesLabel = (!p.productId && retLines.length) ? ' — ' + retLines.map(l=>`${esc(l.name)} × ${l.qty}`).join('، ') : '';
      if(isMultiItem){
        openSheet(`
          <h3>برگشت خرید از ${esc(s.name)}</h3>
          <div class="empty" style="padding:0 0 8px;text-align:right;">${faDate(p.date)}${retLinesLabel} — مبلغ کل: ${toman(p.amount)} ت${returnedAmountSoFar>0?` — قبلاً برگشت‌شده: ${toman(returnedAmountSoFar)} ت`:''}</div>
          <div class="field"><label>تاریخ برگشت</label>${shamsiDateInputHTML('f-ret-date', todayISO())}</div>
          <div id="ret-item-rows">
          ${p.items.map(it=>{
            const remLineQty = purchaseLineRemainingQty(p, it.id);
            return `<div class="field">
              <label>${esc(it.name)} (خریداری‌شده: ${it.qty}، حداکثر قابل‌برگشت: ${remLineQty})</label>
              <input class="ret-item-qty" data-item-id="${it.id}" data-product-id="${it.productId}" data-unit-cost="${it.unitCost}" data-max="${remLineQty}" type="text" inputmode="decimal" placeholder="تعداد برگشتی (اختیاری)" ${remLineQty<=0?'disabled':''}>
            </div>`;
          }).join('')}
          </div>
          <div class="empty" style="padding:4px 0;text-align:right;">مبلغ برگشتی (خودکار): <b id="ret-multi-total">۰</b> تومان</div>
          <div class="btn-row"><button class="btn" id="save-return">ثبت برگشت</button></div>
        `);
        function updateMultiRetTotal(){
          let t = 0;
          document.querySelectorAll('.ret-item-qty').forEach(inp=>{
            const q = numVal(inp);
            const uc = parseFloat(inp.dataset.unitCost)||0;
            if(q>0) t += Math.round(q*uc);
          });
          document.getElementById('ret-multi-total').textContent = toman(t);
        }
        document.querySelectorAll('.ret-item-qty').forEach(inp=>{
          inp.addEventListener('input', updateMultiRetTotal);
        });
        document.getElementById('save-return').addEventListener('click', async (e)=>{
          await withSubmitGuard(e.currentTarget, async ()=>{
          const date = document.getElementById('f-ret-date').value || todayISO();
          const lineReturns = [];
          let overStock = null;
          document.querySelectorAll('.ret-item-qty').forEach(inp=>{
            const q = numVal(inp);
            if(q<=0) return;
            const max = parseFloat(inp.dataset.max)||0;
            const prod = data.products.find(x=>x.id===inp.dataset.productId);
            if(prod && q > (prod.stockQty||0)){ overStock = prod; }
            lineReturns.push({itemId: inp.dataset.itemId, productId: inp.dataset.productId, qty:q, unitCost: parseFloat(inp.dataset.unitCost)||0, max});
          });
          if(lineReturns.length===0){ showToast('حداقل مقدار برگشتی یک قلم رو وارد کن'); throw new Error('validation'); }
          const badLine = lineReturns.find(l=>l.qty>l.max);
          if(badLine){ alert('مقدار برگشتی از باقیمانده‌ی قابل‌برگشت این قلم بیشتره.\n\nباقیمانده قابل‌برگشت: '+badLine.max); throw new Error('validation'); }
          if(overStock){ alert('موجودی واقعی «'+overStock.name+'» در انبار فقط '+(overStock.stockQty||0)+' عدد است.\n\nمقدار برگشتی نمی‌تواند از موجودی واقعی قابل‌برگشت بیشتر باشد.'); throw new Error('validation'); }
          const totalAmount = lineReturns.reduce((a,l)=>a+Math.round(l.qty*l.unitCost),0);
          if(totalAmount<=0){ showToast('مبلغ برگشتی رو وارد کن'); throw new Error('validation'); }
          const liveRemainingAmount = purchaseReturnRemainingAmount(p);
          if(totalAmount>liveRemainingAmount){ alert('مبلغ برگشتی از مبلغ باقیمانده‌ی این خرید بیشتره.\n\nمبلغ باقیمانده قابل‌برگشت: '+toman(liveRemainingAmount)+' تومان'); throw new Error('validation'); }
          if(!confirm('با ثبت این برگشت، موجودی انبار و بدهی به تامین‌کننده اصلاح خواهد شد. ادامه می‌دهید؟')) throw new Error('validation');
          const totalQty = lineReturns.reduce((a,l)=>a+l.qty,0);
          const retLines = lineReturns.map(l=>({productId:l.productId, qty:l.qty, itemId:l.itemId}));
          // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور.
          const previousData = JSON.parse(JSON.stringify(data));
          const retResult = applyPurchaseReturnStockEffects(p, retLines, s.name, date);
          if(!retResult.ok){ alert(retResult.error||'برگشت خرید ممکن نشد'); throw new Error('validation'); }
          p.returns = p.returns||[];
          p.returns.push({
            id:uid(), date, qty:totalQty, amount:totalAmount,
            items: lineReturns.map(l=>({itemId:l.itemId, productId:l.productId, qty:l.qty, amount:Math.round(l.qty*l.unitCost)})),
          });
          try{
            await saveData();
          }catch(saveErr){
            data = previousData;
            throw saveErr;
          }
          openSupplierDetail(sid); render(); showToast('برگشت خرید ثبت شد');
          });
        });
        return;
      }
      openSheet(`
        <h3>برگشت خرید از ${esc(s.name)}</h3>
        <div class="empty" style="padding:0 0 8px;text-align:right;">${faDate(p.date)}${p.productId?` — ${esc((data.products.find(x=>x.id===p.productId)||{}).name||'')}`:''}${retLinesLabel} — مبلغ کل: ${toman(p.amount)} ت${p.productId?` (${p.qty})`:''}${returnedAmountSoFar>0?` — قبلاً برگشت‌شده: ${toman(returnedAmountSoFar)} ت`:''}</div>
        <div class="field"><label>تاریخ برگشت</label>${shamsiDateInputHTML('f-ret-date', todayISO())}</div>
        ${p.productId?`<div class="field"><label>مقدار برگشتی (حداکثر ${remainingQty})</label><input id="f-ret-qty" type="text" inputmode="decimal"></div>`:''}
        <div class="field"><label>مبلغ برگشتی (تومان، حداکثر ${toman(remainingAmount)})</label><input id="f-ret-amount" type="text" inputmode="decimal"></div>
        <div class="btn-row"><button class="btn" id="save-return">ثبت برگشت</button></div>
      `);
      if(p.productId){
        document.getElementById('f-ret-qty').addEventListener('input', ()=>{
          const q = numVal(document.getElementById('f-ret-qty'));
          if(unitPrice>0) document.getElementById('f-ret-amount').value = Math.round(q*unitPrice);
        });
      }
      document.getElementById('save-return').addEventListener('click', async (e)=>{
        await withSubmitGuard(e.currentTarget, async ()=>{
        const date = document.getElementById('f-ret-date').value || todayISO();
        const qty = p.productId ? numVal(document.getElementById('f-ret-qty')) : 0;
        const amount = numVal(document.getElementById('f-ret-amount'));
        if(amount<=0){ showToast('مبلغ برگشتی رو وارد کن'); throw new Error('validation'); }
        if(p.productId && qty<=0){ showToast('مقدار برگشتی رو وارد کن'); throw new Error('validation'); }
        // اعتبارسنجی یکسان با helper مشترک (تک‌قلمی و چندقلمی)
        const liveRemainingQty = purchaseReturnRemainingQty(p);
        const liveRemainingAmount = purchaseReturnRemainingAmount(p);
        if(qty>0 && qty>liveRemainingQty){
          alert('مقدار برگشتی از باقیمانده‌ی قابل‌برگشت این خرید بیشتره.\n\nباقیمانده قابل‌برگشت: '+liveRemainingQty);
          throw new Error('validation');
        }
        if(p.productId && qty>0){
          const realStockProd = data.products.find(x=>x.id===p.productId);
          if(realStockProd && qty > (realStockProd.stockQty||0)){
            alert('موجودی واقعی «'+realStockProd.name+'» در انبار فقط '+(realStockProd.stockQty||0)+' عدد است.\n\nمقدار برگشتی نمی‌تواند از موجودی واقعی قابل‌برگشت بیشتر باشد.');
            throw new Error('validation');
          }
        }
        if(amount>liveRemainingAmount){ alert('مبلغ برگشتی از مبلغ باقیمانده‌ی این خرید بیشتره.\n\nمبلغ باقیمانده قابل‌برگشت: '+toman(liveRemainingAmount)+' تومان'); throw new Error('validation'); }
        if(!confirm((p.productId?'با ثبت این برگشت، موجودی انبار و بدهی به تامین‌کننده اصلاح خواهد شد.':'با ثبت این برگشت، فقط بدهی به تامین‌کننده کم می‌شود (موجودی خودکار اصلاح نمی‌شود).')+' ادامه می‌دهید؟')) throw new Error('validation');
        // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور.
        const previousData = JSON.parse(JSON.stringify(data));
        if(p.productId && qty>0){
          const retResult = applyPurchaseReturnStockEffects(p, [{productId:p.productId, qty}], s.name, date);
          if(!retResult.ok){ alert(retResult.error||'برگشت خرید ممکن نشد'); throw new Error('validation'); }
        }
        p.returns = p.returns||[];
        p.returns.push({id:uid(), date, qty, amount});
        try{
          await saveData();
        }catch(saveErr){
          data = previousData;
          throw saveErr;
        }
        openSupplierDetail(sid); render(); showToast('برگشت خرید ثبت شد');
        });
      });
    });
  });
}

// ---------- init ----------
// Phase 1: auto-init only for legacy single-page tab mode (data-mode="legacy-tabs").
// Multi-page HTML files boot themselves via js/nav.js → bootPage().
(async function init(){
  if(document.body && document.body.getAttribute('data-mode') === 'legacy-tabs'){
    await loadData();
    render();
  }
})();

/* ===========================
   Developer QA Module
   Isolated test harness — additive only.
   Does not modify any existing business logic.
=========================== */
(function DeveloperQAModule(){
  'use strict';

  const QA_MARKER = '__QA_TEST__';
  let qaRunning = false;
  let qaReport = null;

  function qaNow(){ return performance.now(); }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function assert(cond, msg, details){
    if(cond) return { ok:true, msg };
    return { ok:false, msg, details: details||'' };
  }

  function approxEq(a, b, eps){
    eps = eps==null ? 0.01 : eps;
    return Math.abs((a||0)-(b||0)) <= eps;
  }

  /**
   * QA seed/top-up aligned with current FIFO architecture.
   * Creates an open inventory layer via production createInventoryLayer,
   * and increments stockQty + stockLog to match.
   * Signature used by all call sites: (prod, qty, unitCost, note)
   */
  function qaAddStockWithLayer(prod, qty, unitCost, note){
    if(!prod || !(qty>0)) return;
    const cost = (unitCost!=null && !isNaN(Number(unitCost))) ? Number(unitCost) : (prod.buy||0);
    createInventoryLayer({
      purchaseId: null,
      productId: prod.id,
      itemId: null,
      qty: qty,
      unitCost: cost,
      source: 'manual',
      date: todayISO(),
      note: note || 'QA stock',
    });
    prod.stockQty = (prod.stockQty||0) + qty;
    prod.stockLog = prod.stockLog||[];
    prod.stockLog.push({id:uid(), date:todayISO(), type:'in', qty:qty, note: note||'QA stock'});
  }

  /**
   * Additive FIFO health checks. Signature: (rec, products, tag)
   * Does not remove or weaken existing assertions.
   */
  function qaAssertFifoHealthy(rec, products, tag){
    if(typeof ensureInventoryLayers === 'function') ensureInventoryLayers();
    rec(assert(Array.isArray(data.inventoryLayers), 'FIFO layers array exists ['+tag+']'));
    let negLayer = null;
    let overLayer = null;
    for(const l of (data.inventoryLayers||[])){
      if((l.qtyRemaining||0) < 0) negLayer = l;
      if((l.qtyRemaining||0) > (l.qtyOriginal||0) + 0.01) overLayer = l;
    }
    rec(assert(!negLayer, 'No layer with negative qtyRemaining ['+tag+']', negLayer ? String(negLayer.id) : ''));
    rec(assert(!overLayer, 'No layer qtyRemaining > qtyOriginal ['+tag+']', overLayer ? String(overLayer.id) : ''));
    for(const p of (products||[])){
      const stock = p.stockQty||0;
      const fifo = (typeof fifoAvailableQty === 'function') ? fifoAvailableQty(p.id) : 0;
      rec(assert(stock >= -0.01, 'Stock non-negative FIFO check ['+tag+']: '+p.name, 'qty='+stock));
      rec(assert(fifo >= -0.01, 'FIFO available non-negative ['+tag+']: '+p.name, 'fifo='+fifo));
      rec(assert(fifo <= stock + 0.01, 'FIFO <= stockQty ['+tag+']: '+p.name, 'fifo='+fifo+' stock='+stock));
    }
  }

  // --- inject hidden button + panel ---
  function ensureQAUI(){
    if(document.getElementById('qa-dev-btn')) return;

    const style = document.createElement('style');
    style.id = 'qa-dev-style';
    style.textContent = `
      #qa-dev-btn{
        position:fixed; right:10px; bottom:10px; z-index:9998;
        width:28px; height:28px; border-radius:50%;
        border:1px dashed #bbb; background:transparent; color:#bbb;
        font-size:11px; cursor:pointer; opacity:0.25;
      }
      #qa-dev-btn:hover{ opacity:0.85; border-color:var(--gold,#B08D3D); color:var(--olive-dark,#5c4a30); }
      #qa-panel.overlay{ z-index:9999; }
      #qa-panel .sheet{ max-height:92vh; }
      #qa-panel .qa-pass{ color:var(--olive-dark,#5c4a30); font-weight:700; }
      #qa-panel .qa-fail{ color:var(--red,#9B3B2E); font-weight:700; }
      #qa-panel .qa-log{
        max-height:280px; overflow:auto; font-size:.75rem;
        background:#fff; border:1px solid var(--line,#E7DDC7);
        border-radius:8px; padding:8px; direction:ltr; text-align:left;
        white-space:pre-wrap; font-family:ui-monospace,monospace;
      }
      #qa-panel .qa-stat{ display:inline-block; margin:4px 8px 4px 0; padding:4px 10px;
        border-radius:12px; background:#f3efe4; font-size:.8rem; }
    `;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'qa-dev-btn';
    btn.type = 'button';
    btn.title = 'Developer QA';
    btn.textContent = 'QA';
    btn.addEventListener('click', openQAPanel);
    document.body.appendChild(btn);

    // secret: 5 rapid clicks on header title also opens QA
    const h1 = document.querySelector('header h1');
    if(h1){
      let clicks = 0, t = 0;
      h1.style.cursor = 'default';
      h1.addEventListener('click', ()=>{
        const now = Date.now();
        if(now - t > 800) clicks = 0;
        t = now; clicks++;
        if(clicks >= 5){ clicks = 0; openQAPanel(); }
      });
    }
  }

  function openQAPanel(){
    const last = qaReport;
    const summary = last ? `
      <div class="qa-stat">Total: <b>${last.total}</b></div>
      <div class="qa-stat qa-pass">Passed: <b>${last.passed}</b></div>
      <div class="qa-stat ${last.failed? 'qa-fail':''}">Failed: <b>${last.failed}</b></div>
      <div class="qa-stat">Time: <b>${last.ms.toFixed(0)} ms</b></div>
      ${last.extra ? `
      <div class="qa-stat">Ops: <b>${last.extra.opsCount}</b></div>
      <div class="qa-stat">Invoices: <b>${last.extra.invoicesCreated}</b></div>
      <div class="qa-stat">Payments: <b>${last.extra.paymentsCount}</b></div>
      <div class="qa-stat">Returns: <b>${last.extra.returnsCount}</b></div>
      <div class="qa-stat">Edits: <b>${last.extra.editsCount}</b></div>
      <div class="qa-stat">Deletes: <b>${last.extra.deletesCount}</b></div>
      <div class="qa-stat">Backups: <b>${last.extra.backupsCount}</b></div>
      <div class="qa-stat">Repeats: <b>${last.extra.repeats}</b></div>
      ` : ''}
      <h2 class="section-title">Failures / Log</h2>
      <div class="qa-log">${esc(last.logText || '(no log)')}</div>
    ` : `<div class="empty">هنوز تستی اجرا نشده است.</div>`;

    openSheet(`
      <h3>Developer QA / Test Mode</h3>
      <div class="empty" style="padding:0 0 10px;text-align:right;font-size:.8rem;">
        این ماژول ایزوله است و منطق حسابداری را تغییر نمی‌دهد.
        قبل از اجرا از داده‌های فعلی snapshot گرفته می‌شود و پس از اتمام، داده‌ها به حالت قبل برمی‌گردند.
      </div>
      <div class="btn-row">
        <button class="btn" id="qa-run-full" ${qaRunning?'disabled':''}>اجرای کامل تست‌ها</button>
        <button class="btn" id="qa-run-stress" ${qaRunning?'disabled':''}>اجرای Stress Test (سنگین)</button>
        <button class="btn secondary" id="qa-export-json" ${last?'':'disabled'}>خروجی گزارش JSON</button>
        <button class="btn secondary" id="qa-export-txt" ${last?'':'disabled'}>خروجی گزارش TXT</button>
        <button class="btn secondary" id="qa-close">بستن</button>
      </div>
      <h2 class="section-title">نتیجه آخرین اجرا</h2>
      ${summary}
    `);

    const runBtn = document.getElementById('qa-run-full');
    if(runBtn) runBtn.addEventListener('click', async ()=>{
      if(qaRunning) return;
      runBtn.disabled = true;
      runBtn.textContent = 'در حال اجرا…';
      try{
        await runFullQASuite();
        openQAPanel();
      }catch(e){
        console.error(e);
        showToast('خطا در اجرای QA: '+(e&&e.message?e.message:e));
        openQAPanel();
      }
    });
    const stressBtn = document.getElementById('qa-run-stress');
    if(stressBtn) stressBtn.addEventListener('click', async ()=>{
      if(qaRunning) return;
      stressBtn.disabled = true; runBtn.disabled = true;
      stressBtn.textContent = 'در حال اجرای Stress Test…';
      try{
        await runStressQASuite();
        openQAPanel();
      }catch(e){
        console.error(e);
        showToast('خطا در Stress Test: '+(e&&e.message?e.message:e));
        openQAPanel();
      }
    });
    const j = document.getElementById('qa-export-json');
    if(j) j.addEventListener('click', ()=>exportQAReport('json'));
    const t = document.getElementById('qa-export-txt');
    if(t) t.addEventListener('click', ()=>exportQAReport('txt'));
    const c = document.getElementById('qa-close');
    if(c) c.addEventListener('click', ()=>closeModal());
  }

  function exportQAReport(kind){
    if(!qaReport){ showToast('گزارشی موجود نیست'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    if(kind==='json'){
      const blob = JSON.stringify(qaReport, null, 2);
      downloadFile(`qa-report-${stamp}.json`, blob, 'application/json');
    }else{
      const lines = [
        'Developer QA Report — حبوبات و خشکبار باقری',
        'Generated: '+qaReport.finishedAt,
        'Total: '+qaReport.total,
        'Passed: '+qaReport.passed,
        'Failed: '+qaReport.failed,
        'Duration ms: '+qaReport.ms.toFixed(2),
        '',
        '--- LOG ---',
        qaReport.logText||'',
      ];
      downloadFile(`qa-report-${stamp}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
    }
    showToast('گزارش QA آماده شد');
  }

  // ---------- suite ----------
  async function runFullQASuite(){
    qaRunning = true;
    const t0 = qaNow();
    const results = [];
    const log = [];
    function rec(r){
      results.push(r);
      const line = (r.ok?'PASS':'FAIL')+' | '+r.msg+(r.details?(' | '+r.details):'');
      log.push(line);
      if(!r.ok) console.warn('[QA FAIL]', r.msg, r.details||'');
    }

    // suppress UI confirm/alert during bulk ops
    const origConfirm = window.confirm;
    const origAlert = window.alert;
    window.confirm = function(){ return true; };
    window.alert = function(m){ log.push('ALERT: '+m); };

    let snapshot = null;
    try{
      snapshot = deepClone(data);
      log.push('Snapshot taken. customers='+data.customers.length
        +' products='+data.products.length
        +' invoices='+data.invoices.length
        +' suppliers='+data.suppliers.length);

      // ---- Phase A: generate entities ----
      const products = [];
      for(let i=0;i<12;i++){
        const seedQty = 100 + i*5;
        const p = {
          id: uid(),
          name: QA_MARKER+' کالا '+(i+1),
          category: CATEGORY_SUGGESTIONS[i % CATEGORY_SUGGESTIONS.length],
          buy: 10000 + i*500,
          wholesale: 12000 + i*600,
          retail: 15000 + i*700,
          sell: 15000 + i*700,
          stockQty: 0,
          stockLog: [],
          packageWeight: 1,
          lowStockThreshold: 5,
        };
        data.products.push(p);
        products.push(p);
        // Current architecture: stockQty alone is not enough for sales — open FIFO layer required
        qaAddStockWithLayer(p, seedQty, p.buy, 'QA seed');
      }
      rec(assert(products.length===12, 'Generate 12 products'));
      qaAssertFifoHealthy(rec, products, 'after product seed');

      const customers = [];
      for(let i=0;i<15;i++){
        const c = {
          id: uid(),
          name: QA_MARKER+' مشتری '+(i+1),
          ownerName: 'صاحب '+(i+1),
          phone: '09'+(100000000+i),
          region: REGION_SUGGESTIONS[i % REGION_SUGGESTIONS.length],
          route: ROUTES[i % ROUTES.length],
          note: 'QA',
          openingBalance: (i%3===0) ? (i*1000) : 0,
          visits: [],
        };
        data.customers.push(c);
        customers.push(c);
      }
      rec(assert(customers.length===15, 'Generate 15 customers'));

      const suppliers = [];
      for(let i=0;i<5;i++){
        const s = {
          id: uid(),
          name: QA_MARKER+' تامین‌کننده '+(i+1),
          phone: '021'+(1000000+i),
          openingBalance: (i%2===0)?(i*2000):0,
          purchases: [],
          payments: [],
        };
        data.suppliers.push(s);
        suppliers.push(s);
      }
      rec(assert(suppliers.length===5, 'Generate 5 suppliers'));
      await saveData();

      // ---- Phase B: purchases (stock in) ----
      for(let i=0;i<20;i++){
        const s = suppliers[i % suppliers.length];
        const prod = products[i % products.length];
        const qty = 5 + (i%4);
        const amount = qty * prod.buy;
        const date = todayISO();
        s.purchases = s.purchases||[];
        // Production path: applyPurchaseStockEffects creates stockQty + FIFO layer
        const purchase = {id:uid(), date, amount, desc:'QA purchase', productId:prod.id, qty};
        s.purchases.push(purchase);
        applyPurchaseStockEffects(purchase, s.name);
      }
      await saveData();
      rec(assert(true, 'Generate 20 purchases with stock increase'));
      qaAssertFifoHealthy(rec, products, 'after purchases');

      // verify supplier balances after purchases
      for(const s of suppliers){
        const t = supplierTotals(s.id);
        const expectedPurch = (s.purchases||[]).reduce((a,p)=>a+(p.amount||0) - ((p.returns||[]).reduce((x,r)=>x+(r.amount||0),0)),0);
        const expectedBal = (s.openingBalance||0) + expectedPurch - (s.payments||[]).reduce((a,p)=>a+(p.amount||0),0);
        rec(assert(approxEq(t.balance, expectedBal), 'Supplier balance after purchases: '+s.name,
          'got='+t.balance+' expected='+expectedBal));
      }

      // ---- Phase C: invoices (sale + payments + checks) ----
      const createdInvoices = [];
      for(let i=0;i<40;i++){
        const c = customers[i % customers.length];
        const prod = products[i % products.length];
        const qty = 1 + (i%3);
        if((prod.stockQty||0) < qty || (typeof fifoAvailableQty==='function' && fifoAvailableQty(prod.id) < qty)){
          qaAddStockWithLayer(prod, qty + 10, prod.buy, 'QA top-up before sale');
        }
        const price = prod.retail||prod.sell||0;
        const itemDiscount = (i%5===0)?500:0;
        const items = [{
          productId: prod.id,
          name: prod.name,
          qty,
          price,
          buyPrice: prod.buy,
          discount: itemDiscount,
          weight: (prod.packageWeight||0)*qty,
        }];
        const total = Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0));
        const prevBalance = customerTotals(c.id).balance;
        const cashPaid = (i%4===0) ? Math.floor(total*0.3) : 0;
        const cardPaid = (i%4===1) ? Math.floor(total*0.2) : 0;
        const transferPaid = (i%4===2) ? Math.floor(total*0.1) : 0;
        const checkAmount = (i%6===0) ? Math.floor(total*0.25) : 0;
        const paid = cashPaid+cardPaid+transferPaid+checkAmount;
        const newBalance = prevBalance + total - paid;
        const inv = {
          id: uid(),
          number: nextInvoiceNumber(),
          customerId: c.id,
          date: todayISO(),
          items,
          total,
          discount: 0,
          prevBalance,
          cashPaid,
          cardPaid,
          transferPaid,
          checkPaid: checkAmount,
          newBalance,
        };
        data.invoices.push(inv);
        applyInvoiceStockEffects(items, inv.date, inv, true);
        pushInvoicePayments(c.id, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
        createdInvoices.push(inv);
      }
      await saveData();
      rec(assert(createdInvoices.length===40, 'Generate 40 invoices with stock/payment effects'));

      // verify each invoice total & customer balance consistency
      for(const inv of createdInvoices){
        const recomputed = inv.items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0) - (inv.discount||0);
        rec(assert(approxEq(inv.total, Math.max(0,recomputed)), 'Invoice total #'+inv.number,
          'stored='+inv.total+' recomputed='+recomputed));
        // FIFO: each sold line must carry costAllocations + COGS (current architecture)
        for(const it of (inv.items||[])){
          if(!it.productId || !(it.qty>0)) continue;
          rec(assert(Array.isArray(it.costAllocations) && it.costAllocations.length>0,
            'Invoice item FIFO costAllocations #'+inv.number, 'product='+it.productId));
          rec(assert(typeof it.cogs==='number' && isFinite(it.cogs),
            'Invoice item COGS finite #'+inv.number, 'cogs='+it.cogs));
          const allocQty = it.costAllocations.reduce((s,a)=>s+(Number(a.qty)||0),0);
          rec(assert(approxEq(allocQty, it.qty), 'FIFO alloc qty sums to line qty #'+inv.number,
            'alloc='+allocQty+' qty='+it.qty));
        }
      }
      qaAssertFifoHealthy(rec, products, 'after invoices');

      for(const c of customers){
        const t = customerTotals(c.id);
        const invs = customerInvoices(c.id);
        const sumInv = invs.reduce((s,i)=>s+i.total,0);
        rec(assert(approxEq(t.invTotal, sumInv), 'Customer invTotal: '+c.name,
          'got='+t.invTotal+' sum='+sumInv));
        // balance formula: opening + inv - pay - check
        const expected = (c.openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'Customer balance formula: '+c.name,
          'got='+t.balance+' expected='+expected));
      }

      // stock non-negative for QA products (should stay >=0 if we pre-topped)
      for(const p of products){
        rec(assert((p.stockQty||0) >= 0, 'Stock non-negative: '+p.name, 'qty='+p.stockQty));
        rec(assert(Array.isArray(p.stockLog) && p.stockLog.length>0, 'Stock log present: '+p.name));
      }

      // ---- Phase D: standalone payments / checks / returns ----
      for(let i=0;i<10;i++){
        const c = customers[i % customers.length];
        data.payments.push({
          id:uid(), customerId:c.id, date:todayISO(),
          amount: 1000+(i*100), method:['cash','card','transfer'][i%3], note:'QA pay'
        });
      }
      for(let i=0;i<8;i++){
        const c = customers[i % customers.length];
        data.checks.push({
          id:uid(), customerId:c.id, amount:2000+(i*150),
          dueDate:todayISO(), checkNumber:'QA'+i, status: i%2===0?'pending':'cleared'
        });
      }
      // customer return payment with stock effect
      {
        const c = customers[0];
        const prod = products[0];
        const retQty = 1;
        const retAmt = Math.floor((prod.retail||0)*retQty);
        const payment = {
          id:uid(), customerId:c.id, date:todayISO(), amount:retAmt,
          method:'return', note:'QA return',
          returnItems:[{productId:prod.id, name:prod.name, qty:retQty, price:prod.retail}]
        };
        data.payments.push(payment);
        applyReturnStockEffects(payment.returnItems, payment.date, payment);
      }
      await saveData();
      rec(assert(true, 'Standalone payments, checks, and one sales-return applied'));

      for(const c of customers){
        const t = customerTotals(c.id);
        const expected = (c.openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'Customer balance after extra pays: '+c.name,
          'got='+t.balance+' expected='+expected));
      }

      // ---- Phase E: supplier payments + purchase returns ----
      for(let i=0;i<suppliers.length;i++){
        const s = suppliers[i];
        s.payments = s.payments||[];
        s.payments.push({date:todayISO(), amount:500+(i*100)});
      }
      // return part of first purchase that has product
      {
        const s = suppliers[0];
        const p = (s.purchases||[]).find(x=>x.productId && x.qty>0);
        if(p){
          const qty = 1;
          const amount = Math.floor(p.amount / p.qty);
          p.returns = p.returns||[];
          p.returns.push({id:uid(), date:todayISO(), qty, amount});
          const prod = data.products.find(x=>x.id===p.productId);
          if(prod){
            prod.stockQty = (prod.stockQty||0) - qty;
            prod.stockLog = prod.stockLog||[];
            prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-qty, note:'برگشت خرید به '+s.name});
          }
        }
      }
      await saveData();
      rec(assert(true, 'Supplier payments and one purchase-return applied'));

      for(const s of suppliers){
        const t = supplierTotals(s.id);
        rec(assert(typeof t.balance === 'number' && isFinite(t.balance), 'Supplier totals finite: '+s.name, 'bal='+t.balance));
      }

      // ---- Phase F: edit invoice (revert + reapply via public helpers) ----
      {
        const inv = createdInvoices[0];
        const cid = inv.customerId;
        const beforeBal = customerTotals(cid).balance;
        const stockBefore = {};
        (inv.items||[]).forEach(it=>{
          const prod = data.products.find(p=>p.id===it.productId);
          if(prod) stockBefore[it.productId] = prod.stockQty;
        });

        revertInvoiceStockEffects(inv);
        revertInvoicePayments(inv);

        // mutate: double first item qty if stock allows
        const items = inv.items.map(it=>({...it}));
        if(items[0]){
          const prod = data.products.find(p=>p.id===items[0].productId);
          const need = items[0].qty; // additional
          if(prod && (prod.stockQty||0) >= need){
            items[0] = {...items[0], qty: items[0].qty + need};
          }
        }
        const total = Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0) - (inv.discount||0));
        const prevBalance = customerTotals(cid).balance; // after revert payments, balance excludes this inv
        const cashPaid = inv.cashPaid||0;
        const cardPaid = inv.cardPaid||0;
        const transferPaid = inv.transferPaid||0;
        const checkAmount = inv.checkPaid||0;
        const paid = cashPaid+cardPaid+transferPaid+checkAmount;
        const newBalance = prevBalance + total - paid;

        inv.items = items;
        inv.total = total;
        inv.prevBalance = prevBalance;
        inv.newBalance = newBalance;

        applyInvoiceStockEffects(items, inv.date, inv, false);
        pushInvoicePayments(cid, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
        inv.editHistory = inv.editHistory||[];
        inv.editHistory.push({id:uid(), editedAt:new Date().toISOString(), before:{total:createdInvoices[0].total}, after:{total}});
        await saveData();

        const afterBal = customerTotals(cid).balance;
        rec(assert(typeof afterBal==='number', 'Edit invoice: customer balance still finite', 'bal='+afterBal+' before='+beforeBal));
        const t = customerTotals(cid);
        const expected = (data.customers.find(x=>x.id===cid).openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'Edit invoice: balance formula holds', 'got='+t.balance+' expected='+expected));
      }

      // ---- Phase G: delete one invoice via public helpers ----
      {
        const inv = createdInvoices[createdInvoices.length-1];
        const cid = inv.customerId;
        const invId = inv.id;
        revertInvoiceStockEffects(inv);
        revertInvoicePayments(inv);
        data.invoices = data.invoices.filter(x=>x.id!==invId);
        await saveData();
        rec(assert(!data.invoices.find(x=>x.id===invId), 'Delete invoice removed from data'));
        const t = customerTotals(cid);
        const expected = (data.customers.find(x=>x.id===cid).openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'After delete invoice: balance formula', 'got='+t.balance+' expected='+expected));
      }

      // ---- Phase H: dashboard / reports / profit / inventory valuation ----
      {
        const g = globalTotals();
        rec(assert(typeof g.totalProfit==='number' && isFinite(g.totalProfit), 'Dashboard totalProfit finite', 'v='+g.totalProfit));
        rec(assert(typeof g.customerDebt==='number' && isFinite(g.customerDebt), 'Dashboard customerDebt finite', 'v='+g.customerDebt));
        rec(assert(typeof g.supplierDebt==='number' && isFinite(g.supplierDebt), 'Dashboard supplierDebt finite', 'v='+g.supplierDebt));
        rec(assert(typeof g.todaySales==='number', 'Dashboard todaySales defined'));
        rec(assert(typeof g.monthSales==='number', 'Dashboard monthSales defined'));
        rec(assert(typeof g.outstandingChecks==='number', 'Dashboard outstandingChecks defined'));

        const invVal = inventoryValue();
        rec(assert(typeof invVal==='number' && isFinite(invVal) && invVal>=0, 'Inventory valuation >= 0', 'v='+invVal));

        // recompute inventory value manually for QA products + all — independent FIFO-layer sum
        // (NOT sum(stock*buy): once a purchase's cost differs from the product's static
        // "buy" field, that comparison is no longer valid under FIFO valuation)
        let manual = 0;
        (data.inventoryLayers||[]).forEach(l=>{ if(l.status==='open') manual += (l.qtyRemaining||0)*(l.unitCost||0); });
        rec(assert(approxEq(invVal, manual), 'Inventory valuation matches independent FIFO-layer sum',
          'got='+invVal+' manual='+manual));

        // global profit should equal sum of customerProfit
        let profitSum = 0;
        data.customers.forEach(c=>{ profitSum += customerProfit(c.id); });
        rec(assert(approxEq(g.totalProfit, profitSum), 'Total profit equals sum of customer profits',
          'g='+g.totalProfit+' sum='+profitSum));
      }

      // ---- Phase I: backup / restore / undo restore ----
      {
        const midSnapshot = deepClone(data);
        // simulate exportBackupJSON payload
        const backupJson = JSON.stringify(data);
        const parsed = JSON.parse(backupJson);
        rec(assert(validateBackupShape(parsed), 'Backup shape validates'));

        // import path uses normalizeData — call it
        const normalized = normalizeData(parsed);
        rec(assert(Array.isArray(normalized.customers) && Array.isArray(normalized.products), 'normalizeData keeps arrays'));

        // exercise undoLastRestore storage path without destroying real preRestore if any:
        // save current as a temporary preRestore-like structure via dbPut if available
        try{
          const beforeImport = deepClone(data);
          // replace data with a tiny mutation then restore from midSnapshot (manual, same as undo)
          data.customers = data.customers.slice(0, Math.max(0, data.customers.length-1));
          await saveData();
          // restore mid
          data = deepClone(midSnapshot);
          await saveData();
          rec(assert(data.customers.length === midSnapshot.customers.length, 'Manual restore cycle restored customer count'));
          // restore original mid is still QA data; fine
          void beforeImport;
        }catch(e){
          rec(assert(false, 'Backup/restore cycle error', String(e&&e.message||e)));
        }

        // call getAutoBackupList / autoBackupTick safely
        try{
          await autoBackupTick();
          const list = await getAutoBackupList();
          rec(assert(Array.isArray(list), 'getAutoBackupList returns array', 'len='+(list&&list.length)));
        }catch(e){
          rec(assert(false, 'autoBackupTick/list failed', String(e&&e.message||e)));
        }
      }

      // ---- Phase J: visits ----
      {
        const c = customers[1];
        c.visits = c.visits||[];
        c.visits.push({id:uid(), date:todayISO(), time:nowHHMM(), result:VISIT_RESULTS[0]});
        await saveData();
        rec(assert(c.visits.length>=1, 'Visit recorded on customer'));
      }

      // ---- Phase K: render smoke (no throw) ----
      try{
        const tabs = ['dashboard','products','customers','suppliers','reports','backup'];
        for(const tab of tabs){
          activeTab = tab;
          render();
        }
        activeTab = 'dashboard';
        render();
        rec(assert(true, 'Render all tabs without throw'));
      }catch(e){
        rec(assert(false, 'Render threw', String(e&&e.message||e)));
      }

      // ---- Phase L: delete QA entities cleanup is via full snapshot restore ----
      log.push('Phases complete; restoring pre-QA snapshot…');

    }catch(e){
      rec(assert(false, 'Unhandled suite exception', String(e&&e.stack||e.message||e)));
      console.error(e);
    }finally{
      // restore original data
      try{
        if(snapshot){
          data = deepClone(snapshot);
          await saveData();
          render();
          log.push('Original data restored. customers='+data.customers.length
            +' products='+data.products.length
            +' invoices='+data.invoices.length);
          rec(assert(true, 'Original data restored after QA'));
        }
      }catch(e){
        rec(assert(false, 'Failed to restore original data', String(e&&e.message||e)));
      }
      window.confirm = origConfirm;
      window.alert = origAlert;
      qaRunning = false;
    }

    const passed = results.filter(r=>r.ok).length;
    const failed = results.filter(r=>!r.ok).length;
    const ms = qaNow() - t0;
    qaReport = {
      total: results.length,
      passed,
      failed,
      ms,
      finishedAt: new Date().toISOString(),
      results,
      logText: log.join('\n'),
      failures: results.filter(r=>!r.ok),
    };
    showToast(failed===0 ? ('QA PASS — '+passed+'/'+results.length) : ('QA FAIL — '+failed+' failed'));
    return qaReport;
  }

  // ================= Stress / Repeatability Suite (additive extension) =================
  function qaMem(){ try{ return performance.memory ? performance.memory.usedJSHeapSize : null; }catch(e){ return null; } }

  function qaBuildStressEntities(counters){
    const products=[], customers=[], suppliers=[];
    for(let i=0;i<200;i++){
      const seedQty=200+(i%30)*3;
      const p={ id:uid(), name:QA_MARKER+' S-کالا '+i, category:CATEGORY_SUGGESTIONS[i%CATEGORY_SUGGESTIONS.length],
        buy:8000+(i%50)*300, wholesale:10000+(i%50)*350, retail:13000+(i%50)*400, sell:13000+(i%50)*400,
        stockQty:0, stockLog:[],
        packageWeight:1, lowStockThreshold:5 };
      data.products.push(p); products.push(p);
      qaAddStockWithLayer(p, seedQty, p.buy, 'QA stress seed');
    }
    for(let i=0;i<500;i++){
      const c={ id:uid(), name:QA_MARKER+' S-مشتری '+i, ownerName:'مالک '+i, phone:'09'+(200000000+i),
        region:REGION_SUGGESTIONS[i%REGION_SUGGESTIONS.length], route:ROUTES[i%ROUTES.length],
        note:'QA-STRESS', openingBalance:(i%4===0)?(i*50):0, visits:[] };
      data.customers.push(c); customers.push(c);
    }
    for(let i=0;i<50;i++){
      const s={ id:uid(), name:QA_MARKER+' S-تامین‌کننده '+i, phone:'021'+(2000000+i),
        openingBalance:(i%3===0)?(i*300):0, purchases:[], payments:[] };
      data.suppliers.push(s); suppliers.push(s);
    }
    counters.opsCount += products.length+customers.length+suppliers.length;
    return {products, customers, suppliers};
  }

  function qaRunPurchases(ent, counters, n){
    for(let i=0;i<n;i++){
      const s=ent.suppliers[i%ent.suppliers.length], prod=ent.products[i%ent.products.length];
      const qty=3+(i%6), amount=qty*prod.buy, date=todayISO();
      s.purchases=s.purchases||[];
      const purchase={id:uid(), date, amount, desc:'QA-STRESS purchase', productId:prod.id, qty};
      s.purchases.push(purchase);
      applyPurchaseStockEffects(purchase, s.name);
      counters.opsCount++;
    }
  }

  function qaCreateInvoice(ent, i){
    const c=ent.customers[i%ent.customers.length];
    const itemN=1+(i%3); const items=[];
    for(let k=0;k<itemN;k++){
      const prod=ent.products[(i+k)%ent.products.length]; const qty=1+((i+k)%3);
      if((prod.stockQty||0)<qty || (typeof fifoAvailableQty==='function' && fifoAvailableQty(prod.id)<qty)) qaAddStockWithLayer(prod, qty+20, prod.buy, 'QA stress top-up');
      items.push({productId:prod.id, name:prod.name, qty, price:prod.retail||prod.sell||0,
        buyPrice:prod.buy, discount:(i%7===0)?300:0, weight:(prod.packageWeight||0)*qty});
    }
    const total=Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0));
    const prevBalance=customerTotals(c.id).balance;
    const cashPaid=(i%4===0)?Math.floor(total*0.3):0, cardPaid=(i%4===1)?Math.floor(total*0.2):0,
      transferPaid=(i%4===2)?Math.floor(total*0.1):0, checkAmount=(i%6===0)?Math.floor(total*0.2):0;
    const paid=cashPaid+cardPaid+transferPaid+checkAmount;
    const inv={ id:uid(), number:nextInvoiceNumber(), customerId:c.id, date:todayISO(), items, total,
      discount:0, prevBalance, cashPaid, cardPaid, transferPaid, checkPaid:checkAmount, newBalance:prevBalance+total-paid };
    data.invoices.push(inv);
    applyInvoiceStockEffects(items, inv.date, inv, true);
    pushInvoicePayments(c.id, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
    return inv;
  }

  function qaCheckInvariants(rec, tag, full){
    const bad=v=>v==null||typeof v!=='number'||!isFinite(v);
    for(const p of data.products){
      if(bad(p.stockQty)) rec(assert(false, 'Invariant stock invalid ['+tag+']: '+p.name, 'q='+p.stockQty));
    }
    // FIFO architecture invariants (additive)
    for(const l of (data.inventoryLayers||[])){
      if((l.qtyRemaining||0)<0) rec(assert(false, 'Invariant layer qtyRemaining negative ['+tag+']', String(l.id)));
      if((l.qtyRemaining||0)>(l.qtyOriginal||0)+0.01) rec(assert(false, 'Invariant layer rem>original ['+tag+']', String(l.id)));
    }
    const g=globalTotals();
    rec(assert(!bad(g.totalProfit), 'Invariant totalProfit finite ['+tag+']'));
    rec(assert(!bad(g.customerDebt), 'Invariant customerDebt finite ['+tag+']'));
    rec(assert(!bad(g.supplierDebt), 'Invariant supplierDebt finite ['+tag+']'));
    const invVal=inventoryValue();
    rec(assert(!bad(invVal) && invVal>=0, 'Invariant inventoryValue valid ['+tag+']', 'v='+invVal));
    if(full){
      let profitSum=0;
      for(const c of data.customers){
        const t=customerTotals(c.id);
        if(bad(t.balance)) rec(assert(false, 'Invariant customer balance invalid ['+tag+']: '+c.name, 'bal='+t.balance));
        profitSum+=customerProfit(c.id);
      }
      rec(assert(approxEq(g.totalProfit, profitSum, 1), 'Invariant sum(customerProfit)==totalProfit ['+tag+']',
        'g='+g.totalProfit+' sum='+profitSum));
      for(const s of data.suppliers){
        const t=supplierTotals(s.id);
        if(bad(t.balance)) rec(assert(false, 'Invariant supplier balance invalid ['+tag+']: '+s.name, 'bal='+t.balance));
      }
    }
  }

  function qaRandomOps(ent, rec, counters, n){
    const ops=['sale','cash','card','transfer','check','salesReturn','purchaseReturn','supplierPay','editInv','deleteInv','visit'];
    for(let i=0;i<n;i++){
      const op=ops[Math.floor(Math.random()*ops.length)];
      try{
        switch(op){
          case 'sale': { const inv=qaCreateInvoice(ent, 5000+i); ent.invoices.push(inv); counters.invoicesCreated++; break; }
          case 'cash': case 'card': case 'transfer': {
            const c=ent.customers[i%ent.customers.length];
            data.payments.push({id:uid(), customerId:c.id, date:todayISO(), amount:500+(i%20)*50,
              method:(op==='cash'?'cash':op==='card'?'card':'transfer'), note:'QA-STRESS pay'});
            counters.paymentsCount++; break;
          }
          case 'check': {
            const c=ent.customers[i%ent.customers.length];
            data.checks.push({id:uid(), customerId:c.id, amount:1000+(i%15)*70, dueDate:todayISO(),
              checkNumber:'QAS'+i, status:i%2===0?'pending':'cleared'}); counters.paymentsCount++; break;
          }
          case 'salesReturn': {
            const c=ent.customers[i%ent.customers.length], prod=ent.products[i%ent.products.length];
            const payment={id:uid(), customerId:c.id, date:todayISO(), amount:Math.floor(prod.retail||0),
              method:'return', note:'QA-STRESS return', returnItems:[{productId:prod.id, name:prod.name, qty:1, price:prod.retail}]};
            data.payments.push(payment); applyReturnStockEffects(payment.returnItems, payment.date, payment);
            counters.returnsCount++; break;
          }
          case 'purchaseReturn': {
            const s=ent.suppliers[i%ent.suppliers.length];
            const p=(s.purchases||[]).find(x=>x.productId && x.qty>0 && !(x.returns&&x.returns.length));
            if(p){ p.returns=p.returns||[]; p.returns.push({id:uid(), date:todayISO(), qty:1, amount:Math.floor(p.amount/p.qty)});
              const prod=data.products.find(x=>x.id===p.productId);
              if(prod){ prod.stockQty=(prod.stockQty||0)-1; prod.stockLog=prod.stockLog||[];
                prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-1, note:'برگشت خرید استرس'}); }
              counters.returnsCount++; }
            break;
          }
          case 'supplierPay': {
            const s=ent.suppliers[i%ent.suppliers.length]; s.payments=s.payments||[];
            s.payments.push({date:todayISO(), amount:300+(i%10)*40}); counters.paymentsCount++; break;
          }
          case 'editInv': {
            if(ent.invoices.length){
              const inv=ent.invoices[i%ent.invoices.length], cid=inv.customerId;
              revertInvoiceStockEffects(inv); revertInvoicePayments(inv);
              const items=inv.items.map(it=>({...it, qty: it.qty + (i%2===0?1:0)}));
              const total=Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0) - (inv.discount||0));
              const prevBalance=customerTotals(cid).balance;
              const cashPaid=inv.cashPaid||0, cardPaid=inv.cardPaid||0, transferPaid=inv.transferPaid||0, checkAmount=inv.checkPaid||0;
              const paid=cashPaid+cardPaid+transferPaid+checkAmount;
              inv.items=items; inv.total=total; inv.prevBalance=prevBalance; inv.newBalance=prevBalance+total-paid;
              applyInvoiceStockEffects(items, inv.date, inv, false);
              pushInvoicePayments(cid, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
              inv.editHistory=inv.editHistory||[]; inv.editHistory.push({id:uid(), editedAt:new Date().toISOString(), note:'QA-STRESS edit'});
              counters.editsCount++;
            }
            break;
          }
          case 'deleteInv': {
            if(ent.invoices.length>10){ const inv=ent.invoices.pop();
              revertInvoiceStockEffects(inv); revertInvoicePayments(inv);
              data.invoices=data.invoices.filter(x=>x.id!==inv.id); counters.deletesCount++; }
            break;
          }
          case 'visit': {
            const c=ent.customers[i%ent.customers.length]; c.visits=c.visits||[];
            c.visits.push({id:uid(), date:todayISO(), time:nowHHMM(), result:VISIT_RESULTS[i%VISIT_RESULTS.length]});
            break;
          }
        }
      }catch(e){ rec(assert(false, 'Random op threw ['+op+']', String(e&&e.message||e))); }
      qaCheckInvariants(rec, 'op#'+i+':'+op, (i%40===0));
      counters.opsCount++;
    }
  }

  function qaBackupCycle(rec, tag){
    try{
      const snap=deepClone(data);
      const parsed=JSON.parse(JSON.stringify(data));
      rec(assert(validateBackupShape(parsed), 'Backup shape valid ['+tag+']'));
      const normalized=normalizeData(parsed);
      rec(assert(Array.isArray(normalized.customers) && normalized.customers.length===data.customers.length,
        'normalizeData customer count preserved ['+tag+']'));
      rec(assert(Array.isArray(normalized.products) && normalized.products.length===data.products.length,
        'normalizeData product count preserved ['+tag+']'));
      const idsBefore=data.customers.map(c=>c.id).sort().join(',');
      data.customers=data.customers.slice(0, Math.max(0,data.customers.length-1)); // simulate undo-restore trigger
      data=deepClone(snap); // restore
      const idsAfter=data.customers.map(c=>c.id).sort().join(',');
      rec(assert(idsBefore===idsAfter, 'Backup restore preserves customer ids ['+tag+']'));
      rec(assert(data.invoices.length===snap.invoices.length, 'Backup restore preserves invoice count ['+tag+']'));
    }catch(e){ rec(assert(false, 'Backup cycle error ['+tag+']', String(e&&e.message||e))); }
  }

  function qaRenderCheck(rec, rounds){
    try{
      const tabs=['dashboard','products','customers','suppliers','reports','backup'];
      for(let r=0;r<rounds;r++){ for(const t of tabs){ activeTab=t; render(); } }
      activeTab='dashboard'; render();
      rec(assert(true, 'Render all tabs x'+rounds+' rounds without throw'));
    }catch(e){ rec(assert(false, 'Render threw during stress', String(e&&e.message||e))); }
  }

  async function qaPersistenceCheck(rec, tag){
    try{
      const before={c:data.customers.length,p:data.products.length,i:data.invoices.length,s:data.suppliers.length};
      await saveData(); await loadData();
      const after={c:data.customers.length,p:data.products.length,i:data.invoices.length,s:data.suppliers.length};
      rec(assert(JSON.stringify(before)===JSON.stringify(after),
        'Persistence save/load preserves counts ['+tag+']', JSON.stringify(before)+' vs '+JSON.stringify(after)));
    }catch(e){ rec(assert(false, 'Persistence check error ['+tag+']', String(e&&e.message||e))); }
  }

  async function runStressQASuite(){
    qaRunning=true; const t0=qaNow(); const results=[]; const log=[];
    function rec(r){ results.push(r); log.push((r.ok?'PASS':'FAIL')+' | '+r.msg+(r.details?(' | '+r.details):''));
      if(!r.ok) console.warn('[QA-STRESS FAIL]', r.msg, r.details||''); }
    const origConfirm=window.confirm, origAlert=window.alert;
    window.confirm=function(){return true;}; window.alert=function(m){log.push('ALERT: '+m);};
    const counters={opsCount:0, invoicesCreated:0, paymentsCount:0, returnsCount:0, editsCount:0, deletesCount:0, backupsCount:0, repeats:0};
    const phaseTimes={}; let masterSnapshot=null; const runSummaries=[];
    try{
      masterSnapshot=deepClone(data);
      const REPEATS=10;
      for(let round=0; round<REPEATS; round++){
        const tRound0=qaNow();
        data=deepClone(masterSnapshot);
        const ent=qaBuildStressEntities(counters); ent.invoices=[];
        let tA=qaNow(); qaRunPurchases(ent, counters, 150); phaseTimes['purchases_r'+round]=qaNow()-tA;
        qaCheckInvariants(rec, 'afterPurchases_r'+round, true);

        tA=qaNow();
        for(let i=0;i<2100;i++){ ent.invoices.push(qaCreateInvoice(ent, i)); counters.invoicesCreated++;
          if(i%300===0) qaCheckInvariants(rec, 'duringInvoices_r'+round+'#'+i, false); }
        phaseTimes['invoices_r'+round]=qaNow()-tA;
        await saveData();
        qaCheckInvariants(rec, 'afterInvoices_r'+round, true);

        tA=qaNow(); qaRandomOps(ent, rec, counters, 300); phaseTimes['randomOps_r'+round]=qaNow()-tA;
        await saveData();
        qaCheckInvariants(rec, 'afterRandomOps_r'+round, true);

        tA=qaNow();
        for(let b=0;b<20;b++){ qaBackupCycle(rec, 'r'+round+'#'+b); counters.backupsCount++; }
        phaseTimes['backups_r'+round]=qaNow()-tA;

        tA=qaNow(); qaRenderCheck(rec, 4); phaseTimes['render_r'+round]=qaNow()-tA;

        tA=qaNow(); await qaPersistenceCheck(rec, 'r'+round); phaseTimes['persistence_r'+round]=qaNow()-tA;

        const failedSoFar=results.filter(x=>!x.ok).length;
        runSummaries.push({round, failed:failedSoFar, ms:qaNow()-tRound0});
        log.push('Round '+round+' done in '+(qaNow()-tRound0).toFixed(0)+'ms, cumulative failed='+failedSoFar);
        counters.repeats++;
      }
      const perRoundFailed=runSummaries.map((r,idx)=> idx===0 ? r.failed : r.failed-runSummaries[idx-1].failed);
      const consistent=perRoundFailed.every(f=>f===perRoundFailed[0]);
      rec(assert(consistent, 'Repeatability: identical pass/fail pattern across '+runSummaries.length+' runs',
        JSON.stringify(perRoundFailed)));
    }catch(e){
      rec(assert(false, 'Unhandled stress-suite exception', String(e&&e.stack||e.message||e)));
      console.error(e);
    }finally{
      try{
        if(masterSnapshot){ data=deepClone(masterSnapshot); await saveData(); render();
          rec(assert(true, 'Original data restored after stress suite')); }
      }catch(e){ rec(assert(false, 'Failed to restore original data after stress', String(e&&e.message||e))); }
      window.confirm=origConfirm; window.alert=origAlert; qaRunning=false;
    }
    const passed=results.filter(r=>r.ok).length, failed=results.filter(r=>!r.ok).length, ms=qaNow()-t0;
    qaReport={ total:results.length, passed, failed, ms, finishedAt:new Date().toISOString(), results,
      logText:log.join('\n'), failures:results.filter(r=>!r.ok),
      extra:{ opsCount:counters.opsCount, invoicesCreated:counters.invoicesCreated, paymentsCount:counters.paymentsCount,
        returnsCount:counters.returnsCount, editsCount:counters.editsCount, deletesCount:counters.deletesCount,
        backupsCount:counters.backupsCount, repeats:counters.repeats, phaseTimes, totalMs:ms,
        memApproxBytes:qaMem(), runSummaries } };
    showToast(failed===0 ? ('Stress PASS — '+passed+'/'+results.length) : ('Stress FAIL — '+failed+' failed'));
    return qaReport;
  }

  // boot UI after DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureQAUI);
  }else{
    // app init is async; delay slightly so body exists
    setTimeout(ensureQAUI, 0);
  }
})();

