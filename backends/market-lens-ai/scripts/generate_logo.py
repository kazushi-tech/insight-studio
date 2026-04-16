"""Generate Market Lens AI logo using Gemini image generation.

Usage:
    python scripts/generate_logo.py

Requires GEMINI_API_KEY or GEMINI_VISION_MODEL env vars.
Outputs:
    public/logo.png          — main logo (512x512)
    public/favicon.png       — favicon (32x32)
    public/apple-touch-icon.png — Apple touch icon (180x180)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Add project root for imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def generate_logo():
    """Generate logo using Gemini image generation API."""
    try:
        from google import genai
    except ImportError:
        print("ERROR: google-genai package not installed. Run: pip install google-genai")
        sys.exit(1)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY environment variable required")
        sys.exit(1)

    model = os.environ.get("GEMINI_VISION_MODEL", "gemini-2.0-flash-preview-image-generation")

    client = genai.Client(api_key=api_key)

    prompt = (
        "Design a professional, minimal logo icon for 'Market Lens AI'. "
        "The logo should combine a magnifying glass lens motif with subtle data/chart elements. "
        "Use deep teal (#0D6E6E) as the primary color with warm amber (#E8913A) as accent. "
        "Clean geometric style. White or transparent background. "
        "Must be recognizable at 16px favicon size — keep it simple. "
        "Output as a square icon, no text."
    )

    print(f"Generating logo with model: {model}")
    print(f"Prompt: {prompt[:80]}...")

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=genai.types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )

    output_dir = PROJECT_ROOT / "public"
    output_dir.mkdir(exist_ok=True)

    for part in response.candidates[0].content.parts:
        if part.inline_data is not None:
            image_data = part.inline_data.data
            logo_path = output_dir / "logo.png"
            logo_path.write_bytes(image_data)
            print(f"Logo saved: {logo_path}")

            # Generate favicon and apple-touch-icon via PIL resize
            try:
                from PIL import Image
                import io

                img = Image.open(io.BytesIO(image_data))

                # Favicon 32x32
                favicon = img.resize((32, 32), Image.LANCZOS)
                favicon_path = output_dir / "favicon.png"
                favicon.save(str(favicon_path))
                print(f"Favicon saved: {favicon_path}")

                # Apple touch icon 180x180
                touch = img.resize((180, 180), Image.LANCZOS)
                touch_path = output_dir / "apple-touch-icon.png"
                touch.save(str(touch_path))
                print(f"Apple touch icon saved: {touch_path}")

            except ImportError:
                print("WARNING: Pillow not installed, skipping resize. Run: pip install Pillow")
                # Copy logo as-is for favicon/touch
                (output_dir / "favicon.png").write_bytes(image_data)
                (output_dir / "apple-touch-icon.png").write_bytes(image_data)

            print("\nDone! Logo files generated in public/")
            return

    print("ERROR: No image returned from Gemini. Response parts:")
    for part in response.candidates[0].content.parts:
        if part.text:
            print(f"  Text: {part.text[:200]}")
    sys.exit(1)


def create_placeholder_svg():
    """Create a simple SVG placeholder logo for development."""
    output_dir = PROJECT_ROOT / "public"
    output_dir.mkdir(exist_ok=True)

    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#0D6E6E"/>
  <circle cx="220" cy="220" r="100" fill="none" stroke="#fff" stroke-width="24"/>
  <line x1="290" y1="290" x2="380" y2="380" stroke="#E8913A" stroke-width="28" stroke-linecap="round"/>
  <rect x="300" y="160" width="8" height="60" rx="4" fill="#fff" opacity=".6"/>
  <rect x="330" y="140" width="8" height="80" rx="4" fill="#fff" opacity=".6"/>
  <rect x="360" y="170" width="8" height="50" rx="4" fill="#fff" opacity=".6"/>
</svg>"""

    svg_path = output_dir / "logo.svg"
    svg_path.write_text(svg, encoding="utf-8")
    print(f"Placeholder SVG saved: {svg_path}")

    # Also save as .png placeholder if PIL available
    try:
        import cairosvg
        png_data = cairosvg.svg2png(bytestring=svg.encode(), output_width=512, output_height=512)
        (output_dir / "logo.png").write_bytes(png_data)
        (output_dir / "favicon.png").write_bytes(
            cairosvg.svg2png(bytestring=svg.encode(), output_width=32, output_height=32)
        )
        (output_dir / "apple-touch-icon.png").write_bytes(
            cairosvg.svg2png(bytestring=svg.encode(), output_width=180, output_height=180)
        )
        print("PNG versions generated via cairosvg")
    except ImportError:
        print("INFO: cairosvg not installed. SVG placeholder only. Run script with GEMINI_API_KEY for AI-generated logo.")


if __name__ == "__main__":
    if os.environ.get("GEMINI_API_KEY") and "--placeholder" not in sys.argv:
        try:
            generate_logo()
        except Exception as e:
            print(f"Gemini generation failed: {e}")
            print("Falling back to placeholder SVG...")
            create_placeholder_svg()
    else:
        print("Creating placeholder SVG logo...")
        create_placeholder_svg()
