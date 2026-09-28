import { getLog, onLog } from '../session';
import type { LogEntry } from '../ble/connection';
import { h, pad2, toast } from './dom';

const fmt = (e: LogEntry) =>
  `${pad2(e.at.getHours())}:${pad2(e.at.getMinutes())}:${pad2(e.at.getSeconds())} ${e.dir.padEnd(5)} ${e.text}`;

/** Button that opens the protocol log, for diagnosing what a blind actually sends. */
export function logButton(): HTMLButtonElement {
  return h('button', { class: 'btn ghost small', onclick: openLog }, 'Log');
}

function openLog() {
  const pre = h('pre', { class: 'log' });
  const render = () => {
    pre.textContent = getLog().map(fmt).join('\n') || 'Nothing sent or received yet.';
    pre.scrollTop = pre.scrollHeight;
  };
  render();
  const off = onLog(render);
  const copy = h('button', { class: 'btn ghost' }, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getLog().map(fmt).join('\n'));
      toast('Log copied');
    } catch {
      toast('Copy isn’t available here; select the text instead.', 'error');
    }
  });
  const dlg = h(
    'dialog',
    { class: 'sheet tall' },
    h('h2', {}, 'Bluetooth log'),
    h('p', { class: 'muted' }, 'Every frame sent to (tx) and received from (rx) the blind.'),
    pre,
    h('div', { class: 'row end' }, copy, h('button', { class: 'btn primary', onclick: () => close() }, 'Close')),
  );
  const close = () => {
    off();
    dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
}
