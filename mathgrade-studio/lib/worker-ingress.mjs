/** Public Workers receive untrusted headers; only Sites dispatch may assert these identities. */
export function standaloneRequest(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("oai-authenticated-user-")) headers.delete(name);
  }
  return new Request(request, { headers });
}
