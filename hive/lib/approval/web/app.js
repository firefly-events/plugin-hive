/**
 * Vanilla JS client for the Approval Actions fallback dashboard (DOS-221).
 * No build step, no framework — talks to the same /api/approvals/* JSON API
 * the Multica dashboard micro-frontend and the MCP server read and write.
 */
'use strict';

let currentTab = 'pending';

function showTab(tab) {
  currentTab = tab;
  document.getElementById('tab-pending').classList.toggle('active', tab === 'pending');
  document.getElementById('tab-history').classList.toggle('active', tab === 'history');
  document.getElementById('view-pending').style.display = tab === 'pending' ? '' : 'none';
  document.getElementById('view-history').style.display = tab === 'history' ? '' : 'none';
  refresh();
}
window.showTab = showTab;

function flash(message, ok) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = ok ? 'ok' : 'err';
  setTimeout(() => { el.className = ''; }, 4000);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
  return body;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderPendingCard(p) {
  const isHumanGate = p.mode === 'human-gate';
  const contextJson = escapeHtml(JSON.stringify(p.actionContext, null, 2));
  let body = `
    <div class="card" data-id="${escapeHtml(p.id)}">
      <h3>${escapeHtml(p.actionType)} <span class="badge">${escapeHtml(p.mode)}</span></h3>
      <div class="meta">requested by ${escapeHtml(p.requestedBy)} at ${escapeHtml(p.requestedAt)} · id ${escapeHtml(p.id)}</div>
      <pre>${contextJson}</pre>
  `;
  if (isHumanGate) {
    body += `
      <input type="text" id="identity-${escapeHtml(p.id)}" placeholder="your identity (required)">
      <input type="text" id="note-${escapeHtml(p.id)}" placeholder="reasoning note (optional)">
      <button class="action approve" onclick="submitHumanGate('${p.id}', true)">Approve</button>
      <button class="action reject" onclick="submitHumanGate('${p.id}', false)">Reject</button>
    `;
  } else {
    body += `
      <p class="meta">Submit the complete verdict array for this ${escapeHtml(p.mode)} (one entry per quorum
      member / panel lens — partial submissions are rejected so a missing hard-veto lens can never be
      silently skipped).</p>
      <textarea id="verdicts-${escapeHtml(p.id)}" placeholder='[{"identity":"lens-id","approve":true,"reasoning":"...","hardVeto":false}]'></textarea>
      <button class="action submit-json" onclick="submitVerdicts('${p.id}')">Submit verdicts</button>
    `;
  }
  body += `</div>`;
  return body;
}

async function submitHumanGate(id, approve) {
  const approverIdentity = document.getElementById(`identity-${id}`).value.trim();
  const note = document.getElementById(`note-${id}`).value.trim();
  if (!approverIdentity) return flash('Identity is required.', false);
  try {
    await api('/api/approvals/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: id, approve, note, approverIdentity }),
    });
    flash(`Recorded ${approve ? 'approval' : 'rejection'}.`, true);
    refresh();
  } catch (err) {
    flash(err.message, false);
  }
}
window.submitHumanGate = submitHumanGate;

async function submitVerdicts(id) {
  const raw = document.getElementById(`verdicts-${id}`).value.trim();
  let verdicts;
  try {
    verdicts = JSON.parse(raw);
  } catch {
    return flash('Verdicts must be valid JSON.', false);
  }
  try {
    await api('/api/approvals/submit-verdicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId: id, verdicts }),
    });
    flash('Verdicts recorded.', true);
    refresh();
  } catch (err) {
    flash(err.message, false);
  }
}
window.submitVerdicts = submitVerdicts;

function renderHistoryCard(r) {
  const decisionBadge = r.decision.allowed
    ? '<span class="badge allowed">allowed</span>'
    : '<span class="badge denied">denied</span>';
  const passBadge = r.passCheck
    ? '<span class="badge allowed">pass</span>'
    : '<span class="badge denied">fail</span>';
  const verdictRows = (r.verdicts || []).map((v) => `
    <div>
      <span class="badge">${escapeHtml(v.identity)}</span>
      ${v.approve ? '<span class="badge allowed">approve</span>' : '<span class="badge denied">reject</span>'}
      ${v.hardVeto ? '<span class="badge veto">hard-veto</span>' : ''}
      ${v.reasoning ? `— ${escapeHtml(v.reasoning)}` : ''}
      ${v.note ? `— ${escapeHtml(v.note)}` : ''}
    </div>
  `).join('');
  return `
    <div class="card">
      <h3>${escapeHtml(r.actionType)} ${decisionBadge} ${passBadge}</h3>
      <div class="meta">method ${escapeHtml(r.method)} · approver ${escapeHtml(r.approverIdentity)} · ${escapeHtml(r.timestamp)} · approval ${escapeHtml(r.approvalId)}</div>
      ${verdictRows}
    </div>
  `;
}

async function refresh() {
  if (currentTab === 'pending') {
    const el = document.getElementById('view-pending');
    try {
      const pending = await api('/api/approvals/pending?status=pending');
      el.innerHTML = pending.length
        ? pending.map(renderPendingCard).join('')
        : '<p class="empty">No pending approvals.</p>';
    } catch (err) {
      el.innerHTML = `<p class="empty">Failed to load: ${escapeHtml(err.message)}</p>`;
    }
  } else {
    const el = document.getElementById('view-history');
    try {
      const records = await api('/api/approvals/audit-records');
      el.innerHTML = records.length
        ? records.map(renderHistoryCard).join('')
        : '<p class="empty">No resolved approvals yet.</p>';
    } catch (err) {
      el.innerHTML = `<p class="empty">Failed to load: ${escapeHtml(err.message)}</p>`;
    }
  }
}

refresh();
setInterval(refresh, 15000);
