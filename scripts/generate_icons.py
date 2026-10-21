#!/usr/bin/env python3
"""
Generate PNG icons from SVG for PWA.
Requires: pip install cairosvg
Or use any SVG to PNG converter.
"""
import os
import sys
import subprocess

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
SVG_PATH = os.path.join(BASE_DIR, "icons", "icon.svg")
ICONS_DIR = os.path.join(BASE_DIR, "icons")

def main():
    # Try cairosvg first
    try:
        import cairosvg
        for size in SIZES:
            out_path = os.path.join(ICONS_DIR, f"icon-{size}.png")
            cairosvg.svg2png(url=SVG_PATH, write_to=out_path, output_width=size, output_height=size)
            print(f"Generated {out_path}")
        print("All icons generated successfully!")
        return
    except ImportError:
        pass

    # Try ImageMagick
    if subprocess.run(["which", "convert"], capture_output=True).returncode == 0:
        for size in SIZES:
            out_path = os.path.join(ICONS_DIR, f"icon-{size}.png")
            subprocess.run(["convert", "-background", "none", "-resize", f"{size}x{size}", SVG_PATH, out_path], check=True)
            print(f"Generated {out_path}")
        print("All icons generated successfully!")
        return

    # Try rsvg-convert
    if subprocess.run(["which", "rsvg-convert"], capture_output=True).returncode == 0:
        for size in SIZES:
            out_path = os.path.join(ICONS_DIR, f"icon-{size}.png")
            subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out_path, SVG_PATH], check=True)
            print(f"Generated {out_path}")
        print("All icons generated successfully!")
        return

    print("No SVG to PNG converter found.")
    print("Install one of:")
    print("  pip install cairosvg")
    print("  sudo apt install imagemagick")
    print("  sudo apt install librsvg2-bin")
    sys.exit(1)

if __name__ == "__main__":
    main()