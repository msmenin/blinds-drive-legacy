import { MAX_TIMERS, Timer } from '../protocol/commands';
import { DAY_SHORT, errorMessage, h, pad2, toast } from './dom';
import type { DeviceCtx, View } from './view';

function describeDays(days: boolean[]): string {
  const n = days.filter(Boolean).length;
  if (n === 7) return 'Every day';
  if (n === 5 && days.slice(1, 6).every(Boolean)) return 'Weekdays';
  if (n === 2 && days[0] && days[6]) return 'Weekends';
  return DAY_SHORT.filter((_, i) => days[i]).join(', ');
}

const describePos = (p: number) => (p === 0 ? 'Open' : p === 100 ? 'Close' : `Move to ${p}%`);

export function timersView({ conn }: DeviceCtx): View {
  const root = h('div', { class: 'timers' });

  const render = () => {
    root.replaceChildren();
    const s = conn.state.settings;
    if (s && !(s.topLimitSet && s.bottomLimitSet)) {
      root.append(h('p', { class: 'notice' }, 'Set the top and bottom limits in Settings before adding timers.'));
      return;
    }
    const timers = conn.state.timers;
    root.append(
      h('p', { class: 'muted' }, `The blind runs these on its own, even when your phone is away. Up to ${MAX_TIMERS}.`),
    );
    if (!timers.length) root.append(h('p', { class: 'empty' }, 'No timers yet.'));
    root.append(
      h(
        'ul',
        { class: 'card-list' },
        timers.map((t) => {
          const toggle = h('input', { type: 'checkbox', class: 'switch', checked: t.enabled, 'aria-label': 'Timer on' });
          toggle.addEventListener('change', async () => {
            try {
              // Resend the whole entry: safer than the original's zeroed "switch only" payload.
              await conn.setTimer({ ...t, enabled: toggle.checked });
              await conn.refresh();
            } catch (e) {
              toggle.checked = !toggle.checked;
              toast(errorMessage(e), 'error');
            }
          });
          return h(
            'li',
            { class: 'timer' },
            h(
              'button',
              { class: 'timer-main', onclick: () => editor(t) },
              h('span', { class: 'time' }, `${pad2(t.hour)}:${pad2(t.minute)}`),
              h('span', { class: 'muted' }, `${describePos(t.percent)} · ${describeDays(t.days)}`),
            ),
            toggle,
          );
        }),
      ),
    );
    if (timers.length < MAX_TIMERS) {
      root.append(
        h('button', { class: 'btn primary wide', onclick: () => editor(null) }, 'Add timer'),
      );
    }
  };

  const editor = (existing: Timer | null) => {
    const slot = existing?.slot ?? conn.state.timers.length + 1;
    const t: Timer = existing
      ? { ...existing, days: [...existing.days] }
      : { slot, enabled: true, percent: 0, days: [false, true, true, true, true, true, false], hour: 7, minute: 0 };

    const time = h('input', { type: 'time', value: `${pad2(t.hour)}:${pad2(t.minute)}`, required: true });
    const pos = h('input', { type: 'range', min: 0, max: 100, step: 5, value: t.percent });
    const posLabel = h('output', {}, describePos(t.percent));
    pos.addEventListener('input', () => (posLabel.textContent = describePos(Number(pos.value))));
    const dayBoxes = DAY_SHORT.map((d, i) =>
      h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: t.days[i] }), h('span', {}, d)),
    );

    const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save timer');
    const del = existing
      ? h('button', { class: 'btn danger', type: 'button' }, 'Delete')
      : null;

    const form = h(
      'form',
      { class: 'stack' },
      h('h2', {}, existing ? 'Edit timer' : 'New timer'),
      h('label', { class: 'field' }, h('span', {}, 'Time'), time),
      h('fieldset', { class: 'field' }, h('legend', {}, 'Repeat on'), h('div', { class: 'chips' }, dayBoxes)),
      h('label', { class: 'field' }, h('span', {}, 'Position'), pos, posLabel),
      h('div', { class: 'row end' }, del, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel'), save),
    );
    const dlg = h('dialog', { class: 'sheet' }, form);
    const close = () => {
      dlg.close();
      dlg.remove();
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const days = dayBoxes.map((l) => (l.querySelector('input') as HTMLInputElement).checked);
      if (!days.some(Boolean)) {
        toast('Pick at least one day.', 'error');
        return;
      }
      const [hh, mm] = time.value.split(':').map(Number);
      save.disabled = true;
      try {
        await conn.setTimer({ ...t, days, hour: hh, minute: mm, percent: Number(pos.value) });
        await conn.refresh();
        toast('Timer saved');
        close();
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        save.disabled = false;
      }
    });
    del?.addEventListener('click', async () => {
      del.disabled = true;
      try {
        await conn.deleteTimer(t.slot);
        toast('Timer deleted');
        close();
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        del.disabled = false;
      }
    });

    document.body.appendChild(dlg);
    dlg.showModal();
  };

  const off = conn.on('state', render);
  render();
  return { el: root, dispose: off };
}
