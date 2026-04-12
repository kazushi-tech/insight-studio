# Design System: Precision Data Lens

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Precision Data Lens."** In the world of high-stakes data analysis, clarity is not just an aesthetic—it is a functional requirement. This system moves away from the cluttered, "dashboard-in-a-box" look by embracing professional restraint and editorial precision. 

We achieve a premium feel through **intentional asymmetry** and **tonal layering**. By utilizing the space between data points as a functional element, we allow complex information to breathe. The layout avoids rigid, spreadsheet-like grids in favor of a "layered parchment" approach, where information density is balanced by high-contrast typography and sophisticated, muted backgrounds.

---

## 2. Colors & Surface Philosophy
The palette is anchored in a professional Light Mode, utilizing **Deep Navy (#1A1A2E)** for structural authority and **Muted Gold (#D4A843)** for surgical precision in calls to action.

### The "No-Line" Rule
To maintain a high-end editorial feel, **1px solid borders for sectioning are strictly prohibited.** We define boundaries through background shifts. For example, a `surface-container-low` section should sit on a `surface` background to denote a change in context. This creates a seamless, "liquid" interface that feels modern and integrated.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the surface-container tiers to create depth:
*   **Base:** `surface` (#f8f9fa) for the main canvas.
*   **Layout Sections:** `surface-container-low` (#f3f4f5) for large sidebars or content groupings.
*   **Interactive Units:** `surface-container-lowest` (#ffffff) for the primary data cards to provide a "lifted" feel.

### The Glass & Gradient Rule
For floating elements, such as filter overlays or tooltips, use **Glassmorphism**. Combine `surface-variant` with a `backdrop-blur` (8px–12px) at 80% opacity. For the primary Gold CTA, apply a subtle linear gradient from `primary` (#795900) to `primary_container` (#d4a843) to provide a "brushed metal" soul that flat hex codes lack.

---

### Key Color Tokens
*   **Primary (CTA):** `#795900` | **On-Primary:** `#ffffff`
*   **Secondary (Structure):** `#5d5c74` | **On-Secondary:** `#ffffff`
*   **Surface:** `#f8f9fa` | **On-Surface:** `#191c1d`
*   **Outline Variant (Ghost Border):** `#d2c5b1` (Use at 15% opacity only).

---

## 3. Typography
The typography is designed to mimic a high-end financial journal. We pair the technical precision of **Inter** for data with the authoritative character of **Manrope** for headers.

*   **Display (Editorial Hero):** `display-md` (Manrope, 2.75rem). Use for high-level metric summaries.
*   **Headline (Section):** `headline-sm` (Manrope, 1.5rem / 20px equivalent). For primary module headers.
*   **Title (Card):** `title-sm` (Inter, 1rem / 16px equivalent). For card-level titles.
*   **Body (Primary Data):** `body-lg` (Inter, 1rem / 15px equivalent) with a **1.8 line-height**. This generous leading is non-negotiable; it is the key to making dense data readable.
*   **Label (Metadata):** `label-md` (Inter, 0.75rem). For axis labels and captions.

---

## 4. Elevation & Depth
In this design system, hierarchy is communicated through **Tonal Layering** rather than shadows.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface-container-lowest` card placed on a `surface-container` background provides all the separation required for a clean, professional look.
*   **Ambient Shadows:** Shadows are reserved exclusively for **Hover States** on cards. Use an extra-diffused shadow: `box-shadow: 0 10px 30px rgba(25, 28, 29, 0.06)`. This mimics natural ambient light.
*   **The Ghost Border:** If a data table requires containment, use a "Ghost Border"—the `outline-variant` token at **10-20% opacity**. This provides a guide for the eye without creating visual "noise."

---

## 5. Components

### Buttons
*   **Primary:** Muted Gold (`primary_container`). 12px rounded (`md`). Text: `on_primary_container` (#3d2e00).
*   **Secondary:** Deep Navy (`on_secondary_fixed`). Ghost style (no fill, ghost border).
*   **Touch Target:** All buttons must maintain a minimum 44px hit area, regardless of visual size.

### Cards & Data Modules
*   **Styling:** 12px corner radius (`md`). 
*   **Layout:** Forbid the use of divider lines within cards. Use `20px` (Spacing Scale 4) vertical white space to separate header from content. 
*   **Hover:** Transition from a `ghost border` to a subtle `ambient shadow`.

### Input Fields
*   **State:** Default state uses `surface-container-highest` background with no border. 
*   **Focus:** A 2px `primary` (Gold) underline or ghost-border to signal activity. Avoid the "heavy box" look for inputs.

### Data Chips
*   Use `secondary-container` (#e2e0fc) with `secondary` text. Corners should be `full` (pill-shaped) to contrast against the sharp, rectangular data modules.

---

## 6. Do’s and Don’ts

### Do:
*   **Use Asymmetric Balance:** Offset a large data visualization with a focused, right-aligned column of metadata.
*   **Embrace White Space:** Use the `32px` (Spacing Scale 16) section gap to separate major workflows.
*   **Layer Surfaces:** Always place the lightest elements (white) on top of slightly darker backgrounds (f8f9fa) to create natural focus.

### Don’t:
*   **Don't use 100% Black:** Always use `on-surface` (#191c1d) for text to maintain a premium, ink-on-paper feel.
*   **Don't use Dividers:** Avoid horizontal rules. If you feel the need for a line, increase the spacing scale by one increment instead.
*   **Don't Over-round:** Stick to the `12px` (0.75rem) rounding for cards. Excessive rounding (e.g., 24px) diminishes the "professional restraint" of the tool.

---

## 7. Spacing Scale Reference
*   **Micro (Labels/Icons):** `0.5` (0.1rem) to `1` (0.2rem).
*   **Card Internal Padding:** `5` (1.1rem) to `6` (1.3rem).
*   **Card-to-Card Gap:** `10` (2.25rem / ~20px).
*   **Section-to-Section Gap:** `16` (3.5rem / ~32px).