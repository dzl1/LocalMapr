type ApiErrorPayload = {
  error?: string;
};

export async function readApiResponse<T extends ApiErrorPayload>(
  response: Response,
  fallbackError: string,
) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as T;
    } catch {
      return {
        error: `${fallbackError} Server returned invalid JSON with status ${response.status}.`,
      } as T;
    }
  }

  const text = await response.text();

  return {
    error: text.trim() || `${fallbackError} Status ${response.status}.`,
  } as T;
}
