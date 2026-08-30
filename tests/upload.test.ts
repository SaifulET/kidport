import { describe, expect, it } from 'vitest';
import { isAllowedUploadMimeType } from '../src/middlewares/upload';

describe('upload file filter', () => {
  it('accepts common mobile audio capture mime types', () => {
    expect(isAllowedUploadMimeType('audio/mp4')).toBe(true);
    expect(isAllowedUploadMimeType('audio/m4a')).toBe(true);
    expect(isAllowedUploadMimeType('audio/x-m4a')).toBe(true);
    expect(isAllowedUploadMimeType('audio/aac')).toBe(true);
    expect(isAllowedUploadMimeType('audio/webm')).toBe(true);
    expect(isAllowedUploadMimeType('audio/3gpp')).toBe(true);
  });

  it('accepts common mobile video mime types', () => {
    expect(isAllowedUploadMimeType('video/mp4')).toBe(true);
    expect(isAllowedUploadMimeType('video/quicktime')).toBe(true);
    expect(isAllowedUploadMimeType('video/webm')).toBe(true);
    expect(isAllowedUploadMimeType('video/3gpp')).toBe(true);
  });
});
