// Renderer utilities: small, dependency-free helpers shared across the
// renderer's feature modules. No reference to `state`/`els`/IPC — safe to
// load first. Loaded as a classic sibling <script> before renderer.js (see
// index.html); top-level declarations here are visible as bare identifiers
// in every script tag that loads after this one, sharing the page's global
// scope (same mechanism lastLight.js/ambientVisuals.js already rely on).

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTimeAgo(date) {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return `rgba(91, 140, 255, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let contextMenuEl = null;

function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'app-context-menu';
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeContextMenu();
      try { item.action(); } catch (_) { /* no-op */ }
    });
    menu.appendChild(btn);
  });
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const px = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const py = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  menu.style.visibility = 'visible';
  contextMenuEl = menu;
}
