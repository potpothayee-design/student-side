// Student home: wallet, menu, cart and checkout (Workflow steps 1–4).
let me = null;
let menu = [];
let category = 'All';
const cart = new Map(JSON.parse(sessionStorage.getItem('cart') || '[]')); // menu_item_id -> qty

const saveCart = () => sessionStorage.setItem('cart', JSON.stringify([...cart]));

async function loadMe() {
  me = await api('/api/auth/me');
  $('#userName').textContent = `${me.full_name} · ${me.login_id}`;
  $('#balance').textContent = peso(me.balance_cents);
  $('#walletHint').textContent = me.is_demo
    ? 'Demo account: pre-loaded ₱1,000 for the presentation.'
    : 'Top up with cash at the school cashier.';

  const limit = me.settings.no_show_limit;
  if (me.is_suspended) {
    $('#suspendedAlert').innerHTML = `<div class="alert error">
      <b>Pre-ordering is suspended</b> until ${esc(fmtDateTime(me.suspended_until))} because of ${limit} no-shows in a row.
      You can still buy in person at the canteen counter. The suspension lifts automatically.</div>`;
  } else {
    $('#suspendedAlert').innerHTML = '';
  }
}

async function loadActiveOrders() {
  const { orders } = await api('/api/orders');
  const active = orders.filter((o) => ['placed', 'preparing', 'ready'].includes(o.status));
  const limit = me.settings.no_show_limit;
  const strikes = me.consecutive_no_shows;
  $('#statusCard').innerHTML = `
    <div class="row between"><h3 style="margin:0">Your orders</h3><a href="/orders.html" class="btn secondary sm">View all</a></div>
    ${active.length
      ? active.slice(0, 3).map((o) => `
          <div class="row between" style="margin-top:10px">
            <span><span class="mono" style="font-weight:700">${esc(o.order_code)}</span>
              <small> · ${esc(o.slot_label || '')} ${o.slot_start ? fmtTime(o.slot_start) : ''}</small></span>
            ${statusBadge(o.status)}
          </div>`).join('')
      : '<p class="muted" style="margin-top:10px">No active orders right now.</p>'}
    <div class="divider"></div>
    <small>No-show strikes: <b>${strikes}</b> of ${limit} in a row
      ${strikes > 0 && !me.is_suspended ? ' · picking up your next order resets this to 0' : ''}</small>`;
}

async function loadMenu() {
  menu = await api('/api/menu');
  const cats = ['All', ...new Set(menu.map((m) => m.category))];
  $('#categoryChips').innerHTML = cats
    .map((c) => `<button class="chip ${c === category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('');
  // drop cart entries that are no longer on the menu
  for (const id of [...cart.keys()]) if (!menu.find((m) => m.id === id)) cart.delete(id);
  renderMenu();
  renderCart();
}

function renderMenu() {
  const items = menu.filter((m) => category === 'All' || m.category === category);
  if (!items.length) {
    $('#menuGrid').innerHTML = '<div class="glass-card empty">No items available right now.</div>';
    return;
  }
  $('#menuGrid').innerHTML = items.map((m) => {
    const inCart = cart.get(m.id) || 0;
    const soldOut = m.stock <= 0;
    const stockText = soldOut
      ? '<span class="badge danger">Out of stock</span>'
      : m.stock <= 10
        ? `<span class="badge warn">Only ${m.stock} left</span>`
        : `<span class="badge neutral">${m.stock} available</span>`;
    return `
      <article class="glass-card menu-item ${soldOut ? 'soldout' : ''}">
        <div class="photo">${m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.name)}" loading="lazy">` : esc(m.name.charAt(0))}</div>
        <div class="body">
          <div class="name">${esc(m.name)}</div>
          ${m.description ? `<small>${esc(m.description)}</small>` : ''}
          <div>${stockText}</div>
          <div class="spacer"></div>
          <div class="row between">
            <span class="price">${peso(m.price_cents)}</span>
            ${inCart
              ? `<span class="qty">
                   <button class="icon-btn" data-dec="${m.id}" aria-label="Remove one">−</button>
                   <span>${inCart}</span>
                   <button class="icon-btn" data-inc="${m.id}" aria-label="Add one" ${inCart >= Math.min(m.stock, 10) ? 'disabled' : ''}>+</button>
                 </span>`
              : `<button class="btn sm" data-inc="${m.id}" ${soldOut ? 'disabled' : ''}>Add</button>`}
          </div>
        </div>
      </article>`;
  }).join('');
}

function cartTotals() {
  let count = 0, total = 0;
  for (const [id, q] of cart) {
    const m = menu.find((x) => x.id === id);
    if (m) { count += q; total += m.price_cents * q; }
  }
  return { count, total };
}

function renderCart() {
  const { count, total } = cartTotals();
  $('#cartBar').classList.toggle('hidden', count === 0);
  $('#cartCount').textContent = `${count} item${count === 1 ? '' : 's'}`;
  $('#cartTotal').textContent = peso(total);
  saveCart();
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-cat]');
  if (chip) { category = chip.dataset.cat; $$('.chip').forEach((c) => c.classList.toggle('active', c === chip)); renderMenu(); return; }
  const inc = e.target.closest('[data-inc]');
  const dec = e.target.closest('[data-dec]');
  if (inc) {
    const id = Number(inc.dataset.inc);
    const m = menu.find((x) => x.id === id);
    const q = (cart.get(id) || 0) + 1;
    if (m && q <= Math.min(m.stock, 10)) cart.set(id, q);
  } else if (dec) {
    const id = Number(dec.dataset.dec);
    const q = (cart.get(id) || 0) - 1;
    if (q <= 0) cart.delete(id); else cart.set(id, q);
  } else return;
  renderMenu();
  renderCart();
});

$('#clearCart').addEventListener('click', () => { cart.clear(); renderMenu(); renderCart(); });

// ---------- Checkout ----------
$('#checkoutBtn').addEventListener('click', async () => {
  if (me.is_suspended) {
    return modal({ title: 'Pre-ordering suspended', html: `<p>You can pre-order again after ${esc(fmtDateTime(me.suspended_until))}. Please buy in person at the counter for now.</p>` });
  }
  let slots;
  try { slots = await api('/api/slots'); } catch (err) { return toast(err.message, 'error'); }
  await loadMe(); // fresh balance
  const { total } = cartTotals();
  const enough = me.balance_cents >= total;
  const firstOpen = slots.find((s) => s.is_open);

  const itemsHtml = [...cart].map(([id, q]) => {
    const m = menu.find((x) => x.id === id);
    return `<li><span>${q} × ${esc(m.name)}</span><span>${peso(m.price_cents * q)}</span></li>`;
  }).join('');

  const slotsHtml = slots.length
    ? slots.map((s) => `
        <label class="slot-option ${s.is_open ? '' : 'closed'} ${firstOpen && s.id === firstOpen.id ? 'selected' : ''}">
          <span>
            <input type="radio" name="slot" value="${s.id}" ${s.is_open ? '' : 'disabled'}
              ${firstOpen && s.id === firstOpen.id ? 'checked' : ''} style="display:none">
            <b>${esc(s.label)}</b><br><small>${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}</small>
          </span>
          <small>${s.is_open ? `Order by ${fmtTime(s.order_by)}` : 'Closed'}</small>
        </label>`).join('')
    : '<p class="muted">No pickup slots are set up yet.</p>';

  const html = `
    <ul class="order-items">${itemsHtml}</ul>
    <div class="divider"></div>
    <div class="row between"><b>Total</b><b>${peso(total)}</b></div>
    <div class="row between"><span class="muted">Wallet balance</span><span>${peso(me.balance_cents)}</span></div>
    <div class="row between"><span class="muted">Balance after</span><span>${enough ? peso(me.balance_cents - total) : '—'}</span></div>
    ${enough ? '' : '<div class="alert error" style="margin-top:12px">Insufficient balance: please top up at the school cashier.</div>'}
    <h3 style="margin-top:16px">Pickup time slot</h3>
    <div class="slot-list">${slotsHtml}</div>
    ${firstOpen ? '' : '<div class="alert warn" style="margin-top:10px">All slots for today are closed for ordering.</div>'}
    <p class="muted" style="font-size:0.82rem;margin-top:12px">
      Paying deducts ${peso(total)} from your wallet now. You can cancel within
      <b>${me.settings.cancel_window_minutes} minutes</b> for a full refund.
      Unclaimed orders after lunch are marked No-Show and are <b>not refunded</b>.
    </p>
    <div id="checkoutMsg"></div>`;

  const slotId = await modal({
    title: 'Review your order',
    html,
    buttons: [
      { label: 'Back', value: null, class: 'secondary' },
      {
        label: `Confirm & Pay ${peso(total)}`,
        validate: (root) => {
          if (!enough) { showError($('#checkoutMsg', root), 'Insufficient balance: please top up at the school cashier.'); return false; }
          if (!$('input[name=slot]:checked', root)) { showError($('#checkoutMsg', root), 'Please choose a pickup slot.'); return false; }
          return true;
        },
        collect: (root) => Number($('input[name=slot]:checked', root).value),
      },
    ],
    onOpen: (root) => {
      $$('.slot-option', root).forEach((opt) => opt.addEventListener('click', () => {
        const input = $('input', opt);
        if (input.disabled) return;
        input.checked = true;
        $$('.slot-option', root).forEach((o) => o.classList.toggle('selected', o === opt));
      }));
    },
  });
  if (!slotId) return;

  try {
    const order = await api('/api/orders', {
      method: 'POST',
      body: { slot_id: slotId, items: [...cart].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity })) },
    });
    cart.clear();
    saveCart();
    location.href = `/orders.html?new=${order.id}`;
  } catch (err) {
    toast(err.message, 'error');
    loadMenu(); loadMe();
  }
});

(async function init() {
  try {
    await loadMe();
    await Promise.all([loadMenu(), loadActiveOrders()]);
    markActiveNav();
    // keep stock levels live
    setInterval(() => { loadMenu().catch(() => {}); }, 30000);
  } catch (err) {
    toast(err.message, 'error');
  }
})();
