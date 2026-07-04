import { z } from 'zod';

export const SignupSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' }),
  name: z.string().min(1, { message: 'Name is required' }),
});

export type SignupDto = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

export type LoginDto = z.infer<typeof LoginSchema>;

export const ResetPasswordSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  oldPassword: z.string().min(1, { message: 'Old password is required' }),
  newPassword: z
    .string()
    .min(8, { message: 'New password must be at least 8 characters long' }),
});

export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
