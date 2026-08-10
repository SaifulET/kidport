import multer from 'multer';
import { AppError } from '../utils/AppError';

const allowed = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'video/mp4',
  'video/quicktime',
  'application/pdf'
];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!allowed.includes(file.mimetype)) return cb(new AppError('Unsupported file type', 400));
    cb(null, true);
  }
});
