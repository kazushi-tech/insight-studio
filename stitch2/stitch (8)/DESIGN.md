# Design System Strategy: The Digital Librarian

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Librarian."** This vision moves beyond the standard SaaS "box-on-box" layout, instead treating the dashboard as a high-end, curated archive. The aesthetic combines the authority of a private bank with the clean, airy sophistication of a modern architectural gallery.

To achieve a "bespoke" feel, we reject the industrial rigidity of standard grids. Instead, we utilize **Intentional Asymmetry** and **Tonal Depth**. By leaning into generous white space (32px+ margins) and varying our surface elevations through color rather than lines, we create a layout that feels "composed" rather than "assembled." This is an editorial approach to data: every element is a curated exhibit within the vault.

---

## 2. Colors & Surface Philosophy
We utilize a sophisticated palette where "Gold" is a rare, high-value signature, and "Navy" provides the intellectual weight.

### The Palette (Material Logic)
*   **Primary (`#795900`):** Used for deep-toned interactive states.
*   **Primary Container (`#D4A843`):** Our signature Gold. Used for hero actions and brand moments.
*   **Secondary (`#5D5C74`):** A muted slate that bridges the gap between the navy text and the white surfaces.
*   **Surface (`#F8F9FA`):** The foundation of our sidebar and secondary layout sections.
*   **Surface Container Lowest (`#FFFFFF`):** The "Paper." Used for primary content cards to make them pop against the background.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or containment. Boundaries must be defined through background color shifts. To separate a sidebar from a main feed, use the transition from `surface` (#F8F9FA) to `surface_container_lowest` (#FFFFFF). This creates a "seamless" high-end feel that mimics premium stationery.

### The "Glass & Gradient" Rule
For floating elements (modals, dropdowns), use **Glassmorphism**. Apply `surface_container_lowest` at 80% opacity with a `20px` backdrop blur. For main CTAs, apply a subtle linear gradient from `primary_container` (#D4A843) to `primary_fixed_dim` (#EEC058) at a 135-degree angle to provide a metallic, light-catching "soul."

---

## 3. Typography: The Editorial Voice
We use **Manrope** exclusively. Its geometric yet humanist qualities provide the "Modern Librarian" feel—authoritative yet accessible.

*   **Display Scale (`display-lg` to `display-sm`):** Reserved for high-level dashboard summaries. Use these to turn data into "headlines."
*   **Headline & Title:** Use `on_secondary_fixed` (#1A1A2E) to ensure high-contrast readability. The tight tracking and bold weights of Manrope in these scales should feel like a masthead.
*   **Body & Label:** Use `secondary` (#5D5C74) for body text to reduce eye strain, reserving the Dark Navy (#1A1A2E) for active, clickable, or emphasized labels.

---

## 4. Elevation & Depth: Tonal Layering
We do not use structural lines. We use physics.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface_container_lowest` (#FFFFFF) card sits on a `surface` (#F8F9FA) page. To create a sub-section within that card, use `surface_container_low` (#F3F4F5). This creates "recessed" or "raised" areas naturally.
*   **Ambient Shadows:** For floating components, use a shadow with a `24px` blur and `4%` opacity, tinted with the `on_surface` color. This mimics a soft gallery spotlight rather than a digital drop shadow.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., in a high-density data table), use `outline_variant` (#D2C5B1) at **15% opacity**. It should be felt, not seen.

---

## 5. Components & Primitive Styling

### Buttons (The "Seal")
*   **Primary:** 12px (`md`) roundness. Uses the Gold Gradient. No border. Text is `on_primary_fixed` (#261A00).
*   **Secondary:** Ghost style. No background. Use a `label-md` weight in Gold (#D4A843).
*   **Active Sidebar Item:** A `4px` vertical gold border on the far left, with a subtle `surface_container_high` background.

### Cards (The "Vault Boxes")
*   **Styling:** 16px (`lg`) roundness. Background: `surface_container_lowest`. 
*   **Rule:** Forbid the use of divider lines. Separate header from body using a `24px` (Scale 6) vertical gap. Use a `surface_container_low` fill for the footer area of a card to separate actions from content.

### Inputs (The "Ledger")
*   **Styling:** Soft `surface_container_low` fill. No border. On focus, the background shifts to `surface_container_lowest` with a 1px `primary` ghost border (20% opacity).

### Specialized Component: The "Curated Progress"
Instead of a standard thin progress bar, use a thick `8px` bar with `surface_variant` as the track and the Gold Gradient as the indicator, capped with a `full` roundness for a pill-like, tactile feel.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use the Spacing Scale religiously. Use `8.5rem` (Scale 24) for section margins to create an "expensive" sense of space.
*   **Do** use colorful icons in the sidebar, but ensure they are monochromatic within their own container (e.g., a blue icon on a soft blue ghost-circle) to maintain the "Librarian" organization.
*   **Do** overlap elements slightly. A card that partially overlaps a background color shift creates a sophisticated, custom-coded look.

### Don't:
*   **Don't** use `#000000` for text. Use the provided Navy (#1A1A2E) to maintain the premium, softer tone.
*   **Don't** use 1px borders. If you feel you need a line, use a background color change instead.
*   **Don't** crowd the interface. If the dashboard feels full, increase the spacing tokens. The "Vault" should feel spacious, not cluttered.