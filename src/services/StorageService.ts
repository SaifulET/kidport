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

  static publicUrl(key: string) {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    if (env.AWS_S3_PUBLIC_BASE_URL) return `${env.AWS_S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${encodedKey}`;

    const bucket = this.requireBucket();
    return `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${encodedKey}`;
  }

  static async uploadBuffer(prefix: string, file: Express.Multer.File): Promise<StoredMedia> {
    const bucket = this.requireBucket();
    const key = `${prefix}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }));
    return { key, url: this.publicUrl(key), mimeType: file.mimetype, size: file.size, originalName: file.originalname };
  }

  static async presignedPutUrl(key: string, contentType: string) {
    const bucket = this.requireBucket();
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
      expiresIn: 60 * 10
    });
  }
}
