from PIL import Image, ImageDraw
from pathlib import Path

size = 1024
image = Image.new("RGBA", (size, size), (5, 8, 11, 255))
draw = ImageDraw.Draw(image)
margin = 64
draw.rounded_rectangle((margin, margin, size - margin, size - margin), radius=190, fill=(16, 185, 129, 255))
lightning = [(548, 130), (330, 510), (472, 510), (420, 890), (704, 430), (550, 430)]
draw.polygon(lightning, fill=(5, 8, 11, 255))
Path("assets").mkdir(exist_ok=True)
image.save("assets/icon.png", format="PNG", optimize=True)
