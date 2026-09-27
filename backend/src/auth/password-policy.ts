export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 100;

// Returns why the password is too weak, or null if it is acceptable. Used for sign-up and password changes.
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain both letters and numbers.';
  if (password.trim() !== password) return 'Password must not start or end with a space.';
  return null;
}
