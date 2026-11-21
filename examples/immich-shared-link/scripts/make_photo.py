"""Write fixtures/tram.jpg: a small photo whose EXIF holds a Lisbon GPS location and a camera."""
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
img = Image.new("RGB", (1200, 800), (232, 190, 60))
d = ImageDraw.Draw(img)
d.rectangle([200, 300, 1000, 600], fill=(250, 210, 40), outline=(40, 40, 40), width=8)
for x in range(260, 960, 140):
    d.rectangle([x, 340, x + 90, 450], fill=(170, 210, 230))
d.ellipse([300, 560, 400, 660], fill=(40, 40, 40)); d.ellipse([800, 560, 900, 660], fill=(40, 40, 40))
exif = Image.Exif()
exif[0x010F] = "FUJIFILM"          # Make
exif[0x0110] = "X100V"             # Model
exif[0x0132] = "2026:05:02 10:15:00"
ifd = exif.get_ifd(0x8769)
ifd[0x9003] = "2026:05:02 10:15:00"  # DateTimeOriginal
gps = exif.get_ifd(0x8825)
gps[1] = "N"; gps[2] = (38.0, 42.0, 50.04)   # 38.7139 N
gps[3] = "W"; gps[4] = (9.0, 8.0, 21.84)     # 9.1394 W
img.save(out, "JPEG", exif=exif, quality=85)
