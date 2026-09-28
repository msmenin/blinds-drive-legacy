import type { DeviceConnection } from '../ble/connection';
import type { SavedDevice } from '../store';

export interface View {
  el: HTMLElement;
  dispose?: () => void;
}

export interface DeviceCtx {
  conn: DeviceConnection;
  saved: SavedDevice;
}
