import { z } from 'zod';

export const gcpAuthConfigShape = {
  serviceAccountJson: z.object({ $secret: z.string().trim().min(1) }).meta({
    label: 'Service Account JSON',
    description:
      'Contents of the JSON key file for a Google service account with the role required by this connector. Create one at Google Cloud -> IAM & Admin -> Service Accounts and store the JSON as a secret.',
    secret: true,
  }),
} as const;

export interface GcpAuthConfig {
  serviceAccountJson: { $secret: string };
}
