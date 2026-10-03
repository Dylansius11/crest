/**
 * Ships the committed HEAD (never the working tree) to the VPS, builds one immutable image tagged by commit,
 * and swaps the selected services only after each reports healthy. Schema migrations stay an operator step
 * (`supabase db push --db-url <session pooler URL>` from a workstation), never part of a deploy.
 *
 *   node deploy/vps/deploy.ts                    deploy HEAD (relay, api, monitor, custos)
 *   node deploy/vps/deploy.ts --services "relay api monitor"
 *   node deploy/vps/deploy.ts --rollback <sha>   restart a previous release without rebuilding
 *
 * CREST_VPS_SSH (default `crest-vps`) is an OpenSSH host alias with key auth.
 * CREST_PUBLIC_API_URL (default below) is checked after the swap.
 */
import { spawn, spawnSync } from "node:child_process";

const HOST = process.env.CREST_VPS_SSH ?? "crest-vps";
const PUBLIC_API = process.env.CREST_PUBLIC_API_URL ?? "https://crest-api.43-129-38-115.nip.io";
const KEEP_RELEASES = 3;
const SERVICE_SECRETS: Record<string, string | null> = { relay: null, api: "api.env", monitor: "monitor.env", custos: "custos.env" };

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function git(...args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0] ?? ""} failed`);
  return result.stdout.trim();
}

function ssh(command: string, input: "script" | "archive", source?: string | NodeJS.ReadableStream): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn("ssh", ["-o", "BatchMode=yes", HOST, command], { stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", reject);
  child.on("exit", (code: number | null) => (code === 0 ? resolve() : reject(new Error(`${input} step exited ${String(code)}`))));
  if (typeof source === "string") child.stdin.end(source);
  else source?.pipe(child.stdin);
  return promise;
}

/**
 * Exports repository blobs exactly: a Windows checkout's core.autocrlf would otherwise turn every line ending
 * into CRLF, which breaks .dockerignore negations. Extraction keeps default modes so the image's non-root user
 * can read the code; ~/crest itself stays mode 700.
 */
function upload(release: string): Promise<void> {
  const archive = spawn("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", release], { stdio: ["ignore", "pipe", "inherit"] });
  const target = `crest/releases/${release}`;
  return ssh(`set -eu; rm -rf ${target}; mkdir -p ${target}; tar -x -C ${target}`, "archive", archive.stdout);
}

/** Stored before running: executed from stdin, `docker compose` would read the rest of the script as input. */
function remote(script: string): Promise<void> {
  return ssh("umask 077; cat > crest/.deploy.sh && bash crest/.deploy.sh < /dev/null", "script", script);
}

function swap(release: string, services: readonly string[], build: boolean): string {
  const secrets = services.flatMap((service) => {
    const file = SERVICE_SECRETS[service];
    return file ? [file] : [];
  });
  return `
set -euo pipefail
cd "$HOME/crest/releases/${release}"
export CREST_RELEASE=${release} CREST_SECRETS_DIR="$HOME/crest"
for f in ${secrets.join(" ")}; do
  test -f "$CREST_SECRETS_DIR/$f" || { echo "missing $CREST_SECRETS_DIR/$f"; exit 1; }
done
compose="docker compose -f deploy/vps/compose.yml"
${build ? "$compose build relay" : ""}
$compose up -d --no-deps --wait --wait-timeout 240 ${services.join(" ")}
ln -sfn "releases/${release}" "$HOME/crest/current"
cd "$HOME/crest/releases"
ls -1t | tail -n +$((${KEEP_RELEASES} + 1)) | while read -r old; do
  [ "$old" = "${release}" ] && continue
  rm -rf "$old"; docker image rm "crest:$old" >/dev/null 2>&1 || true
done
docker compose -p crest ps --format '{{.Name}} {{.Status}}'
`;
}

async function publicCheck(): Promise<void> {
  const health = await fetch(`${PUBLIC_API}/health`);
  if (!health.ok) throw new Error(`/health returned ${health.status}`);
  const route = await fetch(`${PUBLIC_API}/v1/route`);
  if (!route.ok) throw new Error(`/v1/route returned ${route.status}`);
  const rpc = await fetch(`${PUBLIC_API}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  if (!rpc.ok) throw new Error(`/rpc returned ${rpc.status}`);
  console.log(`${PUBLIC_API} health ok, route ok, rpc ${JSON.stringify(await rpc.json())}`);
}

const services = (argument("--services") ?? "relay api monitor custos").split(/\s+/u).filter((name) => name !== "");
for (const service of services) {
  if (!(service in SERVICE_SECRETS)) throw new Error(`unknown service ${service}`);
}

const rollback = argument("--rollback");
if (rollback !== undefined) {
  if (!/^[0-9a-f]{12}$/u.test(rollback)) throw new Error("--rollback needs a 12-character release commit");
  await remote(swap(rollback, services, false));
} else {
  const release = git("rev-parse", "--short=12", "HEAD");
  if (git("status", "--porcelain", "--untracked-files=no") !== "") console.warn("note: uncommitted changes are not shipped; deploying HEAD");
  console.log(`deploying ${release} (${services.join(", ")}) to ${HOST}`);
  await upload(release);
  await remote(swap(release, services, true));
}
if (services.includes("api") || services.includes("relay")) await publicCheck();
