import './style.css';
import { homeView } from './ui/home';
import { deviceView } from './ui/device';
import type { View } from './ui/view';
import { isDemo } from './ble/mock';
import { h } from './ui/dom';

const app = document.getElementById('app')!;
let current: View | null = null;

function route() {
  current?.dispose?.();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  current =
    parts[0] === 'd' && parts[1] ? deviceView(decodeURIComponent(parts[1]), parts[2] ?? 'control') : homeView();
  app.replaceChildren(...(isDemo() ? [demoBanner()] : []), current.el);
}

window.addEventListener('hashchange', route);
route();

function demoBanner(): HTMLElement {
  const real = location.pathname + location.hash;
  return h(
    'div',
    { class: 'demo-banner', role: 'note' },
    'Demo mode: a simulated blind, no Bluetooth. Password 1234. ',
    h('a', { href: real }, 'Use real blinds'),
  );
}
