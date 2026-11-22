from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, os

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景渐变
bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / S
    r = int(24 - 12 * t)
    g = int(28 - 14 * t)
    b = int(21 - 10 * t)
    bd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([26, 26, S - 26, S - 26], radius=140, fill=255)
img.paste(bg, (0, 0), mask)

# 外侧铜色描边
d.rounded_rectangle([26, 26, S - 26, S - 26], radius=140, outline=(150, 124, 74, 255), width=8)
d.rounded_rectangle([48, 48, S - 48, S - 48], radius=120, outline=(88, 76, 48, 255), width=2)

# 星空/地图网格（低透明度叠加）
grid = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd2 = ImageDraw.Draw(grid)
for i in range(12):
    y = 120 + i * 66
    gd2.line([(90, y), (S - 90, y)], fill=(120, 112, 80, 26), width=2)
for i in range(12):
    x = 120 + i * 66
    gd2.line([(x, 90), (x, S - 150)], fill=(120, 112, 80, 22), width=2)
img.alpha_composite(grid)

# 中心光晕
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for r in range(330, 0, -6):
    a = int(30 * (1 - r / 330))
    gd.ellipse([512 - r, 440 - r, 512 + r, 440 + r], fill=(190, 70, 50, a))
glow = glow.filter(ImageFilter.GaussianBlur(24))
img.alpha_composite(glow)

# 红五星
cx, cy = 512, 430
outer, inner = 300, 122
pts = []
for i in range(10):
    r = outer if i % 2 == 0 else inner
    a = -math.pi / 2 + i * math.pi / 5
    pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
d.polygon(pts, fill=(176, 54, 42, 255))
d.line(pts + [pts[0]], fill=(222, 193, 133, 255), width=10, joint='curve')
# 内层高光
d.line(pts + [pts[0]], fill=(216, 110, 90, 120), width=3, joint='curve')

# 星内暗面
for i in range(5):
    a = -math.pi / 2 + i * 2 * math.pi / 5
    d.line([(cx, cy), (cx + math.cos(a) * inner, cy + math.sin(a) * inner)], fill=(130, 36, 28, 120), width=4)

# 文字
try:
    font_cn = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 124)
    font_num = ImageFont.truetype('C:/Windows/Fonts/georgia.ttf', 58)
except Exception:
    font_cn = ImageFont.load_default()
    font_num = ImageFont.load_default()

def center_text(y, text, font, fill, spacing=0):
    if spacing:
        widths = [d.textlength(ch, font=font) for ch in text]
        total = sum(widths) + spacing * (len(text) - 1)
        x = (S - total) / 2
        for ch, w in zip(text, widths):
            d.text((x, y), ch, font=font, fill=fill)
            x += w + spacing
    else:
        w = d.textlength(text, font=font)
        d.text(((S - w) / 2, y), text, font=font, fill=fill)

# 阴影
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
w = sd.textlength('淮海', font=font_cn)
sd.text(((S - w) / 2 + 4, 750 + 6), '淮海', font=font_cn, fill=(0, 0, 0, 190))
shadow = shadow.filter(ImageFilter.GaussianBlur(10))
img.alpha_composite(shadow)

center_text(750, '淮海', font_cn, (233, 220, 190, 255), spacing=14)
center_text(892, '1948', font_num, (186, 158, 100, 255))

img.save('desktop/app_icon.png')
# 高质量缩放生成 ICO
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
base = img.resize((256, 256), Image.LANCZOS)
base.save('desktop/app.ico', format='ICO', sizes=[(s, s) for s in ico_sizes])
print('icon written')
