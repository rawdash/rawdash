import { CloudWatchConnector } from './aws-cloudwatch';

export {
  CloudWatchConnector,
  configFields,
  cost,
  doc,
  id,
  awsCloudwatchResources as resources,
} from './aws-cloudwatch';
export type {
  CloudWatchMetricQuery,
  CloudWatchSettings,
} from './aws-cloudwatch';
export default CloudWatchConnector;
