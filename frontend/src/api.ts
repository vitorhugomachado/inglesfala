// A deployment or an expired visitor cookie can invalidate an open tab's access.
// Reload the public entry point to renew its HttpOnly cookie, then retry once.
export async function tutorFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(path, options);
  if (response.status !== 401) return response;
  const renewed = await fetch('/', { cache: 'no-store', credentials: 'same-origin', signal: options.signal });
  if (!renewed.ok) throw new Error('Não consegui reconectar ao tutor. Tente novamente em instantes.');
  return fetch(path, options);
}
