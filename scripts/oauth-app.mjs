// Open GitHub's "New OAuth App" form, prefilled for esp32-mcp. GitHub accepts
// oauth_application[name|url|callback_url] as query params; the rest isn't
// prefillable. Mirrors ccw's `make oauth-app`.
//
//   npm run oauth-app
//   npm run oauth-app -- --callback http://localhost:8787/callback   # a dev app
//
// Unlike ccw (device flow, no secret), esp32-mcp uses the auth-code flow: after
// creating the app you must generate a Client Secret, and the callback URL must
// match your deployed host + /callback.

import { spawn } from "node:child_process";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const name = arg("name", "esp32-mcp");
const homepage = arg("homepage", "https://neves.cloud/esp32-mcp");
const callback = arg("callback", "https://esp32-mcp.neves.cloud/callback");

const url =
  "https://github.com/settings/applications/new?" +
  `oauth_application[name]=${encodeURIComponent(name)}` +
  `&oauth_application[url]=${encodeURIComponent(homepage)}` +
  `&oauth_application[callback_url]=${encodeURIComponent(callback)}`;

console.log(`
Register a new GitHub OAuth App with these values:
  Application name:           ${name}
  Homepage URL:               ${homepage}
  Authorization callback URL: ${callback}

Not prefillable — do these in / after the form:
  1. Create the app, then "Generate a new client secret".
  2. Set both on the Worker (never commit them):
       wrangler secret put GITHUB_CLIENT_ID
       wrangler secret put GITHUB_CLIENT_SECRET
  3. The callback above MUST match your deployed host + /callback.
     Local dev:  npm run oauth-app -- --callback http://localhost:8787/callback
`);

const opener =
  process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
const child = spawn(opener, [url], {
  stdio: "ignore",
  detached: true,
  shell: process.platform === "win32",
});
child.on("error", () => console.log(`Open this URL manually:\n${url}`));
child.unref();
