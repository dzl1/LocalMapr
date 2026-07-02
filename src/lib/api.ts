type ApiErrorPayload = {
  error?: string;
};

export async function readApiResponse<T extends ApiErrorPayload>(
  response: Response,
  fallbackError: string,
) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const text = await response.text();

  return {
    error: text.trim() || fallbackError,
  } as T;
}
