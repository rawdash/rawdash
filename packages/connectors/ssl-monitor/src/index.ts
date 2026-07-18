import { SslMonitorConnector } from './ssl-monitor';

export {
  configFields,
  doc,
  id,
  sslMonitorResources as resources,
  SslMonitorConnector,
} from './ssl-monitor';
export type {
  CertProbe,
  CertProbeOutcome,
  CheckStatus,
  SslMonitorDomain,
  SslMonitorResource,
  SslMonitorSettings,
  TlsCertificate,
} from './ssl-monitor';
export default SslMonitorConnector;
