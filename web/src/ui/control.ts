import type { ControlAction } from '../protocol/commands';
import { updateDevice } from '../store';
import { errorMessage, h, toast } from './dom';
import type { DeviceCtx, View } from './view';

const SHORT_PRESS_MS = 1500;

export function controlView({ conn, saved }: DeviceCtx): View {
  const fabric = h('div', { class: 'fabric' }, h('div', { class: 'hem' }));
  const target = h('div', { class: 'target', hidden: true });
  const readout = h('div', { class: 'readout' });
  const win = h(
    'div',
    {
      class: 'window',
      role: 'slider',
      tabindex: 0,
      'aria-label': 'Blind position',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
    },
    h('div', { class: 'sky' }),
    fabric,
    target,
  );
  const battery = h('span', { class: 'battery muted' });
  const notice = h('p', { class: 'notice', hidden: true }, 'Limits aren’t set yet, so the blind can’t go to a position. Set the top and bottom limits in Settings.');

  let dragging = false;

  const render = () => {
    const s = conn.state;
    const pos = s.position;
    fabric.style.height = `${pos ?? 0}%`;
    win.setAttribute('aria-valuenow', String(pos ?? 0));
    readout.textContent = pos === null ? '–' : pos === 0 ? 'Open' : pos === 100 ? 'Closed' : `${pos}% closed`;
    battery.textContent = s.battery !== null ? `Battery ${s.battery}%` : '';
    const limitsOk = !!s.settings && s.settings.topLimitSet && s.settings.bottomLimitSet;
    notice.hidden = !s.settings || limitsOk;
    win.classList.toggle('disabled', !!s.settings && !limitsOk);
  };

  // Drag or tap on the window to choose a position (0 = fully open at the top).
  const pctFromEvent = (e: PointerEvent) => {
    const r = win.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 100);
  };
  const showTarget = (pct: number) => {
    target.hidden = false;
    target.style.top = `${pct}%`;
    target.dataset.label = `${pct}%`;
  };
  const sendTarget = async (pct: number) => {
    try {
      await conn.moveTo(pct);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    setTimeout(() => (target.hidden = true), 600);
  };
  win.addEventListener('pointerdown', (e) => {
    if (win.classList.contains('disabled')) return;
    dragging = true;
    win.setPointerCapture(e.pointerId);
    showTarget(pctFromEvent(e));
  });
  win.addEventListener('pointermove', (e) => dragging && showTarget(pctFromEvent(e)));
  win.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    sendTarget(pctFromEvent(e));
  });
  win.addEventListener('pointercancel', () => {
    dragging = false;
    target.hidden = true;
  });
  win.addEventListener('keydown', (e) => {
    if (win.classList.contains('disabled')) return;
    const cur = conn.state.position ?? 0;
    const step = { ArrowDown: 10, ArrowUp: -10, PageDown: 25, PageUp: -25, Home: -100, End: 100 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const pct = Math.min(100, Math.max(0, cur + step));
    showTarget(pct);
    sendTarget(pct);
  });

  const button = (action: ControlAction, label: string, cls = '') => {
    const b = h('button', { class: `btn ctl ${cls}`, 'aria-label': label }, label);
    let downAt = 0;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      downAt = performance.now();
      b.classList.add('pressed');
      conn.control(action).catch((err) => toast(errorMessage(err), 'error'));
    });
    const release = () => {
      if (!downAt) return;
      b.classList.remove('pressed');
      const held = performance.now() - downAt;
      downAt = 0;
      // Inching mode: the original app sent stop when a short press was released.
      if (action !== 'STOP' && conn.state.settings?.inching && held <= SHORT_PRESS_MS) {
        conn.control('STOP').catch(() => {});
      }
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        conn.control(action).catch((err) => toast(errorMessage(err), 'error'));
      }
    });
    return b;
  };

  const offState = conn.on('state', () => {
    render();
    updateDevice(saved.id, { settings: conn.state.settings, lastSeen: Date.now() });
  });
  render();
  conn.refreshBattery().catch(() => {});

  const el = h(
    'div',
    { class: 'control' },
    h('div', { class: 'stage' }, win, h('div', { class: 'status' }, readout, battery)),
    notice,
    h('div', { class: 'ctl-row' }, button('OPEN', 'Open'), button('STOP', 'Stop', 'stop'), button('CLOSE', 'Close')),
    h('p', { class: 'hint muted' }, 'Drag down the window to lower the blind to that point.'),
  );
  return { el, dispose: offState };
}
