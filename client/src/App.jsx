import React, { useEffect, useMemo, useState } from 'react';
import { api, getToken, money } from './api';

const roles = ['CLERK','MANAGER','ADMIN','MANAGEMENT'];
const blankClient = { firstName:'', lastName:'', nationalId:'', phone:'', email:'', address:'', employment:'', notes:'' };

export default function App() {
  const [token, setToken] = useState(getToken());
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clients, setClients] = useState([]);
  const [loans, setLoans] = useState([]);
  const [summary, setSummary] = useState(null);
  const [staff, setStaff] = useState([]);
  const [audit, setAudit] = useState([]);
  const [clientForm, setClientForm] = useState(blankClient);
  const [loanForm, setLoanForm] = useState({ clientId:'', principal:'', dueDate:'', purpose:'', interestRate:'25' });
  const [repayForm, setRepayForm] = useState({ loanId:'', amount:'', method:'CASH', reference:'' });
  const [staffForm, setStaffForm] = useState({ name:'', email:'', password:'', role:'CLERK' });
  const [search, setSearch] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ password:'', confirm:'' });
  const [clientEdit, setClientEdit] = useState(null);

  const canReports = ['MANAGER','ADMIN','MANAGEMENT'].includes(user?.role);
  const canDecide = user?.role === 'MANAGER';
  const canStaff = user?.role === 'ADMIN';
  const canAudit = ['ADMIN','MANAGEMENT'].includes(user?.role);
  const canCapture = ['CLERK','MANAGER'].includes(user?.role);

  async function loadAll() {
    setError('');
    try {
      const [c,l] = await Promise.all([api('/clients'), api('/loans')]);
      setClients(c); setLoans(l);
      if (canReports || ['MANAGER','ADMIN','MANAGEMENT'].includes(user?.role)) setSummary(await api('/reports/summary'));
      if (user?.role === 'ADMIN') setStaff(await api('/staff'));
      if (['ADMIN','MANAGEMENT'].includes(user?.role)) setAudit(await api('/reports/audit'));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    if (token) api('/auth/me').then(d => setUser(d.user)).catch(() => { localStorage.removeItem('loan_token'); setToken(''); });
  }, [token]);
  useEffect(() => { if (user) loadAll(); }, [user]);

  async function login(e) {
    e.preventDefault(); setError('');
    try {
      const data = await api('/auth/login', { method:'POST', body:JSON.stringify({ email, password }) });
      localStorage.setItem('loan_token', data.token); setToken(data.token); setUser(data.user); setPassword('');
    } catch (e) { setError(e.message); }
  }
  function logout() { localStorage.removeItem('loan_token'); setToken(''); setUser(null); setClients([]); setLoans([]); setSummary(null); setTab('overview'); }
  async function act(fn, success) {
    setError(''); setNotice('');
    try { await fn(); setNotice(success); await loadAll(); }
    catch (e) { setError(e.message); }
  }
  async function createClient(e) {
    e.preventDefault();
    await act(async () => { await api('/clients', {method:'POST',body:JSON.stringify(clientForm)}); setClientForm(blankClient); }, 'Client registered successfully.');
  }
  async function createLoan(e) {
    e.preventDefault();
    await act(async () => { await api('/loans', {method:'POST',body:JSON.stringify(loanForm)}); setLoanForm({clientId:'',principal:'',dueDate:'',purpose:'',interestRate:'25'}); }, 'Loan application submitted for manager review.');
  }
  async function decision(id, decision) {
    const note = window.prompt(`Optional note for ${decision.toLowerCase()}:`) || '';
    await act(() => api(`/loans/${id}/decision`, {method:'POST',body:JSON.stringify({decision,note})}), `Loan ${decision.toLowerCase()}.`);
  }
  async function disburse(id) {
    if (!window.confirm('Confirm this approved loan has been disbursed to the client?')) return;
    await act(() => api(`/loans/${id}/disburse`, {method:'POST',body:JSON.stringify({})}), 'Disbursement recorded.');
  }
  async function repayment(e) {
    e.preventDefault();
    await act(async () => {
      const r = await api(`/loans/${repayForm.loanId}/repayments`, {method:'POST',body:JSON.stringify({amount:repayForm.amount,method:repayForm.method,reference:repayForm.reference})});
      setReceipt(r); setRepayForm({loanId:'',amount:'',method:'CASH',reference:''});
    }, 'Repayment recorded. Receipt is ready to print.');
  }
  async function assess() {
    await act(async () => {
      const r = await api('/loans/assess-overdue', {method:'POST',body:JSON.stringify({})});
      setNotice(`Overdue assessment complete. ${r.assessedCount} charge(s) assessed.`);
    }, 'Overdue assessment complete.');
  }
  async function createStaff(e) {
    e.preventDefault();
    await act(async () => { await api('/staff',{method:'POST',body:JSON.stringify(staffForm)}); setStaffForm({name:'',email:'',password:'',role:'CLERK'}); }, 'Staff account created. User must change password.');
  }
  async function updateStaff(s, changes) {
    await act(() => api(`/staff/${s._id}`,{method:'PATCH',body:JSON.stringify(changes)}), 'Staff account updated.');
  }
  async function saveClientEdit(e) {
    e.preventDefault();
    await act(async () => { await api(`/clients/${clientEdit._id}`,{method:'PATCH',body:JSON.stringify(clientEdit)}); setClientEdit(null); }, 'Client profile updated.');
  }
  async function changePassword(e) {
    e.preventDefault();
    if (passwordForm.password !== passwordForm.confirm) return setError('Passwords do not match.');
    await act(async () => { await api('/auth/change-password',{method:'POST',body:JSON.stringify({password:passwordForm.password})}); setUser({...user,mustChangePassword:false}); setPasswordForm({password:'',confirm:''}); }, 'Password changed.');
  }

  const filteredClients = useMemo(() => clients.filter(c => `${c.clientNumber} ${c.firstName} ${c.lastName} ${c.phone} ${c.nationalId}`.toLowerCase().includes(search.toLowerCase())), [clients, search]);
  const filteredLoans = useMemo(() => loans.filter(l => `${l.loanNumber} ${l.client?.firstName||''} ${l.client?.lastName||''} ${l.status}`.toLowerCase().includes(search.toLowerCase())), [loans, search]);

  if (!token || !user) return <main className="login-page"><section className="login-card"><div className="brand-mark">ML</div><p className="eyebrow">BOTSWANA · BWP</p><h1>Micro-Lending<br/>Management</h1><p className="muted">Secure access for authorized staff.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={login} className="stack"><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label><button className="primary wide">Sign in</button></form><p className="tiny muted">Use the administrator account configured during setup.</p></section></main>;

  if (user.mustChangePassword) return <main className="login-page"><section className="login-card"><p className="eyebrow">ACCOUNT SECURITY</p><h1>Change your password</h1><p className="muted">A new account or temporary password must be changed before continuing.</p>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}<form className="stack" onSubmit={changePassword}><label>New password (12+ characters)<input type="password" minLength="12" value={passwordForm.password} onChange={e=>setPasswordForm({...passwordForm,password:e.target.value})} required/></label><label>Confirm password<input type="password" minLength="12" value={passwordForm.confirm} onChange={e=>setPasswordForm({...passwordForm,confirm:e.target.value})} required/></label><button className="primary wide">Update password</button></form></section></main>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">ML</div><div><b>MicroLend</b><small>Management system</small></div></div><div className="side-label">WORKSPACE</div>
      <nav>
        <Nav active={tab==='overview'} onClick={()=>setTab('overview')}>Overview</Nav>
        <Nav active={tab==='clients'} onClick={()=>setTab('clients')}>Clients</Nav>
        <Nav active={tab==='loans'} onClick={()=>setTab('loans')}>Loans</Nav>
        {canCapture && <Nav active={tab==='repayments'} onClick={()=>setTab('repayments')}>Record repayment</Nav>}
        {canReports && <Nav active={tab==='reports'} onClick={()=>setTab('reports')}>Reports</Nav>}
        {canStaff && <Nav active={tab==='staff'} onClick={()=>setTab('staff')}>Staff accounts</Nav>}
        {canAudit && <Nav active={tab==='audit'} onClick={()=>setTab('audit')}>Audit log</Nav>}
      </nav>
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{user.name?.slice(0,1).toUpperCase()}</div><div className="user-info"><b>{user.name}</b><small>{user.role}</small></div></div><button className="logout" onClick={logout}>Sign out ↗</button></div>
    </aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">SINGLE BRANCH · BOTSWANA</p><h2>{({overview:'Overview',clients:'Clients',loans:'Loan management',repayments:'Record repayment',reports:'Reports & performance',staff:'Staff accounts',audit:'Audit trail'})[tab]||'Workspace'}</h2></div><div className="top-actions"><span className="role-pill">{user.role}</span><button className="secondary" onClick={loadAll}>↻ Refresh</button></div></header>
      {error && <div className="alert error">{error}<button className="alert-close" onClick={()=>setError('')}>×</button></div>}{notice && <div className="alert success">{notice}<button className="alert-close" onClick={()=>setNotice('')}>×</button></div>}
      {tab==='overview' && <Overview user={user} summary={summary} loans={loans} clients={clients} setTab={setTab} assess={assess}/>}
      {tab==='clients' && <section className="panel"><div className="section-head"><div><h3>Client register</h3><p>Client profile editing is restricted to the IT administrator.</p></div><span className="count">{clients.length} clients</span></div><input className="search" placeholder="Search name, client number, phone or ID…" value={search} onChange={e=>setSearch(e.target.value)}/>{canCapture || user.role==='ADMIN' ? <form className="form-grid" onSubmit={createClient}><h4 className="full">Register a new client</h4><Field label="First name" value={clientForm.firstName} set={v=>setClientForm({...clientForm,firstName:v})} required/><Field label="Last name" value={clientForm.lastName} set={v=>setClientForm({...clientForm,lastName:v})} required/><Field label="National ID / Omang" value={clientForm.nationalId} set={v=>setClientForm({...clientForm,nationalId:v})} required/><Field label="Phone" value={clientForm.phone} set={v=>setClientForm({...clientForm,phone:v})} required/><Field label="Email (optional)" type="email" value={clientForm.email} set={v=>setClientForm({...clientForm,email:v})}/><Field label="Address / village" value={clientForm.address} set={v=>setClientForm({...clientForm,address:v})} required/><Field label="Employment (optional)" value={clientForm.employment} set={v=>setClientForm({...clientForm,employment:v})}/><label className="full">Notes<textarea value={clientForm.notes} onChange={e=>setClientForm({...clientForm,notes:e.target.value})}/></label><div className="full"><button className="primary">Save client</button></div></form>:null}
        <div className="table-wrap"><table><thead><tr><th>Client</th><th>Client no.</th><th>Phone</th><th>National ID</th><th>Address</th>{canStaff&&<th>Action</th>}</tr></thead><tbody>{filteredClients.map(c=><tr key={c._id}><td><b>{c.firstName} {c.lastName}</b><small className="table-sub">{c.email||'No email'}</small></td><td>{c.clientNumber}</td><td>{c.phone}</td><td>{c.nationalId}</td><td>{c.address}</td>{canStaff&&<td><button className="text-button" onClick={()=>setClientEdit({...c})}>Edit profile</button></td>}</tr>)}</tbody></table>{filteredClients.length===0&&<Empty text="No clients found."/>}</div>
      </section>}
      {tab==='loans' && <section className="panel"><div className="section-head"><div><h3>Loan applications & accounts</h3><p>Applications require manager approval before disbursement.</p></div><span className="count">{loans.length} records</span></div><input className="search" placeholder="Search loan number, client or status…" value={search} onChange={e=>setSearch(e.target.value)}/>{canCapture&&<form className="form-grid" onSubmit={createLoan}><h4 className="full">New loan application</h4><label>Client<select value={loanForm.clientId} onChange={e=>setLoanForm({...loanForm,clientId:e.target.value})} required><option value="">Choose a client</option>{clients.map(c=><option key={c._id} value={c._id}>{c.clientNumber} — {c.firstName} {c.lastName}</option>)}</select></label><Field label="Principal (BWP)" type="number" min="1" step="0.01" value={loanForm.principal} set={v=>setLoanForm({...loanForm,principal:v})} required/><Field label="Initial flat interest (%)" type="number" min="0" max="100" step="0.1" value={loanForm.interestRate} set={v=>setLoanForm({...loanForm,interestRate:v})} required/><Field label="Due date" type="date" value={loanForm.dueDate} set={v=>setLoanForm({...loanForm,dueDate:v})} required/><label>Purpose<input value={loanForm.purpose} onChange={e=>setLoanForm({...loanForm,purpose:e.target.value})} required/></label><div className="form-note full">Initial interest is a flat percentage of principal. A 25% rate on BWP 1,000 adds BWP 250 initial interest.</div><div className="full"><button className="primary">Submit application</button></div></form>}
        <div className="table-wrap"><table><thead><tr><th>Loan / client</th><th>Status</th><th>Principal</th><th>Initial interest</th><th>Charges</th><th>Paid</th><th>Outstanding</th><th>Due date</th><th>Actions</th></tr></thead><tbody>{filteredLoans.map(l=><tr key={l._id}><td><b>{l.loanNumber}</b><small className="table-sub">{l.client?.firstName} {l.client?.lastName}</small></td><td><Status value={l.status}/></td><td>{money(l.principalBWP)}</td><td>{money(l.interestBWP)}</td><td>{money(l.chargesTotalBWP)}</td><td>{money(l.paymentsTotalBWP)}</td><td><b>{money(l.outstandingBWP)}</b></td><td>{new Date(l.dueDate).toLocaleDateString()}</td><td className="actions">{canDecide&&l.status==='PENDING'&&<><button className="mini success-btn" onClick={()=>decision(l._id,'APPROVED')}>Approve</button><button className="mini danger-btn" onClick={()=>decision(l._id,'REJECTED')}>Reject</button></>}{canDecide&&l.status==='APPROVED'&&<button className="mini primary" onClick={()=>disburse(l._id)}>Disburse</button>}{canCapture&&l.status==='DISBURSED'&&<button className="mini secondary" onClick={()=>{setRepayForm({...repayForm,loanId:l._id});setTab('repayments')}}>Repay</button>}</td></tr>)}</tbody></table>{filteredLoans.length===0&&<Empty text="No loans match your search."/>}</div>
      </section>}
      {tab==='repayments' && <section className="panel narrow-panel"><h3>Record a repayment</h3><p className="muted">A receipt is generated after a successful payment record.</p><form className="stack" onSubmit={repayment}><label>Loan<select value={repayForm.loanId} onChange={e=>setRepayForm({...repayForm,loanId:e.target.value})} required><option value="">Select an active loan</option>{loans.filter(l=>l.status==='DISBURSED'&&l.outstandingBWP>0).map(l=><option key={l._id} value={l._id}>{l.loanNumber} — {l.client?.firstName} {l.client?.lastName} — due {money(l.outstandingBWP)}</option>)}</select></label><Field label="Amount received (BWP)" type="number" min="0.01" step="0.01" value={repayForm.amount} set={v=>setRepayForm({...repayForm,amount:v})} required/><label>Payment method<select value={repayForm.method} onChange={e=>setRepayForm({...repayForm,method:e.target.value})}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile money</option><option value="OTHER">Other</option></select></label><Field label="Transaction reference (optional)" value={repayForm.reference} set={v=>setRepayForm({...repayForm,reference:v})}/><button className="primary">Record payment & generate receipt</button></form>{receipt&&<div className="receipt" id="receipt"><div className="receipt-top"><div className="brand-mark">ML</div><div><b>PAYMENT RECEIPT</b><small>Micro-Lending Management</small></div><Status value="PAID"/></div><h2>{receipt.receiptNumber}</h2><p>Received: {new Date(receipt.receivedAt).toLocaleString()}</p><div className="receipt-line"><span>Loan number</span><b>{receipt.loanNumber}</b></div><div className="receipt-line"><span>Amount received</span><b>{money(receipt.amountBWP)}</b></div><div className="receipt-line"><span>Method</span><b>{receipt.method.replace('_',' ')}</b></div><div className="receipt-line"><span>Reference</span><b>{receipt.reference||'—'}</b></div><hr/><p className="muted">Payment allocation</p><div className="receipt-line"><span>Overdue charges</span><span>{money(receipt.allocated.charges)}</span></div><div className="receipt-line"><span>Initial interest</span><span>{money(receipt.allocated.interest)}</span></div><div className="receipt-line"><span>Principal</span><span>{money(receipt.allocated.principal)}</span></div><div className="receipt-line total"><span>Remaining balance</span><b>{money(receipt.outstandingBWP)}</b></div><button className="primary wide no-print" onClick={()=>window.print()}>Print receipt</button></div>}</section>}
      {tab==='reports' && <><section className="stats-grid">{summary&&<><Stat label="Clients" value={summary.clients}/><Stat label="Capital disbursed" value={money(summary.capitalDisbursedBWP)}/><Stat label="Payments collected" value={money(summary.paymentsCollectedBWP)}/><Stat label="Outstanding balance" value={money(summary.outstandingBWP)}/><Stat label="Overdue loans" value={summary.overdueLoans}/><Stat label="Pending applications" value={summary.pendingApplications}/></>}</section><section className="panel"><div className="section-head"><div><h3>Loan portfolio report</h3><p>Current portfolio status, due dates, payments and balances.</p></div><button className="secondary" onClick={()=>downloadCSV(loans)}>Export CSV</button></div><div className="table-wrap"><table><thead><tr><th>Loan</th><th>Client</th><th>Status</th><th>Principal</th><th>Interest</th><th>Charges</th><th>Paid</th><th>Outstanding</th><th>Due date</th></tr></thead><tbody>{loans.map(l=><tr key={l._id}><td>{l.loanNumber}</td><td>{l.client?.firstName} {l.client?.lastName}</td><td><Status value={l.status}/></td><td>{money(l.principalBWP)}</td><td>{money(l.interestBWP)}</td><td>{money(l.chargesTotalBWP)}</td><td>{money(l.paymentsTotalBWP)}</td><td>{money(l.outstandingBWP)}</td><td>{new Date(l.dueDate).toLocaleDateString()}</td></tr>)}</tbody></table></div></section></>}
      {tab==='staff' && <section className="panel"><div className="section-head"><div><h3>Staff accounts</h3><p>IT administrator only. Temporary passwords must be changed on first sign-in.</p></div></div><form className="form-grid" onSubmit={createStaff}><h4 className="full">Create staff account</h4><Field label="Full name" value={staffForm.name} set={v=>setStaffForm({...staffForm,name:v})} required/><Field label="Email" type="email" value={staffForm.email} set={v=>setStaffForm({...staffForm,email:v})} required/><Field label="Temporary password (12+ chars)" value={staffForm.password} set={v=>setStaffForm({...staffForm,password:v})} required/><label>Role<select value={staffForm.role} onChange={e=>setStaffForm({...staffForm,role:e.target.value})}>{roles.map(r=><option key={r}>{r}</option>)}</select></label><div className="full"><button className="primary">Create account</button></div></form><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{staff.map(s=><tr key={s._id}><td>{s.name}</td><td>{s.email}</td><td><select value={s.role} onChange={e=>updateStaff(s,{role:e.target.value})} disabled={s._id===user.id}>{roles.map(r=><option key={r}>{r}</option>)}</select></td><td><Status value={s.active?'ACTIVE':'INACTIVE'}/></td><td><button className="text-button" onClick={()=>updateStaff(s,{active:!s.active})}>{s.active?'Deactivate':'Activate'}</button><button className="text-button" onClick={()=>{const p=window.prompt('Enter a temporary password of at least 12 characters');if(p)updateStaff(s,{password:p})}}>Reset password</button></td></tr>)}</tbody></table></div></section>}
      {tab==='audit' && <section className="panel"><div className="section-head"><div><h3>Audit trail</h3><p>Recent security and financial events. Entries are append-only through the application.</p></div></div><div className="table-wrap"><table><thead><tr><th>Date/time</th><th>Actor</th><th>Role</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{audit.map(a=><tr key={a._id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.actorName||a.actor?.name||'System'}</td><td>{a.actorRole||a.actor?.role}</td><td><b>{a.action}</b></td><td>{a.entityType} {a.entityId}</td><td><code>{JSON.stringify(a.details||{})}</code></td></tr>)}</tbody></table>{audit.length===0&&<Empty text="No audit events yet."/>}</div></section>}
      {clientEdit && <div className="modal-backdrop"><form className="modal panel" onSubmit={saveClientEdit}><div className="section-head"><h3>Edit client profile</h3><button type="button" className="icon-button" onClick={()=>setClientEdit(null)}>×</button></div><div className="form-grid">{['firstName','lastName','nationalId','phone','email','address','employment','notes'].map(k=><label key={k}>{({firstName:'First name',lastName:'Last name',nationalId:'National ID',phone:'Phone',email:'Email',address:'Address',employment:'Employment',notes:'Notes'})[k]}<input value={clientEdit[k]||''} onChange={e=>setClientEdit({...clientEdit,[k]:e.target.value})}/></label>)}</div><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setClientEdit(null)}>Cancel</button><button className="primary">Save changes</button></div></form></div>}
      <footer>MicroLend · Botswana · BWP <span>Access is role-restricted · Keep client information confidential</span></footer>
    </main>
  </div>;
}

function Nav({active,onClick,children}) { return <button className={`nav-item ${active?'active':''}`} onClick={onClick}><span className="nav-dot"/>{children}</button>; }
function Field({label,value,set,type='text',required=false,min,max,step}) { return <label>{label}<input type={type} value={value} onChange={e=>set(e.target.value)} required={required} min={min} max={max} step={step}/></label>; }
function Status({value}) { const v=String(value||'').toLowerCase(); return <span className={`status status-${v}`}>{String(value||'').replaceAll('_',' ')}</span>; }
function Empty({text}) { return <div className="empty">{text}</div>; }
function Stat({label,value}) { return <div className="stat-card"><span>{label}</span><strong>{value}</strong></div>; }
function Overview({user,summary,loans,clients,setTab,assess}) {
  const recent = [...loans].slice(0,6);
  const isManager = user.role==='MANAGER';
  return <><section className="welcome"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Welcome back, {user.name.split(' ')[0]}.</h1><p>Here is the latest activity across your loan portfolio.</p></div><div className="welcome-mark">M</div></section>
    {summary&&<section className="stats-grid"><Stat label="Registered clients" value={summary.clients}/><Stat label="Capital disbursed" value={money(summary.capitalDisbursedBWP)}/><Stat label="Payments collected" value={money(summary.paymentsCollectedBWP)}/><Stat label="Outstanding balance" value={money(summary.outstandingBWP)}/><Stat label="Overdue loans" value={summary.overdueLoans}/><Stat label="Pending review" value={summary.pendingApplications}/></section>}
    <section className="quick-grid"><button className="quick-card" onClick={()=>setTab('clients')}><span className="quick-icon">＋</span><b>Client register</b><small>Find or add a client</small></button><button className="quick-card" onClick={()=>setTab('loans')}><span className="quick-icon">↗</span><b>Loan applications</b><small>Review account status</small></button>{['CLERK','MANAGER'].includes(user.role)&&<button className="quick-card" onClick={()=>setTab('repayments')}><span className="quick-icon">↘</span><b>Record repayment</b><small>Capture a payment</small></button>}{isManager&&<button className="quick-card" onClick={assess}><span className="quick-icon">◷</span><b>Assess overdue charges</b><small>Apply eligible charges once</small></button>}</section>
    <section className="panel"><div className="section-head"><div><h3>Recent loan activity</h3><p>Latest applications and account status</p></div><button className="text-button" onClick={()=>setTab('loans')}>View all →</button></div><div className="table-wrap"><table><thead><tr><th>Loan number</th><th>Client</th><th>Principal</th><th>Outstanding</th><th>Status</th><th>Due date</th></tr></thead><tbody>{recent.map(l=><tr key={l._id}><td><b>{l.loanNumber}</b></td><td>{l.client?.firstName} {l.client?.lastName}</td><td>{money(l.principalBWP)}</td><td>{money(l.outstandingBWP)}</td><td><Status value={l.status}/></td><td>{new Date(l.dueDate).toLocaleDateString()}</td></tr>)}</tbody></table>{!recent.length&&<Empty text="No loan activity yet. Register a client and submit a loan application to get started."/>}</div></section>
    <div className="role-note"><b>Your access: {user.role}</b><p>{({CLERK:'Register clients, capture loan applications and record repayments. Managers approve loans.',MANAGER:'Review applications, approve/reject loans, record disbursements and monitor collections.',ADMIN:'Manage staff accounts, correct client profiles, review audit logs and maintain system security.',MANAGEMENT:'Monitor company-wide portfolio performance, financial reports and audit activity.'})[user.role]}</p></div>
  </>;
}
function downloadCSV(loans) {
  const headers = ['Loan Number','Client','Status','Principal BWP','Interest BWP','Charges BWP','Payments BWP','Outstanding BWP','Due Date'];
  const rows = loans.map(l=>[l.loanNumber,`${l.client?.firstName||''} ${l.client?.lastName||''}`,l.status,l.principalBWP,l.interestBWP,l.chargesTotalBWP,l.paymentsTotalBWP,l.outstandingBWP,new Date(l.dueDate).toISOString().slice(0,10)]);
  const csv = [headers,...rows].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='loan-portfolio-report.csv'; a.click(); URL.revokeObjectURL(url);
}
