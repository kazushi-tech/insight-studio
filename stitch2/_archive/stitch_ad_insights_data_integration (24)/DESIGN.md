# Design System Strategy: The Nocturnal Executive

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Nocturnal Executive."** 

We are moving away from the bright, sterile "SaaS Blue" templates. This system is designed to feel like a high-end private terminal—quiet, authoritative, and sophisticated. We achieve an editorial feel by prioritizing tonal depth over structural lines. By utilizing the deep navy palette (`surface_container_low`) and the muted gold (`primary_container`), we create a workspace that feels less like a tool and more like a curated environment. 

The layout should embrace **intentional asymmetry**: large `display-md` typography should be offset by generous whitespace, and interactive elements should feel "settled" into the background rather than floating on top of it.

---

## 2. Colors & Tonal Architecture
The palette is built on a foundation of "Deep Navy" with "Muted Gold" serving as a guiding light.

*   **Primary (Gold):** Use `primary` (#f2c35b) for high-impact interactions and `primary_container` (#d4a843) for steady-state branding elements.
*   **Surface Hierarchy:** Our depth comes from the "Lowest to Highest" tiering.
    *   `surface_container_lowest`: Use for the main background of the app.
    *   `surface_container_low`: The specific "Deep Navy" (#1A1A2E) intended for primary login cards and sidebars.
    *   `surface_container_highest`: For popovers or active input states.

### The "No-Line" Rule
**Explicit Instruction:** You are prohibited from using 1px solid borders to define sections or cards. Boundaries must be defined solely through background color shifts. To separate a card from the background, place a `surface_container_low` card on a `surface` background. The subtle shift in hex value is enough for the eye to perceive structure without the "clutter" of lines.

### The "Glass & Gradient" Rule
To elevate the aesthetic from "flat" to "premium," use Glassmorphism for floating elements (like tooltips or dropdowns). Apply `surface_bright` at 60% opacity with a `20px` backdrop-blur. 
*   **Signature Texture:** For primary buttons, do not use a flat fill. Use a linear gradient from `primary` (#f2c35b) to `primary_container` (#d4a843) at a 135-degree angle. This adds a metallic "soul" to the Gold that feels intentional.

---

## 3. Typography
We utilize **Manrope** for its geometric clarity and professional weight distribution.

*   **Display & Headlines:** Use `display-md` (2.75rem) for login welcomes. Set these with a letter-spacing of `-0.02em` to create a "tight," editorial look.
*   **Titles:** `title-lg` (1.375rem) should be used for card headers.
*   **Body:** `body-md` (0.875rem) is our workhorse. Ensure a line height of at least 1.5 to maintain the "premium" breathing room.
*   **Labels:** Use `label-md` in `on_surface_variant` (#d2c5b1) for secondary metadata.

The hierarchy is driven by the contrast between the crisp `on_surface` (White/Off-white) and the muted `primary` gold. Headlines should feel like a statement, not just a label.

---

## 4. Elevation & Depth
In this system, depth is a matter of light and material, not physics-defying shadows.

*   **The Layering Principle:** Stack surfaces to create focus. An input field should be `surface_container_highest` nested within a `surface_container_low` card. This "recessed" look feels more modern than a raised look.
*   **Ambient Shadows:** If a floating element (like a modal) requires a shadow, it must be extra-diffused. 
    *   *Specs:* `Y: 20px, Blur: 40px, Color: #0c0c1f (surface_container_lowest) at 15% opacity.` 
    *   Avoid grey shadows; shadows must be tinted with our deep navy to feel like they are part of the same atmosphere.
*   **The "Ghost Border" Fallback:** If a container lacks contrast (e.g., in high-glare environments), use a "Ghost Border." Apply the `outline_variant` (#4e4636) at **10% opacity**. It should be felt, not seen.

---

## 5. Components

### Buttons
*   **Primary:** 12px (`md`) corner radius. Gold gradient fill. Label in `on_primary` (#402d00). 
*   **Secondary:** No fill. Ghost border (10% `outline_variant`). Text in `primary`.
*   **Sizing:** Height should be a rigid 48px for touch-ready, professional presence.

### Input Fields
*   **Base:** `surface_container_highest` background with 12px (`md`) radius.
*   **States:** On focus, transition the background to `surface_bright` and add a 1px ghost border using `primary`. 
*   **Labeling:** Use "Floating Labels" or labels in `label-md` placed 8px above the field in `on_surface_variant`.

### Cards
*   **Base:** 16px (`lg`) corner radius. 
*   **Rule:** Forbid the use of divider lines inside cards. Use vertical white space (24px or 32px) to separate the "Action" area from the "Content" area.

### Chips (Filter/Selection)
*   Use `surface_container_high` with `label-md` text. When selected, switch to `primary_container` with `on_primary_container` text. Keep corners at `full` (pill shape).

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical margins (e.g., a 64px left margin and 48px right margin) to create an editorial, non-template feel.
*   **Do** use `on_surface_variant` for all non-essential text to maintain the "Nocturnal" vibe.
*   **Do** allow the Deep Navy background to "breathe." Large areas of empty #111125 are a luxury, not a waste of space.

### Don’t
*   **Don't** use 100% white (#FFFFFF) for long-form body text; use `on_surface` (#e2e0fc) to reduce eye strain against the dark base.
*   **Don't** ever use a standard "Drop Shadow" preset. 
*   **Don't** use sharp 0px corners. This system is defined by its 12px/16px "Soft-Modernism" curves.
*   **Don't** add "Glow" effects to the Gold unless it represents a critical active state (like a focused primary button). Keep the gold "Muted" and matte.