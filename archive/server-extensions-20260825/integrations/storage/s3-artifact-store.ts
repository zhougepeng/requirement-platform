import "server-only";

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type S3ArtifactConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export class S3ArtifactStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3ArtifactConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async putImmutable(key: string, body: Uint8Array, contentType: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      throw new Error(`拒绝覆盖已发布 Demo：${key}`);
    } catch (error) {
      if (!(error instanceof Error) || !["NotFound", "Unknown"].includes(error.name)) throw error;
    }
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }
}
