"""Generate favicon and app icons from a source image.

Usage:
    python scripts/generate_favicon.py <path-to-image>

Outputs directly into frontend/app/:
    favicon.ico       — multi-size ICO (16, 32, 48)
    apple-icon.png    — 180x180 for iOS home screen
    icon.png          — 32x32 for Next.js metadata
"""

import sys
from pathlib import Path
from PIL import Image

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate_favicon.py <path-to-image>")
        sys.exit(1)

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"File not found: {src}")
        sys.exit(1)

    out_dir = Path(__file__).parent.parent / "frontend" / "app"
    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert("RGBA")

    # favicon.ico — embed 16, 32, 48 sizes
    sizes = [(16, 16), (32, 32), (48, 48)]
    ico_images = [img.resize(size, Image.LANCZOS) for size in sizes]
    ico_path = out_dir / "favicon.ico"
    ico_images[0].save(ico_path, format="ICO", sizes=sizes)
    print(f"OK {ico_path}")

    # apple-icon.png — 180x180
    apple_path = out_dir / "apple-icon.png"
    img.resize((180, 180), Image.LANCZOS).save(apple_path, format="PNG")
    print(f"OK {apple_path}")

    # icon.png — 32x32
    icon_path = out_dir / "icon.png"
    img.resize((32, 32), Image.LANCZOS).save(icon_path, format="PNG")
    print(f"OK {icon_path}")

    print("\nDone. Drop the files into frontend/app/ and commit.")

if __name__ == "__main__":
    main()
