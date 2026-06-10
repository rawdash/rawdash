import { AppsflyerConnector } from './appsflyer';

export {
  AppsflyerConnector,
  appsflyerResources as resources,
  configFields,
  doc,
  getWindow,
  id,
  installRowToMetricSample,
  retentionRowToMetricSamples,
} from './appsflyer';
export type {
  AppsflyerInstallRow,
  AppsflyerResource,
  AppsflyerRetentionRow,
  AppsflyerSettings,
} from './appsflyer';
export default AppsflyerConnector;
