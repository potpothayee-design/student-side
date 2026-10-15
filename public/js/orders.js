// Student orders: status tracking, 10-minute cancel window, Confirm Now, pickup QR
// (Workflow steps 5–9).
let me = null;
let orders = [];
let clockOffset = 0; // server time - browser time (ms), so countdowns are accurate

const STEPS = ['placed', 'preparing', 'ready', 'completed'];
const nowServer = () => Date.now() + clockOffset;

function manilaHHMM(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

function activeCard(o) {
  const step = STEPS.indexOf(o.status);
  const items = o.items.map((i) => `<li><span>${i.quantity} × ${esc(i.name)}</span><span>${peso(i.line_total_cents)}</span></li>`).join('');
  const nowHHMM = manilaHHMM(nowServer());
  const missed = ['preparing', 'ready'].includes(o.status) && o.slot_end && nowHHMM > o.slot_end;

  let actions = '';
  let extra = '';
  if (o.status === 'placed') {
    extra = `
      <div class="alert warn" style="margin:10px 0">
        You can cancel${o.payment_method === 'wallet' ? ' for a full refund' : ''} for another <span class="countdown" data-deadline="${esc(o.cancel_deadline)}">--:--</span>.
        After that, the order is locked in automatically.
        <div class="progress" style="margin-top:8px"><div data-progress="${esc(o.cancel_deadline)}" data-start="${esc(o.placed_at)}"></div></div>
      </div>`;
    actions = `
      <button class="btn danger sm" data-cancel="${o.id}">Cancel order</button>
      <button class="btn sm" data-confirm="${o.id}">Confirm Now</button>`;
  } else if (o.status === 'preparing') {
    extra = `<p class="muted" style="margin:8px 0">The canteen is preparing your order${o.lock_method === 'confirm_now' ? ' (you confirmed early)' : ''}.</p>`;
    actions = `<button class="btn secondary sm" data-qr="${o.id}">Show pickup QR</button>`;
  } else if (o.status === 'ready') {
    extra = `<div class="alert success" style="margin:10px 0"><b>Ready for pickup!</b> Show your order number or QR at the counter.${o.payment_method === 'cash' ? ` Bring <b>${peso(o.total_cents)}</b> in cash.` : ''}</div>`;
    actions = `<button class="btn sm" data-qr="${o.id}">Show pickup QR</button>`;
  }
  if (missed) {
    extra += `<div class="alert warn" style="margin:10px 0">You missed your pickup slot. Your order is held until the end of lunch
      (${fmtTime(me.settings.lunch_end_time)}). Unclaimed orders become <b>No-Show</b>${o.payment_method === 'wallet' ? ' and are not refunded' : ' and count as a strike'}.</div>`;
  }

  return `
    <article class="glass-card order-card">
      <div class="row between">
        <span class="code">${esc(o.order_code)}</span>
        ${statusBadge(o.status)}
      </div>
      <small>${esc(o.slot_label || 'Walk-in')} ${o.slot_start ? `· ${fmtTime(o.slot_start)}–${fmtTime(o.slot_end)}` : ''} · ${fmtDate(o.order_date)}</small>
      <div class="timeline">${STEPS.map((s, i) => `<div class="step ${i <= step ? 'done' : ''}"></div>`).join('')}</div>
      <ul class="order-items">${items}</ul>
      ${o.payment_method === 'cash'
        ? `<div class="row between"><b>Pay in cash at pickup</b><b>${peso(o.total_cents)}</b></div>`
        : `<div class="row between"><b>Paid from wallet</b><b>${peso(o.total_cents)}</b></div>`}
      ${extra}
      <div class="row" style="margin-top:8px">${actions}</div>
    </article>`;
}

function render() {
  const active = orders.filter((o) => ['placed', 'preparing', 'ready'].includes(o.status));
  const past = orders.filter((o) => !['placed', 'preparing', 'ready'].includes(o.status));

  $('#activeList').innerHTML = active.length
    ? active.map(activeCard).join('')
    : '<div class="glass-card empty">No active orders. <a href="/">Browse the menu</a></div>';

  $('#historyList').innerHTML = past.length
    ? `<table>
        <thead><tr><th>Order</th><th>Date</th><th class="hide-mobile">Items</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${past.map((o) => `
          <tr>
            <td class="mono">${esc(o.order_code)}${o.is_walk_in ? ' <small>(walk-in)</small>' : ''}</td>
            <td>${fmtDateTime(o.placed_at)}</td>
            <td class="hide-mobile"><small>${o.items.map((i) => `${i.quantity}× ${esc(i.name)}`).join(', ')}</small></td>
            <td class="num">${peso(o.total_cents)}<br><small>${o.payment_method === 'cash' ? 'cash' : 'wallet'}</small></td>
            <td>${statusBadge(o.status)}${o.status === 'cancelled' && o.payment_method === 'wallet' ? ' <small>refunded</small>' : ''}${o.status === 'no_show' && o.payment_method === 'wallet' ? ' <small>forfeited</small>' : ''}</td>
          </tr>`).join('')}</tbody>
      </table>`
    : '<div class="empty">No past orders yet.</div>';

  tick();
}

// Update countdowns every second without re-rendering everything.
let refreshQueued = false;
function tick() {
  $$('[data-deadline]').forEach((el) => {
    const left = Math.max(0, new Date(el.dataset.deadline).getTime() - nowServer());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (left === 0 && !refreshQueued) { refreshQueued = true; setTimeout(() => { refreshQueued = false; load(); }, 1500); }
  });
  $$('[data-progress]').forEach((el) => {
    const start = new Date(el.dataset.start).getTime();
    const end = new Date(el.dataset.progress).getTime();
    const pct = Math.max(0, Math.min(100, ((end - nowServer()) / (end - start)) * 100));
    el.style.width = pct + '%';
  });
}

async function load() {
  const data = await api('/api/orders');
  clockOffset = new Date(data.server_time).getTime() - Date.now();
  orders = data.orders;
  render();
}

document.addEventListener('click', async (e) => {
  const cancelBtn = e.target.closest('[data-cancel]');
  const confirmBtn = e.target.closest('[data-confirm]');
  const qrBtn = e.target.closest('[data-qr]');

  if (cancelBtn) {
    const o = orders.find((x) => x.id === Number(cancelBtn.dataset.cancel));
    const ok = await confirmModal('Cancel this order?',
      o.payment_method === 'wallet'
        ? `Order <b>${esc(o.order_code)}</b> will be cancelled and <b>${peso(o.total_cents)}</b> refunded to your wallet.`
        : `Order <b>${esc(o.order_code)}</b> will be cancelled. Nothing was charged because it is a cash order.`,
      'Yes, cancel order', 'danger');
    if (!ok) return;
    withBusy(cancelBtn, async () => {
      try {
        const r = await api(`/api/orders/${o.id}/cancel`, { method: 'POST' });
        toast(r.payment_method === 'cash' ? 'Order cancelled.' : `Order cancelled. ${peso(r.refunded_cents)} refunded. New balance: ${peso(r.balance_cents)}`);
      } catch (err) { toast(err.message, 'error'); }
      load();
    });
  }

  if (confirmBtn) {
    const o = orders.find((x) => x.id === Number(confirmBtn.dataset.confirm));
    const ok = await confirmModal('Confirm now?',
      '<b>Once confirmed, this order can no longer be cancelled or refunded.</b><br>It will go straight to the kitchen for preparation.',
      'I understand, confirm', 'warning');
    if (!ok) return;
    withBusy(confirmBtn, async () => {
      try {
        await api(`/api/orders/${o.id}/confirm-now`, { method: 'POST' });
        toast('Order confirmed and sent for preparation.');
      } catch (err) { toast(err.message, 'error'); }
      load();
    });
  }

  if (qrBtn) {
    try {
      const r = await api(`/api/orders/${qrBtn.dataset.qr}/qr`);
      modal({
        title: 'Pickup QR',
        html: `<div class="qr-box"><img src="${r.qr}" alt="QR code for order ${esc(r.order_code)}">
               <div class="code mono" style="font-size:1.6rem;font-weight:700;letter-spacing:3px">${esc(r.order_code)}</div>
               <small>Show this at the canteen counter</small></div>`,
        buttons: [{ label: 'Close', value: true, class: 'secondary' }],
      });
    } catch (err) { toast(err.message, 'error'); }
  }
});

(async function init() {
  try {
    me = await api('/api/auth/me');
    await load();
    const newId = new URLSearchParams(location.search).get('new');
    if (newId) {
      const placed = orders.find((x) => String(x.id) === newId);
      $('#newAlert').innerHTML = placed && placed.payment_method === 'cash'
        ? `<div class="alert success"><b>Order placed. Pay ${peso(placed.total_cents)} in cash at pickup.</b>
            You have ${me.settings.cancel_window_minutes} minutes to cancel, or tap <b>Confirm Now</b> to send it to the kitchen right away.</div>`
        : `<div class="alert success"><b>Order placed and paid from your wallet.</b>
            You have ${me.settings.cancel_window_minutes} minutes to cancel for a full refund, or tap <b>Confirm Now</b> to send it to the kitchen right away.</div>`;
      history.replaceState(null, '', '/orders.html');
    }
    markActiveNav();
    setInterval(tick, 1000);
    setInterval(() => load().catch(() => {}), 10000); // live status updates
  } catch (err) { toast(err.message, 'error'); }
})();
