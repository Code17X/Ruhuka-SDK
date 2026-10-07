export const MAX_LOGIN_EMAIL_BYTES = 254;
export const MAX_LOGIN_PASSWORD_BYTES = 1024;

export function isValidLoginInput(
  email: unknown,
  password: unknown,
): email is string {
  if (typeof email !== "string" || typeof password !== "string") return false;
  const normalizedEmail = email.trim();
  const emailParts = normalizedEmail.split("@");
  return (
    normalizedEmail.length > 0 &&
    Buffer.byteLength(normalizedEmail, "utf8") <= MAX_LOGIN_EMAIL_BYTES &&
    emailParts.length === 2 &&
    emailParts[0]!.length > 0 &&
    emailParts[1]!.length > 0 &&
    !/\s|[\u0000-\u001f\u007f]/u.test(normalizedEmail) &&
    Buffer.byteLength(password, "utf8") > 0 &&
    Buffer.byteLength(password, "utf8") <= MAX_LOGIN_PASSWORD_BYTES
  );
}
