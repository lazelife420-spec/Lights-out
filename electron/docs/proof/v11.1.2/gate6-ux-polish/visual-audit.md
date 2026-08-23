# Gate 6 packaged visual audit

Baseline: packaged Electron 11.1.2 at `6a46228487ef5ae8ac372a51fe96e9c05b1f1044`.

The baseline uses a fresh isolated profile, dismisses onboarding without saving invented answers, and contains no fabricated receipts. All captures came from `dist-native\win-unpacked\Lights Out.exe`.

## Findings

| Class | Surface | Finding | Gate 6 disposition |
|---|---|---|---|
| P1 — visual/coherence | Settings | The intended desktop category rail renders as a horizontal stack because the shared modal column direction wins; most categories are clipped and the content begins below the rail. | Restore the specified rail/content split and add a deliberate narrow-window fallback. |
| P1 — visual/coherence | Tonight | The control room lacks a first-class page/state header and leaves the timer ring visually isolated in a large undifferentiated field. | Add a session identity header and tighten the plan → runtime → context hierarchy without changing timer semantics. |
| P1 — visual/coherence | Brand/session state | The real mark is strong on Home but absent from Start Tonight, armed/running identity, Begin Ritual, and Proof completion/empty identity. | Apply the existing mark selectively to product/session moments only. |
| P1 — visual/coherence | Schedule | The first viewport mixes legacy emoji, a dense tab bar, raw form controls, and calendar cards with inconsistent hierarchy. | Normalize page framing, icon treatment, tab density, and calendar cards while preserving scheduling behavior. |
| P1 — visual/coherence | Devices | Capability cards are truthful but read as a long undifferentiated diagnostic ledger; their headings use emoji instead of the established SVG system. | Add readiness hierarchy and semantic SVG headings; preserve all capability truth boundaries. |
| P1 — visual/coherence | Proof | The honest empty state is a small generic card surrounded by unexplained dead space and uses emoji headings. | Build an intentional branded empty state and stronger evidence hierarchy without adding data. |
| P2 — polish | Shell | Brand appears in the title bar, sidebar, and centered header with similar weight; secondary pages gain little from the tiny repeated center mark. | Keep title/sidebar identity and make the in-content mark stateful/contextual instead of repetitive decoration. |
| P2 — polish | Home | Home is already the strongest surface, but its primary CTA uses a generic arrow and the hero can better distinguish ready/armed/running identity. | Preserve layout; integrate the real mark in the core CTA and controlled state styling. |
| P2 — polish | Library | Browsing structure and readiness truth are strong; selected art, CTA, and section rhythm can feel more product-specific. | Preserve the model catalogue and improve selected/ready polish. |
| P2 — polish | Global components | Button heights, card radii, input focus, and empty-state treatments vary across legacy and newer sections. | Add a bounded Gate 6 token/component normalization layer. |
| P2 — polish | Microcopy | Main-process fault notifications overstate timer safety for fault classes beyond the proven renderer-crash path. | Use universally supportable check-status wording; retain the proven active-renderer-reload message. |
| P2 — polish | Responsive | The minimum supported layout remains readable, but the content rail and fixed sidebar consume significant width and long panels lack explicit narrow-state rules. | Add supported-width layout rules and verify with packaged capture/performance proof. |
| KEEP — intentional | Navigation | Home → Tonight → Library → Schedule → Devices → Proof and secondary Settings/Help are clear, labeled, and keyboard-addressable. | Preserve. |
| KEEP — intentional | Home trust bar | Local-only, final-confirm, emergency-cancel, and no-cloud claims are compact and legible. | Preserve with semantic colors. |
| KEEP — intentional | Timer semantics | Preview ring, ambient clock, Start Now, Arm Tonight, and Begin Ritual have distinct real meanings. | Preserve exactly. |
| KEEP — intentional | Library truth | Four ready modes and subordinate unavailable modes are differentiated honestly. | Preserve; add no modes. |
| KEEP — intentional | Safety | Dry Run is explicit and remote controls cannot force local power actions. | Preserve; real power actions remain zero. |
| OUT OF SCOPE | Feature architecture | New providers, new modes, scheduling engines, receipt architecture, Android behavior, and persistence migrations. | No change. |
| UNPROVEN | Populated Proof visual | The isolated baseline has no real receipts, so populated Proof is not asserted by the baseline capture alone. | Use existing canonical receipt proofs and final runtime lanes; do not fabricate history. |

## Implementation order

1. Normalize the visual foundation and repair Settings layout.
2. Integrate selective session identity into Home, Tonight, Library, and Proof.
3. Polish Schedule, Devices, Settings, and microcopy.
4. Verify supported window sizes, keyboard ownership, packaged runtime, reliability, and performance.
