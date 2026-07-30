import { PostgresConnector } from './postgres';

export {
  PostgresConnector,
  PostgresQueryExecutor,
  configFields,
  cost,
  doc,
  id,
  postgresResources as resources,
  shouldUseTls,
} from './postgres';
export type { PgClient, PostgresSettings } from './postgres';
export { mapPostgresError } from './errors';
export default PostgresConnector;
