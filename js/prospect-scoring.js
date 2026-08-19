/* prospect-scoring.js — independent shop evaluation scoring (not CRM finance) */
const PROSPECT_APP_VERSION = '1.0';
const PROSPECT_SCORING_VERSION = 1;

const PROSPECT_QUESTIONS = [
  { id:'q1', label:'نوع و اندازه مغازه', weight:10, options:[
    {key:'super_big',     label:'سوپر بزرگ', score:10},
    {key:'resto_active',  label:'رستوران / آشپزخانه پرکار', score:8},
    {key:'super_small',   label:'سوپر کوچک', score:6},
    {key:'nuts_shop',     label:'آجیل و خشکبارفروشی', score:4},
    {key:'other_ok',      label:'سایر — مناسب', score:2},
    {key:'other_bad',     label:'سایر — نامناسب', score:1},
  ]},
  { id:'q2', label:'حجم فعلی فروش حبوبات و خشکبار', weight:18, options:[
    {key:'huge', label:'خیلی زیاد', score:18},
    {key:'high', label:'زیاد', score:14},
    {key:'mid',  label:'متوسط', score:9},
    {key:'low',  label:'کم', score:4},
    {key:'none', label:'تقریباً صفر', score:1},
  ]},
  { id:'q3', label:'وضعیت تأمین‌کننده فعلی', weight:10, options:[
    {key:'none_fixed', label:'تأمین‌کننده ثابت ندارد', score:10},
    {key:'has_fixed',  label:'تأمین‌کننده ثابت دارد', score:3},
  ]},
  { id:'q4', label:'رضایت از تأمین‌کننده فعلی', weight:9, options:[
    {key:'no_supplier',  label:'تأمین‌کننده ثابت ندارد', score:9},
    {key:'very_unhappy', label:'خیلی ناراضی', score:8},
    {key:'unhappy',      label:'ناراضی', score:6},
    {key:'neutral',      label:'بی‌تفاوت', score:4},
    {key:'happy',        label:'راضی', score:2},
    {key:'very_happy',   label:'خیلی راضی', score:1},
  ]},
  { id:'q5', label:'دسترسی به تصمیم‌گیرنده', weight:8, options:[
    {key:'owner_present', label:'صاحب مغازه بود', score:8},
    {key:'manager_full',  label:'مسئول خرید بود', score:6},
    {key:'needs_coord',   label:'نیاز به هماهنگی دارد', score:3},
    {key:'absent',        label:'تصمیم‌گیرنده حضور نداشت', score:1},
  ]},
  { id:'q6', label:'تمایل به امتحان تأمین‌کننده جدید', weight:12, options:[
    {key:'eager',      label:'مشتاق', score:12},
    {key:'interested', label:'علاقه‌مند', score:8},
    {key:'hesitant',   label:'هنوز تردید دارد', score:4},
    {key:'closed',     label:'کاملاً بسته و مخالف', score:0},
  ]},
  { id:'q7', label:'شرایط پرداخت', weight:16, options:[
    {key:'cash_weekly',  label:'نقدی / تسویه هفتگی', score:16},
    {key:'next_invoice', label:'تسویه تا فاکتور بعدی', score:11},
    {key:'d15_30',       label:'چک یا تسویه ۱۵ تا ۳۰ روزه', score:6},
    {key:'long_or_bad',  label:'چک/طلب بالای ۳۰ روز یا مشکل‌دار', score:1},
  ]},
  { id:'q8', label:'فضای نمایش و نگهداری کالا', weight:6, options:[
    {key:'dedicated', label:'فضای اختصاصی حبوبات و خشکبار', score:6},
    {key:'partial',   label:'فقط برای حبوبات یا خشکبار جا دارد', score:4},
    {key:'mid_low',   label:'فضای متوسط یا کم', score:2},
    {key:'none',      label:'فضای مناسب برای این کالاها ندارد', score:0},
  ]},
  { id:'q9', label:'موقعیت مکانی و ترافیک مشتری', weight:6, options:[
    {key:'main',   label:'خیابان اصلی / کنار جاده', score:6},
    {key:'dense',  label:'داخل محله پرجمعیت / پرمصرف', score:4},
    {key:'normal', label:'محله یا موقعیت معمولی', score:2},
    {key:'quiet',  label:'جای خلوت', score:1},
  ]},
  { id:'q10', label:'احتمال سفارش تکراری', weight:5, options:[
    {key:'very_high', label:'بسیار بالا', score:5},
    {key:'high',      label:'بالا', score:3},
    {key:'mid_low',   label:'متوسط / پایین', score:1},
    {key:'unknown',   label:'نامشخص', score:0},
  ]},
];

const PROSPECT_VISIT_TAGS = [
  {key:'price_list',      label:'اطلاعات گرفت — لیست قیمت / شماره'},
  {key:'sample',          label:'گفت سربزن'},
  {key:'owner_absent',    label:'تصمیم‌گیرنده نبود'},
  {key:'rejected',        label:'رد کرد'},
  {key:'became_customer', label:'خرید کرد'},
];

const PROSPECT_RANK_INFO = {
  'A+': {color:'#0F7A4A', desc:'اولویت مطلق – ویزیت فوری و پیگیری سنگین'},
  'A':  {color:'#2E9A5C', desc:'اولویت بالا – پیگیری جدی در ۷ روز آینده'},
  'B':  {color:'#3B7DD8', desc:'متوسط رو به بالا – پیگیری عادی'},
  'C':  {color:'#D98A22', desc:'اولویت پایین – فقط در صورت آزاد بودن زمان'},
  'D':  {color:'#C64B4B', desc:'فعلاً ارزش پیگیری ندارد'},
};

function prospectScoreToRank(score){
  if(score>=90) return 'A+';
  if(score>=75) return 'A';
  if(score>=55) return 'B';
  if(score>=35) return 'C';
  return 'D';
}
function prospectComputeScore(answers){
  let total=0;
  PROSPECT_QUESTIONS.forEach(q=>{
    const opt = q.options.find(o=>o.key===answers[q.id]);
    if(opt) total += opt.score;
  });
  return total;
}
function prospectAnsweredCount(answers){
  return PROSPECT_QUESTIONS.filter(q=>answers[q.id]).length;
}
function prospectNowISO(){ return new Date().toISOString(); }
function prospectTodayStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function prospectFaDate(iso){
  try{ return new Date(iso).toLocaleDateString('fa-IR'); }catch(e){ return (iso||'').slice(0,10); }
}
function prospectFaDateTime(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString('fa-IR')+' '+d.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});
  }catch(e){ return iso||''; }
}
