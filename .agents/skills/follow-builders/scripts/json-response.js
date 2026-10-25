// Never include remote bodies, URLs, headers, or parser exception text in errors:
// they may contain credentials or private Telegram data.
export async function readJSONResponse(response, operation) {
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentType = ['application/json', 'text/plain', 'text/html', 'application/problem+json'].includes(mime)
    ? mime : 'other-or-missing';
  const context = `${operation} (HTTP ${response.status}; Content-Type ${contentType})`;
  let text;
  try { text = await response.text(); }
  catch { throw new Error(`${context}: response body could not be read; details omitted`); }
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${context}: expected JSON object, received non-JSON response; body omitted`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: expected JSON object; body omitted`);
  }
  return value;
}
