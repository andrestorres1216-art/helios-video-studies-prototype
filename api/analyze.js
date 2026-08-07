const requestsByIp = new Map();

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const authorization = request.headers.authorization;
  if (!authorization) {
    return response.status(401).json({ error: { message: 'Add an API key in AI Settings before running analysis.' } });
  }

  const clientIp = String(request.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recentRequests = (requestsByIp.get(clientIp) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recentRequests.length >= 12) {
    return response.status(429).json({ error: { message: 'Analysis limit reached. Try again in an hour.' } });
  }
  recentRequests.push(now);
  requestsByIp.set(clientIp, recentRequests);

  if (!request.body || JSON.stringify(request.body).length > 4_000_000) {
    return response.status(413).json({ error: { message: 'Analysis request is too large. Use fewer or shorter videos.' } });
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify(request.body),
    });
    const body = await upstream.text();
    response.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
  } catch {
    response.status(502).json({ error: { message: 'The analysis service could not be reached. Please try again.' } });
  }
};
