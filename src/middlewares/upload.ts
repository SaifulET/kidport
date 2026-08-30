import multer from 'multer';
import { AppError } from '../utils/AppError';

export const MAX_UPLOAD_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const allowedUploadMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/3gpp',
  'audio/3gpp2',
  'audio/amr',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp',
  'video/3gpp2',
  'application/pdf'
];

export const isAllowedUploadMimeType = (mimeType: string) =>
  allowedUploadMimeTypes.includes(mimeType.toLowerCase());

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUploadMimeType(file.mimetype)) return cb(new AppError('Unsupported file type', 400));
    cb(null, true);
  }
});
