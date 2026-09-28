import * as C from '../protocol/commands';
import { LimitReply } from '../protocol/decode';
import { disconnectCurrent } from '../session';
import { removeDevice, updateDevice } from '../store';
import { confirmDialog, errorMessage, h, promptDialog, toast } from './dom';
import type { DeviceCtx, View } from './view';

export function settingsView({ conn, saved }: DeviceCtx): View {
  const root = h('div', { class: 'settings' });

  const render = () => {
    root.replaceChildren(motorCard(), limitsCard(), identityCard(), dangerCard());
  };

  // ---- motor (0x11) ---------------------------------------------------------
  const motorCard = () => {
    const s = conn.state.settings;
    if (!s) return h('p', { class: 'muted' }, 'Reading settings from the blind…');

    const type = h(
      'select',
      {},
      Object.entries(C.DEVICE_TYPE_LABELS).map(([v, label]) =>
        h('option', { value: v, selected: Number(v) === s.deviceType }, label),
      ),
    );
    const reverse = h('input', { type: 'checkbox', class: 'switch', checked: s.direction });
    const inching = h('input', { type: 'checkbox', class: 'switch', checked: s.inching });
    const speedMin = Math.min(20, s.speed || 20);
    const speedMax = Math.max(40, s.speed);
    const speed = h('input', { type: 'range', min: speedMin, max: speedMax, step: 1, value: s.speed || 28 });
    const speedOut = h('output', {}, `${speed.value} rpm`);
    const length = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 65535, value: s.length });
    const diameter = h(
      'select',
      {},
      C.DIAMETERS.map((d) => h('option', { value: d, selected: d === s.diameter }, `${d} mm`)),
      C.DIAMETERS.includes(s.diameter as never) ? null : h('option', { value: s.diameter, selected: true }, `${s.diameter} mm`),
    );
    const moveTime = h('output', { class: 'muted' });
    const updateTime = () => {
      speedOut.textContent = `${speed.value} rpm`;
      // MyTimeSetTool.calculationSpeedTime: (len / (dia/10·π·speed))·60 / 10 seconds.
      const len = Number(length.value);
      const dia = Number(diameter.value);
      const sp = Number(speed.value);
      moveTime.textContent =
        len && dia && sp ? `Full travel takes about ${Math.round(((len / ((dia / 10) * Math.PI * sp)) * 60) / 10)} s` : '';
    };
    [speed, length, diameter].forEach((el) => el.addEventListener('input', updateTime));
    updateTime();

    const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save motor settings');
    const form = h(
      'form',
      { class: 'card stack' },
      h('h2', {}, 'Motor'),
      h('label', { class: 'field' }, h('span', {}, 'Blind type'), type),
      h('label', { class: 'toggle' }, h('span', {}, 'Reverse direction', h('small', { class: 'muted' }, 'Use if Open and Close are swapped.')), reverse),
      h('label', { class: 'toggle' }, h('span', {}, 'Hold to move', h('small', { class: 'muted' }, 'A short press stops when you let go.')), inching),
      h('label', { class: 'field' }, h('span', {}, 'Speed'), speed, speedOut),
      h('label', { class: 'field' }, h('span', {}, 'Blind height (mm)'), length),
      h('label', { class: 'field' }, h('span', {}, 'Gear diameter'), diameter),
      moveTime,
      h('div', { class: 'row end' }, save),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await conn.writeSettings({
          deviceType: Number(type.value),
          direction: reverse.checked,
          inching: inching.checked,
          speed: Number(speed.value),
          length: Number(length.value),
          diameter: Number(diameter.value),
        });
        await conn.refresh();
        toast('Motor settings saved');
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        save.disabled = false;
      }
    });
    return form;
  };

  // ---- limits (0x22) --------------------------------------------------------
  const limitsCard = () => {
    const s = conn.state.settings;
    const state = (ok?: boolean) => (ok ? 'Set' : 'Not set');
    return h(
      'div',
      { class: 'card stack' },
      h('h2', {}, 'Limits'),
      h('p', { class: 'muted' }, 'The top and bottom stopping points. Both must be set before positions, timers and light modes work.'),
      h('div', { class: 'row between' }, h('span', {}, 'Top', h('small', { class: 'muted' }, state(s?.topLimitSet))), h('button', { class: 'btn ghost', onclick: () => limitWizard('top') }, 'Set top')),
      h('div', { class: 'row between' }, h('span', {}, 'Bottom', h('small', { class: 'muted' }, state(s?.bottomLimitSet))), h('button', { class: 'btn ghost', onclick: () => limitWizard('bottom') }, 'Set bottom')),
    );
  };

  const limitWizard = async (edge: C.LimitEdge) => {
    try {
      const r = await conn.limit(C.encodeLimitEnter(edge));
      if (r !== LimitReply.ENTERED) throw new Error('The blind didn’t enter limit setup.');
    } catch (e) {
      toast(errorMessage(e), 'error');
      return;
    }

    const jog = (action: C.ControlAction, label: string) => {
      const b = h('button', { class: 'btn ctl', type: 'button' }, label);
      let downAt = 0;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        downAt = performance.now();
        conn.control(action).catch((err) => toast(errorMessage(err), 'error'));
      });
      const up = () => {
        if (!downAt) return;
        const held = performance.now() - downAt;
        downAt = 0;
        if (action !== 'STOP' && held <= 1500) conn.control('STOP').catch(() => {});
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
      return b;
    };

    const save = h('button', { class: 'btn primary', type: 'button' }, `Save ${edge} limit`);
    const dlg = h(
      'dialog',
      { class: 'sheet' },
      h('h2', {}, `Set the ${edge} limit`),
      h(
        'p',
        { class: 'muted' },
        `Move the blind to where it should stop at the ${edge}. Tap to nudge; hold longer than 1.5 s and it keeps moving until you tap Stop.`,
      ),
      h('div', { class: 'ctl-row' }, jog('OPEN', 'Up'), jog('STOP', 'Stop'), jog('CLOSE', 'Down')),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => finish(false) }, 'Cancel'), save),
    );
    let done = false;
    const finish = async (saving: boolean) => {
      if (done) return;
      if (saving) {
        save.disabled = true;
        try {
          const r = await conn.limit(C.encodeLimitSave(edge));
          if (r === LimitReply.SAME_POSITION) {
            toast('Top and bottom can’t be at the same position.', 'error');
            save.disabled = false;
            return;
          }
          if (r === LimitReply.TIMEOUT) throw new Error('Limit setup timed out on the blind. Start again.');
          if (r !== LimitReply.SAVED) throw new Error('The blind didn’t confirm the limit.');
          toast(`${edge === 'top' ? 'Top' : 'Bottom'} limit saved`);
        } catch (e) {
          toast(errorMessage(e), 'error');
          save.disabled = false;
          return;
        }
      } else {
        await conn.limit(C.encodeLimitExit(), 2000).catch(() => null);
      }
      done = true;
      dlg.close();
      dlg.remove();
      conn.refresh().catch(() => {});
    };
    save.addEventListener('click', () => finish(true));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(false);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  };

  // ---- name & password ------------------------------------------------------
  const identityCard = () => {
    const rename = h('button', { class: 'btn ghost' }, 'Rename');
    rename.addEventListener('click', async () => {
      const v = await promptDialog({
        title: 'Rename blind',
        message: 'The new name is stored on the blind, so other phones see it too.',
        label: 'Name',
        value: saved.label,
        maxlength: C.MAX_NAME_BYTES,
        confirm: 'Rename',
      });
      if (!v) return;
      try {
        C.encodeName(v); // validate length before sending
        await conn.rename(v);
        // The advertised name changes too; the picker filter must use it next time.
        saved.label = v;
        saved.name = v;
        updateDevice(saved.id, { label: v, name: v });
        toast('Renamed');
        const h1 = document.querySelector('.device-head h1');
        if (h1) h1.textContent = v;
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    });

    const pw = h('button', { class: 'btn ghost' }, 'Change password');
    pw.addEventListener('click', async () => {
      const v = await promptDialog({
        title: 'Change password',
        message: 'Up to 4 digits. Write it down: without it you can’t connect.',
        label: 'New password',
        inputmode: 'numeric',
        pattern: '[0-9]{1,4}',
        maxlength: 4,
        confirm: 'Change password',
      });
      if (v === null) return;
      try {
        await conn.changePassword(Number(v));
        saved.password = Number(v);
        updateDevice(saved.id, { password: Number(v) });
        toast('Password changed');
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    });

    return h(
      'div',
      { class: 'card stack' },
      h('h2', {}, 'Name and password'),
      h('div', { class: 'row between' }, h('span', {}, saved.label), rename),
      h('div', { class: 'row between' }, h('span', {}, 'Password', h('small', { class: 'muted' }, 'Saved on this phone')), pw),
    );
  };

  // ---- reset / forget -------------------------------------------------------
  const dangerCard = () => {
    const reset = h('button', { class: 'btn danger' }, 'Factory reset');
    reset.addEventListener('click', async () => {
      const ok = await confirmDialog(
        'Factory reset this blind?',
        'This clears its limits and settings on the motor. You’ll need to set the limits again.',
        'Factory reset',
        true,
      );
      if (!ok) return;
      try {
        const r = await conn.limit(C.encodeFactoryReset());
        if (r !== LimitReply.RESET_DONE) throw new Error('The blind didn’t confirm the reset.');
        toast('Blind reset');
        await conn.refresh();
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    });

    const forget = h('button', { class: 'btn ghost' }, 'Forget on this phone');
    forget.addEventListener('click', async () => {
      const ok = await confirmDialog('Forget this blind?', 'It’s removed from this phone’s list. The blind itself isn’t changed.', 'Forget', true);
      if (!ok) return;
      disconnectCurrent();
      removeDevice(saved.id);
      location.hash = '#/';
    });

    return h('div', { class: 'card stack' }, h('h2', {}, 'Reset'), h('div', { class: 'row between wrap' }, forget, reset));
  };

  // Re-render only when settings are re-read, so edits in progress survive position updates.
  let last = conn.state.settings;
  const off = conn.on('state', (s) => {
    if (s.settings !== last) {
      last = s.settings;
      render();
    }
  });
  render();
  return { el: root, dispose: off };
}
