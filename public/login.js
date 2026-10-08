const form = document.getElementById('login-form');
const error = document.getElementById('login-error');
const submit = document.getElementById('login-submit');
const password = document.getElementById('password');
submit.disabled = location.protocol !== 'https:';
if (submit.disabled) error.textContent = 'Open WAVE via je beveiligde HTTPS-adres.';
fetch('/auth/status', { cache: 'no-store' }).then(r => r.json()).then(status => {
  if (!status.enabled || status.authenticated) location.replace('/');
}).catch(() => {});
form.addEventListener('submit', async event => {
  event.preventDefault(); error.textContent = ''; submit.disabled = true;
  try {
    if (location.protocol !== 'https:') throw new Error('Open WAVE via je beveiligde HTTPS-adres.');
    const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Inloggen mislukt.');
    password.value = ''; location.replace('/');
  } catch (failure) { error.textContent = failure.message || 'Geen verbinding. Probeer opnieuw.'; }
  finally { submit.disabled = false; }
});
