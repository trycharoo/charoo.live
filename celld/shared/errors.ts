export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new HttpError(status, message);
}
// RPC transports do not preserve custom Error subclasses. Carry explicit public errors.
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };
export async function result<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof HttpError)
      return { ok: false, status: e.status, message: e.message };
    throw e;
  }
}
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new HttpError(r.status, r.message);
  return r.value;
}
