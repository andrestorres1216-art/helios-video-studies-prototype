const requestsByIp = new Map();

const textOutput = body => body.content
  ?.filter(item => item.type === 'text')
  .map(item => item.text)
  .join('') || '';

const anthropicContent = content => content.map(item => {
  if (item.type === 'input_text') return { type: 'text', text: item.text };
  if (item.type === 'input_image') {
    const match = String(item.image_url || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!match) throw new Error('Unsupported image format.');
    return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
  }
  throw new Error('Unsupported analysis content.');
});

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: { message: 'Method not allowed' } });
  }

  // Provider credentials belong to the deployment, never to an individual
  // browser. This gives every app user the same configured service while
  // keeping the API key out of localStorage and network requests.
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL;
  if (!openaiKey || !openaiModel) {
    return response.status(503).json({ error: { message: 'Shared AI service is not configured. Contact the app administrator.' } });
  }

  const clientIp = String(request.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recentRequests = (requestsByIp.get(clientIp) || []).filter(time => now - time < 60 * 60 * 1000);
  // A full 3-minute study can require many Azure-safe image batches. This is
  // intentionally a generous abuse safeguard, not an evidence-quality cap.
  if (recentRequests.length >= 2_000) {
    return response.status(429).json({ error: { message: 'Analysis limit reached. Try again in an hour.' } });
  }
  recentRequests.push(now);
  requestsByIp.set(clientIp, recentRequests);

  if (!request.body || JSON.stringify(request.body).length > 4_000_000) {
    return response.status(413).json({ error: { message: 'Analysis request is too large. Use fewer or shorter videos.' } });
  }

  try {
    const { provider: _provider, azureEndpoint: _azureEndpoint, model: _model, ...openaiBody } = request.body;
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ ...openaiBody, model: openaiModel }),
    });
    const body = await upstream.text();
    response.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
  } catch {
    response.status(502).json({ error: { message: 'The analysis service could not be reached. Please try again.' } });
  }
};
