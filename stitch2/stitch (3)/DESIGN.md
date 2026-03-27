# Design System Specification: Editorial Precision

## 1. Overview & Creative North Star: "The Strategic Lens"
This design system is anchored by the Creative North Star of **"The Strategic Lens."** In the high-stakes world of ad operations and competitor analysis, the UI must act as a high-performance instrument—invisible until needed, yet authoritative in its presentation. 

To move beyond the "SaaS template" aesthetic, we break from the rigid 12-column grid in favor of **Intentional Asymmetry**. By utilizing expansive white space (the `surface-container-lowest`) and high-contrast typographic scales, we create an editorial feel that treats data like a premium financial journal rather than a cluttered dashboard. We prioritize tonal depth and "breathability" over structural lines to ensure the user remains focused on insights, not the interface.

---

### 2. Colors & Surface Philosophy
Our palette is a sophisticated interplay of Deep Navy (`on_primary_fixed`) and Muted Gold (`secondary`), grounded by a layered grayscale.

*   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. Boundaries are defined through background shifts. For example, a data table (using `surface_container_low`) sits directly on the `background` (Pure White) without a stroke.
*   **Surface Hierarchy & Nesting:** Treat the UI as physical layers of fine paper.
    *   **Level 0 (Base):** `surface` (#F8F9FA) for sidebars and background global areas.
    *   **Level 1 (The Canvas):** `surface_container_lowest` (#FFFFFF) for the main content workspace.
    *   **Level 2 (The Insight):** `surface_container` (#EDEEEF) for nested widgets or secondary analysis panels.
*   **The "Glass & Gradient" Rule:** Floating action panels or tooltips should utilize a backdrop-blur (12px–20px) with 80% opacity of the `surface_white`.
*   **Signature Textures:** For high-value CTAs or "Golden Metric" cards, use a subtle linear gradient from `secondary` (#D4A843) to `secondary_fixed_dim` (#EEC058) at a 135-degree angle to provide a professional luster.

---

### 3. Typography: The Editorial Voice
We utilize **Manrope** exclusively. Its geometric yet humane construction provides the "Modern Professional" tone required for Japanese and English data contexts.

*   **Display & Headline (The Authority):** Use `display-md` and `headline-lg` with tight letter-spacing (-0.02em) to create a bold, "newspaper masthead" feel for key metrics.
*   **Body (The Clarity):** `body-md` is our workhorse. Ensure a line height of 1.6 to maintain readability in dense ad-op reports.
*   **Labels (The Metadata):** Use `label-md` in `on_surface_variant` (#47464C) for all non-critical data points, ensuring a clear hierarchy between "The Answer" (the data) and "The Question" (the label).

---

### 4. Elevation & Depth: Tonal Layering
We move away from the "shadow-everything" approach. Depth is achieved through **Natural Ambient Light**.

*   **The Layering Principle:** Instead of shadows, place a `surface_container_lowest` card on a `surface_container_low` background. This creates a "soft lift" that feels architectural.
*   **Ambient Shadows:** For "floating" elements like modals, use a custom shadow: `0 24px 48px -12px rgba(26, 26, 46, 0.08)`. This uses the Deep Navy (`on_primary_fixed`) as the shadow tint, creating a more integrated, premium look than neutral gray.
*   **The "Ghost Border" Fallback:** If a divider is mandatory for accessibility, use `outline_variant` (#C8C5CD) at **15% opacity**. It should be felt, not seen.

---

### 5. Components: Precision Primitives

#### Buttons (The Tactical Trigger)
*   **Primary:** Background `primary` (#00000B), Text `on_primary` (#FFFFFF). Radius: `md` (12px).
*   **Secondary (The Accent):** Background `secondary` (#795900), Text `on_secondary` (#FFFFFF). Use for "Analyze" or "Optimize" actions.
*   **Tertiary:** No background; `on_surface` text with a subtle `secondary` icon.

#### Cards (The Insight Container)
*   **Styling:** Radius: `lg` (16px). No borders. Use `surface_container_lowest` (#FFFFFF).
*   **Spacing:** Always use `spacing-6` (1.5rem) for internal padding to ensure "The Strategic Lens" has room to breathe.

#### Input Fields (The Data Entry)
*   **Neutral State:** `surface_container_high` background. No border.
*   **Focus State:** A 2px "Ghost Border" using `secondary` (#D4A843) at 40% opacity. 

#### Data Lists
*   **Structure:** No dividers. Use alternating background tints of `surface` and `surface_container_low` for row separation.
*   **Typography:** Numbers must use `label-md` with `tabular-nums` CSS setting for perfect alignment in competitor analysis tables.

---

### 6. Do’s and Don'ts

#### Do
*   **Do** prioritize vertical rhythm using the `spacing-8` (2rem) and `spacing-12` (3rem) tokens between major data sections.
*   **Do** use the Muted Gold (`secondary`) sparingly—only for "Insight" highlights or primary conversions.
*   **Do** ensure all Japanese typography uses `letter-spacing: 0.05em` to prevent character crowding in dense reports.

#### Don't
*   **Don't** use 100% black. Use Deep Navy (#1A1A2E) for text to maintain a high-end, "ink on paper" feel.
*   **Don't** use stylized illustrations or icons with rounded "bubble" ends. Use sharp, 2px stroke-weight geometric icons.
*   **Don't** use standard "drop shadows" on every card. Rely on the background color shifts to define the layout.