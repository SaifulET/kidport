import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    fullName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    identity: z.enum(['mother', 'father', 'parent', 'nanny', 'daycare'])
  })
});

export const loginSchema = z.object({
  body: z.object({ email: z.string().email(), password: z.string().min(1) })
});

export const refreshSchema = z.object({ body: z.object({ refreshToken: z.string().min(1) }) });
