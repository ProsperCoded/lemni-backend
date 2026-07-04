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

export const ForgotPasswordSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;

export const VerifyResetOtpSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  code: z.string().length(6, { message: 'Code must be exactly 6 characters' }),
});

export type VerifyResetOtpDto = z.infer<typeof VerifyResetOtpSchema>;

export const ResetPasswordWithTokenSchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
  newPassword: z
    .string()
    .min(8, { message: 'New password must be at least 8 characters long' }),
});

export type ResetPasswordWithTokenDto = z.infer<
  typeof ResetPasswordWithTokenSchema
>;
