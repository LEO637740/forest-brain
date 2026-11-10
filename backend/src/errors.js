export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}
export const invariant = (condition, code, message, status = 400, details) => {
  if (!condition) throw new AppError(code, message, status, details);
};
