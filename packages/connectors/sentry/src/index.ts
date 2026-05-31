import { SentryConnector } from './sentry';

export {
  configFields,
  doc,
  SentryConnector,
  sentryResources as resources,
  id,
} from './sentry';
export type { SentryResource, SentrySettings } from './sentry';
export default SentryConnector;
