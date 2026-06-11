import { BranchConnector } from './branch';

export {
  BranchConnector,
  branchResources as resources,
  clickRowToEventRecord,
  configFields,
  doc,
  getWindow,
  id,
  installBucketToMetricSample,
  mergeInstallBuckets,
} from './branch';
export type {
  BranchClickResultRow,
  BranchInstallResultRow,
  BranchResource,
  BranchSettings,
} from './branch';
export default BranchConnector;
