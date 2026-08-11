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

  const authorization = request.headers.authorization;
  if (!authorization) {
    return response.status(401).json({ error: { message: 'Add an API key in AI Settings before running analysis.' } });
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

  const provider = request.body.provider || 'openai';
  if (!['openai', 'anthropic', 'azure-openai'].includes(provider)) {
    return response.status(400).json({ error: { message: 'Choose a supported provider in AI Settings.' } });
  }

  try {
    if (provider === 'azure-openai') {
      const endpoint = String(request.body.azureEndpoint || '').replace(/\/+$/, '');
      if (!/^https:\/\/[a-z0-9-]+\.openai\.azure\.com\/openai\/v1$/i.test(endpoint)) {
        return response.status(400).json({ error: { message: 'Use a valid Azure OpenAI /openai/v1 endpoint.' } });
      }
      const { provider: _provider, azureEndpoint: _azureEndpoint, ...azureBody } = request.body;
      const upstream = await fetch(`${endpoint}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': authorization.replace(/^Bearer\s+/i, '') },
        body: JSON.stringify(azureBody),
      });
      const body = await upstream.text();
      return response.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
    }

    if (provider === 'anthropic') {
      const message = request.body.input?.find(item => item.role === 'user');
      if (!message?.content) return response.status(400).json({ error: { message: 'Analysis request is missing content.' } });
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': authorization.replace(/^Bearer\s+/i, ''),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.body.model || 'claude-opus-5',
          max_tokens: 4096,
          messages: [{ role: 'user', content: anthropicContent(message.content) }],
        }),
      });
      const body = await upstream.json();
      if (!upstream.ok) return response.status(upstream.status).json(body);
      return response.status(200).json({ output_text: textOutput(body), provider: 'anthropic' });
    }

    const { provider: _provider, ...openaiBody } = request.body;
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify(openaiBody),
    });
    const body = await upstream.text();
    response.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
  } catch {
    response.status(502).json({ error: { message: 'The analysis service could not be reached. Please try again.' } });
  }
};
