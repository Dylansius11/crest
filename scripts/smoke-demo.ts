import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPublicClient, decodeErrorResult, decodeEventLog, encodeDeployData, encodeFunctionData, getAddress, http, parseAbi, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { crestAccountAbi, crestAccountCreationBytecode, GUARDIAN_SELECTORS } from "../packages/contracts/src/index.ts";
import { loadDeploymentManifest } from "../packages/contracts/src/manifest-file.ts";
import { compilePolicy, policyStagingMessage, routeContextOf } from "../packages/policy/src/index.ts";

// Every RPC endpoint is loopback; chain ID, Anvil client, and relay fork identity are checked before using the public dev key.
const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = fileURLToPath(new URL("../config/deployment-manifest.46630.json", import.meta.url));
const forkUrl = "http://127.0.0.1:8545";
const relayUrl = "http://127.0.0.1:8604";
const apiUrl = "http://127.0.0.1:8788";
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/crest_demo";
const faucetOwner = getAddress("0x712683F374Cd524F6336E87D577Fc39d1102930A");
const owner = getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const guardian = getAddress("0x4fd1139714C571Fc49BF26fFaA0375Adb137f271");
const exec = promisify(execFile);
const abi = crestAccountAbi as Abi;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const vaultAbi = parseAbi(["function previewDeposit(uint256) view returns (uint256)", "function previewWithdraw(uint256) view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
const feedAbi = parseAbi(["function set(int256)"]);
const MORPHO_ABI = parseAbi(["function position(bytes32,address) view returns (uint256 supplyShares,uint128 borrowShares,uint128 collateral)"]);
const client = createPublicClient({ transport: http(forkUrl) });
const json = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item, 2);
const step = (title: string, detail: unknown) => console.log(`[FORK] ${title}: ${json(detail)}`);
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(forkUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("result" in payload)) throw new Error(`${method} failed: ${json(payload)}`);
  return payload.result;
}
async function rows<T>(sql: string): Promise<T[]> {
  const { stdout } = await exec("docker", ["exec", "supabase_db_crest", "psql", "-U", "postgres", "-d", "crest_demo", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select coalesce(json_agg(r), '[]'::json) from (${sql}) r`], { cwd: root, timeout: 30_000 });
  return JSON.parse(stdout.trim()) as T[];
}
async function run(args: string[], cwd: string, guardianKey = false) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, ROBINHOOD_CHAIN_RPC_URL: forkUrl,
    DEPLOYMENT_MANIFEST_PATH: manifestPath, GUARDIAN_EXPECTED_CHAIN_ID: "46630", GUARDIAN_EXPECTED_ADDRESS: guardian,
    GUARDIAN_ALLOWED_ACCOUNT: account, CREST_ACCOUNT_ADDRESS: account };
  delete env.GUARDIAN_PRIVATE_KEY;
  const command = guardianKey ? ["--env-file=../../.env", ...args] : args;
  const { stdout } = await exec("node", command, { cwd, env, timeout: 240_000, maxBuffer: 2_000_000 });
  return stdout.trim();
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(`API ${path} HTTP ${response.status}: ${json(result)}`);
  return result as T;
}
async function transaction(label: string, from: Address, to: Address | undefined, data: Hex, evidence: Record<string, unknown>) {
  const hash = await rpc("eth_sendTransaction", [{ from, ...(to ? { to } : {}), data, gas: "0x5b8d80" }]) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `${label} reverted: ${hash}`);
  evidence[label] = { hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(), status: receipt.status };
  step(label, evidence[label]);
  return receipt;
}
const call = (address: Address, functionName: string, args: readonly unknown[] = []) => client.readContract({ address, abi, functionName, args } as never) as Promise<bigint | boolean>;
const encode = (functionName: string, args: readonly unknown[] = []) => encodeFunctionData({ abi, functionName, args } as never);
async function waitBlocks(number: bigint) {
  const target = await client.getBlockNumber() + number;
  while (await client.getBlockNumber() < target) await new Promise((resolve) => setTimeout(resolve, 1000));
}
function resultLine(output: string, marker: string): Record<string, unknown> {
  const text = output.split("\n").find((line) => line.startsWith("{") && line.includes(marker));
  assert(text, `missing ${marker} result: ${output}`);
  return JSON.parse(text) as Record<string, unknown>;
}
async function assessment(id: string) {
  assert(/^[a-z0-9-]+$/i.test(id), "invalid assessment id");
  const [row] = await rows<{ status: string; ltv: string | null; morphoHealth: string | null; policyHealth: string | null; ownerBorrowCapacity: string; recommendedAction: string; reasonCodes: string[]; rates: { borrowStatus: string; borrowReasons: string[]; vaultStatus: string; vaultReasons: string[] } }>(
    `select status, ltv_wad::text as ltv, morpho_health_wad::text as "morphoHealth", policy_health_wad::text as "policyHealth", owner_borrow_capacity_assets::text as "ownerBorrowCapacity", recommended_action as "recommendedAction", reason_codes as "reasonCodes",
      json_build_object('borrowStatus', input_json #>> '{rates,borrow,status}', 'borrowReasons', input_json #> '{rates,borrow,reasons}',
      'vaultStatus', input_json #>> '{rates,vault,status}', 'vaultReasons', input_json #> '{rates,vault,reasons}') as rates
      from risk_assessments where id='${id}'`);
  assert(row, `assessment ${id} missing`);
  return row;
}
async function observe() {
  const output = await run(["src/main.ts", "--once"], `${root}apps/monitor`);
  const line = resultLine(output, '"service":"crest-monitor"');
  assert(typeof line.assessmentId === "string", `monitor emitted no assessment: ${output}`);
  const state = await assessment(line.assessmentId);
  step("monitor assessment", { ...line, ...state });
  return { ...line, assessment: state, triggerId: line.triggerId };
}
async function guardianAction(triggerId: string, label: string, evidence: Record<string, unknown>) {
  assert(/^[a-z0-9-]+$/i.test(triggerId), "invalid trigger ID");
  const cwd = `${root}apps/automation`;
  const output = await run(["src/main.ts", "run", "--once", "--trigger-id", triggerId], cwd, true);
  const started = resultLine(output, '"command":"run"');
  assert(typeof started.runId === "string" && typeof started.status === "string", `Custos did not start ${label}: ${output}`);
  await waitBlocks(21n);
  const reconciled = resultLine(await run(["src/main.ts", "reconcile", "--run-id", started.runId], cwd), '"command":"reconcile"');
  assert(reconciled.status === "verified", `${label} not verified: ${json(reconciled)}`);
  const [tx] = await rows<{ hash: string }>(`select '0x' || encode(transaction_hash,'hex') as hash from transaction_attempts where run_id='${started.runId}' order by attempt_number desc limit 1`);
  assert(tx, `${label} transaction hash absent`);
  const receipt = await client.getTransactionReceipt({ hash: tx.hash as Hex });
  assert(receipt.status === "success", `${label} receipt failed`);
  evidence[label] = { hash: tx.hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(), status: receipt.status };
  const checks = await rows<{ kind: string; passed: boolean; expected: unknown; actual: unknown; blockNumber: string }>(`select kind, passed, expected_json as expected, actual_json as actual, checked_block_number::text as "blockNumber" from postcondition_checks where run_id='${started.runId}' order by kind`);
  const requiredChecks = label === "guardianFreeze" ? ["frozen"] : ["debt_decreased", "strategy_floor_held", "vault_receiver_fixed", "repay_beneficiary_fixed"];
  assert(requiredChecks.every((kind) => checks.some((check) => check.kind === kind && check.passed)), `${label} postconditions incomplete: ${json(checks)}`);
  const result = { triggerId, runId: started.runId, startStatus: started.status, status: reconciled.status, transaction: evidence[label], postconditionChecks: checks };
  step(label, result);
  return result;
}
async function forbidden(accountAddress: Address, from: Address, assets: bigint, shares: bigint) {
  try { await client.call({ account: from, to: accountAddress, data: encode("borrowAndDeploy", [assets, shares]) }); }
  catch (error) {
    let current: unknown = error;
    while (current && typeof current === "object") {
      if ("data" in current && typeof current.data === "string" && /^0x[0-9a-f]+$/i.test(current.data)) {
        try {
          const decoded = decodeErrorResult({ abi, data: current.data as Hex });
          return { name: decoded.errorName, selector: current.data.slice(0, 10) };
        } catch { /* Viem also attaches RPC envelope data. */ }
      }
      current = "cause" in current ? current.cause : null;
    }
    throw error;
  }
  throw new Error(`forbidden borrow unexpectedly succeeded for ${from}`);
}

const manifest = await loadDeploymentManifest(manifestPath);
assert(manifest.network.chainId === 46630 && manifest.trust.level === "sandbox" && manifest.gate.outcome === "full_route", "wrong sandbox manifest");
assert((await client.getChainId()) === 46630, "fork must use chain 46630");
const clientVersion = await rpc("web3_clientVersion");
assert(typeof clientVersion === "string" && clientVersion.toLowerCase().includes("anvil"), "refusing any non-Anvil RPC before using the public Anvil dev key");
const relay = createPublicClient({ transport: http(relayUrl) });
const nodeInfo = await rpc("anvil_nodeInfo");
const forkConfig = typeof nodeInfo === "object" && nodeInfo !== null && "forkConfig" in nodeInfo ? nodeInfo.forkConfig : null;
const forkedUrl = typeof forkConfig === "object" && forkConfig !== null && "forkUrl" in forkConfig ? forkConfig.forkUrl : null;
const forkBlockNumber = typeof forkConfig === "object" && forkConfig !== null && "forkBlockNumber" in forkConfig ? forkConfig.forkBlockNumber : null;
assert(forkedUrl === relayUrl && typeof forkBlockNumber === "number" && Number.isSafeInteger(forkBlockNumber), "Anvil must fork the cache-free 8604 relay");
const origin = await relay.getBlock({ blockNumber: BigInt(forkBlockNumber) });
const forkBase = await client.getBlock({ blockNumber: origin.number });
assert(origin.hash && forkBase.hash === origin.hash, "fork origin does not match a relay canonical block; restart Anvil against 8604");
const [preexisting] = await rows<{ count: number }>("select count(*)::int as count from crest_accounts where chain_id=46630");
assert(preexisting?.count === 0, "crest_demo already has an account; use a freshly migrated crest_demo and restart the fork");
await api("/health").catch((error) => { throw new Error(`fork API on 8788 is required: ${String(error)}`); });
await rpc("evm_setIntervalMining", [1]);
const collateral = getAddress(manifest.market.collateralToken);
const loan = getAddress(manifest.market.loanToken);
const vault = getAddress(manifest.vault.address);
const feed = getAddress(manifest.contracts.collateralFeed?.address ?? "");
const balances = await Promise.all([collateral, loan].map((address) => client.readContract({ address, abi: erc20, functionName: "balanceOf", args: [faucetOwner] })));
const inventory = { faucetOwner, faucetTSLA: balances[0].toString(), faucetUSDG: balances[1].toString(), faucetETH: (await client.getBalance({ address: faucetOwner })).toString() };
assert(balances[0] >= 500_000_000_000_000_000n && balances[1] >= 20_000_000n, "faucet owner requires 0.5 TSLA and 20 USDG for fork exit");
step("wallet inventory and intents", { inventory, forkOwner: owner, executable: { asset: collateral, intent: "PROTECT_AND_BORROW", marketId: manifest.market.id }, unsupported: { asset: "AAPL", reason: "no AAPL collateral market or vault in the 46630 sandbox manifest" } });
const route = await api<{ trust: { level: string; disclosures: string[] }; market: unknown; vault: unknown; integrity: { digest: string } }>("/v1/route");
assert(route.trust.level === "sandbox" && route.integrity.digest === manifest.integrity.digest, "fork API route mismatch");
step("exact SANDBOX route", { trust: route.trust, market: route.market, vault: route.vault, integrity: route.integrity });
await rpc("anvil_impersonateAccount", [faucetOwner]);
await rpc("anvil_setBalance", [faucetOwner, "0x56bc75e2d63100000"]);
await rpc("anvil_setBalance", [owner, "0x56bc75e2d63100000"]);
await rpc("anvil_setBalance", [guardian, "0x56bc75e2d63100000"]);
const transactions: Record<string, unknown> = {};
await transaction("forkOnlyFundTSLA", faucetOwner, collateral, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [owner, 1_000_000_000_000_000_000n] }), transactions);
await transaction("forkOnlyFundUSDG", faucetOwner, loan, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [owner, 20_000_000n] }), transactions);
assert(await client.readContract({ address: collateral, abi: erc20, functionName: "balanceOf", args: [owner] }) >= 500_000_000_000_000_000n, "fork owner was not funded with collateral");
const deployment = await transaction("deploy", owner, undefined, encodeDeployData({ abi, bytecode: crestAccountCreationBytecode, args: [owner, getAddress(manifest.contracts.morpho?.address ?? "")] }), transactions);
const account: Address = getAddress(deployment.contractAddress ?? "");
await waitBlocks(21n);
await api("/v1/accounts/register", { transactionHash: deployment.transactionHash, account, owner });
const policy = { schemaVersion: 2, guardian, maxCollateralAssets: "1000000000000000000", debtCeilingAssets: "20000000", maxStrategyAssets: "20000000", reserveFloorAssets: "0", strategyFloorAssets: "0", maxRepayPerActionAssets: "10000000", lowerLtvWad: "50000000000000000", targetLtvWad: "100000000000000000", upperLtvWad: "200000000000000000", criticalLtvWad: "400000000000000000", minimumNetSpreadBps: "0", maxOracleDivergenceBps: "500", harvestThresholdAssets: "1000000", triggers: { freezeOnOracleDegraded: true, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true } };
const intents = [{ asset: collateral, intent: { kind: "PROTECT_AND_BORROW", marketId: manifest.market.id } }, { asset: loan, intent: { kind: "EARN_STABLE", vaultId: `46630:${vault}` } }];
const compiled = compilePolicy({ ...policy, intents }, routeContextOf(manifest, { account, owner }));
assert(compiled.ok, `fork policy rejected: ${compiled.ok ? "" : compiled.issues.join("; ")}`);
const forkDevSigner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
assert(forkDevSigner.address === owner, "Anvil dev account address mismatch");
const ownerSignature = await forkDevSigner.signMessage({ message: policyStagingMessage({ chainId: 46630, account, policyNonce: 1n, policyHash: compiled.policy.policyHash, contentHash: compiled.policy.contentHash }) });
const staged = await api<{ policy: { policyHash: Hex; configurationCall: { from: string; to: string; data: Hex } } }>(`/v1/accounts/${account}/policies`, { owner, policy, intents, ownerSignature });
assert(staged.policy.configurationCall.from.toLowerCase() === owner.toLowerCase() && staged.policy.configurationCall.to.toLowerCase() === account.toLowerCase(), "configuration call authority mismatch");
const configured = await transaction("configure", owner, account, staged.policy.configurationCall.data, transactions);
const configuredEvents = configured.logs.filter((log) => log.address.toLowerCase() === account.toLowerCase()).flatMap((log) => {
  try { return [decodeEventLog({ abi, topics: log.topics, data: log.data })]; } catch { return []; }
});
assert(configuredEvents.some((event) => event.eventName === "PolicyConfigured" && event.args !== undefined && "policyHash" in event.args && event.args.policyHash === staged.policy.policyHash), "PolicyConfigured hash did not match staged policy");
step("owner policy and configured event", { policy, policyHash: staged.policy.policyHash, guardianSelectors: GUARDIAN_SELECTORS });
await transaction("approveCollateral", owner, collateral, encodeFunctionData({ abi: erc20, functionName: "approve", args: [account, 500_000_000_000_000_000n] }), transactions);
await transaction("supplyCollateral", owner, account, encode("supplyCollateral", [500_000_000_000_000_000n]), transactions);
const preview = await client.readContract({ address: vault, abi: vaultAbi, functionName: "previewDeposit", args: [10_000_000n] });
const minShares = preview * 9950n / 10000n;
await transaction("borrowAndDeploy", owner, account, encode("borrowAndDeploy", [10_000_000n, minShares]), transactions);
async function position() {
  const [debt, shares, liquidity, collateralPosition] = await Promise.all([
    call(account, "currentDebtAssets"), client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [account] }),
    call(account, "maxWithdrawableStrategyAssets"), client.readContract({ address: getAddress(manifest.contracts.morpho?.address ?? ""), abi: MORPHO_ABI, functionName: "position", args: [manifest.market.id as Hex, account] }),
  ]);
  return { debtAssets: String(debt), vaultShares: shares.toString(), withdrawableAssets: String(liquidity), collateralAssets: collateralPosition[2].toString() };
}
const borrowed = await position();
assert(BigInt(borrowed.debtAssets) >= 10_000_000n && BigInt(borrowed.vaultShares) > 0n && BigInt(borrowed.withdrawableAssets) > 0n, "borrow state missing");
step("debt, shares, withdrawable and rate caveat", { ...borrowed, previewDepositShares: preview.toString(), minimumVaultShares: minShares.toString(), rates: "No current 46630 Morpho APY is available; monitor checks the source below." });
const reverts = { guardianBorrow: await forbidden(account, guardian, 1_000_000n, 0n), ownerOverCeiling: await forbidden(account, owner, 11_000_000n, 0n) };
assert(reverts.guardianBorrow.name === "OwnableUnauthorizedAccount" && reverts.ownerOverCeiling.name === "DebtCeilingExceeded", `unexpected forbidden call results: ${json(reverts)}`);
step("forbidden borrow selectors", reverts);
await waitBlocks(30n);
const initial = await observe();
assert(initial.assessment.status === "DEGRADED" && typeof initial.triggerId === "string", "expected DEGRADED freeze trigger");
assert(initial.assessment.rates.borrowStatus === "unknown" && initial.assessment.rates.vaultStatus === "unknown", `unexpected 46630 current rate evidence: ${json(initial.assessment.rates)}`);
step("current API rates unreadable", initial.assessment.rates);
const doctor = await run(["--env-file=../../.env", "src/main.ts", "doctor"], `${root}apps/automation`);
assert(JSON.parse(doctor).status === "ok", `Custos doctor did not pass: ${doctor}`);
step("Custos doctor", JSON.parse(doctor));
const freeze = await guardianAction(initial.triggerId, "guardianFreeze", transactions);
assert(await call(account, "borrowingFrozen") === true, "Custos did not freeze borrowing");
// Cheatcode input is deliberately fork-only: no live MockFeed transaction or API write.
const mockFeed = await transaction("forkOnlyMockFeedDrop", owner, feed, encodeFunctionData({ abi: feedAbi, functionName: "set", args: [7_000_000_000n] }), transactions);
assert(mockFeed.status === "success", "mock feed drop did not apply");
await waitBlocks(30n);
const beforeProtect = await position();
const protect = await observe();
assert(protect.assessment.status === "PROTECT" && typeof protect.triggerId === "string", `expected PROTECT after fork-only collateral drop: ${json(protect)}`);
const [trigger] = await rows<{ actionKind: string; requestedAssets: string }>(`select action_kind as "actionKind", requested_assets as "requestedAssets" from automation_triggers where id='${protect.triggerId}'`);
assert(trigger?.actionKind === "repay_strategy", `expected strategy repay trigger: ${json(trigger)}`);
const repay = await guardianAction(protect.triggerId, "guardianStrategyRepay", transactions);
const afterProtect = await position();
assert(BigInt(afterProtect.debtAssets) < BigInt(beforeProtect.debtAssets), "Guardian strategy repayment did not decrease debt");
const repaidAssets = BigInt(beforeProtect.debtAssets) - BigInt(afterProtect.debtAssets);
const policyPostconditions = { guardianRepayWithinCap: repaidAssets <= 10_000_000n, debtWithinCeiling: BigInt(afterProtect.debtAssets) <= 20_000_000n, strategyFloorHeld: repay.postconditionChecks.some((check) => check.kind === "strategy_floor_held" && check.passed) };
assert(Object.values(policyPostconditions).every(Boolean), `Guardian policy caps failed: ${json(policyPostconditions)}`);
const afterMonitor = await observe();
step("downside before and after", { before: { position: beforeProtect, assessment: protect.assessment }, after: { position: afterProtect, assessment: afterMonitor.assessment } });
step("upside owner approval gate", { ownerBorrowCapacityAssets: afterMonitor.assessment.ownerBorrowCapacity, recommendedAction: afterMonitor.assessment.recommendedAction, reasonCodes: afterMonitor.assessment.reasonCodes, ownerSignatureRequired: true });
await transaction("approveOwnerRepay", owner, loan, encodeFunctionData({ abi: erc20, functionName: "approve", args: [account, 20_000_000n] }), transactions);
await transaction("ownerRepay", owner, account, encode("ownerRepay", [20_000_000n]), transactions);
const shares = await client.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [account] });
const remainingAssets = await call(account, "strategyAssets") as bigint;
assert(remainingAssets > 0n && shares > 0n, "no strategy left for owner exit");
await transaction("withdrawStrategy", owner, account, encode("withdrawStrategy", [remainingAssets, owner, shares]), transactions);
await transaction("withdrawCollateral", owner, account, encode("withdrawCollateral", [500_000_000_000_000_000n, owner]), transactions);
const exited = await position();
assert(exited.debtAssets === "0" && exited.collateralAssets === "0" && exited.vaultShares === "0", `owner exit not zero: ${json(exited)}`);
step("owner exit to zero", exited);
const evidence = {
  evidenceClass: "forked", trust: "sandbox", chainId: "46630", account, database: "crest_demo",
  fork: { relay: relayUrl, blockNumber: origin.number.toString(), blockHash: origin.hash, timestamp: origin.timestamp.toString() },
  manifestIntegrityDigest: manifest.integrity.digest, inventory, forkOwner: owner,
  route: { market: manifest.market.id, vault, disclosures: manifest.trust.disclosures },
  policyHash: staged.policy.policyHash, transactions, reverts,
  assessments: { degraded: initial.assessment, protectBefore: protect.assessment, protectAfter: afterMonitor.assessment },
  guardian: { freeze, strategyRepay: repay },
  downside: { before: { position: beforeProtect, assessment: protect.assessment },
    after: { position: afterProtect, assessment: afterMonitor.assessment }, repaidAssets: repaidAssets.toString(), policyPostconditions },
  ownerExit: exited,
  notLive: ["Every transaction occurred on a 46630 Anvil fork, never testnet.",
    "The owner is the Anvil dev account funded by fork impersonation; the live canary owner is 0x712683F374Cd524F6336E87D577Fc39d1102930A.",
    "MockFeed price was changed only on the fork by its public set(int256) method.",
    "Current Morpho API rates on 46630 were unreadable; no APY or carry is claimed."],
};
await mkdir(`${root}docs/evidence`, { recursive: true });
await writeFile(`${root}docs/evidence/demo-fork-46630.json`, `${json(evidence)}\n`);
step("evidence saved", { path: "docs/evidence/demo-fork-46630.json", account, database: "crest_demo", ports: [8545, 8788] });
