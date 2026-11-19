// Relay: receives commands from the Vercel panel and runs ffmpeg -> Telegram RTMP.
// Zero npm dependencies. Needs Node 18+ and ffmpeg on PATH.
const http = require("http");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.RELAY_TOKEN;
if (!TOKEN) { console.error("Set RELAY_TOKEN"); process.exit(1); }

const HEIGHTS = { "480p": 480, "720p": 720, "1080p": 1080 };
const BITRATES = { "480p": 900, "720p": 2500, "1080p": 4500 };

let proc = null, startedAt = 0, liveAt = 0, restarts = 0, wantRunning = false;
let cfg = null, logs = [];

const log = (line) => { logs.push(line); if (logs.length > 150) logs.shift(); };
const redact = (s) => (cfg && cfg.key ? s.split(cfg.key).join("****") : s);

function buildArgs(c) {
  const h = HEIGHTS[c.quality] || 720;
  const kbps = c.bitrate > 0 ? c.bitrate : BITRATES[c.quality] || 2500;
  const a = ["-hide_banner", "-loglevel", "info", "-stats_period", "5"];
  if (c.source === "url") {
    if (c.loop) a.push("-stream_loop", "-1");
    a.push("-re", "-i", c.url);
  } else {
    a.push("-re", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
           "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100");
  }
  a.push("-vf", `scale=-2:${h},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-b:v", kbps + "k", "-maxrate", kbps + "k", "-bufsize", kbps * 2 + "k",
    "-g", "60", "-r", "30",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100");
  if (c.mute) a.push("-af", "volume=0");
  const base = c.server.endsWith("/") ? c.server : c.server + "/";
  a.push("-f", "flv", base + c.key);
  return a;
}

function launch() {
  startedAt = Date.now(); liveAt = 0;
  log(`[relay] starting ffmpeg (${cfg.source}, ${cfg.quality})`);
  proc = spawn("ffmpeg", buildArgs(cfg), { stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", (d) => {
    for (const l of redact(d.toString()).split(/\r|\n/).filter(Boolean)) {
      if (!liveAt && /frame=|time=/.test(l)) liveAt = Date.now();
      log(l.slice(0, 300));
    }
  });
  proc.on("error", (e) => { log("[relay] " + e.message); proc = null; wantRunning = false; });
  proc.on("exit", (code) => {
    log(`[relay] ffmpeg exited (${code})`);
    proc = null;
    if (wantRunning && cfg.autoRestart && restarts < 5) {
      restarts++; log(`[relay] auto-restart ${restarts}/5 in 3s`);
      setTimeout(() => { if (wantRunning && !proc) launch(); }, 3000);
    } else wantRunning = false;
  });
}

function stop() {
  wantRunning = false;
  return new Promise((resolve) => {
    if (!proc) return resolve();
    proc.once("exit", resolve);
    proc.kill("SIGTERM");
    setTimeout(() => proc && proc.kill("SIGKILL"), 4000);
  });
}

function validate(b) {
  if (!/^rtmps?:\/\//i.test(b.server || "")) return "Server URL must start with rtmp:// or rtmps://";
  if (!b.key) return "Stream key is required.";
  if (/[\s"'`$;&|<>]/.test(b.server + b.key)) return "Server URL or key has invalid characters.";
  if (b.source === "url" && !/^(https?|rtmps?):\/\//i.test(b.url || "")) return "Source URL must start with http(s):// or rtmp(s)://";
  return null;
}

function status() {
  const running = !!proc;
  return {
    state: running ? (liveAt ? "live" : "starting") : "offline",
    uptime: running ? (Date.now() - startedAt) / 1000 : 0,
    restarts,
    config: cfg ? { source: cfg.source, quality: cfg.quality } : { source: "-", quality: "-" },
    logs,
  };
}

async function begin(b) {
  const err = validate(b);
  if (err) return [400, { error: err }];
  await stop();
  cfg = {
    server: b.server, key: b.key, source: b.source === "url" ? "url" : "test", url: b.url || "",
    quality: HEIGHTS[b.quality] ? b.quality : "720p", bitrate: Math.min(Math.max(+b.bitrate || 0, 0), 8000),
    loop: b.loop !== false, mute: !!b.mute, autoRestart: b.autoRestart !== false,
  };
  restarts = 0; wantRunning = true; logs = [];
  launch();
  return [200, status()];
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== "Bearer " + TOKEN) return send(401, { error: "Unauthorized" });
  let raw = "";
  req.on("data", (d) => { raw += d; if (raw.length > 1e5) req.destroy(); });
  req.on("end", async () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: "Bad JSON" }); }
    const path = req.url.split("?")[0];
    if (req.method === "GET" && path === "/status") return send(200, status());
    if (req.method === "POST" && (path === "/start" || path === "/restart")) { const [c, o] = await begin(body); return send(c, o); }
    if (req.method === "POST" && path === "/stop") { await stop(); log("[relay] stopped"); return send(200, status()); }
    send(404, { error: "Not found" });
  });
});

server.listen(PORT, () => console.log("relay on :" + PORT));
process.on("SIGTERM", async () => { await stop(); process.exit(0); });
