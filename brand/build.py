#!/usr/bin/env python3
"""
Builds every SamePace logo asset from one geometry definition.

  OUTFIT_TTF=path/to/Outfit_600SemiBold.ttf python3 brand/build.py

Needs fontTools (pip install fonttools) and rsvg-convert (brew install librsvg).
The font ships with the mobile app: mobile/node_modules/@expo-google-fonts/
outfit/600SemiBold/Outfit_600SemiBold.ttf (run `npm install` in mobile/ first).

Outputs:
  brand/svg, brand/png      masters, for design tools and press
  mobile/assets/...         the icons app.json points at
  public/favicon.svg        the web favicon
  public/og.jpg             the 1200x630 share card (JPEG step uses macOS `sips`)

The mark is "In step": two people leaning forward at the same angle. They never
touch — see brand/README.md for the rules that keep it from reading as a couple.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "brand" / "svg"
PNG = ROOT / "brand" / "png"
MOBILE = ROOT / "mobile" / "assets"

# Same values as mobile/src/constants/theme.ts and src/styles.css.
INK = "#050506"
PAPER = "#F6F6F8"
ON_DARK = {"a": "#30D158", "b": "#64D2FF", "text": "#F5F5F7"}
ON_LIGHT = {"a": "#0B7A2E", "b": "#0B6A94", "text": "#111113"}
MUTED = "#A1A1A6"
TAGLINE = "Workout buddies at your level who show up."
WHITE = {"a": "#F5F5F7", "b": "#F5F5F7", "text": "#F5F5F7"}
BLACK = {"a": "#111113", "b": "#111113", "text": "#111113"}

LEAN = 14  # degrees; both figures share it, which is the whole idea


def figure(cx: float, fill: str, *, head_r=9.0, head_cy=27.0, body_w=15.0, body_y=41.0, body_h=40.0) -> str:
    """One person: a round head over a pill body, rotated about its own centre."""
    pivot_y = (head_cy - head_r + body_y + body_h) / 2
    return (
        f'<g transform="rotate({LEAN} {cx} {pivot_y})" fill="{fill}">'
        f'<circle cx="{cx}" cy="{head_cy}" r="{head_r}"/>'
        f'<rect x="{cx - body_w / 2}" y="{body_y}" width="{body_w}" height="{body_h}" rx="{body_w / 2}"/>'
        "</g>"
    )


def mark(c: dict) -> str:
    """The standard mark on a 100-unit canvas, optically centred on (50, 50)."""
    return figure(34.5, c["a"]) + figure(64.5, c["b"])


def mark_micro(c: dict) -> str:
    """For 16-24 px: bigger heads, wider bodies, a wider neck gap that survives blur."""
    kw = dict(head_r=10.5, head_cy=24.5, body_w=18.0, body_y=42.0, body_h=42.0)
    return figure(32.5, c["a"], **kw) + figure(66.5, c["b"], **kw)


def svg(view: str, body: str, *, w: float | None = None, h: float | None = None, title="SamePace") -> str:
    size = f' width="{w}" height="{h}"' if w and h else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"{size} role="img" aria-label="{title}">'
        f"<title>{title}</title>{body}</svg>\n"
    )


# ── Wordmark: Outfit SemiBold, outlined so no one needs the font installed ────


class Wordmark:
    TRACKING = -0.02  # em, matches the app header's letter-spacing

    def __init__(self, ttf: Path, tracking: float | None = None):
        if tracking is not None:
            self.TRACKING = tracking
        font = TTFont(str(ttf))
        self.glyphs = font.getGlyphSet()
        self.cmap = font.getBestCmap()
        self.hmtx = font["hmtx"]
        self.upem = font["head"].unitsPerEm
        self.x_height = font["OS/2"].sxHeight

    def paths(self, text: str, size: float, x: float, baseline: float, fills: list[str]) -> tuple[str, float]:
        """Returns (svg, width). `fills` has one colour per character."""
        s = size / self.upem
        out, pen_x = [], 0.0
        for ch, fill in zip(text, fills):
            name = self.cmap[ord(ch)]
            pen = SVGPathPen(self.glyphs)
            self.glyphs[name].draw(pen)
            out.append(
                f'<path fill="{fill}" transform="translate({x + pen_x * s:.3f} {baseline:.3f}) scale({s:.5f} {-s:.5f})" d="{pen.getCommands()}"/>'
            )
            pen_x += self.hmtx[name][0] + self.TRACKING * self.upem
        width = (pen_x - self.TRACKING * self.upem) * s
        return "".join(out), width

    def x_height_at(self, size: float) -> float:
        return self.x_height * size / self.upem


def two_tone(c: dict) -> list[str]:
    return [c["text"]] * 4 + [c["a"]] * 4  # "same" + "pace"


def lockup_horizontal(wm: Wordmark, c: dict, bg: str | None) -> str:
    size = 50.0
    baseline = 49.5 + wm.x_height_at(size) / 2  # x-height centred on the mark's centre
    text, tw = wm.paths("samepace", size, 96.0, baseline, two_tone(c))
    w, pad = 96.0 + tw, 14.0
    view = f"{14 - pad} {10 - pad / 2} {w - 14 + 2 * pad} {80 + pad}"
    rect = f'<rect x="{14 - pad}" y="{10 - pad / 2}" width="{w - 14 + 2 * pad}" height="{80 + pad}" fill="{bg}"/>' if bg else ""
    return svg(view, rect + mark(c) + text)


def lockup_stacked(wm: Wordmark, c: dict, bg: str | None) -> str:
    size = 30.0
    _, tw = wm.paths("samepace", size, 0, 0, two_tone(c))
    text, _ = wm.paths("samepace", size, 50 - tw / 2, 116.0, two_tone(c))
    half = max(tw / 2, 36) + 14
    view = f"{50 - half} 4 {2 * half} 130"
    rect = f'<rect x="{50 - half}" y="4" width="{2 * half}" height="130" fill="{bg}"/>' if bg else ""
    return svg(view, rect + mark(c) + text)


def wordmark_only(wm: Wordmark, c: dict) -> str:
    size = 50.0
    text, tw = wm.paths("samepace", size, 0, 40.0, two_tone(c))
    return svg(f"-4 -2 {tw + 8} 56", text)


# ── Share card ───────────────────────────────────────────────────────────────


def og_card(wm: Wordmark, body_font: Wordmark) -> str:
    """1200x630 link preview: stacked lockup and tagline on the app's ink-and-wash backdrop."""
    c = ON_DARK
    washes = (
        "<defs>"
        f'<radialGradient id="w1" cx="600" cy="-40" r="620" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{c["b"]}" stop-opacity="0.16"/><stop offset="1" stop-color="{c["b"]}" stop-opacity="0"/></radialGradient>'
        f'<radialGradient id="w2" cx="0" cy="630" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{c["a"]}" stop-opacity="0.12"/><stop offset="1" stop-color="{c["a"]}" stop-opacity="0"/></radialGradient>'
        "</defs>"
        f'<rect width="1200" height="630" fill="{INK}"/>'
        '<rect width="1200" height="630" fill="url(#w1)"/><rect width="1200" height="630" fill="url(#w2)"/>'
    )
    k = 3.4  # mark scale: 100-unit canvas -> 340 px
    art = f'<g transform="translate({600 - 50 * k} 38) scale({k})">{mark(c)}</g>'
    _, tw = wm.paths("samepace", 112, 0, 0, two_tone(c))
    word, _ = wm.paths("samepace", 112, 600 - tw / 2, 452, two_tone(c))
    _, lw = body_font.paths(TAGLINE, 36, 0, 0, [MUTED] * len(TAGLINE))
    line, _ = body_font.paths(TAGLINE, 36, 600 - lw / 2, 536, [MUTED] * len(TAGLINE))
    return svg("0 0 1200 630", washes + art + word + line, w=1200, h=630, title="SamePace. " + TAGLINE)


def feature_graphic(wm: Wordmark, body_font: Wordmark) -> str:
    """Google Play feature graphic, 1024x500. Play crops the edges in some placements, so it all sits centred."""
    c = ON_DARK
    washes = (
        "<defs>"
        f'<radialGradient id="f1" cx="512" cy="-60" r="560" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{c["b"]}" stop-opacity="0.16"/><stop offset="1" stop-color="{c["b"]}" stop-opacity="0"/></radialGradient>'
        f'<radialGradient id="f2" cx="0" cy="500" r="460" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{c["a"]}" stop-opacity="0.12"/><stop offset="1" stop-color="{c["a"]}" stop-opacity="0"/></radialGradient>'
        "</defs>"
        f'<rect width="1024" height="500" fill="{INK}"/>'
        '<rect width="1024" height="500" fill="url(#f1)"/><rect width="1024" height="500" fill="url(#f2)"/>'
    )
    k = 2.3
    art = f'<g transform="translate({512 - 50 * k} 44) scale({k})">{mark(c)}</g>'
    _, tw = wm.paths("samepace", 84, 0, 0, two_tone(c))
    word, _ = wm.paths("samepace", 84, 512 - tw / 2, 346, two_tone(c))
    _, lw = body_font.paths(TAGLINE, 28, 0, 0, [MUTED] * len(TAGLINE))
    line, _ = body_font.paths(TAGLINE, 28, 512 - lw / 2, 412, [MUTED] * len(TAGLINE))
    return svg("0 0 1024 500", washes + art + word + line, w=1024, h=500, title="SamePace. " + TAGLINE)


def to_jpeg(png: Path, dst: Path) -> bool:
    """Store listings and link previews want no alpha channel. Uses macOS `sips`."""
    if not shutil.which("sips"):
        print(f"sips not found: {dst.name} not refreshed")
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "92", str(png), "--out", str(dst)],
        check=True,
        capture_output=True,
    )
    return True


MANIFEST = """{
  "name": "SamePace",
  "short_name": "SamePace",
  "description": "%s",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "%s",
  "theme_color": "%s",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
"""


# ── Icons ────────────────────────────────────────────────────────────────────


def tile(body: str, *, rounded: bool) -> str:
    rx = ' rx="22.5"' if rounded else ""
    return svg("0 0 100 100", f'<rect width="100" height="100"{rx} fill="{INK}"/>' + body, title="SamePace app icon")


def scaled(body: str, k: float) -> str:
    return f'<g transform="translate(50 50) scale({k}) translate(-50 -50)">{body}</g>'


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def render(src: Path, dst: Path, w: int, h: int | None = None) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["rsvg-convert", "-w", str(w)]
    if h:
        cmd += ["-h", str(h)]
    subprocess.run(cmd + ["-o", str(dst), str(src)], check=True)


def find_font(weight: str = "600SemiBold") -> Path:
    """OUTFIT_TTF points at the SemiBold file; other weights are found beside it."""
    rel = f"node_modules/@expo-google-fonts/outfit/{weight}/Outfit_{weight}.ttf"
    env = os.environ.get("OUTFIT_TTF")
    beside = Path(env).parent.parent / weight / f"Outfit_{weight}.ttf" if env else None
    for p in (beside, ROOT / "mobile" / rel):
        if p and Path(p).is_file():
            return Path(p)
    sys.exit(f"Outfit_{weight}.ttf not found. Run `npm install` in mobile/ or set OUTFIT_TTF.")


def main() -> None:
    wm = Wordmark(find_font())

    # Masters
    marks = {
        "mark-on-dark": mark(ON_DARK),
        "mark-on-light": mark(ON_LIGHT),
        "mark-mono-white": mark(WHITE),
        "mark-mono-black": mark(BLACK),
        "mark-micro-on-dark": mark_micro(ON_DARK),
        "mark-micro-on-light": mark_micro(ON_LIGHT),
    }
    for name, body in marks.items():
        write(SVG / f"{name}.svg", svg("0 0 100 100", body))

    icon_rounded = write(SVG / "app-icon.svg", tile(mark(ON_DARK), rounded=True))
    icon_square = write(SVG / "app-icon-square.svg", tile(mark(ON_DARK), rounded=False))
    icon_micro = write(SVG / "app-icon-micro.svg", tile(mark_micro(ON_DARK), rounded=True))

    lockups = {
        "lockup-horizontal-on-dark": lockup_horizontal(wm, ON_DARK, None),
        "lockup-horizontal-on-light": lockup_horizontal(wm, ON_LIGHT, None),
        "lockup-horizontal-mono-white": lockup_horizontal(wm, WHITE, None),
        "lockup-horizontal-mono-black": lockup_horizontal(wm, BLACK, None),
        "lockup-stacked-on-dark": lockup_stacked(wm, ON_DARK, None),
        "lockup-stacked-on-light": lockup_stacked(wm, ON_LIGHT, None),
        "wordmark-on-dark": wordmark_only(wm, ON_DARK),
        "wordmark-on-light": wordmark_only(wm, ON_LIGHT),
    }
    for name, text in lockups.items():
        write(SVG / f"{name}.svg", text)

    # PNG masters. Lockups get a filled background so they are usable as-is.
    render(icon_square, PNG / "app-icon-1024.png", 1024)
    render(icon_rounded, PNG / "app-icon-rounded-512.png", 512)
    for name, c, bg in (
        ("lockup-horizontal-on-dark", ON_DARK, INK),
        ("lockup-horizontal-on-light", ON_LIGHT, PAPER),
        ("lockup-stacked-on-dark", ON_DARK, INK),
        ("lockup-stacked-on-light", ON_LIGHT, PAPER),
    ):
        fn = lockup_stacked if "stacked" in name else lockup_horizontal
        tmp = write(PNG / f".{name}.svg", fn(wm, c, bg))
        render(tmp, PNG / f"{name}.png", 1600 if "horizontal" in name else 900)
        tmp.unlink()
    render(SVG / "mark-mono-white.svg", PNG / "mark-mono-white-512.png", 512)
    render(SVG / "mark-mono-black.svg", PNG / "mark-mono-black-512.png", 512)

    # Mobile (paths match mobile/app.json)
    img = MOBILE / "images"
    render(icon_square, img / "icon.png", 1024)
    # Android adaptive icons crop to the centre 66%, so the mark is scaled to sit inside it.
    fg = write(PNG / ".android-fg.svg", svg("0 0 100 100", scaled(mark(ON_DARK), 0.78)))
    render(fg, img / "android-icon-foreground.png", 512)
    bg = write(PNG / ".android-bg.svg", svg("0 0 100 100", f'<rect width="100" height="100" fill="{INK}"/>'))
    render(bg, img / "android-icon-background.png", 512)
    mono = write(PNG / ".android-mono.svg", svg("0 0 100 100", scaled(mark({"a": "#FFFFFF", "b": "#FFFFFF"}), 0.78)))
    render(mono, img / "android-icon-monochrome.png", 432)
    for tmp in (fg, bg, mono):
        tmp.unlink()
    # Splash: app.json shows it 76 pt wide, so 228 px is @3x. Cropped to the mark.
    splash = write(PNG / ".splash.svg", svg("14 12 72 76", mark(ON_DARK)))
    render(splash, img / "splash-icon.png", 228)
    splash.unlink()
    render(icon_micro, img / "favicon.png", 48)
    # Android status-bar icon for push: the system tints it, so white on transparent.
    note = write(PNG / ".notification.svg", svg("0 0 100 100", scaled(mark({"a": "#FFFFFF", "b": "#FFFFFF"}), 1.1)))
    render(note, img / "notification-icon.png", 96)
    note.unlink()

    # iOS 26 layered icon: one vector layer on a solid ink fill.
    layer = svg("0 0 1024 1024", f'<g transform="scale(10.24)">{mark(ON_DARK)}</g>', w=1024, h=1024)
    write(MOBILE / "expo.icon" / "Assets" / "samepace-mark.svg", layer)

    # Web
    write(ROOT / "public" / "favicon.svg", tile(mark_micro(ON_DARK), rounded=True))
    card = write(SVG / "share-card.svg", og_card(wm, Wordmark(find_font("400Regular"), tracking=0.0)))
    card_png = PNG / ".share-card.png"
    render(card, card_png, 1200, 630)
    if shutil.which("sips"):
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "88", str(card_png), "--out", str(ROOT / "public" / "og.jpg")],
            check=True,
            capture_output=True,
        )
    else:
        print("sips not found: public/og.jpg not refreshed; convert brand/svg/share-card.svg by hand")
    card_png.unlink()

    # Web app icons + manifest (home-screen installs, iOS share sheet)
    public = ROOT / "public"
    render(icon_square, public / "apple-touch-icon.png", 180)
    render(icon_square, public / "icon-192.png", 192)
    render(icon_square, public / "icon-512.png", 512)
    # Maskable icons are cropped to a circle of 80%: same safe zone as Android adaptive.
    maskable = write(PNG / ".maskable.svg", svg("0 0 100 100", f'<rect width="100" height="100" fill="{INK}"/>' + scaled(mark(ON_DARK), 0.78)))
    render(maskable, public / "icon-maskable-512.png", 512)
    maskable.unlink()
    write(public / "manifest.webmanifest", MANIFEST % (TAGLINE, INK, INK))

    # Store listings (upload these by hand in App Store Connect / Play Console)
    store = ROOT / "brand" / "store"
    render(icon_square, store / "app-store-icon-1024.png", 1024)
    render(icon_square, store / "play-icon-512.png", 512)
    graphic = write(SVG / "play-feature-graphic.svg", feature_graphic(wm, Wordmark(find_font("400Regular"), tracking=0.0)))
    graphic_png = store / ".feature.png"
    render(graphic, graphic_png, 1024, 500)
    to_jpeg(graphic_png, store / "play-feature-graphic-1024x500.jpg")
    graphic_png.unlink()

    print(f"wrote {len(list(SVG.glob('*.svg')))} SVG masters, {len(list(PNG.glob('*.png')))} PNG masters, mobile icons, favicon")


if __name__ == "__main__":
    main()
