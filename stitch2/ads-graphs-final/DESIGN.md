# Design System Specification

## 1. Overview & Creative North Star
This design system is built upon the North Star of **"The Living Editorial."** It moves away from the sterile, modular appearance of traditional dashboards and toward a sophisticated, high-end publication aesthetic. By blending the precision of technical analytics with the organic warmth of botanical science, the system creates a space that feels calm yet authoritative.

To achieve this, the design system utilizes intentional asymmetry—such as oversized display typography paired with generous negative space—and rejects the "box-in-a-box" layout. Instead of rigid grids, elements are layered to create a sense of depth and flow, ensuring that complex data feels curated rather than overwhelming.

## 2. Colors
The palette is a deep exploration of forest and earth tones, anchored by a rich, dark evergreen and lifted by off-white parchment neutrals.

### Palette Architecture
*   **Primary Navigation:** `primary` (#0f5238) provides the authoritative weight for the sidebar, creating a strong vertical anchor.
*   **Actionable Intensity:** `primary_container` (#2d6a4f) is reserved for active states and primary buttons, offering high contrast against the `background`.
*   **Neutral Foundation:** The `background` (#fafaf5) is a soft, non-reflective off-white that reduces eye strain during long analytical sessions.
*   **Semantic States:** In place of gold/amber, we use `tertiary` (#713638) for alerts and `secondary` (#456553) for auxiliary data, maintaining a muted, organic spectrum.

### The "No-Line" Rule
Designers are prohibited from using 1px solid borders for sectioning. Structural definition must be achieved through **Tonal Transitions**. Use `surface_container_low` or `surface_container_highest` background shifts to separate the sidebar from the main canvas or to group related data clusters.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of fine paper:
*   **Level 0 (Base):** `background` (#fafaf5).
*   **Level 1 (Sectioning):** `surface_container_low` (#f4f4ef).
*   **Level 2 (Cards):** `surface_container_lowest` (#ffffff) — Reserved for the primary data containers.

### Signature Textures
To add "soul," use subtle linear gradients for hero components (e.g., transitioning from `primary` at 0% to `primary_container` at 100% at a 135-degree angle). Floating elements should employ **Glassmorphism**, using semi-transparent surface colors with a `20px` backdrop-blur to allow underlying botanical tones to bleed through.

## 3. Typography
The system employs a high-contrast typographic pairing to balance editorial elegance with data density.

*   **Display & Headlines (Manrope):** Chosen for its geometric precision and modern flair. `display-lg` (3.5rem) should be used for high-impact editorial moments, while `headline-sm` (1.5rem) anchors card titles.
*   **Data & Body (Inter):** A workhorse typeface designed for legibility. Use `body-md` (0.875rem) for descriptive text and `label-md` (0.75rem) for technical data points and micro-copy.

The hierarchy is intentionally steep. By pairing a large `headline-lg` title with a significantly smaller `body-sm` description, we create a sense of premium hierarchy found in high-end scientific journals.

## 4. Elevation & Depth
In this design system, depth is a matter of light and layering, not structural lines.

### The Layering Principle
Hierarchy is achieved by stacking surface tiers. A `surface_container_lowest` (#ffffff) card sitting on a `surface_container_low` (#f4f4ef) background provides all the "lift" required for the eye to perceive a new layer.

### Ambient Shadows
Shadows are used sparingly to signify interactivity (hover states).
*   **Elevation Level 1 (Hover):** `box-shadow: 0 12px 32px -12px rgba(26, 28, 25, 0.08);`
*   The shadow color is never pure black; it is a tinted version of `on_surface` to mimic natural light passing through a botanical canopy.

### The "Ghost Border" Fallback
If a container requires a border for accessibility, use a **Ghost Border**: `outline_variant` (#bfc9c1) at 15% opacity. Standard 100% opaque borders are strictly forbidden.

## 5. Components
All components follow the `DEFAULT` roundedness scale of **12px (0.5rem)** to maintain a soft, approachable feel.

*   **Buttons:** Primary buttons use `primary_container` with `on_primary` text. Use wide horizontal padding (`spacing-6`) and `label-md` in all-caps for a technical, "instrument-panel" look.
*   **Cards:** Forbid divider lines. Use `spacing-4` vertical white space or `surface_variant` backgrounds to separate header and content within a card.
*   **Progress Indicators:** Use thick, 8px bars with a background of `surface_container_high` and a fill of `primary`.
*   **Chips:** Use `full` (9999px) rounding. Status chips (e.g., "Flourishing") use a `secondary_container` background with `on_secondary_container` text.
*   **Input Fields:** Ghost-bordered (`outline_variant` at 20%) with a `surface_container_lowest` fill. Active states should transition the border to `primary` without increasing stroke weight.

## 6. Do's and Don'ts

### Do:
*   **Do** use asymmetrical layouts. A large hero image or stat on the left balanced by white space on the right creates an editorial feel.
*   **Do** use the Spacing Scale (specifically `spacing-8` and `spacing-10`) to let the data "breathe."
*   **Do** use "surface-tint" overlays on images to ensure they feel integrated into the dark green and off-white theme.

### Don't:
*   **Don't** use pure black (#000000) or pure gray. Always use the specified `on_surface` (#1a1c19) or `on_surface_variant` (#404943) for text.
*   **Don't** use standard "drop shadows" with high opacity. They break the organic, calm vibe of the system.
*   **Don't** use gold, amber, or bright blue for alerts. Use the `tertiary` and `secondary` green-adjacent tones to maintain color harmony.