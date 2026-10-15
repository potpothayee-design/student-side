(async function () {
  try {
    const me = await api('/api/auth/me');
    $('#who').textContent = `${me.full_name} · ${me.login_id}`;
    const w = await api('/api/wallet');
    $('#balance').textContent = peso(w.balance_cents);
    $('#txns').innerHTML = w.transactions.length
      ? `<table>
          <thead><tr><th>Date</th><th>Type</th><th class="hide-mobile">Details</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead>
          <tbody>${w.transactions.map((t) => `
            <tr>
              <td>${fmtDateTime(t.created_at)}</td>
              <td>${esc(TXN_LABELS[t.type] || t.type)}</td>
              <td class="hide-mobile"><small>${esc(t.reason || '')}${t.receipt_no ? ` · Receipt ${esc(t.receipt_no)}` : ''}</small></td>
              <td class="num ${t.amount_cents >= 0 ? 'amount-pos' : 'amount-neg'}">${signedPeso(t.amount_cents)}</td>
              <td class="num">${peso(t.balance_after_cents)}</td>
            </tr>`).join('')}</tbody>
        </table>`
      : '<div class="empty">No transactions yet. Top up at the school cashier to get started.</div>';
    markActiveNav();
  } catch (err) { toast(err.message, 'error'); }
})();

$('#changePw').addEventListener('click', async () => {
  const data = await modal({
    title: 'Change password',
    html: `<div class="field"><label>Current password</label><input type="password" id="cpw"></div>
           <div class="field"><label>New password (min. 6)</label><input type="password" id="npw"></div><div id="pwmsg"></div>`,
    buttons: [
      { label: 'Cancel', value: null, class: 'secondary' },
      { label: 'Save', collect: (r) => ({ current_password: $('#cpw', r).value, new_password: $('#npw', r).value }) },
    ],
  });
  if (!data) return;
  try { await api('/api/auth/change-password', { method: 'POST', body: data }); toast('Password changed.'); }
  catch (err) { toast(err.message, 'error'); }
});
