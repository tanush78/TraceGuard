'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmt = value => Number(value).toLocaleString('en-US');
const title = value => ({open:'Open',investigating:'Investigating',resolved:'Resolved',critical:'Critical',high:'High',medium:'Medium',low:'Low'}[value] || value);
const stamp = value => new Date(value).toLocaleString('en-GB', {timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}) + ' UTC';
const initials = user => user.split(/[.@_]/).slice(0,2).map(s=>s[0] || '').join('').toUpperCase();
const colors = {low:'#6cbda6',medium:'#90b6f7',high:'#edbf75',critical:'#f17983'};
const state = {route:'overview', overview:null, search:'', severity:'', status:'', offset:0, limit:12, request:0};
let toastTimer;
async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const body = await response.json(); message = typeof body.detail === 'string' ? body.detail : message; } catch (_) { /* fall back to status */ }
    throw new Error(message);
  }
  return response.json();
}
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>element.classList.remove('show'), 4200); }
function errorBlock(error) { return `<div class="error-box"><span class="eyebrow">CONNECTION INTERRUPTED</span><h2>We couldn't load this view.</h2><p>${esc(error.message)}</p><button class="button secondary" data-action="retry">Try again</button></div>`; }
function params(alertsOnly = state.route === 'alerts') { return new URLSearchParams({alerts_only:alertsOnly,search:state.search,severity:state.severity,status:state.status,offset:state.offset,limit:state.limit}); }
function actions() { return `<div class="heading-actions"><a class="button secondary" id="export-link" href="/api/export?${params(state.route!=='events')}">${icon('down')}Export report</a><button class="button primary" data-action="import">${icon('up')}Import events</button></div>`; }
function heading(eyebrow, h1, description) { return `<section class="heading"><div><span class="eyebrow">${eyebrow}</span><h1>${h1}</h1><p>${description}</p></div>${actions()}</section>`; }
function statusPill(status) { return `<span class="status ${esc(status)}">${esc(title(status))}</span>`; }
function risk(event) { return `<span class="risk ${esc(event.severity)}" title="${esc(title(event.severity))} · ranking, not probability">${event.risk}<span class="risk-track"><span class="risk-fill" style="width:${event.risk}%"></span></span></span>`; }
function row(event, allEvents = false) {
  return `<tr><td><div class="user-cell"><span class="user-initials">${esc(initials(event.user))}</span><div><strong>${esc(event.user)}</strong><small>${esc(event.country)} · ${esc(event.source_ip)}</small></div></div></td><td>${risk(event)}</td><td>${event.signals.length ? `<span class="signal-chip">${esc(event.signals[0].label)}</span>${event.signals.length>1?`<span class="signal-extra">+${event.signals.length-1}</span>`:''}` : '<span class="signal-chip">Within baseline</span>'}</td><td>${event.risk>=65?statusPill(event.status):'<span class="mono" style="color:#6cbda6;font-size:9px">Observed</span>'}</td><td class="mono" style="font-size:9px">${esc(stamp(event.timestamp))}</td><td><button class="review" data-review="${esc(event.id)}">${allEvents?'Inspect':'Review'}${icon('arrow')}</button></td></tr>`;
}
function tableHead() { return '<thead><tr><th>ACCOUNT / SOURCE</th><th>RISK SCORE</th><th>CONTEXT SIGNALS</th><th>STATUS</th><th>EVENT TIME</th><th></th></tr></thead>'; }
function activityChart(activity) {
  const totals = activity.map(day=>Object.keys(colors).reduce((sum,key)=>sum+day[key],0));
  const max = Math.max(4, Math.ceil(Math.max(...totals) / 20) * 20);
  let svg = '';
  for(let i=0;i<=4;i++) { const y=22+i*35; svg += `<line class="grid" x1="35" y1="${y}" x2="655" y2="${y}"/><text x="25" y="${y+3}" text-anchor="end">${Math.round(max*(1-i/4))}</text>`; }
  activity.forEach((day,index)=>{
    const x=60+index*87;let bottom=162;
    Object.keys(colors).forEach(key=>{ const h=day[key]/max*140; if(h>0) svg+=`<rect x="${x}" y="${bottom-h}" width="39" height="${h}" fill="${colors[key]}" opacity="${key==='low'?'.70':'1'}" rx="1"><title>${esc(day.date)}: ${day[key]} ${key} events</title></rect>`;bottom-=h; });
    const label=new Date(day.date+'T00:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'});
    svg+=`<text x="${x+19}" y="184" text-anchor="middle">${esc(label)}</text>`;
  });
  return `<svg viewBox="0 0 680 200" role="img" aria-label="Event counts by severity across the latest seven days">${svg}</svg>`;
}
function overviewView(data) {
  const total=data.events;
  let angle=0; const stops=Object.keys(colors).map(key=>{ const start=angle;angle+=total?(data.severity[key]||0)/total*100:0;return `${colors[key]} ${start}% ${angle}%`; }).join(',');
  return heading('SECURITY OVERVIEW','See the signal. Follow the trace.','A clearer picture of account activity, unusual behavior, and what needs attention.')+`
  <section class="metrics" aria-label="Security metrics">
    <article class="metric"><div class="metric-label">Active alerts${icon('shield')}</div><div class="metric-number">${fmt(data.active_alerts)}</div><div class="metric-foot"><span class="highlight">${fmt(data.active_alerts)} awaiting review</span> · risk ≥ 65</div></article>
    <article class="metric"><div class="metric-label">Critical signals${icon('alert')}</div><div class="metric-number">${fmt(data.critical_alerts)}</div><div class="metric-foot">Highest-priority unresolved events</div></article>
    <article class="metric"><div class="metric-label">Events analyzed${icon('pulse')}</div><div class="metric-number">${fmt(total)}</div><div class="metric-foot"><span class="mint">${fmt(data.demo_events)} synthetic</span> · all stored events</div></article>
    <article class="metric"><div class="metric-label">Accounts observed${icon('users')}</div><div class="metric-number">${fmt(data.accounts)}</div><div class="metric-foot">${fmt(data.resolved_alerts)} alerts resolved by analyst</div></article>
  </section>
  <section class="chart-layout">
    <article class="panel"><div class="panel-heading"><div><h2>Activity at a glance</h2><p class="panel-subtitle">All observed events, grouped by risk</p></div><span class="period">${icon('clock')}Latest 7 days</span></div><div class="chart-legend"><span><i class="legend-dot" style="background:${colors.low}"></i>Within baseline</span><span><i class="legend-dot" style="background:${colors.medium}"></i>Medium</span><span><i class="legend-dot" style="background:${colors.high}"></i>High</span><span><i class="legend-dot" style="background:${colors.critical}"></i>Critical</span></div><div class="activity-chart">${activityChart(data.activity)}</div><div class="chart-note">${icon('pulse')}Window ends at the latest stored event · all times UTC</div></article>
    <article class="panel distribution-panel"><div class="panel-heading"><div><h2>Signal distribution</h2><p class="panel-subtitle">Across ${fmt(total)} analyzed events</p></div></div><div class="distribution"><div class="donut" style="background:${total?`conic-gradient(${stops})`:'#24333d'}"><div class="donut-label"><b>${fmt(total)}</b><small>total events</small></div></div></div><div class="distribution-list">${Object.keys(colors).reverse().map(key=>`<div class="distribution-row"><span><i class="legend-dot" style="background:${colors[key]}"></i>${key==='low'?'Low risk':title(key)}</span><strong>${data.severity[key]||0}</strong><span class="pct">${total?Math.round((data.severity[key]||0)/total*100):0}%</span></div>`).join('')}</div></article>
  </section>
  <section class="panel"><div class="panel-heading queue-heading"><div><h2>Priority queue <span style="color:#6c8494;font-weight:400;margin-left:5px">/ ${data.active_alerts}</span></h2><p class="panel-subtitle">Your highest-risk unresolved signals</p></div><a class="link-button" href="#alerts">View alert inbox${icon('arrow')}</a></div><div class="table-wrap"><table>${tableHead()}<tbody>${data.top_alerts.map(e=>row(e)).join('') || `<tr><td colspan="6"><div class="empty"><h3>All clear for now.</h3><p>No unresolved alerts. Import events or explore existing activity.</p></div></td></tr>`}</tbody></table></div><div class="queue-footer"><span>Showing <b>${data.top_alerts.length}</b> of <b>${data.active_alerts}</b> active alerts</span><span class="muted-foot">Ranked by risk score, then event time</span></div></section>
  <div class="mini-insight">${icon('layers')}<span>A score should start an investigation, not finish one. Every alert includes its underlying context.</span><a href="#model">Inside the model ↗</a></div>`;
}
function listView() {
  const alerts=state.route==='alerts';
  return heading(alerts?'ALERT INBOX':'ACTIVITY EXPLORER',alerts?'Investigate with context.':'Every event leaves a trace.',alerts?'Inspect the signals, record your findings, and keep a clear investigation history.':'Search account activity and inspect the telemetry behind each risk score.')+`
  <section class="panel"><div class="filter-bar"><label class="search-field" aria-label="Search events">${icon('search')}<input id="event-search" type="search" maxlength="100" placeholder="Search accounts, IP addresses, countries…" value="${esc(state.search)}"></label><select id="severity-filter" aria-label="Filter severity"><option value="">All severity levels</option>${(alerts?['critical','high','medium']:['critical','high','medium','low']).map(s=>`<option value="${s}" ${state.severity===s?'selected':''}>${title(s)}</option>`).join('')}</select>${alerts?`<select id="status-filter" aria-label="Filter alert status"><option value="">All statuses</option>${['open','investigating','resolved'].map(s=>`<option value="${s}" ${state.status===s?'selected':''}>${title(s)}</option>`).join('')}</select>`:''}</div><div class="table-wrap" id="table-content"><div class="loading"><span class="spinner"></span>Reading activity…</div></div><div class="queue-footer" id="table-footer"></div></section><div class="mini-insight">${icon('shield')}<span>${alerts?'Alert threshold: risk score ≥ 65. Context signals describe rule triggers, not model feature attribution.':'All included sample accounts and IP addresses are fictional. Imported rows are labelled separately in the event inspector.'}</span></div>`;
}
async function refreshList() {
  const request=++state.request;
  try {
    const data=await api('/api/events?'+params());
    if(request!==state.request || !['alerts','events'].includes(state.route))return;
    $('#table-content').innerHTML=`<table>${tableHead()}<tbody>${data.items.map(e=>row(e,state.route==='events')).join('') || `<tr><td colspan="6"><div class="empty">${icon('search')}<h3>No matching ${state.route==='alerts'?'alerts':'events'}.</h3><p>Try another search or clear your filters.</p><button class="button secondary" data-action="clear-filters">Clear filters</button></div></td></tr>`}</tbody></table>`;
    $('#table-footer').innerHTML=`<span>${data.total?`Showing <b>${state.offset+1}–${state.offset+data.items.length}</b> of <b>${fmt(data.total)}</b>`:'0 results'} <span class="muted-foot">· sorted by event time</span></span><div class="pagination"><button data-page="previous" ${state.offset===0?'disabled':''} aria-label="Previous page">← Previous</button><button data-page="next" ${state.offset+state.limit>=data.total?'disabled':''} aria-label="Next page">Next →</button></div>`;
    $('#export-link').href='/api/export?'+params();
  } catch(error) { if(request===state.request && $('#table-content'))$('#table-content').innerHTML=errorBlock(error); }
}
function modelView(model) {
  const pct=n=>(n*100).toFixed(1)+'%';
  return heading('DETECTION MODEL','Understand the decision.','An inspectable baseline, explicit context rules, and a reproducible synthetic evaluation.')+`
  <section class="model-grid"><article class="panel model-card"><div class="model-icon">${icon('layers')}</div><span class="eyebrow">HYBRID ANOMALY DETECTION</span><h2 style="margin-top:13px">Isolation Forest + context</h2><p>${esc(model.method)}</p><div class="model-kv"><span>Training baseline</span><strong>${fmt(model.training_events)} clean synthetic events</strong></div><div class="model-kv"><span>Calibration set</span><strong>${fmt(model.calibration_events)} separate clean events</strong></div><div class="model-kv"><span>Alert threshold</span><strong>≥ ${model.threshold} / 100</strong></div><div class="model-kv"><span>Reproducibility</span><strong>Fixed training seed · ${model.seed}</strong></div></article>
  <article class="panel model-card"><span class="eyebrow">CONTROLLED SYNTHETIC EVALUATION</span><h2 style="margin-top:13px">Measure the prototype.</h2><p>A held-out generated set of ${model.evaluation_events} events, including ${model.evaluation_anomalies} injected anomalies. Evaluation uses risk ≥ ${model.threshold}.</p><div class="benchmark"><div><b>${pct(model.precision)}</b><small>Precision</small></div><div><b>${pct(model.recall)}</b><small>Recall</small></div><div><b>${pct(model.f1)}</b><small>F1 score</small></div></div><div class="notice">${esc(model.limitations)}</div><a href="/api/model" target="_blank" rel="noopener" class="link-button" style="margin-top:19px">Inspect evaluation metadata${icon('arrow')}</a></article>
  <article class="panel model-card"><h2>Six inputs. Visible assumptions.</h2><p>Numerical counts are log-transformed. Account countries are learned only from the clean training baseline.</p><div class="feature-list">${model.features.map(f=>`<div class="feature-item">${esc(f)}</div>`).join('')}</div></article>
  <article class="panel model-card"><h2>Context makes it actionable.</h2><p>Rule points are added to the calibrated anomaly percentile. These are explicit context checks, not SHAP or causal explanations.</p><div class="model-kv"><span>≥ 10 failed attempts</span><strong>+35</strong></div><div class="model-kv"><span>≥ 500 MB outbound</span><strong>+35</strong></div><div class="model-kv"><span>New device / unfamiliar country</span><strong>+20 each</strong></div><div class="model-kv"><span>Unknown account</span><strong>+15</strong></div><div class="model-kv"><span>Outside 08:00–20:00 UTC</span><strong>+10</strong></div><p>Context points are capped at 65. A high score warrants analyst review; it does not establish malicious intent.</p></article>
  <article class="panel model-wide"><h2>From event to investigation</h2><div class="pipeline"><div class="pipeline-step"><b>01 / Validate</b><small>CSV schema, typed fields, size limits</small></div>${icon('arrow')}<div class="pipeline-step"><b>02 / Score</b><small>Feature transforms + hybrid risk</small></div>${icon('arrow')}<div class="pipeline-step"><b>03 / Investigate</b><small>Signals, telemetry, analyst notes</small></div>${icon('arrow')}<div class="pipeline-step"><b>04 / Persist</b><small>SQLite records + triage audit trail</small></div></div><p class="muted">Single-analyst local application. Organization-specific baselines, authentication, drift monitoring, and real-world validation are future work.</p></article></section>`;
}
async function updateOverview() { state.overview=await api('/api/overview');$('#alert-count').textContent=state.overview.active_alerts;return state.overview; }
async function render() {
  const route=location.hash.slice(1) || 'overview';
  state.route=['overview','alerts','events','model'].includes(route)?route:'overview';
  const request=++state.request;
  const names={overview:'Overview',alerts:'Alert inbox',events:'Activity explorer',model:'Detection model'};
  $('#breadcrumb').textContent=names[state.route];
  document.title=names[state.route]+' · TraceGuard';
  document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===state.route;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('#sidebar').classList.remove('open');
  $('#main').innerHTML='<div class="loading"><span class="spinner"></span>Connecting the dots…</div>';
  try {
    const data=await updateOverview();
    if(request!==state.request)return;
    if(state.route==='overview')$('#main').innerHTML=overviewView(data);
    else if(state.route==='model') {const model=await api('/api/model');if(request!==state.request)return;$('#main').innerHTML=modelView(model);}
    else {$('#main').innerHTML=listView();await refreshList();}
    $('#main').classList.remove('view-enter');void $('#main').offsetWidth;$('#main').classList.add('view-enter');
  } catch(error) { if(request===state.request)$('#main').innerHTML=errorBlock(error); }
}
function renderDetail(event) {
  const modal=$('#detail-modal');modal.dataset.identity=event.id;
  const isAlert=event.risk>=65;
  modal.innerHTML=`<div class="modal-top"><span class="eyebrow">${isAlert?'ALERT INVESTIGATION':'EVENT INSPECTOR'}</span><button class="icon-button" data-close="detail-modal" aria-label="Close investigation">${icon('close')}</button></div><p class="drawer-label">${esc(event.id)}</p><h2>${esc(event.user)}</h2><p class="muted" style="margin-top:4px">${esc(stamp(event.timestamp))} · ${esc(event.source==='synthetic-demo'?'Synthetic demo event':'Imported CSV event')}</p>
  <div class="detail-risk" style="border-color:${colors[event.severity]}55;background:${colors[event.severity]}08"><b style="color:${colors[event.severity]}">${event.risk}</b><div><p>${esc(title(event.severity))} risk ranking</p><small>${event.anomaly_percentile}th anomaly percentile · not a probability</small></div><span style="margin-left:auto">${isAlert?statusPill(event.status):''}</span></div>
  <h3>Context signals <span style="color:#6c8796">/ ${event.signals.length}</span></h3><div class="signals">${event.signals.map(s=>`<article class="signal">${icon('alert')}<div><b>${esc(s.label)}</b><p>${esc(s.detail)}</p></div></article>`).join('')||'<p class="muted">No contextual rule thresholds were triggered.</p>'}</div><p style="font-size:9px;color:#67818f;line-height:1.6">These describe rule triggers; they are not individual feature contributions to the Isolation Forest.</p>
  <h3>Event telemetry</h3><div class="detail-grid">${[['Source IP',event.source_ip],['Country',event.country],['Device',event.device],['Outcome',event.outcome],['Failed attempts',event.failure_count],['Outbound data',fmt(event.data_out_mb)+' MB']].map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div>
  ${isAlert?`<h3>Analyst decision</h3><form class="triage-form" id="triage-form"><label>Status<select name="status">${['open','investigating','resolved'].map(s=>`<option value="${s}" ${event.status===s?'selected':''}>${title(s)}</option>`).join('')}</select></label><label>Investigation note<textarea name="note" maxlength="2000" placeholder="What did you find? Record the reasoning behind your decision."></textarea></label><p id="triage-message" class="form-message" role="status" style="margin:0"></p><button class="button primary" type="submit">${icon('check')}Save decision</button></form><h3>Investigation history</h3><div class="audit"><div class="audit-entry"><b>Signal detected</b><time>${esc(stamp(event.timestamp))}</time><p>Risk score ${event.risk}. Initial status: Open.</p></div>${event.audit.map(a=>`<div class="audit-entry"><b>${esc(title(a.old_status))} → ${esc(title(a.new_status))}</b><time>${esc(stamp(a.timestamp))}</time>${a.note?`<p>${esc(a.note)}</p>`:''}</div>`).join('')}</div>`:''}`;
  modal.scrollTop=0;
}
async function openDetail(identity) {
  const modal=$('#detail-modal');modal.dataset.identity=identity;modal.innerHTML='<div class="loading"><span class="spinner"></span>Opening investigation…</div>';if(!modal.open)modal.showModal();
  try { const event=await api('/api/events/'+encodeURIComponent(identity));if(modal.open && modal.dataset.identity===identity)renderDetail(event); } catch(error) { modal.innerHTML=errorBlock(error)+`<button class="button secondary" data-close="detail-modal">Close</button>`; }
}
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-close]');if(close)$('#'+close.dataset.close).close();
  const review=event.target.closest('[data-review]');if(review)openDetail(review.dataset.review);
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='import') {$('#import-message').textContent='';$('#import-form').reset();$('#file-name').textContent='Up to 2 MB · 5,000 rows';$('#import-modal').showModal();}
  if(action==='retry')render();
  if(action==='clear-filters') {state.search='';state.severity='';state.status='';state.offset=0;render();}
  const page=event.target.closest('[data-page]');if(page && !page.disabled) {state.offset=Math.max(0,state.offset+(page.dataset.page==='next'?1:-1)*state.limit);refreshList();}
});
let searchTimer;
document.addEventListener('input',event=>{
  if(event.target.id==='event-search') {clearTimeout(searchTimer);state.search=event.target.value;state.offset=0;searchTimer=setTimeout(refreshList,250);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='severity-filter') {state.severity=event.target.value;state.offset=0;refreshList();}
  if(event.target.id==='status-filter') {state.status=event.target.value;state.offset=0;refreshList();}
  if(event.target.id==='csv-file')$('#file-name').textContent=event.target.files[0]?.name || 'Up to 2 MB · 5,000 rows';
});
$('#menu-button').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#main').addEventListener('click',()=>$('#sidebar').classList.remove('open'));
$('#import-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#import-submit');button.disabled=true;button.textContent='Analyzing…';const message=$('#import-message');message.classList.remove('success');message.textContent='';
  try {const data=await api('/api/import',{method:'POST',body:new FormData(event.target)});$('#import-modal').close();toast(`${fmt(data.inserted)} events imported · ${fmt(data.duplicates)} duplicates skipped`);await render();}
  catch(error) {message.textContent=error.message;}
  finally {button.disabled=false;button.innerHTML='Analyze events'+icon('arrow');}
});
$('#detail-modal').addEventListener('submit',async event=>{
  if(event.target.id!=='triage-form')return;event.preventDefault();const form=event.target;const button=$('button[type="submit"]',form);button.disabled=true;
  const identity=$('#detail-modal').dataset.identity;
  try {const data=await api('/api/alerts/'+encodeURIComponent(identity),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});if($('#detail-modal').open && $('#detail-modal').dataset.identity===identity)renderDetail(data);await render();toast('Decision saved to the investigation history');}
  catch(error) {const message=$('#triage-message');if(message)message.textContent=error.message;button.disabled=false;}
});
window.addEventListener('hashchange',()=>{clearTimeout(searchTimer);state.search='';state.severity='';state.status='';state.offset=0;render();});
render();
