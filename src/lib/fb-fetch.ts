// Helper fetch FB Graph API với token trong Authorization header thay vì query string.
// Lý do: ?access_token=... vào FB access log, log proxy, Next.js fetch instrumentation
// → leak token. Bearer header thì không bị log mặc định.

export function fbHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(extra || {}),
  }
}

// fbGet: GET với token Bearer header. Trả raw response để caller tự .json()
export function fbGet(url: string, token: string): Promise<Response> {
  return fetch(url, { headers: fbHeaders(token) })
}

// fbPost: POST với token Bearer header. body = URLSearchParams hoặc string.
export function fbPost(url: string, token: string, body: URLSearchParams | string | FormData): Promise<Response> {
  return fetch(url, { method: "POST", headers: fbHeaders(token), body })
}

// fbDelete: DELETE với token Bearer header.
export function fbDelete(url: string, token: string): Promise<Response> {
  return fetch(url, { method: "DELETE", headers: fbHeaders(token) })
}
