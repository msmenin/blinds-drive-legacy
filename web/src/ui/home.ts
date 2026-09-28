import { bluetoothAvailable } from '../ble/connection';
import { addDevice, connectSaved, currentSavedDeviceId } from '../session';
import { loadDevices } from '../store';
import { DEVICE_TYPE_LABELS } from '../protocol/commands';
import { errorMessage, h, toast } from './dom';
import { logButton } from './log';
import type { View } from './view';

export function homeView(): View {
  const devices = loadDevices();
  const connectedId = currentSavedDeviceId();

  const add = h('button', { class: 'btn primary wide', disabled: !bluetoothAvailable() }, 'Add a blind');
  add.addEventListener('click', async () => {
    add.disabled = true;
    add.textContent = 'Connecting…';
    try {
      const saved = await addDevice();
      if (saved) location.hash = `#/d/${encodeURIComponent(saved.id)}`;
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      add.disabled = false;
      add.textContent = 'Add a blind';
    }
  });

  const list = devices.length
    ? h(
        'ul',
        { class: 'device-list' },
        devices.map((d) => {
          const btn = h(
            'button',
            { class: 'device-row' },
            h('span', { class: 'device-glyph', 'aria-hidden': 'true' }, glyph(d.settings?.position ?? null)),
            h(
              'span',
              { class: 'device-text' },
              h('strong', {}, d.label),
              h(
                'span',
                { class: 'muted' },
                d.id === connectedId ? 'Connected' : d.settings ? DEVICE_TYPE_LABELS[d.settings.deviceType] ?? 'Blind' : 'Blind',
              ),
            ),
          );
          btn.addEventListener('click', async () => {
            if (d.id === connectedId) {
              location.hash = `#/d/${encodeURIComponent(d.id)}`;
              return;
            }
            btn.classList.add('busy');
            try {
              const conn = await connectSaved(d);
              if (conn) location.hash = `#/d/${encodeURIComponent(currentSavedDeviceId() ?? d.id)}`;
            } catch (e) {
              toast(errorMessage(e), 'error');
            } finally {
              btn.classList.remove('busy');
            }
          });
          return h('li', {}, btn);
        }),
      )
    : h('p', { class: 'empty' }, 'No blinds yet. Stand near one and add it; you’ll need its password.');

  const el = h(
    'main',
    { class: 'page home' },
    h('header', { class: 'home-head' }, h('h1', {}, 'Blinds'), logButton()),
    bluetoothAvailable()
      ? null
      : h(
          'div',
          { class: 'notice' },
          h('strong', {}, 'This browser can’t use Bluetooth.'),
          ' On iPhone, open this page in the free Bluefy browser. On Android or a computer, use Chrome or Edge.',
        ),
    list,
    add,
  );
  return { el };
}

/** A tiny blind drawn at its last known position. */
function glyph(position: number | null): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  const frame = document.createElementNS(ns, 'rect');
  Object.entries({ x: 3, y: 3, width: 26, height: 26, rx: 3, class: 'g-frame' }).forEach(([k, v]) =>
    frame.setAttribute(k, String(v)),
  );
  svg.appendChild(frame);
  const drop = Math.round(((position ?? 50) / 100) * 22);
  const fabric = document.createElementNS(ns, 'rect');
  Object.entries({ x: 5, y: 5, width: 22, height: Math.max(drop, 2), class: 'g-fabric' }).forEach(([k, v]) =>
    fabric.setAttribute(k, String(v)),
  );
  svg.appendChild(fabric);
  return svg;
}
