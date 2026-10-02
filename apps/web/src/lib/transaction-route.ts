type SigningRoute = { network: { chainId: number }; trust: { level: string }; gate: { outcome: string } };

/**
 * Owner signatures are enabled only on the labeled 46630 SANDBOX with a fully gated route. The reviewed mainnet
 * route stays registered but signing-disabled until the owner funds and approves a mainnet canary.
 */
export function isOwnerSigningEnabled(route: SigningRoute): boolean {
  return route.network.chainId === 46630 && route.trust.level === "sandbox" && route.gate.outcome === "full_route";
}
