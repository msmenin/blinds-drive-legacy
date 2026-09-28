import { connectSaved, currentSavedDeviceId, getConnection } from '../session';
import { findDevice } from '../store';
import { errorMessage, h, toast } from './dom';
import { logButton } from './log';
import { controlView } from './control';
import { timersView } from './timers';
import { seasonsView } from './seasons';
import { settingsView } from './settings';
import type { DeviceCtx, View } from './view';

const TABS = [
  { key: 'control', label: 'Control', render: controlView },
  { key: 'timers', label: 'Timers', render: timersView },
  { key: 'light', label: 'Light', render: seasonsView },
  { key: 'settings', label: 'Settings', render: settingsView },
] as const;

export function deviceView(id: string, tab: string): View {
  const saved = findDevice(id);
  if (!saved) {
    location.hash = '#/';
    return { el: h('main') };
  }
  const base = `#/d/${encodeURIComponent(saved.id)}`;
  const conn = getConnection(saved.id);

  const head = h(
    'header',
    { class: 'device-head' },
    h('a', { href: '#/', class: 'back', 'aria-label': 'All blinds' }, '‹'),
    h('h1', {}, saved.label),
    h('span', { class: `dot ${conn ? 'on' : ''}`, title: conn ? 'Connected' : 'Not connected' }),
    logButton(),
  );

  if (!conn) {
    const btn = h('button', { class: 'btn primary wide' }, 'Connect');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Connecting…';
      try {
        const c = await connectSaved(saved);
        if (c) {
          const newId = currentSavedDeviceId() ?? saved.id;
          const target = `#/d/${encodeURIComponent(newId)}/${tab}`;
          if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
          else location.hash = target;
        }
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Connect';
      }
    });
    return {
      el: h(
        'main',
        { class: 'page device' },
        head,
        h('div', { class: 'offline' }, h('p', {}, 'This blind isn’t connected. Stand within a few metres of it and connect.'), btn),
      ),
    };
  }

  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const ctx: DeviceCtx = { conn, saved };
  const body = active.render(ctx);

  const nav = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Blind sections' },
    TABS.map((t) =>
      h('a', { href: `${base}/${t.key}`, class: t === active ? 'active' : '', 'aria-current': t === active ? 'page' : undefined }, t.label),
    ),
  );

  const offDisc = conn.on('disconnected', () => {
    toast('Blind disconnected', 'error');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

  return {
    el: h('main', { class: `page device tab-${active.key}` }, head, h('section', { class: 'tab-body' }, body.el), nav),
    dispose: () => {
      offDisc();
      body.dispose?.();
    },
  };
}
