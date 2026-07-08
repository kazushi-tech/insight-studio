# Design System Specification: The Botanical Intelligence

## 1. Overview & Creative North Star: "The Digital Arboretum"
This design system is not a generic dashboard; it is a high-end data editorial. Our North Star is **"The Digital Arboretum"**—an environment where complex data is cultivated with the precision of a laboratory but presented with the breath and elegance of a botanical garden. 

We move beyond the "template" look by prioritizing **negative space as a functional element**. We reject the clutter of traditional data tools in favor of an asymmetrical, intentional layout that guides the eye toward critical insights. This system treats data points as specimens: isolated for clarity, framed for importance, and presented with a sophisticated, organic rhythm.

---

## 2. Colors: The Organic Palette
Our color theory is rooted in depth and tonal layering. We use nature-inspired greens not just as branding, but as a semantic tool to indicate density and importance.

### Core Tones
- **Primary (`#003925`)**: The anchor. Used for high-level navigation and primary actions. It represents authority and depth.
- **Primary Container (`#0f5238`)**: Used for hero elements and prominent data summaries.
- **Surface (`#fafaf5`)**: Our "paper." A warm off-white that reduces eye strain compared to pure white.
- **Surface-container-lowest (`#ffffff`)**: Reserved exclusively for cards and interactive modules to create a "lifted" effect.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to section off areas of the UI. Separation must be achieved through **Tonal Transitions**. 
- A `surface-container-low` sidebar against a `surface` main content area is the preferred method of boundary definition. 
- Boundaries should feel felt, not seen.

### Signature Textures
To escape the "flat" SaaS aesthetic, use **Subtle Gradients** for large interactive surfaces. Transitioning from `primary` to `primary_container` (top-left to bottom-right at 45°) adds a professional "soul" to the UI that solid fills cannot achieve.

---

## 3. Typography: The Editorial Scale
We utilize a pairing of **Manrope** (geometric, authoritative) for headings and **Inter** (highly legible, neutral) for data and body text.

| Level | Token | Font | Size | Weight | Intent |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-lg` | Manrope | 3.5rem | 700 | Large, evocative editorial statements. |
| **Headline** | `headline-md` | Manrope | 1.75rem | 600 | Defining section starts. |
| **Title** | `title-md` | Inter | 1.125rem | 500 | Card titles and primary data labels. |
| **Body** | `body-md` | Inter | 0.875rem | 400 | Standard narrative text. |
| **Label** | `label-sm` | Inter | 0.6875rem | 600 | Metadata, captions, and micro-copy. |

**Hierarchy Note:** Use wide letter-spacing (tracking) for `label` styles to give them an "archival" or "curated" feel.

---

## 4. Elevation & Depth: Tonal Layering
In this system, depth is a product of light and stacking, not shadows.

- **The Layering Principle:** Stacks are created by placing a higher-luminance surface on a lower-luminance background. 
    - *Example:* Place a `surface-container-lowest` (`#ffffff`) card on a `surface` (`#fafaf5`) background. 
- **The "Ghost Border" Fallback:** If a container requires a border for accessibility, use the **Ghost Border**: `outline-variant` (`#bfc9c1`) at **15% opacity**. This creates a "watermark" edge that vanishes into the background rather than cutting into it.
- **Glassmorphism:** For floating menus or navigation overlays, use `surface` colors at 80% opacity with a `24px` backdrop-blur. This ensures the "Botanical" colors of the content bleed through, maintaining a sense of place.
- **Ambient Shadows:** Only use shadows for "floating" elements (e.g., Modals). Use a large blur (32px+) at 4% opacity, tinted with the `on-surface` color.

---

## 5. Components: Precision & Breathing Room

### Cards (The Specimen Box)
- **Constraint:** Max-width must be dynamically adjusted. On sparse data views, cards should center-align and expand to a maximum of 800px to prevent "line-length fatigue."
- **Styling:** `12px` (token: `DEFAULT`) corner radius. No 100% opaque borders.
- **Spacing:** Use 32px internal padding to allow data to "breathe."

### Buttons
- **Primary:** `primary` background with `on-primary` text. `999px` (full) radius for a modern, tactile feel.
- **Secondary:** Transparent background with a "Ghost Border" (15% `outline-variant`).
- **Interaction:** On hover, primary buttons should shift to `primary_container` with a subtle elevation increase.

### Data Inputs
- **Style:** Underline-only or ghost-bordered. Avoid heavy "box" inputs. 
- **Focus State:** Use a 2px `primary` bottom border to signal intent without cluttering the vertical rhythm.

### Progress & Metrics
- Use **Thick, Low-Contrast Tracks**. A progress bar should use `surface-variant` for the track and `primary` for the fill. Avoid high-contrast markers; use typography (`label-md`) to provide the exact value.

---

## 6. Do's and Don'ts

### Do
- **DO** use asymmetry. Large headlines on the left with white space on the right creates a premium, editorial feel.
- **DO** use "Intelligent Defaults." If a data set is small, center the layout rather than stretching it across the screen.
- **DO** utilize `surface-container` shifts to define functional zones (e.g., a darker sidebar vs. a lighter workspace).

### Don't
- **DON'T** use divider lines (`<hr>`). Use 40px–64px of vertical white space to separate sections instead.
- **DON'T** use 100% black text. Always use `on-surface` (`#1a1c19`) to keep the "Botanical" softness.
- **DON'T** pack information. If a card feels "full," it needs to be broken into two cards or given more padding. Accuracy is born from clarity, not density.

---

## 7. Responsive Philosophy: The Living Layout
The layout should feel "living." On large displays, the sidebars and margins expand to preserve the "Arboretum" feel. As the screen shrinks, the 12px radius remains constant, but the typography scale should fluidly step down, ensuring that the "Editorial" hierarchy is never lost, even on mobile specimens.