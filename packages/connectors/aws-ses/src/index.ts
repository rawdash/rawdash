import { AwsSesConnector } from './aws-ses';

export {
  AwsSesConnector,
  EMAIL_STATS_METRIC,
  REPUTATION_METRIC,
  configFields,
  doc,
  id,
  awsSesResources as resources,
} from './aws-ses';
export type { AwsSesSettings } from './aws-ses';
export default AwsSesConnector;
