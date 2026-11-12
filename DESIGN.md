# Saklolo interface

This is an operational prototype, with a resident intake surface and a response desk. Product boundaries are in PRODUCT.md.

## Visual direction
Quiet, readable civic-service interface. The resident view is mobile-first and limited to 440px on desktop, with a white canvas, green navigation, and red reserved for SOS. Its first viewport prioritizes a circular SOS action, voice, and location. Optional details use a shadcn Collapsible; shadcn Tabs provide bottom navigation between Help and Reports. The operator retains its wider map-and-inbox layout. No illustrative emergency scenes or invented activity metrics.

## Tokens
- Font: self-hosted DM Sans Variable; 12–14px compact UI, 16px form inputs, 25–27px resident heading.
- Main background: #f5f5ef; working surface: #ffffff.
- Text/action green: #243e36; secondary text: #596860.
- Divider: #dce1d8; SOS: #b9342c.
- Spacing: 4px base; related controls 8–12px; sections 24–32px.
- Surface radius: 12–16px; controls: 7–9px.
- Focus: 3px #a66514 with 3px offset. Reduced motion respected.

## States
Never conflate pending local storage, confirmed server delivery, human acknowledgement, or dispatch. Voice remains visibly opt-in and online-only. Empty desk shows no fabricated reports. Maps display only received coordinates and report capture times. Compact viewport breakpoint: 720px; intermediate: 1050px.

## Resident motion
GSAP handles short vertical arrival transitions, optional-detail expansion, and status feedback. Reduced-motion users receive the same fully visible controls without animation. No infinite SOS pulse, artificial sending delay, or hidden initial screen. Desktop phone presentation begins at 600px; compact phones are supported down to 320px.

## Operator map and review desk
The desk pairs a searchable, filterable inbox with an incident map and a focused review panel. Counts come from received reports. Awaiting-review reports sort first; acknowledgement confirms human review and never implies dispatch.

OpenStreetMap supplies the online street basemap. Category icons distinguish incident types, red and green indicate review status, and a ring identifies the selected report. A translucent circle shows reported GPS accuracy. Nearby coordinates are grouped into selectable count markers. Fit reports and Focus selected provide explicit camera controls; routine polling preserves the operator's map position and open popups. Loading, unavailable tiles, and missing coordinates have explicit states. Street tiles are not packaged for guaranteed offline use.
