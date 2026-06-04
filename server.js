// Pit Road — Local Server
// Serves the app and proxies Anthropic API calls (keeps your API key off the browser)

require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Diagnostic endpoint ───────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const keyStatus = !apiKey || apiKey === 'your_api_key_here'
    ? 'MISSING'
    : `SET (starts with ${apiKey.slice(0,8)}...)`;

  // Try a minimal ping to Anthropic
  let anthropicReachable = false;
  let anthropicError = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const d = await r.json();
    if (r.ok) { anthropicReachable = true; }
    else { anthropicError = d.error?.message || JSON.stringify(d.error) || `HTTP ${r.status}`; }
  } catch (e) { anthropicError = e.message; }

  console.log(`[health] key=${keyStatus} anthropic=${anthropicReachable ? 'OK' : anthropicError}`);
  res.json({ keyStatus, anthropicReachable, anthropicError });
});

// ── Claude API Proxy ──────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log(`[claude] incoming request, model=${req.body?.model}, hasImage=${JSON.stringify(req.body?.messages?.[0]?.content)?.includes('"image"')}`);

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('[claude] API key not set');
    return res.status(500).json({
      error: 'API key not configured. Open the .env file and paste your Anthropic key.'
    });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[claude] Anthropic error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data.error?.message || data.error || 'API error' });
    }

    console.log(`[claude] OK, tokens used=${data.usage?.input_tokens}+${data.usage?.output_tokens}`);
    res.json(data);
  } catch (err) {
    console.error('[claude] Fetch error:', err.message);
    res.status(500).json({ error: err.message || 'Could not reach Anthropic API' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

// Find the machine's local network IP so the user can open it on their phone
const getLocalIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'unknown';
};

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n🏁  PIT ROAD is running!\n');
  console.log(`   On this computer:  http://localhost:${PORT}`);
  console.log(`   On your phone:     http://${ip}:${PORT}  (same WiFi)\n`);
  console.log('   Press Ctrl+C to stop.\n');
});
