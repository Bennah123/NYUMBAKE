// ------------------------------------------------------------
// In-page toast notifications — replaces the browser's native
// alert() popups, which block the page and can't be styled.
//   toast('Saved', 'success')   toast(err.message, 'error')
// Styles live in assets/css/styles.css under "Toasts".
// ------------------------------------------------------------

let container = null;

function getContainer() {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

export function toast(message, type = 'info', durationMs = 4500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message; // textContent, never innerHTML: messages can contain user/DB text

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  const remove = () => el.remove();
  close.addEventListener('click', remove);
  el.appendChild(close);

  getContainer().appendChild(el);
  if (durationMs > 0) setTimeout(remove, durationMs);
  return el;
}