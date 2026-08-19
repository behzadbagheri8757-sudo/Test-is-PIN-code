/* payments.js — invoice-linked payment/check apply & revert
   Phase 0 extract: no logic changes.
*/
function paymentMethodLabel(method){
  return {cash:'دریافت نقد', card:'دریافت با کارت', transfer:'انتقال بانکی', discount:'تخفیف', return:'برگشت از فروش'}[method] || 'دریافت';
}

function pushInvoicePayments(cid, inv, cashPaid, cardPaid, transferPaid, checkAmount, checkDue, checkMeta){
  if(cashPaid>0) data.payments.push({id:uid(), customerId:cid, date:inv.date, amount:cashPaid, method:'cash', invoiceId:inv.id});
  if(cardPaid>0) data.payments.push({id:uid(), customerId:cid, date:inv.date, amount:cardPaid, method:'card', invoiceId:inv.id});
  if(transferPaid>0) data.payments.push({id:uid(), customerId:cid, date:inv.date, amount:transferPaid, method:'transfer', invoiceId:inv.id});
  if(checkAmount>0) data.checks.push({id:uid(), customerId:cid, amount:checkAmount, dueDate:checkDue||todayISO(), checkNumber:(checkMeta&&checkMeta.checkNumber)||'', status:(checkMeta&&checkMeta.status)||'pending', invoiceId:inv.id});
}
function revertInvoicePayments(inv){
  data.payments = data.payments.filter(p=>p.invoiceId!==inv.id);
  data.checks = data.checks.filter(c=>c.invoiceId!==inv.id);
}

