// Vercel serverless proxy: browser -> this function -> your relay (ffmpeg host).
// Keeps RELAY_TOKEN secret and gates access with APP_PASSWORD.
const ALLOWED = { start: "POST", stop: "POST", restart: "POST", status: "GET" };

module.exports = async (req, res) => {
  const { RELAY_URL, RELAY_TOKEN, APP_PASSWORD } = process.env;
  if (!RELAY_URL || !RELAY_TOKEN || !APP_PASSWORD) {
    return res.status(500).json({ error: "Set RELAY_URL, RELAY_TOKEN and APP_PASSWORD in Vercel environment variables." });
  }
  if (req.headers["x-app-password"] !== APP_PASSWORD) {
    return res.status(401).json({ error: "Wrong password." });
  }
  const action = String(req.query.action || "");
  if (!ALLOWED[action] || ALLOWED[action] !== req.method) {
    return res.status(400).json({ error: "Unknown action." });
  }
  try {
    const r = await fetch(RELAY_URL.replace(/\/$/, "") + "/" + action, {
      method: req.method,
      headers: { "content-type": "application/json", authorization: "Bearer " + RELAY_TOKEN },
      body: req.method === "POST" ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Relay unreachable: " + e.message });
  }
};
