type Attrs = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | number | null | undefined | false | Child[];

/** Tiny hyperscript helper: h('button', { class: 'x', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k in el && k !== 'style' && k !== 'list') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove('show'), kind === 'error' ? 5000 : 2500);
}

export function errorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotFoundError') {
    return /cancel/i.test(e.message) ? 'No blind selected.' : `Bluetooth error: ${e.message}`;
  }
  if (e instanceof DOMException) return `Bluetooth error (${e.name}): ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Modal prompt built on <dialog>. Resolves with the value, or null if cancelled. */
export function promptDialog(opts: {
  title: string;
  message?: string;
  label: string;
  value?: string;
  inputmode?: string;
  pattern?: string;
  maxlength?: number;
  confirm: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', {
      value: opts.value ?? '',
      inputmode: opts.inputmode,
      pattern: opts.pattern,
      maxlength: opts.maxlength,
      required: true,
      autocomplete: 'off',
    });
    const form = h(
      'form',
      { method: 'dialog' },
      h('h2', {}, opts.title),
      opts.message ? h('p', { class: 'muted' }, opts.message) : null,
      h('label', { class: 'field' }, h('span', {}, opts.label), input),
      h(
        'div',
        { class: 'row end' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, opts.confirm),
      ),
    );
    const dlg = h('dialog', { class: 'sheet' }, form);
    const close = (v: string | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      close(input.value.trim());
    });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    input.focus();
  });
}

export function confirmDialog(title: string, message: string, confirm: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = h(
      'dialog',
      { class: 'sheet' },
      h('h2', {}, title),
      h('p', { class: 'muted' }, message),
      h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirm),
      ),
    );
    const close = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
