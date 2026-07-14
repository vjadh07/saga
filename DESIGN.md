---
name: Saga
description: A calm editorial workspace for evidence-backed publishing decisions
colors:
  forest-ink: "#16201a"
  evidence-green: "#176b45"
  warning-amber: "#8a5a0a"
  contradiction-red: "#a33a32"
  context-blue: "#2f628c"
  paper: "#ffffff"
  canvas: "#f4f6f3"
  quiet-surface: "#f7f8f6"
  divider: "#dce2dd"
  body-text: "#46524b"
  muted-text: "#69756e"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(2.125rem, 5vw, 3.5rem)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.045em"
  heading:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 750
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  sm: "7px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.forest-ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "9px 22px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.forest-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
    height: "44px"
  status-chip:
    backgroundColor: "{colors.quiet-surface}"
    textColor: "{colors.body-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 9px"
  content-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  text-area:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.forest-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "16px"
---

# Design System: Saga

## 1. Overview

**Creative North Star: "The Editorial Review Desk"**

Saga should feel like a clear document review on a bright laptop during a time-limited publishing decision. The product is forensic without looking hostile, technical without leading with implementation details, and confident without using spectacle. The eye should move from outcome, to claims that need attention, to corrected prose, and only then to deeper proof.

This system explicitly rejects dense internal diagnostics consoles, terminal cosplay and generic black-and-neon AI dashboards, and decorative AI effects. It uses quiet paper surfaces, strong editorial type hierarchy, compact written statuses, and progressive disclosure to keep attention on the decision.

**Key Characteristics:**

- Light neutral canvas with crisp white work surfaces
- Forest ink for authority and a restrained evidence green
- Large plain-language outcomes with compact supporting counts
- Flat structure, hairline dividers, and limited ambient shadow
- Short state transitions used only to explain interaction

## 2. Colors

The palette pairs warm neutral paper with sober editorial ink and semantic evidence colors.

### Primary

- **Forest Ink:** The brand anchor, primary action, and strongest text color.
- **Evidence Green:** Supported findings, evidence indicators, and successful state.

### Secondary

- **Warning Amber:** Missing context, outdated claims, and review warnings.
- **Contradiction Red:** Claims contradicted by validated evidence and failed states.
- **Context Blue:** Opinions and informational states that are not errors.

### Neutral

- **Paper:** Main work surfaces and controls.
- **Canvas:** Page background.
- **Quiet Surface:** Secondary controls and inset regions.
- **Divider:** Hairline separation between related regions.
- **Body Text:** Supporting prose.
- **Muted Text:** Helper copy and secondary metadata.

### Named Rules

**The Evidence Color Rule.** Semantic color always appears with a written status. Color never carries meaning alone.

**The One Accent Rule.** Green signals evidence or success. It is not decorative branding scattered across the screen.

## 3. Typography

**Display Font:** Inter with system sans-serif fallbacks  
**Body Font:** Inter with system sans-serif fallbacks  
**Label/Mono Font:** System sans-serif for interface labels, system monospace only for receipt fingerprints

**Character:** One practical sans-serif family keeps the product direct and familiar. Weight, scale, and spacing create hierarchy without turning the interface into a visual demo reel.

### Hierarchy

- **Display** (720, fluid 34px to 56px, 1.08): The single audit outcome or primary Live invitation.
- **Headline** (700, 26px, 1.2): Major workflow sections.
- **Title** (700, 17px, 1.3): Proof blocks and document panes.
- **Body** (400, 16px, 1.6): Explanations and document text, normally kept below 75 characters per line.
- **Label** (750, 12px, normal case): Status chips and compact controls.

### Named Rules

**The Answer First Rule.** The largest type states what the user should do, not the internal system name.

## 4. Elevation

Saga is flat by default. Borders and surface tone define most grouping. One soft ambient shadow may lift the Live composer, and the sticky corrected-draft preview uses position rather than a deeper shadow.

### Shadow Vocabulary

- **Composer Ambient** (`0 14px 40px rgba(23,38,28,.06)`): Live input composer only.
- **Control Lift** (`0 1px 3px rgba(20,33,25,.12)`): Selected segmented control only.

### Named Rules

**The Flat Review Rule.** Content and evidence stay flat at rest. Shadow never replaces hierarchy.

## 5. Components

Components should feel compact, readable, and reliable rather than decorative.

### Buttons

- **Shape:** Calm rectangular control with a 9px to 10px radius.
- **Primary:** Forest Ink fill, Paper text, and at least 44px height.
- **Hover / Focus:** Slight ink shift on hover and a visible green focus ring.
- **Secondary:** Paper fill with a quiet divider border.

### Chips

- **Style:** Compact written result, quiet tinted surface, hairline border, 7px radius.
- **State:** Every semantic variant includes text such as Supported, Wrong, Out of date, or Opinion.

### Cards / Containers

- **Corner Style:** 14px for main surfaces and 10px for compact regions.
- **Background:** Paper on Canvas, with Quiet Surface only for inset support.
- **Shadow Strategy:** Flat by default, as defined in Elevation.
- **Border:** One-pixel Divider hairline.
- **Internal Padding:** 16px for compact controls, 22px to 24px for document surfaces.

### Inputs / Fields

- **Style:** Paper field, one-pixel neutral stroke, 10px radius, 16px internal padding.
- **Focus:** Evidence Green border with a soft three-pixel focus ring.
- **Error / Disabled:** Written state, semantic tint, and reduced opacity only as a secondary cue.

### Navigation

The sticky header uses a small two-option segmented control. The active view has a Paper surface and slight Control Lift. On mobile the switch moves to a full-width second row.

### Claim Review Workspace

The signature component is a stable split view. The original document stays on the left. The selected finding and exact evidence stay on the right. Highlighted claim text is keyboard operable and every selected state includes a written verdict.

## 6. Do's and Don'ts

### Do:

- **Do** lead with one plain-language audit outcome and no more than three supporting numbers.
- **Do** keep evidence and technical provenance one deliberate action away.
- **Do** use a minimum 44px target for primary actions and navigation.
- **Do** respect reduced motion and keep state transitions between 180ms and 240ms.
- **Do** preserve a visible distinction between fixed Demo results and Live web research.

### Don't:

- **Don't** build dense internal diagnostics consoles.
- **Don't** use terminal cosplay and generic black-and-neon AI dashboards.
- **Don't** use unexplained internal terms such as "Trust Passport" or "Flight Recorder" as primary navigation.
- **Don't** use decorative glass, glow, and fake thinking animations.
- **Don't** create repetitive grids of equal-weight cards.
- **Don't** let technical metrics hide the publishing decision.
