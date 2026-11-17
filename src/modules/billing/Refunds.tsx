import { useMemo, useState } from 'react'
import { IconPlus, IconRefresh, IconWallet } from '@tabler/icons-react'
import { HeaderActions } from '../../shared/HeaderActions'
import { Field, Sheet, SheetFoot, Tag } from '../../shared/ui'
import { billingStore, usePayments, useRefunds } from './billingStore'
import type { RefundStatus } from './types'
import './billing.css'

const fmt=(n:number,c:string)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(n)
const dt=(n:number)=>new Date(n).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
const tone:Record<RefundStatus,'green'|'orange'|'red'|'tint'>={Requested:'orange',Processing:'orange',Completed:'green',Failed:'red',Cancelled:'tint'}

export default function Refunds(){
 const payments=usePayments(), refunds=useRefunds()
 const [open,setOpen]=useState(false),[paymentId,setPaymentId]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[method,setMethod]=useState<'Original payment method'|'Manual'>('Original payment method'),[status,setStatus]=useState<RefundStatus>('Completed'),[note,setNote]=useState(''),[filter,setFilter]=useState('all')
 const eligible=payments.filter(p=>p.status==='completed'||p.status==='refunded')
 const payment=eligible.find(p=>p.id===paymentId)
 const already=refunds.filter(r=>r.paymentId===paymentId&&r.status!=='Failed'&&r.status!=='Cancelled').reduce((a,r)=>a+r.amount,0)
 const remaining=payment?Math.max(0,payment.amount-already):0
 const rows=useMemo(()=>refunds.filter(r=>filter==='all'||r.status===filter),[refunds,filter])
 const save=()=>{if(!payment||Number(amount)<=0||Number(amount)>remaining||!reason.trim())return;billingStore.createRefund({paymentId,date:Date.now(),amount:Number(amount),reason,method,status,note:note||undefined});setOpen(false);setPaymentId('');setAmount('');setReason('');setNote('')}
 const total=refunds.filter(r=>r.status==='Completed').reduce((s,r)=>s+r.amount,0)
 return <div className="billing-page">
  <HeaderActions><button className="btn btn--prominent" onClick={()=>setOpen(true)}><IconPlus size={16}/>Create refund</button></HeaderActions>
  <div className="billing-detail-kpis"><div><span>Total refunded</span><b>{fmt(total,'USD')}</b></div><div><span>Refund records</span><b>{refunds.length}</b></div><div><span>Completed</span><b>{refunds.filter(r=>r.status==='Completed').length}</b></div><div><span>Pending / processing</span><b>{refunds.filter(r=>r.status==='Requested'||r.status==='Processing').length}</b></div></div>
  <section className="billing-panel">
   <div className="billing-panel__head"><div><h3>Refund history</h3><p className="footnote">Refunds are recorded separately from their original payments.</p></div><select className="billing-inline-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{(['Requested','Processing','Completed','Failed','Cancelled'] as RefundStatus[]).map(x=><option key={x}>{x}</option>)}</select></div>
   <div className="billing-table-wrap"><table className="billing-table"><thead><tr><th>Refund ref.</th><th>Payment</th><th>Invoice</th><th>Customer</th><th>Date</th><th>Reason</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.reference}</b></td><td>{r.paymentReference}</td><td>{r.invoiceNumber}</td><td>{r.customerName}</td><td>{dt(r.date)}</td><td>{r.reason}</td><td><b>{fmt(r.amount,r.currency)}</b></td><td><Tag tone={tone[r.status]}>{r.status}</Tag></td></tr>)}</tbody></table></div>
   {!rows.length&&<div className="billing-empty"><IconRefresh size={25}/><b>No refunds yet</b><span>Refunds you record will appear here.</span></div>}
  </section>
  {open&&<Sheet title="Create refund" sub="Record a full or partial refund against an existing payment." onClose={()=>setOpen(false)} onSubmit={e=>{e.preventDefault();save()}} foot={<SheetFoot onCancel={()=>setOpen(false)} primary="Save refund" disabled={!payment||Number(amount)<=0||Number(amount)>remaining||!reason.trim()}/>}>
   <div className="billing-form">
    <Field label="Original payment *" id="refund-payment"><select id="refund-payment" value={paymentId} onChange={e=>{setPaymentId(e.target.value);setAmount('')}}><option value="">Select a payment</option>{eligible.map(p=><option key={p.id} value={p.id}>{p.reference} · {p.customerName} · {fmt(p.amount,p.currency)}</option>)}</select></Field>
    {payment&&<div className="billing-payment-context"><span>Remaining refundable amount</span><b>{fmt(remaining,payment.currency)}</b></div>}
    <div className="billing-form__two"><Field label="Refund amount *" id="refund-amount"><input id="refund-amount" type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></Field><Field label="Refund method" id="refund-method"><select id="refund-method" value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option>Original payment method</option><option>Manual</option></select></Field></div>
    <Field label="Reason *" id="refund-reason"><select id="refund-reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="">Select reason</option><option>Service cancelled</option><option>Duplicate payment</option><option>Overpayment</option><option>Billing adjustment</option><option>Other</option></select></Field>
    <Field label="Status" id="refund-status"><select id="refund-status" value={status} onChange={e=>setStatus(e.target.value as RefundStatus)}><option>Completed</option><option>Requested</option><option>Processing</option><option>Failed</option><option>Cancelled</option></select></Field>
    <Field label="Internal note" id="refund-note"><textarea id="refund-note" rows={2} value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional note"/></Field>
    {payment&&Number(amount)>remaining&&<p className="billing-error">Refund cannot exceed the remaining refundable amount.</p>}
    <p className="billing-form__hint">Demo mode: this records a refund locally; it does not send money through a payment gateway.</p>
   </div>
  </Sheet>}
 </div>
}
