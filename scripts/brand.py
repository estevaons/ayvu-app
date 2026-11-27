"""Gera ícones, favicon e splash a partir da coruja do Ayvu (assets/brand/ayvu-owl.png).

    python3 scripts/brand.py

A arte original tem a coruja dourada sobre fundo quase preto. Extraímos a coruja com
transparência e recompomos sobre o fundo do app, para que ícone, splash e app combinem.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/brand/ayvu-owl.png"
BG = (15, 14, 12)  # --bg do tema escuro (#0f0e0c)
RES = ROOT / "android/app/src/main/res"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def owl_cutout() -> Image.Image:
    """Coruja recortada com alfa: o fundo vira transparente e as bordas continuam suaves."""
    im = Image.open(SRC).convert("RGB")
    bg = im.getpixel((8, 8))
    gold = (240, 205, 110)
    out = Image.new("RGBA", im.size)
    px, po = im.load(), out.load()
    span = max(gold) - max(bg)
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            a = min(1.0, max(0.0, (max(r, g, b) - max(bg) - 6) / span))
            if a <= 0:
                po[x, y] = (0, 0, 0, 0)
                continue
            # Tira o fundo misturado na borda (des-pré-multiplica).
            c = [min(255, max(0, round((v - (1 - a) * bv) / a))) for v, bv in zip((r, g, b), bg)]
            po[x, y] = (*c, round(a * 255))
    return out.crop(out.getbbox())


def place(owl: Image.Image, size: tuple[int, int], fraction: float, bg=BG) -> Image.Image:
    """Coruja centralizada ocupando `fraction` do menor lado."""
    w, h = size
    target = fraction * min(w, h)
    scale = target / max(owl.size)
    mark = owl.resize((max(1, round(owl.width * scale)), max(1, round(owl.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", size, (*bg, 255) if bg else (0, 0, 0, 0))
    canvas.alpha_composite(mark, ((w - mark.width) // 2, (h - mark.height) // 2))
    return canvas


def mask(im: Image.Image, shape: str) -> Image.Image:
    m = Image.new("L", (im.width * 4, im.height * 4), 0)
    d = ImageDraw.Draw(m)
    box = (0, 0, m.width - 1, m.height - 1)
    if shape == "circle":
        d.ellipse(box, fill=255)
    else:
        d.rounded_rectangle(box, radius=m.width // 5, fill=255)
    out = im.copy()
    out.putalpha(m.resize(im.size, Image.LANCZOS))
    return out


def main() -> None:
    owl = owl_cutout()

    # Web / PWA
    pub = ROOT / "public"
    place(owl, (512, 512), 0.74).save(pub / "icon-512.png", optimize=True)
    place(owl, (192, 192), 0.74).save(pub / "icon-192.png", optimize=True)
    place(owl, (512, 512), 0.56).save(pub / "icon-maskable-512.png", optimize=True)
    place(owl, (180, 180), 0.70).convert("RGB").save(pub / "apple-touch-icon.png", optimize=True)
    place(owl, (256, 256), 0.80).save(pub / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    # Android: ícone legado (quadrado arredondado e redondo) e adaptativo (108dp, área segura 66dp).
    for name, k in DENSITIES.items():
        legacy, adaptive = round(48 * k), round(108 * k)
        folder = RES / f"mipmap-{name}"
        mask(place(owl, (legacy, legacy), 0.72), "rounded").save(folder / "ic_launcher.png", optimize=True)
        mask(place(owl, (legacy, legacy), 0.64), "circle").save(folder / "ic_launcher_round.png", optimize=True)
        place(owl, (adaptive, adaptive), 0.54, bg=None).save(folder / "ic_launcher_foreground.png", optimize=True)

    # Splash do Capacitor (Android < 12): imagem de tela cheia com a coruja no centro.
    for splash in RES.glob("drawable*/splash.png"):
        size = Image.open(splash).size
        place(owl, size, 0.40).convert("RGB").save(splash, optimize=True)

    print("ok")


if __name__ == "__main__":
    main()
