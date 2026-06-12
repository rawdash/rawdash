import { AwsBedrockConnector } from './aws-bedrock';

export {
  AwsBedrockConnector,
  ERRORS_METRIC,
  INPUT_TOKENS_METRIC,
  INVOCATIONS_METRIC,
  LATENCY_METRIC,
  OUTPUT_TOKENS_METRIC,
  SPEND_METRIC,
  awsBedrockResources as resources,
  buildSpendSamples,
  configFields,
  cost,
  doc,
  getBedrockWindow,
  getSpendWindow,
  id,
  parseListMetrics,
} from './aws-bedrock';
export type {
  AwsBedrockSettings,
  BedrockWindow,
  SpendWindow,
} from './aws-bedrock';
export default AwsBedrockConnector;
