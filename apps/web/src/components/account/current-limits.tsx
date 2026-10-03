import { Cell, Fact } from "@/components/ui/cell";
import { activeTokens } from "@/lib/manifest";
import type { RouteToken } from "@/lib/manifest";
import { compactAddress, decimal, percentFromWad } from "./format";
import type { LiveAccountState, RecordedPosition } from "./types";

const { collateral, loan } = activeTokens;

function amount(value: bigint | string | null | undefined, token: RouteToken) {
  return decimal(value === null || value === undefined ? value : value.toString(), token.decimals, token.symbol);
}

/** How much of a cap is in use and how much is left; an unread balance leaves the room unstated, never zero. */
function Room({ used, cap, token, verb }: { used: bigint | null; cap: bigint; token: RouteToken; verb: string }) {
  if (used === null) return <span className="block text-xs text-ink-soft">Current balance unavailable</span>;
  const left = cap > used ? cap - used : 0n;
  return <span className={`block text-xs ${left === 0n ? "text-signal-stop" : "text-ink-soft"}`}>{amount(used, token)} {verb} · {amount(left, token)} left</span>;
}

/**
 * The limits the account enforces, read from the chain at one block. Caps and the Custos address live only
 * onchain, so when that read fails they show as unavailable while the bands fall back to the recorded snapshot.
 */
export function CurrentLimits({ live, position }: { live: LiveAccountState | null; position: RecordedPosition | null }) {
  const policy = live?.policy ?? null;
  const snapshot = position?.snapshot ?? null;
  const meta = policy && live ? `Policy ${policy.nonce} · block ${live.blockNumber}` : snapshot ? `Policy ${position?.account.policyNonce} · recorded` : "Not recorded";
  const lower = policy?.lowerLtvWad.toString() ?? snapshot?.lowerLtvWad;
  const target = policy?.targetLtvWad.toString() ?? snapshot?.targetLtvWad;
  const upper = policy?.upperLtvWad.toString() ?? snapshot?.upperLtvWad;
  const critical = policy?.criticalLtvWad.toString() ?? snapshot?.criticalLtvWad;
  return <Cell index="Current limits" meta={meta} className="bg-paper"><div className="p-5">
    <p className="text-sm text-ink-soft">{policy ? "Read directly from the account. Every owner action and every Custos repayment is checked against these onchain." : "The live policy read failed. Caps and the Custos address stay unavailable; the bands come from the recorded snapshot."}</p>
    <p className="mt-5 type-display text-poster-sm">Borrowing</p>
    <dl>
      <Fact label="Debt ceiling">{policy ? <>{amount(policy.debtCeilingAssets, loan)}<Room used={live?.debtAssets ?? null} cap={policy.debtCeilingAssets} token={loan} verb="owed" /></> : "Unavailable"}</Fact>
      <Fact label="Collateral cap">{policy ? <>{amount(policy.maxCollateralAssets, collateral)}<Room used={live?.collateralAssets ?? null} cap={policy.maxCollateralAssets} token={collateral} verb="supplied" /></> : "Unavailable"}</Fact>
      <Fact label="Strategy cap">{policy ? <>{amount(policy.maxStrategyAssets, loan)}<Room used={live?.strategyAssets ?? null} cap={policy.maxStrategyAssets} token={loan} verb="in the vault" /></> : "Unavailable"}</Fact>
    </dl>
    <p className="mt-5 type-display text-poster-sm">LTV bands</p>
    <dl>
      <Fact label="Lower LTV">{percentFromWad(lower)}</Fact>
      <Fact label="Target LTV"><>{percentFromWad(target)}<span className="block text-xs text-ink-soft">Custos repays down to this</span></></Fact>
      <Fact label="Upper LTV"><>{percentFromWad(upper)}<span className="block text-xs text-ink-soft">Above this, Custos freezes borrowing and repays</span></></Fact>
      <Fact label="Critical LTV">{percentFromWad(critical)}</Fact>
      <Fact label="Morpho liquidation LTV"><>{percentFromWad(policy?.lltvWad.toString())}<span className="block text-xs text-ink-soft">Set by the Morpho market, not by this policy</span></></Fact>
    </dl>
    <p className="mt-5 type-display text-poster-sm">Custos</p>
    <dl>
      <Fact label="Repayment cap per action">{amount(policy?.maxRepayPerActionAssets ?? snapshot?.maxRepayPerActionAssets, loan)}</Fact>
      <Fact label="Reserve floor">{amount(policy?.reserveFloorAssets ?? snapshot?.reserveFloorAssets, loan)}</Fact>
      <Fact label="Vault floor">{amount(policy?.strategyFloorAssets ?? snapshot?.strategyFloorAssets, loan)}</Fact>
      <Fact label="Custos address">{policy ? <span title={policy.guardian}>{compactAddress(policy.guardian)}</span> : "Unavailable"}</Fact>
    </dl>
  </div></Cell>;
}
