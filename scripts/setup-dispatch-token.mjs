// Give the Worker GITHUB_DISPATCH_TOKEN, so a pasted list fills in about a
// minute instead of on the next scheduled sync (roughly fifteen minutes).
//
//   npm run setup:dispatch
//
// Optional: without the token every list is still read, just on the schedule.
// Run it from the repository root on a machine signed in with `wrangler login`.
// Node rather than a shell script because the same command then works in
// PowerShell, cmd and bash alike (on Windows, `bash` from PowerShell is WSL,
// which has neither this checkout's wrangler login nor its node_modules).
//
// The token is read without echo, checked against GitHub from this process,
// handed to wrangler on stdin, and never printed, written to disk, or put on
// any command line.
import { spawn } from "node:child_process";

const REPO = "LunarWerxs/IMDBWatcharr";
const WORKFLOW = "sync-feeds.yml";
const CLOUDFLARE_ACCOUNT_ID = "36d7c731fd0352ef08ea7e46d2d20793";
const PAT_URL =
  "https://github.com/settings/personal-access-tokens/new" +
  "?name=IMDb%20Watcharr%20sync%20dispatch" +
  "&description=Lets%20the%20watcharr.lunarwerx.com%20Worker%20start%20the%20sync-feeds%20workflow" +
  "&target_name=LunarWerxs&expires_in=none&actions=write";

function openInBrowser(url) {
  // No shell anywhere: cmd would read the "&" in the URL as a command separator.
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // The link is printed below as well.
  }
}

/** Read one line from the terminal without showing it. */
function readSecret(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const input = process.stdin;
    input.setEncoding("utf8");

    if (!input.isTTY) {
      let piped = "";
      input.on("data", (chunk) => (piped += chunk));
      input.on("end", () => resolve(piped.trim()));
      return;
    }

    let value = "";
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stdout.write("\n");
      resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") {
          input.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

/** Ask for a queue-only sync run: exactly what the Worker will do with the token. */
async function testDispatch(token) {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "imdbwatcharr-setup",
      },
      body: JSON.stringify({ ref: "main", inputs: { scope: "requested" } }),
    });
    return response.status;
  } catch {
    return 0;
  }
}

function putWorkerSecret(token) {
  return new Promise((resolve) => {
    // shell: true because npx is a .cmd on Windows; only fixed words go through
    // it, the token travels on stdin.
    const child = spawn("npx wrangler secret put GITHUB_DISPATCH_TOKEN", {
      shell: true,
      stdio: ["pipe", "ignore", "inherit"],
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID },
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.end(token);
  });
}

async function main() {
  console.log(`1. A GitHub page opens for a new fine-grained token. Check that it has:
     Resource owner:     LunarWerxs
     Repository access:  Only select repositories -> IMDBWatcharr
     Permissions:        Actions -> Read and write (nothing else)
   then press Generate token and copy it.
2. Paste it here and press Enter. Nothing shows while you paste.
   (if no page opened: ${PAT_URL})
`);
  openInBrowser(PAT_URL);

  const token = await readSecret("Token: ");
  if (!token) {
    console.log("No token pasted; nothing changed.");
    return 1;
  }

  const status = await testDispatch(token);
  if (status !== 204) {
    console.log(
      `GitHub answered ${status || "nothing (no connection)"} to a test dispatch. Check the token's repository and its ` +
        "Actions permission. If LunarWerxs has to approve new tokens, an owner approves it under the organization's " +
        "Settings, Personal access tokens, Pending requests. Then run this again.",
    );
    return 1;
  }
  console.log("GitHub accepted a test dispatch.");

  if ((await putWorkerSecret(token)) !== 0) {
    console.log("wrangler could not set the secret (is this machine signed in with `npx wrangler login`?). Nothing else changed.");
    return 1;
  }
  console.log("GITHUB_DISPATCH_TOKEN is set on the Worker. New lists now fill in about a minute.");
  return 0;
}

// exitCode rather than process.exit(): exiting while stdin's pipe is still
// closing trips a libuv assertion on Windows.
process.exitCode = await main();
