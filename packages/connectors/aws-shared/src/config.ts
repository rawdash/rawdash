import { z } from 'zod';

export const awsAuthConfigShape = {
  region: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'region must look like an AWS region, e.g. us-east-1',
    )
    .meta({
      label: 'AWS Region',
      description:
        'The AWS region whose service endpoint you want to call, e.g. us-east-1.',
      placeholder: 'us-east-1',
    }),
  accessKeyId: z.object({ $secret: z.string() }).optional().meta({
    label: 'Access Key ID',
    description:
      'AWS access key ID for an IAM principal with permission to call the relevant service. Use together with the secret access key for static-credential auth.',
    secret: true,
  }),
  secretAccessKey: z.object({ $secret: z.string() }).optional().meta({
    label: 'Secret Access Key',
    description: 'AWS secret access key paired with the access key ID above.',
    secret: true,
  }),
  roleArn: z
    .string()
    .regex(
      /^arn:aws:iam::\d{12}:role\/.+/,
      'roleArn must be a full IAM role ARN, e.g. arn:aws:iam::123456789012:role/rawdash',
    )
    .optional()
    .meta({
      label: 'Role ARN',
      description:
        'IAM role to assume via STS instead of using static keys. The base credentials (the access key above, or the ambient AWS environment) must be allowed to sts:AssumeRole this role.',
      placeholder: 'arn:aws:iam::123456789012:role/rawdash',
    }),
  externalId: z.string().min(1).optional().meta({
    label: 'External ID',
    description:
      'External ID required by the trust policy of the role being assumed. Only used with Role ARN.',
  }),
} as const;

export interface AwsAuthConfig {
  region: string;
  accessKeyId?: { $secret: string };
  secretAccessKey?: { $secret: string };
  roleArn?: string;
  externalId?: string;
}

export const awsAuthRefine = {
  predicate: (val: AwsAuthConfig): boolean => {
    const hasRole = val.roleArn !== undefined;
    const hasStatic =
      val.accessKeyId !== undefined && val.secretAccessKey !== undefined;
    if (val.externalId !== undefined && !hasRole) {
      return false;
    }
    return hasRole || hasStatic;
  },
  message:
    'Provide either accessKeyId + secretAccessKey (static credentials) or roleArn (role assumption). externalId requires roleArn.',
} as const;
