import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

const s3 = new S3Client({ region: env.AWS_REGION });

export type StoredMedia = {
  key: string;
  url?: string;
  mimeType: string;
  size: number;
  originalName?: string;
};

export class StorageService {
  static requireBucket() {
    if (!env.AWS_S3_BUCKET) throw new AppError('AWS S3 bucket is not configured', 503);
    return env.AWS_S3_BUCKET;
  }

  static async uploadBuffer(prefix: string, file: Express.Multer.File): Promise<StoredMedia> {
    const bucket = this.requireBucket();
    const key = `${prefix}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }));
    return { key, mimeType: file.mimetype, size: file.size, originalName: file.originalname };
  }

  static async presignedPutUrl(key: string, contentType: string) {
    const bucket = this.requireBucket();
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
      expiresIn: 60 * 10
    });
  }
}
