import { LIGHT_LUX, Season, SeasonKind } from '../protocol/commands';
import { errorMessage, h, pad2, toast } from './dom';
import type { DeviceCtx, View } from './view';

const LEVEL_WORD = (n: number) => (n <= 3 ? 'dim' : n <= 6 ? 'soft' : 'bright');
const levelLabel = (n: number) => `Level ${n} · ${LIGHT_LUX[n - 1]} lux (${LEVEL_WORD(n)})`;

const DEFAULT = (kind: SeasonKind): Season => ({
  kind,
  enabled: false,
  openByLight: true,
  closeByLight: true,
  openLevel: kind === 'summer' ? 2 : 7,
  closeLevel: kind === 'summer' ? 7 : 2,
  startHour: 0,
  startMinute: 0,
  endHour: 23,
  endMinute: 59,
});

export function seasonsView({ conn }: DeviceCtx): View {
  const root = h('div', { class: 'seasons' });

  const render = () => {
    root.replaceChildren();
    const s = conn.state.settings;
    if (s && !s.hasLightSensor) {
      root.append(h('p', { class: 'notice' }, 'This blind has no light sensor connected, so light modes aren’t available.'));
      return;
    }
    if (s && !(s.topLimitSet && s.bottomLimitSet)) {
      root.append(h('p', { class: 'notice' }, 'Set the top and bottom limits in Settings before using light modes.'));
      return;
    }

    const light = h('span', {}, conn.state.light ? levelLabel(conn.state.light.level) : 'Unknown');
    const check = h('button', { class: 'btn ghost small' }, 'Check now');
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        const r = await conn.queryLight();
        light.textContent = r && r.hasSensor ? levelLabel(r.level) : 'No sensor reading';
      } catch (e) {
        toast(errorMessage(e), 'error');
      } finally {
        check.disabled = false;
      }
    });

    root.append(
      h('p', { class: 'muted' }, 'With the solar/light sensor, the blind can open and close itself as daylight changes. Turn on one season at a time.'),
      h('div', { class: 'light-now' }, h('span', { class: 'muted' }, 'Light now'), light, check),
      seasonCard('summer', 'Summer', 'Close when the sun gets strong; open when it dims.'),
      seasonCard('winter', 'Winter', 'Open to let the sun in; close when it gets dark.'),
    );
  };

  const seasonCard = (kind: SeasonKind, title: string, blurb: string) => {
    const cur = conn.state.seasons?.[kind] ?? DEFAULT(kind);
    const other = conn.state.seasons?.[kind === 'summer' ? 'winter' : 'summer'];

    const enabled = h('input', { type: 'checkbox', class: 'switch', checked: cur.enabled, 'aria-label': `${title} mode on` });
    const openBy = h('input', { type: 'checkbox', checked: cur.openByLight });
    const closeBy = h('input', { type: 'checkbox', checked: cur.closeByLight });
    const levelSelect = (v: number) =>
      h('select', {}, LIGHT_LUX.map((_, i) => h('option', { value: i + 1, selected: i + 1 === v }, levelLabel(i + 1))));
    const openLvl = levelSelect(cur.openLevel);
    const closeLvl = levelSelect(cur.closeLevel);
    const start = h('input', { type: 'time', value: `${pad2(cur.startHour)}:${pad2(cur.startMinute)}` });
    const end = h('input', { type: 'time', value: `${pad2(cur.endHour)}:${pad2(cur.endMinute)}` });
    const allDay = h('button', {
      class: 'btn ghost small',
      type: 'button',
      onclick: () => {
        start.value = '00:00';
        end.value = '23:59';
      },
    }, 'All day');
    const save = h('button', { class: 'btn primary', type: 'submit' }, `Save ${title.toLowerCase()} mode`);

    const form = h(
      'form',
      { class: 'card stack' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, title), h('p', { class: 'muted' }, blurb)), enabled),
      h('label', { class: 'check' }, openBy, h('span', {}, 'Open by light')),
      h('label', { class: 'field indent' }, h('span', {}, 'Open at'), openLvl),
      h('label', { class: 'check' }, closeBy, h('span', {}, 'Close by light')),
      h('label', { class: 'field indent' }, h('span', {}, 'Close at'), closeLvl),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'row between' }, h('span', {}, 'Active between'), allDay),
        h('div', { class: 'time-range' }, start, h('span', {}, 'and'), end),
      ),
      h('div', { class: 'row end' }, save),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (enabled.checked && other?.enabled) {
        toast(`Turn off ${kind === 'summer' ? 'winter' : 'summer'} mode first.`, 'error');
        return;
      }
      const [sh, sm] = start.value.split(':').map(Number);
      const [eh, em] = end.value.split(':').map(Number);
      const next: Season = {
        kind,
        enabled: enabled.checked,
        openByLight: openBy.checked,
        closeByLight: closeBy.checked,
        openLevel: Number(openLvl.value),
        closeLevel: Number(closeLvl.value),
        startHour: sh || 0,
        startMinute: sm || 0,
        endHour: eh ?? 23,
        endMinute: em ?? 59,
      };
      save.disabled = true;
      try {
        await conn.setSeason(next);
        await conn.refresh();
        toast(`${title} mode saved`);
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        save.disabled = false;
      }
    });
    return form;
  };

  // Only re-render when season data changes, so half-edited forms aren't wiped by position notifies.
  let lastSeasons = conn.state.seasons;
  let lastSettings = conn.state.settings;
  const off = conn.on('state', (s) => {
    if (s.seasons !== lastSeasons || s.settings !== lastSettings) {
      lastSeasons = s.seasons;
      lastSettings = s.settings;
      render();
    }
  });
  render();
  return { el: root, dispose: off };
}
