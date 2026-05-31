import { MetaAdsConnector } from './meta-ads';

export {
  campaignToEntity,
  configFields,
  doc,
  id,
  insightRowToMetricSample,
  MetaAdsConnector,
  metaAdsResources as resources,
} from './meta-ads';
export type {
  MetaAdsResource,
  MetaAdsSettings,
  MetaActionEntry,
  MetaAdInsight,
  MetaAdsetInsight,
  MetaCampaign,
  MetaCampaignInsight,
} from './meta-ads';
export default MetaAdsConnector;
