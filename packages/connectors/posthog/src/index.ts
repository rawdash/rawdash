import { PostHogConnector } from './posthog';

export {
  configFields,
  doc,
  PostHogConnector,
  posthogResources as resources,
  id,
} from './posthog';
export type {
  PostHogSettings,
  PostHogResource,
  PostHogFunnel,
} from './posthog';
export default PostHogConnector;
