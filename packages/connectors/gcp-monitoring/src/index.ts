import { GcpMonitoringConnector } from './gcp-monitoring';

export {
  GcpMonitoringConnector,
  configFields,
  doc,
  id,
  parseDurationSeconds,
  pointToSample,
  gcpMonitoringResources as resources,
} from './gcp-monitoring';
export type {
  GcpMonitoringMetricQuery,
  GcpMonitoringSettings,
} from './gcp-monitoring';
export default GcpMonitoringConnector;
