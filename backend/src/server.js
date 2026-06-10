const http = require("http");
const app = require("./app");
const { initSocket } = require("./socket");
const { port } = require("./config/env");
const prisma = require("./config/db");

const server = http.createServer(app);

initSocket(server);

server.listen(port, () => {
  console.log(`INTEGRITY backend running on port ${port}`);
  warmUpDatabase();
  startKeepAlive();
});

/**
 * Establish the DB connection at boot instead of lazily on the first request.
 * Prisma connects lazily by default, so the very first sign-in after a deploy
 * or cold start pays the full connect cost and can time out. Connecting here
 * (with a couple of retries) means the pool is ready before users arrive.
 */
async function warmUpDatabase(attempt = 1) {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("Database connection warmed up and ready");
  } catch (err) {
    const MAX_ATTEMPTS = 5;
    if (attempt < MAX_ATTEMPTS) {
      const delay = attempt * 2000;
      console.warn(`DB warm-up failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms…`);
      setTimeout(() => warmUpDatabase(attempt + 1), delay);
    } else {
      console.error("DB warm-up failed after max attempts:", err.message);
    }
  }
}

/**
 * Keep-alive self-ping.
 *
 * Free-tier hosts (Render, Railway, Fly.io) spin down services after
 * ~15 minutes of inactivity, causing 20-50 second "cold start" delays
 * for the next real request.  Pinging /health every 10 minutes keeps
 * the process warm at no additional cost.
 *
 * The ping only starts when the server has a PUBLIC_URL configured
 * (set that env var on your hosting dashboard to the backend's URL,
 * e.g. https://your-app.onrender.com).  In local dev it is skipped.
 */
function startKeepAlive() {
  const selfUrl = process.env.PUBLIC_URL;
  if (!selfUrl) return; // local dev — no ping needed

  const https = selfUrl.startsWith("https") ? require("https") : require("http");
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  setInterval(() => {
    https.get(`${selfUrl}/health`, (res) => {
      res.resume(); // drain response so the socket is freed
    }).on("error", () => {}); // silently ignore transient failures
  }, INTERVAL_MS);

  console.log(`Keep-alive ping enabled → ${selfUrl}/health every 10 min`);
}

module.exports = server;
