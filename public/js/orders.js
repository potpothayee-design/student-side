// Student order tracking, cancellation, confirmation and pickup QR.
let orders = [];
let serverOffset = 0;
let refreshing = false;

function canCancel(order) {
  return order.status === 'placed' && new Date(order.cancel_deadline).getTime() > Date.now() + serverOffset;
}

function renderOrders() {
  const active = orders.filter((o) => ['placed', 'preparing', 'ready'].includes(o.status));
  const history = orders.filter((o) => !['placed', 'preparing', 'ready'].includes(o.status));

  $('#activeList').innerHTML = active.length ? active.map((o) => `
    <article class="glass-card">
      <div class="row between"><h3 class="mono">${esc(o.order_code)}</h3>${statusBadge(o.status)}</div>
      <p class="muted">${esc(fmtDate(o.order_date))} · ${esc(o.slot_label || 'Pickup')}
        ${o.slot_start ? `${fmtTime(o.slot_start)} – ${fmtTime(o.slot_end)}` : ''}</p>
      <ul class="order-items">${o.items.map((item) => `
        <li><span>${item.quantity} × ${esc(item.name)}</span><span>${peso(item.line_total_cents)}</span></li>
      `).join('')}</ul>
      <div class="row between"><b>Total paid</b><b>${peso(o.total_cents)}</b></div>
      ${canCancel(o) ? `
        <p class="muted">Cancel for a full refund within <b data-deadline="${esc(o.cancel_deadline)}"></b>,
          or confirm now to start preparation.</p>
        <div class="row">
          <button class="btn secondary sm" data-action="cancel" data-id="${o.id}">Cancel order</button>
          <button class="btn sm" data-action="confirm-now" data-id="${o.id}">Confirm now</button>
        </div>` : '<p class="muted">This order is locked in and can no longer be cancelled.</p>'}
      <button class="btn secondary sm" data-action="qr" data-id="${o.id}">Show pickup QR</button>
    </article>`).join('') : '<div class="glass-card empty">No active orders. Choose something from the menu to get started.</div>';

  $('#historyList').innerHTML = history.length ? `
    <table>
      <thead><tr><th>Order</th><th>Date</th><th>Status</th><th class="num">Total</th></tr></thead>
      <tbody>${history.map((o) => `
        <tr><td class="mono">${esc(o.order_code)}</td><td>${esc(fmtDateTime(o.placed_at))}</td>
          <td>${statusBadge(o.status)}</td><td class="num">${peso(o.total_cents)}</td></tr>`).join('')}</tbody>
    </table>` : '<div class="empty">Your completed, cancelled and no-show orders will appear here.</div>';
  updateCountdowns();
}

function updateCountdowns() {
  let expired = false;
  $$('[data-deadline]').forEach((el) => {
    const seconds = Math.max(0, Math.ceil((new Date(el.dataset.deadline).getTime() - Date.now() - serverOffset) / 1000));
    el.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (seconds === 0) expired = true;
  });
  // Hide cancellation controls immediately; the server remains authoritative.
  if (expired) renderOrders();
}

async function loadOrders() {
  if (refreshing) return;
  refreshing = true;
  try {
    const data = await api('/api/orders');
    orders = data.orders;
    serverOffset = new Date(data.server_time).getTime() - Date.now();
    renderOrders();
  } finally {
    refreshing = false;
  }
}

$('#activeList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  await withBusy(button, async () => {
    try {
      const { action, id } = button.dataset;
      if (action === 'qr') {
        const data = await api(`/api/orders/${id}/qr`);
        await modal({
          title: `Pickup · ${data.order_code}`,
          html: `<p>Show this QR code to the canteen staff when collecting your order.</p>
            <img src="${esc(data.qr)}" alt="Pickup QR code for ${esc(data.order_code)}" width="280" height="280">
            <p class="mono">${esc(data.order_code)}</p>`,
        });
        return;
      }
      const cancel = action === 'cancel';
      const confirmed = await confirmModal(
        cancel ? 'Cancel order?' : 'Confirm order now?',
        cancel ? 'Your full payment will be refunded to your wallet.' : 'Preparation will start and this order can no longer be cancelled.',
        cancel ? 'Cancel order' : 'Confirm now'
      );
      if (!confirmed) return;
      await api(`/api/orders/${id}/${action}`, { method: 'POST' });
      toast(cancel ? 'Order cancelled. Your wallet has been refunded.' : 'Order confirmed.');
      await loadOrders();
    } catch (err) {
      toast(err.message, 'error');
      loadOrders().catch(() => {});
    }
  });
});

(async function init() {
  markActiveNav();
  try {
    await loadOrders();
    const newId = new URLSearchParams(location.search).get('new');
    if (orders.some((o) => String(o.id) === newId)) {
      $('#newAlert').innerHTML = '<div class="alert success">Order placed and paid from your wallet. Track it here and show your QR code at pickup.</div>';
    }
    setInterval(updateCountdowns, 1000);
    setInterval(() => loadOrders().catch(() => {}), 15000);
  } catch (err) {
    showError($('#newAlert'), err.message);
  }
})();
