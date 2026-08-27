import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { SocialResponseService } from '../src/services/SocialResponseService';

describe('SocialResponseService observation response', () => {
  it('includes domain details at the top level', () => {
    const domainId = new Types.ObjectId();
    const response = SocialResponseService.observation({
      _id: new Types.ObjectId(),
      text: 'Shared a story with a caregiver.',
      domainId: {
        _id: domainId,
        name: 'Language & Literacy',
        slug: 'language-literacy'
      },
      createdAt: new Date(),
      media: []
    });

    expect(response.domain).toEqual({
      id: domainId.toString(),
      name: 'Language & Literacy',
      slug: 'language-literacy'
    });
    expect(response.domainId).toBe(domainId.toString());
    expect(response.domainName).toBe('Language & Literacy');
  });
});
