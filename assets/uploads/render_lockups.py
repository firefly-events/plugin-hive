"""Render Hive logo lockups (mark + 'Hive' wordmark) directly via PIL.

Produces:
  - hive-lockup-horizontal-{4096,2048,1024,512}.png  (transparent, 4:1)
  - hive-lockup-horizontal-cream-{...}.png           (cream bg)
  - hive-lockup-square-{1024,512}.png                (transparent, 1:1, mark-over-wordmark stack)
  - hive-lockup-square-cream-{1024,512}.png
  - hive-lockup-banner-{2048,1280}.png               (16:9 social card)
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

OUT = Path("/Users/don/Documents/plugin-hive/assets/uploads")
OUT.mkdir(parents=True, exist_ok=True)
FONT_PATH = str(Path.home() / "Library/Fonts/Montserrat-BoldItalic.ttf")

# Brand colors
DEEP_VIOLET = (58, 37, 95, 255)        # #3A255F
PLUM = (161, 36, 104, 255)             # #A12468
GOLD = (255, 205, 97, 255)             # #FFCD61
NIGHT_JAR = (41, 14, 67, 255)          # #290E43
CREAM = (255, 241, 207, 255)           # #FFF1CF


# ---------- Concept 4 mark (drawn in 120x120 source units, then scaled) ----------

def draw_mark(canvas: Image.Image, draw: ImageDraw.ImageDraw, *,
              cx: float, cy: float, scale: float,
              stroke_color=DEEP_VIOLET) -> None:
    """Draw Concept 4 hex with adjacent ghost cells, centered at (cx, cy).

    Source mark bounding box (with ghost cells) ≈ 76 wide × 110 tall in 120-unit coords.
    `scale` = output px per source unit.
    """
    # Source coords: translate(38, 38) is built into points below.
    tx, ty = 38, 38

    def P(x, y):
        return (cx + (tx + x - 60) * scale, cy + (ty + y - 60) * scale)

    # Stroke widths
    main_stroke = max(2, round(2.4 * scale))
    ghost_stroke = max(2, round(2.0 * scale))

    # Ghost NE (50% opacity)
    ne = [(22, 0), (22, -22), (41.05, -33), (60.10, -22), (60.10, 0)]
    ne_pts = [P(x, y) for x, y in ne]
    ghost_color_ne = blend(stroke_color, (0, 0, 0, 0), 0.5)
    draw_polyline(canvas, ne_pts, ghost_color_ne, ghost_stroke)

    # Ghost SW (35% opacity)
    sw = [(2.95, 33), (-16.10, 44), (-16.10, 66), (2.95, 77)]
    sw_pts = [P(x, y) for x, y in sw]
    ghost_color_sw = blend(stroke_color, (0, 0, 0, 0), 0.35)
    draw_polyline(canvas, sw_pts, ghost_color_sw, ghost_stroke)

    # Main hex
    hex_pts = [(22, 0), (41.05, 11), (41.05, 33), (22, 44), (2.95, 33), (2.95, 11)]
    hex_xy = [P(x, y) for x, y in hex_pts]
    # Closed polygon outline
    draw_polyline(canvas, hex_xy + [hex_xy[0]], stroke_color, main_stroke)

    # Vertex dots
    dot_colors = [GOLD, PLUM, DEEP_VIOLET, GOLD, PLUM, DEEP_VIOLET]
    r = 4.5 * scale
    for (x, y), color in zip(hex_pts, dot_colors):
        cx_, cy_ = P(x, y)
        draw.ellipse([cx_ - r, cy_ - r, cx_ + r, cy_ + r], fill=color)


def blend(fg_rgba, bg_rgba, alpha):
    """Multiply fg alpha by `alpha`."""
    r, g, b, a = fg_rgba
    return (r, g, b, int(round(a * alpha)))


def draw_polyline(canvas: Image.Image, pts, color, width):
    """Anti-aliased polyline with rounded caps/joins.

    PIL's draw.line is not AA. We draw on a separate RGBA layer with
    line() then composite, which keeps per-segment endpoint dots smooth.
    """
    if color[3] == 0:
        return
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    # PIL line is jagged at edges; use ellipse end-caps + joins for smoothness.
    ld.line(pts, fill=color, width=width, joint="curve")
    # End-cap circles
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        ld.ellipse([x - r, y - r, x + r, y + r], fill=color)
    canvas.alpha_composite(layer)


# ---------- Wordmark ----------

def draw_wordmark(canvas: Image.Image, draw: ImageDraw.ImageDraw, *,
                  baseline_xy, font_size: int, color=DEEP_VIOLET):
    font = ImageFont.truetype(FONT_PATH, font_size)
    x, y = baseline_xy
    # PIL anchor "ls" = left, baseline
    draw.text((x, y), "Hive", font=font, fill=color, anchor="ls")


def measure_text(font_size: int):
    font = ImageFont.truetype(FONT_PATH, font_size)
    bbox = font.getbbox("Hive", anchor="ls")
    # bbox is (left, top, right, bottom) relative to anchor point
    return bbox, font


# ---------- Composition helpers ----------

def make_canvas(w: int, h: int, bg=None) -> Image.Image:
    if bg is None:
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))
    return Image.new("RGBA", (w, h), bg)


def render_horizontal(width: int, height: int, *, bg=None,
                      mark_color=DEEP_VIOLET, text_color=DEEP_VIOLET,
                      padding_ratio: float = 0.10) -> Image.Image:
    """Horizontal lockup: mark + wordmark, centered as a group.

    Text size auto-fits to available width. Mark height matches text cap height
    so the lockup reads as a balanced unit.
    """
    canvas = make_canvas(width, height, bg)
    draw = ImageDraw.Draw(canvas)

    pad = int(height * padding_ratio)
    avail_w = width - 2 * pad
    avail_h = height - 2 * pad

    # Source mark bbox ≈ 76 × 110 (incl. ghost cells); main hex (vertices only) ≈ 38 × 44.
    # We want the MAIN hex height to roughly match "Hive" cap height.
    # Mark scale chosen so total mark height fits avail_h, then text sized accordingly.

    # Cap height of Montserrat Bold Italic ≈ 0.72 × font_size.
    # Main hex (44 source units) target = cap height of text.
    # So if mark scale = s, main hex height = 44s = cap_h = 0.72 * font_size.
    # Mark total height (incl. ghost cells) = 110s. Must fit avail_h.

    # Iteratively pick a font_size that makes the whole assembly fit avail_w and avail_h.
    def assembly_dims(font_size: int):
        s = (0.72 * font_size) / 44.0
        mark_total_w = 76 * s
        mark_total_h = 110 * s
        bbox, _ = measure_text(font_size)
        text_l, text_t, text_r, text_b = bbox
        text_w = text_r - text_l
        text_h = text_b - text_t
        gutter = max(int(font_size * 0.18), 16)
        total_w = mark_total_w + gutter + text_w
        total_h = max(mark_total_h, text_h)
        return s, mark_total_w, mark_total_h, gutter, text_w, text_h, total_w, total_h, bbox

    # Binary search font_size up to a generous max
    lo, hi = 8, max(8, height * 4)
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        s, mw, mh, g, tw, th, tot_w, tot_h, _ = assembly_dims(mid)
        if tot_w <= avail_w and tot_h <= avail_h:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1

    font_size = best
    s, mark_w, mark_h, gutter, text_w, text_h, total_w, total_h, bbox = assembly_dims(font_size)
    text_l, text_t, text_r, text_b = bbox

    # Center group horizontally
    group_x0 = int((width - total_w) / 2)
    mark_cx = group_x0 + mark_w / 2
    mark_cy = height / 2

    draw_mark(canvas, draw, cx=mark_cx, cy=mark_cy, scale=s, stroke_color=mark_color)

    text_x = int(mark_cx + mark_w / 2 + gutter - text_l)
    text_baseline_y = int(height / 2 - (text_t + text_b) / 2)
    draw_wordmark(canvas, draw, baseline_xy=(text_x, text_baseline_y),
                  font_size=font_size, color=text_color)
    return canvas


def render_square(side: int, *, bg=None,
                  mark_color=DEEP_VIOLET, text_color=DEEP_VIOLET) -> Image.Image:
    """Square lockup: mark stacked above wordmark."""
    canvas = make_canvas(side, side, bg)
    draw = ImageDraw.Draw(canvas)

    # Mark in top half, wordmark in bottom third
    mark_target_h = int(side * 0.50)
    scale = mark_target_h / 110.0
    mark_cx = side / 2
    mark_cy = side * 0.36
    draw_mark(canvas, draw, cx=mark_cx, cy=mark_cy, scale=scale, stroke_color=mark_color)

    # Wordmark below
    target_cap_h = side * 0.22
    font_size = int(target_cap_h / 0.72)
    bbox, font = measure_text(font_size)
    text_left, text_top, text_right, text_bottom = bbox
    text_w = text_right - text_left
    text_x = int((side - text_w) / 2 - text_left)
    text_baseline_y = int(side * 0.82 - text_top)  # roughly position cap top at 0.82*side - text_top
    # Better: vertical anchor center on y = 0.78*side
    target_cy = side * 0.80
    text_baseline_y = int(target_cy - (text_top + text_bottom) / 2)
    draw_wordmark(canvas, draw, baseline_xy=(text_x, text_baseline_y),
                  font_size=font_size, color=text_color)
    return canvas


def render_banner(width: int, height: int, *, bg=CREAM,
                  mark_color=DEEP_VIOLET, text_color=DEEP_VIOLET) -> Image.Image:
    """Wide banner (e.g., 16:9 1280x640 GitHub social preview). Same as horizontal."""
    return render_horizontal(width, height, bg=bg,
                             mark_color=mark_color, text_color=text_color)


# ---------- Output ----------

def save_set(prefix: str, image: Image.Image, sizes: list[tuple[int, int]]):
    """Save base image, then downsampled variants matching aspect."""
    base_w, base_h = image.size
    for w, h in sizes:
        if (w, h) == (base_w, base_h):
            out = OUT / f"{prefix}-{w}x{h}.png"
            image.save(out, "PNG", optimize=True)
        else:
            resized = image.resize((w, h), Image.LANCZOS)
            out = OUT / f"{prefix}-{w}x{h}.png"
            resized.save(out, "PNG", optimize=True)
        print(f"  wrote {out.name}")


def main():
    print("== horizontal 4:1 transparent ==")
    h_master = render_horizontal(4096, 1024, bg=None)
    save_set("hive-lockup-horizontal", h_master,
             [(4096, 1024), (2048, 512), (1024, 256), (512, 128)])

    print("== horizontal 4:1 cream ==")
    h_cream = render_horizontal(4096, 1024, bg=CREAM)
    save_set("hive-lockup-horizontal-cream", h_cream,
             [(4096, 1024), (2048, 512), (1024, 256), (512, 128)])

    print("== horizontal 4:1 dark (cream marks on Night Jar) ==")
    h_dark = render_horizontal(4096, 1024, bg=NIGHT_JAR,
                               mark_color=CREAM, text_color=CREAM)
    save_set("hive-lockup-horizontal-dark", h_dark,
             [(4096, 1024), (2048, 512), (1024, 256), (512, 128)])

    print("== square 1:1 transparent ==")
    sq = render_square(2048, bg=None)
    save_set("hive-lockup-square", sq,
             [(2048, 2048), (1024, 1024), (512, 512), (400, 400), (256, 256)])

    print("== square 1:1 cream ==")
    sq_cream = render_square(2048, bg=CREAM)
    save_set("hive-lockup-square-cream", sq_cream,
             [(2048, 2048), (1024, 1024), (512, 512), (400, 400), (256, 256)])

    print("== social banner 2:1 cream (GitHub social preview 1280x640) ==")
    banner = render_banner(2560, 1280, bg=CREAM)
    save_set("hive-lockup-banner", banner,
             [(2560, 1280), (1280, 640)])

    print("== social banner 2:1 dark ==")
    banner_dark = render_banner(2560, 1280, bg=NIGHT_JAR,
                                mark_color=CREAM, text_color=CREAM)
    save_set("hive-lockup-banner-dark", banner_dark,
             [(2560, 1280), (1280, 640)])

    print("done")


if __name__ == "__main__":
    main()
