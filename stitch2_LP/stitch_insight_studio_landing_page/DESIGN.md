# Design System Specification: The Luminous Architect

## 1. Overview & Creative North Star
This design system is built to move beyond the utilitarian "SaaS dashboard" aesthetic. We are pursuing a Creative North Star titled **"The Luminous Architect."** 

The goal is to blend the structural precision of high-end architecture with the fluid, light-filled atmosphere of a modern editorial gallery. We achieve this by rejecting the "boxed-in" nature of standard web design. Instead of rigid lines and heavy containers, we use **Tonal Layering**, **Bento-style compartmentalization**, and **Asymmetric white space** to guide the eye. This system feels high-performance not through complexity, but through the deliberate control of light, depth, and motion.

---

## 2. Colors & Surface Logic

### The Palette
We utilize a sophisticated spectrum of Emeralds and Slate, punctuated by "Muted Gold" accents.
- **Primary Focus:** `primary` (#006c49) and `primary_container` (#10b981).
- **The Glow:** `tertiary_fixed_dim` (#eec058) for highlights and high-value data points.
- **Surface Depth:** `surface` (#f8f9ff) through `surface_container_highest` (#d3e4fe).

### The "No-Line" Rule
**Explicit Instruction:** 1px solid borders are strictly prohibited for sectioning or layout containment. We do not "box" content. 
- Boundaries must be defined solely by background color shifts. 
- *Example:* A `surface_container_lowest` (#ffffff) card sitting on a `surface_container_low` (#eff4ff) section. 

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of semi-translucent materials. 
- **Base Layer:** `surface` (#f8f9ff).
- **Secondary Content Areas:** `surface_container_low` (#eff4ff).
- **Floating Interactive Elements:** `surface_container_lowest` (#ffffff).
- **Nesting:** To define importance, an inner container should always be one "tier" higher or lower than its parent. This creates a soft, natural edge that feels premium rather than clinical.

### The "Glass & Gradient" Rule
To inject "soul" into the interface, use Glassmorphism for floating navigation and overlays. Use `surface_container_low` at 70% opacity with a `backdrop-blur` of 20px. 
- **Signature Gradients:** For primary CTAs and Hero accents, use a linear gradient: `primary` (#006c49) at 0% to `primary_container` (#10b981) at 100% at a 135-degree angle.

---

## 3. Typography: The Editorial Voice
We use **Manrope** to bridge the gap between technical precision and human warmth. 

- **Display & Headlines:** Use `Bold` (700) weight. Headlines should utilize tighter letter-spacing (-0.02em) to feel impactful and "custom."
- **Body & Labels:** Use `Medium` (500) weight. Avoid "Regular" (400) to maintain a sense of authority and readability against vibrant backgrounds.

### Typography Scale
- **Display-LG (3.5rem):** For hero moments and high-impact data.
- **Headline-MD (1.75rem):** For major section titles within Bento grids.
- **Title-SM (1rem):** For card headings, always in `Bold`.
- **Body-MD (0.875rem):** The workhorse for all interface copy.

---

## 4. Elevation & Depth: The Layering Principle

### Ambient Shadows
Standard drop shadows are too "dirty" for this system. When a floating effect is required (e.g., a dropdown or a modal), use an **Ambient Shadow**:
- **Color:** A tinted version of `on_surface` (#0b1c30) at 6% opacity.
- **Blur:** 32px to 64px (Large and diffused).
- **Spread:** -4px to ensure the shadow stays tucked under the element.

### The "Ghost Border" Fallback
If a visual separator is required for accessibility (e.g., in high-density data tables), use a **Ghost Border**:
- **Stroke:** 1px of `outline_variant` (#bbcabf) at **15% opacity**. It should be felt, not seen.

### Bento Grid Dynamics
Layouts should follow a Bento grid logic using the spacing scale `4` (1rem) or `6` (1.5rem) for gaps. Vary the aspect ratios of cells to create intentional asymmetry, ensuring the layout feels dynamic rather than a repeating pattern.

---

## 5. Components

### Buttons
- **Primary:** Gradient (`primary` to `primary_container`) with white text. `0.5rem` (DEFAULT) corner radius.
- **Secondary:** `surface_container_high` background with `on_surface` text. No border.
- **Tertiary/Accent:** Use `tertiary_container` (#c79c38) only for high-conversion actions or "Insight" triggers.

### Chips
- Use `full` (9999px) roundedness. 
- Use `primary_fixed` (#6ffbbe) background with `on_primary_fixed` (#002113) text for active states.

### Input Fields
- **Background:** `surface_container_low` (#eff4ff).
- **State Change:** On focus, transition background to `surface_container_lowest` (#ffffff) and add a 2px `primary` ghost-border (20% opacity).
- **Labels:** Always `label-md` in `on_surface_variant`.

### Cards & Lists
- **Strict Rule:** No divider lines. Separate list items using a `1.5` (0.375rem) vertical gap and a subtle background shift (`surface_container_low`) on hover.
- **Bento Cards:** Use `xl` (1.5rem) corner radius for large dashboard containers to emphasize the "Studio" aesthetic.

---

## 6. Do's and Don'ts

### Do:
- **Do** use `tertiary` (Gold) sparingly as a "spark" for data insights or notification dots.
- **Do** overlap elements. Let a glassmorphic card partially sit over a gradient background to create depth.
- **Do** use high-performance scroll animations: elements should subtly scale up (1.0 to 1.02) or fade in as they enter the viewport.

### Don't:
- **Don't** use pure black (#000000) for text. Use `on_surface` (#0b1c30) to keep the "Slate" sophistication.
- **Don't** use 100% opaque borders. They break the "Luminous" feel and create visual noise.
- **Don't** use traditional "Drop Shadows" on cards. Rely on color-shifting surfaces to define depth first.
- **Don't** crowd the Bento grid. If a cell feels tight, increase the container size or move content to a secondary layer.

---

## 7. Signature Interaction: The "Gold Thread"
When a user interacts with a primary data point, use a `tertiary` (#D4A843) micro-interaction—such as a 2px underline or a subtle glow effect—to symbolize the "Insight" being discovered. This is our signature brand moment.