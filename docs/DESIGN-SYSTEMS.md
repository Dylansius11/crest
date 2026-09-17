# Crest Design System

**Source mark:** [`crest-logo.png`](./crest-logo.png)  
**Design objective:** Make asset intent, LTV, yield liquidity, Guardian authority, and realized debt repayment legible before encouraging leverage.

## 1. Brand foundation

Crest should feel controlled, transparent, and calm under pressure.

Brand attributes:

- **Protective:** downside actions are explicit and bounded.
- **Legible:** exact amounts, rates, permissions, and evidence.
- **Honest:** projected carry never looks realized; unsupported routes remain visible.
- **Consent-first:** additional borrowing is clearly an owner action.
- **Institutional but usable:** dense enough for risk, simple enough for a live demo.

Use “Crest” in prose and the supplied wordmark in brand placement. `Crest Guardian` is the role name for automation; a later character/agent name must not obscure its permissions.

## 2. Logo rules

- Minimum digital width: `144px`.
- Clear space: at least the cap-height of the `C`.
- Preferred surface: white or slate-50.
- Do not recolor the raster, add gradients/shadows, or turn the slope into a price chart.
- Accessible name: `Crest — policy-controlled borrowing`.
- Confirm trademark status before production claims.

## 3. Color tokens

```css
:root {
  --crest-blue-50:  #eef5ff;
  --crest-blue-100: #d9e9ff;
  --crest-blue-300: #8bb9ff;
  --crest-blue-500: #2d71db;
  --crest-blue-600: #236ad8;
  --crest-blue-700: #1955b8;
  --crest-blue-800: #173f82;
  --crest-blue-950: #10244b;

  --crest-slate-25:  #fbfcfe;
  --crest-slate-50:  #f6f8fb;
  --crest-slate-100: #edf1f6;
  --crest-slate-200: #dce3eb;
  --crest-slate-400: #8795a8;
  --crest-slate-600: #526174;
  --crest-slate-800: #263445;
  --crest-slate-950: #101923;

  --crest-normal:   #236ad8;
  --crest-success:  #147a4b;
  --crest-warning:  #a55b00;
  --crest-critical: #b42318;
  --crest-degraded: #7557a8;
  --crest-surface:  #ffffff;
}
```

### Semantic rules

| State | Color | Required label |
|---|---|---|
| Normal | Blue | `Normal` |
| Owner approval | Blue outline | `Owner approval required` |
| Intervention verified | Green | `Debt reduced` plus exact amount |
| Warning | Amber | `Warning` plus threshold/source |
| Critical | Red | `Critical` plus action |
| Degraded/unknown | Purple | `Degraded` or `Unknown` |
| Unsupported | Slate | `Unsupported` plus reason |

Blue never means safe. Green is reserved for a verified outcome. Color always has text and icon.

## 4. Typography

- Display/headings: `Inter Tight`, then `Inter, system-ui, sans-serif`.
- Body/UI: `Inter`, then `system-ui, sans-serif`.
- Amounts, rates, addresses, policy: `IBM Plex Mono`, then `ui-monospace, monospace`.
- Logo: supplied artwork only.

Use tabular numerals. Every percentage includes metric and basis: `Current LTV`, `Target LTV`, `Morpho LLTV`, `Borrow APY`, or `Vault APY`.

## 5. Layout

- Base spacing: `4px`; scale `4, 8, 12, 16, 24, 32, 48, 64, 96`.
- Card radius: `12px`; control radius: `8px`.
- Border: `1px solid slate-200`.
- Default elevation: none.
- Minimum target: `44x44px`.
- Desktop nav: `240px`; content maximum: `1360px`.
- Mobile: one column; action state, LTV, debt, and withdrawable liquidity precede charts.

Reference the logo slope only in hero/dividers. Cards, tables, forms, charts, and numeric regions stay rectangular.

## 6. Information hierarchy

Position screen order:

1. account, chain, environment, block/time, and data freshness;
2. Guardian state and exact allowed next action;
3. debt, collateral value, current LTV, target band, and Morpho LLTV;
4. idle reserve and currently withdrawable strategy liquidity;
5. borrow APY, vault APY, incentives, fees, and estimated net carry;
6. realized strategy earnings and realized debt repaid;
7. exact market/vault identities and qualification status;
8. owner versus Guardian permissions;
9. lifecycle/oracle/vault/rate provenance;
10. intervention timeline and transaction evidence;
11. stress scenarios and limitations.

Never place “Borrow more” above the risk/liquidity summary. It is always an owner-approval card.

## 7. Core components

### 7.1 Wallet Asset Intent Table

| Asset | Balance | Intent | Route | Status/reason |
|---|---:|---|---|---|
| NVDA Stock Token | 10 | Protect & borrow | verified market | Executable at block … |
| USDG | 1,000 | Earn stable | fixed vault | Constrained by current cap |
| AAPL Stock Token | 4 | Keep | wallet | No movement |
| Other token | 50 | Unsupported | — | No verified market/vault |

Each row offers only verified intents. `KEEP` does not request approval. Unsupported rows are not hidden.

### 7.2 LTV Band Panel

```text
Current LTV       38.2%
Lower             30.0%
Target            35.0%
Upper guard       42.0%
Critical          50.0%
Morpho LLTV       65.0%

[---- lower -- target -- current -- upper ---- critical ---- LLTV]
```

Also show:

- debt required to reach target;
- repayment needed to return to target;
- additional-borrow capacity as `Owner approval required`;
- source block and oracle status.

Do not combine LTV with health factor. Show Morpho health and policy health in a secondary exact table.

### 7.3 Capital Allocation Panel

```text
Collateral in Morpho                 10 NVDA
Morpho collateral APY                0.00%
Accrued debt                         2,000 USDG
Idle protected reserve                 500 USDG
Vault quoted assets                  1,520 USDG
Currently withdrawable               1,350 USDG
Guardian-actionable                    850 USDG
```

The hierarchy must prevent quoted vault assets from being mistaken for immediately repayable liquidity.

### 7.4 Carry Breakdown

```text
Vault base APY                  +6.20%
Incentive APR                   +0.80%
Borrow APY                      -4.10%
Vault/protocol fees             -0.30%
Estimated execution cost        -0.10%
Estimated net spread            +2.50%
Estimated annual net carry      +38.00 USDG
```

Required:

- source and timestamp for each rate;
- exact denominator;
- projected label;
- stale/degraded indicator;
- realized section below, not blended into estimate.

Never make a giant negative “loan APY” the primary metric.

### 7.5 Realized Repayment Card

Only canonical post-state can turn this card green.

```text
Debt before           2,000.81 USDG
Vault withdrawn         250.00 USDG
Debt after            1,750.79 USDG
Accrued debt reduced    250.02 USDG
Status                  Verified at block …
```

If receipt succeeds but debt does not decrease, display `Postcondition failed`, not success.

### 7.6 Guardian State Card

States:

- `NORMAL`;
- `HARVESTABLE`;
- `UPSIZE_AVAILABLE`;
- `PROTECT`;
- `EXIT_YIELD`;
- `CRITICAL`;
- `DEGRADED`.

Required fields:

- current state and reason code;
- triggering threshold/input;
- policy version;
- exact permitted selector;
- requested, capped, simulated, and actual amount;
- owner action needed;
- receipt/postcondition.

### 7.7 Permission Inspector

```text
Owner can:
configure · borrow-and-deploy · withdraw · unfreeze · revoke Guardian

Guardian can:
freeze · repay from idle reserve · repay from fixed vault

Guardian cannot:
borrow · unfreeze · choose venue · choose receiver · transfer · swap
sell collateral · change policy · call arbitrary targets
```

Display before Guardian authorization and on every position.

### 7.8 Route Verification Drawer

Morpho:

- five exact MarketParams and derived ID;
- deployment/token code hashes;
- LLTV, oracle freshness, liquidity;
- verification block/time.

Vault:

- exact chain/address/code/interface/asset;
- upgrade/manager/curator disclosure;
- caps, pause, fees, downstream allocations;
- quoted versus withdrawable assets;
- verification block/time.

Use `Verified at block …`, not an unqualified checkmark.

### 7.9 Evidence Provenance

Onchain oracle, Morpho state, vault state, rate sources, and Robinhood lifecycle data are separate rows. Each shows source, generated/fetched time, block where applicable, freshness, use, and non-use.

## 8. Screen specifications

### 8.1 Wallet inventory

- Works read-only until an owner transaction is needed.
- Shows all detected assets and available intents.
- Defaults to `KEEP`; never preselect leverage.
- Explains why an asset cannot borrow or earn.

### 8.2 Route review

- One combined market-and-vault qualification summary.
- User can inspect independent gates.
- Primary action is `Review policy`, not `Borrow now`.
- If vault fails, offer reserve-only protection without APY copy.

### 8.3 Policy compiler

Three synchronized views:

1. optional natural-language draft;
2. typed form;
3. exact onchain configuration and consequence preview.

Form order:

```text
asset intent
→ exact market/vault
→ debt/collateral/strategy caps
→ lower/target/upper/critical LTV
→ minimum net spread
→ reserve/strategy floors
→ repayment cap
→ Guardian address and permissions
```

### 8.4 Account setup

```text
Deploy account
→ configure fixed route/policy
→ authorize Guardian
→ supply collateral
→ owner reviews borrow-and-deploy
```

Each step shows target, selector, network, amounts, share bounds, and receipt.

### 8.5 Position dashboard

No promotional hero after setup. Lead with Guardian state, LTV band, debt, withdrawable liquidity, carry breakdown, and evidence.

### 8.6 Owner borrow approval

Show:

- current and resulting debt/LTV;
- lower/target/upper/critical and Morpho LLTV;
- borrow APY and vault APY sources;
- estimated annual carry in USDG;
- vault deposit amount and minimum shares;
- degradation and spread-inversion consequences;
- `Guardian cannot borrow this amount`.

### 8.7 Intervention timeline

```text
12:00:28 Upper LTV crossed · 42.4% > 42.0%
12:00:31 Borrowing frozen · tx 0x…
12:00:34 Vault maxWithdraw refreshed · 850 USDG
12:00:36 Strategy repayment submitted · 250 USDG
12:00:40 Debt reduced · 2,000.81 → 1,750.79 USDG
12:00:42 Policy LTV restored · 35.1%
```

Failure remains visible and states whether risk improved, stayed unchanged, or worsened.

### 8.8 Roadmap preview

Post-MVP A: signed borrow envelope and target-LTV automation.
Post-MVP B: several isolated accounts and independently qualified strategies.

Preview is informational; disabled controls must not simulate production capability.

## 9. Charts

- LTV over time with lower/target/upper/critical/LLTV direct labels.
- Debt and realized repayments; never animate debt down before confirmation.
- Vault quoted versus withdrawable assets.
- Borrow APY, vault APY, and net spread on one basis only when conventions match.
- Corporate action/halt/oracle/vault-pause as discrete event intervals.
- No dual-axis by default.
- No smoothing across missing data.
- Every chart has a table and exact hover time/block.

## 10. Copy system

### Use

- “Keep tokenized-equity exposure while borrowing USDG.”
- “Guardian can reduce debt; only you can create debt.”
- “Estimated net carry: +38 USDG/year at current rates.”
- “Realized debt reduced: 250.02 USDG.”
- “850 USDG is currently withdrawable and permitted for repayment.”
- “Additional borrow available; owner approval required.”
- “Yield route unavailable; reserve-only protection remains.”

### Never use

- “Liquidation-proof.”
- “Guaranteed self-repaying.”
- “Risk-free” or “guaranteed negative APY.”
- “Collateral earns Morpho yield.”
- “AI keeps you safe.”
- “Best yield” without verified full comparison.
- “Trading halt stops liquidation.”
- “Every Stock Token is supported.”
- “Auto-borrowing” for MVP.

## 11. Transaction confirmation

Every owner transaction preview shows:

- chain/environment/account;
- Crest Account, Morpho, and vault addresses;
- selector and exact route;
- token/amount and share bounds;
- current/resulting debt and LTV;
- caps/floors affected;
- simulation block/gas;
- whether Guardian authority changes.

High-risk owner actions—raising debt/strategy caps, lowering floors, changing Guardian, or unfreezing—use a precise consequence statement.

## 12. States and recovery

| State | UI treatment | Recovery |
|---|---|---|
| Market unsupported | Route blocked with gate reason | Select verified route |
| Vault unsupported | Yield disabled; reserve-only available | Verify another same-asset vault later |
| Rate stale/spread below floor | No new borrow recommendation | Refresh or wait |
| Oracle stale/paused | Critical/degraded; freeze | Wait for valid onchain source |
| Vault withdrawal constrained | Show quoted/withdrawable gap | Partial repay and owner alert |
| Reserve/strategy at floor | Guardian amount zero | Owner changes policy or adds funds |
| Guardian transaction pending | Hash/nonce state | Reconcile; no duplicate |
| Repay reverted | Failure reason | Keep frozen; fresh assessment |
| Debt unchanged | Postcondition failure | Keep frozen; owner review |

## 13. Motion and accessibility

- 120–180ms transitions; 200–240ms drawers/modals.
- A state change may pulse once, then remain static.
- Never animate projected earnings as balance.
- Never animate debt down before canonical postcondition.
- No liquidation countdown.
- Respect `prefers-reduced-motion`.
- WCAG 2.2 AA contrast.
- Full keyboard setup and visible focus.
- Status uses icon, text, and accessible description.
- Charts include tables.
- Critical numbers and permissions have mobile parity.

## 14. Design acceptance

- A first-time judge identifies owner versus Guardian debt authority in under 10 seconds.
- Wallet assets clearly show keep, borrow, earn, and unsupported intent.
- Current LTV, policy band, and Morpho LLTV cannot be confused.
- Morpho collateral APY displays as zero.
- Quoted vault assets and withdrawable repayment liquidity cannot be confused.
- Projected net carry and realized debt repayment cannot be confused.
- Every intervention shows exact receipt and debt before/after.
- Live, forked, simulated, cached, projected, and illustrative states are unmistakable.
