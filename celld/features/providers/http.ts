import { HttpError } from "../../shared/errors";
export async function providerFetch(
  url: string,
  init: RequestInit,
  message: string,
) {
  try {
    return await fetch(url, init);
  } catch {
    throw new HttpError(503, message);
  }
}
