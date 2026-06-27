import { MailgunConnector } from './mailgun';

export {
  MailgunConnector,
  configFields,
  doc,
  getWindow,
  id,
  logsItemToEvent,
  mailgunResources as resources,
  metricsItemToSample,
} from './mailgun';
export type {
  MailgunLogsItem,
  MailgunMetricsItem,
  MailgunResource,
  MailgunSettings,
  MailgunWindow,
} from './mailgun';
export default MailgunConnector;
