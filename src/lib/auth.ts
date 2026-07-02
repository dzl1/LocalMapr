type EmailVerificationUser = {
  confirmed_at?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
};

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Please verify your email before signing in. Check your inbox for the confirmation link.";

export function isUserEmailVerified(user?: EmailVerificationUser | null) {
  return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}
