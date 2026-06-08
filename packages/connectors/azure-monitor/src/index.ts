import { AzureMonitorConnector } from './azure-monitor';

export {
  AzureMonitorConnector,
  azureMonitorResources as resources,
  configFields,
  doc,
  id,
} from './azure-monitor';
export type {
  AzureMonitorMetricQuery,
  AzureMonitorResource,
  AzureMonitorSettings,
} from './azure-monitor';
export default AzureMonitorConnector;
