export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages, system } = req.body;
    const contents = [
      { role: 'user', parts: [{ text: system + '\n\n' + messages[0].content }] },
      ...messages.slice(1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
      }
    );
    const data = await response.json();
    if (!data.candidates) return res.status(500).json({ debug: data });
    const text = data.candidates[0].content.parts[0].text || '';
    res.status(200).json({ content: [{ text }] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
