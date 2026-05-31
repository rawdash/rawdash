import { GoogleAdsConnector } from './google-ads';

export {
  adGroupMetricRowToSample,
  campaignMetricRowToSample,
  campaignToEntity,
  configFields,
  doc,
  getDateRange,
  GoogleAdsConnector,
  googleAdsResources as resources,
  id,
  keywordMetricRowToSample,
} from './google-ads';
export type { GoogleAdsResource, GoogleAdsSettings } from './google-ads';
export default GoogleAdsConnector;
