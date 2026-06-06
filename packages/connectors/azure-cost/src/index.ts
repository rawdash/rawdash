import { AzureCostConnector } from './azure-cost';

export {
  AzureCostConnector,
  azureCostResources as resources,
  configFields,
  cost,
  doc,
  id,
} from './azure-cost';
export type { AzureCostSettings, CostWindow } from './azure-cost';
export default AzureCostConnector;
