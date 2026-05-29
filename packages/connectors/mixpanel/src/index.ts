import { MixpanelConnector } from './mixpanel';

export {
  buildActiveUserSamples,
  buildEventsPerDaySamples,
  buildFunnelSamples,
  buildRetentionSamples,
  configFields,
  doc,
  getDateRange,
  MixpanelConnector,
} from './mixpanel';
export type {
  MixpanelFunnelSpec,
  MixpanelPhase,
  MixpanelResource,
  MixpanelSettings,
} from './mixpanel';
export default MixpanelConnector;
