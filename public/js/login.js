const msg = $('#msg');
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#loginForm').classList.toggle('hidden', b.dataset.tab !== 'login');
  $('#registerForm').classList.toggle('hidden', b.dataset.tab !== 'register');
  showError(msg, '');
}));

// Already logged in? Go to home.
api('/api/auth/me', { noRedirect: true }).then(() => (location.href = '/')).catch(() => {});

$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.submitter;
  withBusy(btn, async () => {
    try {
      await api('/api/auth/login', { method: 'POST', body: { login_id: $('#loginId').value, password: $('#loginPw').value }, noRedirect: true });
      location.href = '/';
    } catch (err) { showError(msg, err.message); }
  });
});

$('#registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('#regPw').value !== $('#regPw2').value) return showError(msg, 'Passwords do not match.');
  const btn = e.submitter;
  withBusy(btn, async () => {
    try {
      await api('/api/auth/register', {
        method: 'POST', noRedirect: true,
        body: { school_id: $('#regId').value, full_name: $('#regName').value, password: $('#regPw').value },
      });
      location.href = '/';
    } catch (err) { showError(msg, err.message); }
  });
});
