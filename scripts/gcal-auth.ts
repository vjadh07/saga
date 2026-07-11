// One-time Google Calendar OAuth, installed-app loopback flow. Needs a Google
// Cloud OAuth client (desktop type) with the Calendar API enabled. Prints the
// consent URL, catches the redirect on 127.0.0.1:4300, saves the token to
// .secrets/gcal-token.json. Run: npm run gcal-auth
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { google } from "googleapis";

try {
  process.loadEnvFile();
} catch {
  // no .env file is fine, the vars may already be exported
}

const clientId = process.env.GCAL_CLIENT_ID;
const clientSecret = process.env.GCAL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("set GCAL_CLIENT_ID and GCAL_CLIENT_SECRET first (see .env.example)");
  process.exit(2);
}

const port = Number(process.env.GCAL_AUTH_PORT ?? 4300);
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `http://127.0.0.1:${port}`);

const url = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/calendar.events"],
  prompt: "consent",
});

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const got = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).searchParams.get("code");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(got ? "saga: calendar authorized, you can close this tab" : "no code in redirect");
    if (got) {
      server.close();
      resolve(got);
    }
  });
  server.on("error", reject);
  server.listen(port, "127.0.0.1", () => {
    console.log("open this URL, pick your account, approve calendar access:\n");
    console.log(url + "\n");
    console.log(`waiting for the redirect on http://127.0.0.1:${port} ...`);
  });
});

const { tokens } = await oauth2.getToken(code);
mkdirSync(".secrets", { recursive: true });
writeFileSync(".secrets/gcal-token.json", JSON.stringify(tokens, null, 2));
console.log("token saved to .secrets/gcal-token.json");
