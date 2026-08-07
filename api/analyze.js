module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const authorization = request.headers.authorization;
  if (!authorization) {
    return response.status(401).json({ error: { message: 'Add an API key in AI Settings before running analysis.' } });
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
