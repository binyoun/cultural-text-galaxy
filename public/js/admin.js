// Galaxy admin: lists every star (newest first) so one specific star can be
// removed. The admin token stays in this browser tab only (sessionStorage).

const list = document.getElementById('list');
const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');
const tokenInput = document.getElementById('token');

let token = '';
try {
  token = sessionStorage.getItem('galaxyAdminToken') || '';
} catch (err) {
  token = '';
}
tokenInput.value = token;

document.getElementById('saveToken').addEventListener('click', () => {
  token = tokenInput.value.trim();
  try {
    sessionStorage.setItem('galaxyAdminToken', token);
  } catch (err) {
    // private mode: keep it in memory for this page only
  }
  statusEl.textContent = token ? 'Token set for this tab.' : '';
});

async function load() {
  try {
    const res = await fetch('/api/entries', { cache: 'no-store' });
    const data = await res.json();
    render(data.entries || []);
  } catch (err) {
    statusEl.textContent = 'Could not load the stars. Refresh in a moment (the server may be waking up).';
  }
}

function render(entries) {
  countEl.textContent = entries.length;
  list.textContent = '';
  entries
    .map((entry, i) => ({ entry, number: i + 1 }))
    .reverse()
    .forEach(({ entry, number }) => list.appendChild(row(entry, number)));
}

function row(entry, number) {
  const el = document.createElement('div');
  el.className = 'star-row';

  const img = document.createElement('img');
  img.src = entry.url;
  img.alt = `Star ${number}`;
  img.loading = 'lazy';

  const meta = document.createElement('div');
  meta.className = 'star-meta';
  const time = new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const swatch = document.createElement('span');
  swatch.className = 'star-swatch';
  swatch.style.background = entry.color || '#ffffff';
  const title = document.createElement('strong');
  title.textContent = `#${number}  ${time}`;
  meta.append(swatch, title, document.createElement('br'));
  meta.append([entry.region, entry.place].filter(Boolean).join(', ') || 'No region or place');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Remove';
  let armed = false;
  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Tap again to remove';
      btn.classList.add('confirm');
      setTimeout(() => {
        armed = false;
        btn.textContent = 'Remove';
        btn.classList.remove('confirm');
      }, 4000);
      return;
    }
    await remove(entry.id, number);
  });

  el.append(img, meta, btn);
  return el;
}

async function remove(id, number) {
  if (!token) {
    statusEl.textContent = 'Enter the admin token first.';
    return;
  }
  statusEl.textContent = `Removing star #${number}...`;
  try {
    const res = await fetch(`/api/entries/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      headers: { 'x-admin-token': token },
    });
    if (res.status === 403) {
      statusEl.textContent = 'Wrong admin token.';
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    statusEl.textContent = `Star #${number} removed.`;
    load();
  } catch (err) {
    statusEl.textContent = 'Removing failed. Try again.';
  }
}

load();
// Refresh the list, but not while a Remove button is waiting for its second tap.
setInterval(() => {
  if (!list.querySelector('button.confirm')) load();
}, 15000);
