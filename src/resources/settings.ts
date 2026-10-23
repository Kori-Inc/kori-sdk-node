import type { RequestOptions } from '../http.js';
import type { Settings as SettingsData, SettingsUpdateParams } from '../types.js';
import { API, Resource } from './base.js';

export class Settings extends Resource {
  retrieve(options?: RequestOptions): Promise<SettingsData> {
    return this.data({ ...options, method: 'GET', path: `${API}/settings` });
  }

  update(params: SettingsUpdateParams, options?: RequestOptions): Promise<SettingsData> {
    return this.data({ ...options, method: 'PUT', path: `${API}/settings`, body: params });
  }
}
