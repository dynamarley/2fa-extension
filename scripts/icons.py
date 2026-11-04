"""Rebuild extension PNG icons. Requires Pillow; not needed to use the extension."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "assets"
scale = 4
image = Image.new("RGBA", (128 * scale, 128 * scale))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 128 * scale - 1, 128 * scale - 1), radius=30 * scale, fill="#287c53")
shield = [(64, 25), (96, 37), (96, 60), (93, 72), (83, 85), (64, 103), (45, 85), (35, 72), (32, 60), (32, 37), (64, 25)]
draw.line([(x * scale, y * scale) for x, y in shield], fill="white", width=7 * scale, joint="curve")
check = [(49, 63), (59, 73), (81, 49)]
draw.line([(x * scale, y * scale) for x, y in check], fill="#d9edba", width=8 * scale, joint="curve")
for x, y in [check[0], check[-1]]:
    radius = 4 * scale
    draw.ellipse((x * scale - radius, y * scale - radius, x * scale + radius, y * scale + radius), fill="#d9edba")
for size in (16, 32, 48, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f"icon-{size}.png")
