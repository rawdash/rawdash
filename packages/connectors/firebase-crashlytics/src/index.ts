import { FirebaseCrashlyticsConnector } from './firebase-crashlytics';

export {
  FirebaseCrashlyticsConnector,
  buildCrashesPerDaySql,
  buildCrashesSamplesFromBqResponse,
  buildTopIssuesEntitiesFromBqResponse,
  buildTopIssuesSql,
  configFields,
  doc,
  getCrashlyticsWindow,
  id,
  firebaseCrashlyticsResources as resources,
} from './firebase-crashlytics';
export type { FirebaseCrashlyticsSettings } from './firebase-crashlytics';
export default FirebaseCrashlyticsConnector;
