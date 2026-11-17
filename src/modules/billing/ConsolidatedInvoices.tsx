import { useMemo, useState } from 'react'
import { IconFiles, IconLayersIntersect } from '@tabler/icons-react'
import { HeaderActions } from '../../shared/HeaderActions'
import { Tag } from '../../shared/ui'
import { billingStore, useConsolidatedInvoices, useConsolidationEnabled, useInvoices } from './billingStore'
import './billing.css'

const fmt=(n:number,c:string)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(n)
const dt=(n:number)=>new Date(n).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})

export default function ConsolidatedInvoices(){
 const invoices=useInvoices(), records=useConsolidatedInvoices(), enabled=useConsolidationEnabled()
 const [selected,setSelected]=useState<string[]>([]),[notice,setNotice]=useState('')
 const eligible=invoices.filter(x=>x.amountPaid===0&&x.balanceDue===x.total&&x.status!=='void'&&!records.some(r=>r.sourceInvoiceIds.includes(x.id)))
 const selectedRows=eligible.filter(x=>selected.includes(x.id))
 const groups=useMemo(()=>{const map=new Map<string,typeof eligible>();eligible.forEach(x=>{const key=`${x.customerName}__${x.currency}`;map.set(key,[...(map.get(key)||[]),x])});return [...map.entries()]},[eligible])
 const compatible=selectedRows.length>=2&&selectedRows.every(x=>x.customerName===selectedRows[0].customerName&&x.currency===selectedRows[0].currency)
 const toggle=(id:string)=>{setNotice('');setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}
 const create=()=>{if(!compatible)return;const result=billingStore.createConsolidatedInvoice(selected);if(result){setNotice(`${result.number} created successfully.`);setSelected([])}else setNotice('Unable to consolidate this selection. Check customer, currency and payment eligibility.')}
 return <div className="billing-page">
  <HeaderActions><span className="billing-count">{records.length} consolidated invoices</span></HeaderActions>
  <section className="billing-panel billing-consolidation-setting">
   <div className="billing-panel__head"><div><h3>Consolidated invoicing</h3><p className="footnote">This is an optional firm-level feature. Enable it only when the firm wants to combine eligible invoices for the same customer.</p></div><label className="billing-switch"><input type="checkbox" checked={enabled} onChange={e=>{billingStore.setConsolidationEnabled(e.target.checked);setSelected([]);setNotice('')}}/><span>{enabled?'Enabled':'Disabled'}</span></label></div>
   {!enabled&&<div className="billing-consolidation-disabled"><IconLayersIntersect size={24}/><div><b>Consolidated invoicing is turned off</b><p>Enable this setting to select and combine eligible unpaid invoices. Existing individual invoices will remain unchanged.</p></div></div>}
  </section>
  {enabled&&<section className="billing-panel">
   <div className="billing-panel__head"><div><h3>Select invoices to consolidate</h3><p className="footnote">Only fully unpaid invoices for the same customer and currency can be selected.</p></div><span className="billing-count">{selected.length} selected</span></div>
   {groups.length?groups.map(([key,items])=><div className="billing-consolidation-group" key={key}>
    <div className="billing-consolidation-group__head"><b>{items[0].customerName}</b><span>{items[0].currency} · {items.length} eligible invoices</span></div>
    <div className="billing-table-wrap"><table className="billing-table"><thead><tr><th>Select</th><th>Invoice</th><th>Invoice date</th><th>Due date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{items.map(inv=><tr key={inv.id}><td><input aria-label={`Select ${inv.number}`} type="checkbox" checked={selected.includes(inv.id)} onChange={()=>toggle(inv.id)}/></td><td><b>{inv.number}</b></td><td>{dt(inv.invoiceDate)}</td><td>{dt(inv.dueDate)}</td><td><b>{fmt(inv.balanceDue,inv.currency)}</b></td><td><Tag tone="tint">{inv.status}</Tag></td></tr>)}</tbody></table></div>
   </div>):<div className="billing-empty"><IconFiles size={25}/><b>No eligible invoices</b><span>There are no fully unpaid invoices available for consolidation.</span></div>}
   <div className="billing-consolidation-footer"><div><span>Combined total</span><b>{selectedRows.length?fmt(selectedRows.reduce((s,x)=>s+x.balanceDue,0),selectedRows[0].currency):'—'}</b><small>Choose at least two invoices from the same customer and currency.</small></div><button className="btn btn--prominent" disabled={!compatible} onClick={create}><IconLayersIntersect size={16}/>Create consolidated invoice</button></div>
   {selectedRows.length>1&&!compatible&&<p className="billing-error billing-consolidation-error">Please select invoices belonging to the same customer and currency.</p>}
   {notice&&<p className="billing-consolidation-notice">{notice}</p>}
  </section>}
  <section className="billing-panel">
   <div className="billing-panel__head"><div><h3>Consolidated invoice history</h3><p className="footnote">Original invoice references are retained for audit visibility.</p></div></div>
   <div className="billing-table-wrap"><table className="billing-table"><thead><tr><th>Consolidated ref.</th><th>Customer</th><th>Source invoices</th><th>Created</th><th>Total</th><th>Status</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td><b>{r.number}</b></td><td>{r.customerName}<small>{r.customerEmail}</small></td><td>{r.sourceInvoiceNumbers.join(', ')}</td><td>{dt(r.createdAt)}</td><td><b>{fmt(r.total,r.currency)}</b></td><td><Tag tone={r.status==='Issued'?'green':'tint'}>{r.status}</Tag></td></tr>)}</tbody></table></div>
   {!records.length&&<div className="billing-empty">No consolidated invoices have been created.</div>}
  </section>
 </div>
}
