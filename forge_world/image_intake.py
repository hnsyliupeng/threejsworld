#!/usr/bin/env python3
"""Pure-stdlib PNG decoder/encoder, Otsu masking, de-lighting, comparison sheet, interior_difference & Divine Eye."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pbr_surface_synth import encode_png_rgba  # noqa: E402


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png_rgba(path: Path) -> tuple[int, int, bytes]:
    """Decode an 8-bit PNG (grayscale, RGB, gray+alpha, or RGBA) into flat RGBA bytes."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG file: {path}")
    pos = 8
    width = height = bit_depth = color_type = 0
    idat = bytearray()
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        chunk_data = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk_data)
            if bit_depth != 8 or interlace != 0:
                raise ValueError(f"Unsupported PNG format (bit_depth={bit_depth}, interlace={interlace})")
        elif tag == b"IDAT":
            idat.extend(chunk_data)
        elif tag == b"IEND":
            break

    bpp_map = {0: 1, 2: 3, 4: 2, 6: 4}
    if color_type not in bpp_map:
        raise ValueError(f"Unsupported PNG color_type={color_type} (indexed palettes unsupported)")
    bpp = bpp_map[color_type]
    raw = zlib.decompress(bytes(idat))
    stride = width * bpp
    recon = bytearray(height * stride)
    in_off = 0
    for y in range(height):
        ftype = raw[in_off]
        in_off += 1
        row_off = y * stride
        prev_off = (y - 1) * stride
        for i in range(stride):
            x_val = raw[in_off + i]
            a = recon[row_off + i - bpp] if i >= bpp else 0
            b = recon[prev_off + i] if y > 0 else 0
            c = recon[prev_off + i - bpp] if (y > 0 and i >= bpp) else 0
            if ftype == 0:
                val = x_val
            elif ftype == 1:
                val = (x_val + a) & 0xFF
            elif ftype == 2:
                val = (x_val + b) & 0xFF
            elif ftype == 3:
                val = (x_val + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                val = (x_val + _paeth(a, b, c)) & 0xFF
            else:
                raise ValueError(f"Invalid PNG filter {ftype}")
            recon[row_off + i] = val
        in_off += stride

    out = bytearray(width * height * 4)
    if color_type == 6:
        out[:] = recon
    elif color_type == 2:
        for i in range(width * height):
            out[i * 4 : i * 4 + 3] = recon[i * 3 : i * 3 + 3]
            out[i * 4 + 3] = 255
    elif color_type == 0:
        for i in range(width * height):
            g = recon[i]
            out[i * 4 : i * 4 + 4] = bytes((g, g, g, 255))
    elif color_type == 4:
        for i in range(width * height):
            g, a = recon[i * 2], recon[i * 2 + 1]
            out[i * 4 : i * 4 + 4] = bytes((g, g, g, a))
    return width, height, bytes(out)


def otsu_threshold(values: list[int]) -> int:
    """Otsu between-class variance threshold (avoids fixed-percentile self-fulfilling illusion)."""
    hist = [0] * 256
    for v in values:
        hist[v] += 1
    total = len(values)
    if total == 0:
        return 128
    sum_all = sum(i * hist[i] for i in range(256))
    sum_bg = 0.0
    w_bg = 0
    max_var = -1.0
    best_t = 128
    for t in range(256):
        w_bg += hist[t]
        if w_bg == 0:
            continue
        w_fg = total - w_bg
        if w_fg == 0:
            break
        sum_bg += t * hist[t]
        m_bg = sum_bg / w_bg
        m_fg = (sum_all - sum_bg) / w_fg
        var_between = w_bg * w_fg * (m_bg - m_fg) ** 2
        if var_between > max_var:
            max_var = var_between
            best_t = t
    return best_t


def build_foreground_mask(width: int, height: int, rgba: bytes) -> tuple[list[bool], dict[str, Any]]:
    """Compute foreground mask using alpha channel when meaningful, else Otsu distance from border color."""
    n = width * height
    alphas = [rgba[i * 4 + 3] for i in range(n)]
    if min(alphas) < 250 and max(alphas) > 10:
        mask = [a >= 128 for a in alphas]
        return mask, {"method": "alpha", "foregroundFraction": round(sum(mask) / max(1, n), 4)}

    # Estimate border background RGB median
    border_r, border_g, border_b = [], [], []
    for x in range(width):
        for y in (0, height - 1):
            p = (y * width + x) * 4
            border_r.append(rgba[p]); border_g.append(rgba[p + 1]); border_b.append(rgba[p + 2])
    border_r.sort(); border_g.sort(); border_b.sort()
    m = len(border_r) // 2
    bg = (border_r[m], border_g[m], border_b[m])
    dists = []
    for i in range(n):
        p = i * 4
        d = math.sqrt((rgba[p] - bg[0]) ** 2 + (rgba[p + 1] - bg[1]) ** 2 + (rgba[p + 2] - bg[2]) ** 2)
        dists.append(min(255, int(round(d * 255.0 / 441.673))))
    t = max(8, otsu_threshold(dists))
    mask = [d >= t for d in dists]
    return mask, {"method": "otsu-border-distance", "threshold": t, "foregroundFraction": round(sum(mask) / max(1, n), 4)}


def delight_albedo(width: int, height: int, rgba: bytes, radius: int = 8) -> bytes:
    """Remove low-frequency baked lighting gradients to approximate neutral albedo before UV projection."""
    lumas = [0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2] for i in range(width * height)]
    mean_luma = max(1.0, sum(lumas) / max(1, len(lumas)))

    # Separable box smooth of illumination field
    horiz = [0.0] * (width * height)
    for y in range(height):
        row = y * width
        for x in range(width):
            x0 = max(0, x - radius)
            x1 = min(width - 1, x + radius)
            horiz[row + x] = sum(lumas[row + xx] for xx in range(x0, x1 + 1)) / (x1 - x0 + 1)
    illum = [0.0] * (width * height)
    for y in range(height):
        y0 = max(0, y - radius)
        y1 = min(height - 1, y + radius)
        span = y1 - y0 + 1
        for x in range(width):
            illum[y * width + x] = sum(horiz[yy * width + x] for yy in range(y0, y1 + 1)) / span

    out = bytearray(len(rgba))
    for i in range(width * height):
        p = i * 4
        # Dampen illumination variation toward neutral mean_luma without erasing local texture contrast
        local_ill = max(12.0, illum[i])
        gain = (mean_luma / local_ill) ** 0.75
        gain = max(0.45, min(2.2, gain))
        out[p] = min(255, max(0, int(round(rgba[p] * gain))))
        out[p + 1] = min(255, max(0, int(round(rgba[p + 1] * gain))))
        out[p + 2] = min(255, max(0, int(round(rgba[p + 2] * gain))))
        out[p + 3] = rgba[p + 3]
    return bytes(out)


def _resize_nn(w: int, h: int, rgba: bytes, tw: int, th: int) -> bytes:
    out = bytearray(tw * th * 4)
    for y in range(th):
        sy = min(h - 1, (y * h) // th)
        for x in range(tw):
            sx = min(w - 1, (x * w) // tw)
            so = (sy * w + sx) * 4
            do = (y * tw + x) * 4
            out[do : do + 4] = rgba[so : so + 4]
    return bytes(out)


def make_comparison_sheet(ref_path: Path, render_path: Path, out_path: Path) -> dict[str, Any]:
    rw, rh, r_rgba = decode_png_rgba(ref_path)
    gw, gh, g_rgba = decode_png_rgba(render_path)
    th = max(rh, gh, 128)
    rw2 = max(1, round(rw * th / max(1, rh)))
    gw2 = max(1, round(gw * th / max(1, gh)))
    r_scaled = _resize_nn(rw, rh, r_rgba, rw2, th)
    g_scaled = _resize_nn(gw, gh, g_rgba, gw2, th)
    gap = 8
    total_w = rw2 + gap + gw2
    sheet = bytearray([24, 24, 28, 255] * (total_w * th))
    for y in range(th):
        for x in range(rw2):
            so = (y * rw2 + x) * 4
            do = (y * total_w + x) * 4
            sheet[do : do + 4] = r_scaled[so : so + 4]
        for x in range(gw2):
            so = (y * gw2 + x) * 4
            do = (y * total_w + (rw2 + gap + x)) * 4
            sheet[do : do + 4] = g_scaled[so : so + 4]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(encode_png_rgba(total_w, th, bytes(sheet)))
    return {"sheetPath": str(out_path), "width": total_w, "height": th}


def slice_grid_crops(image_path: Path, out_dir: Path, grid: int = 3) -> dict[str, Any]:
    w, h, rgba = decode_png_rgba(image_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    cw = max(1, w // grid)
    ch = max(1, h // grid)
    crops = []
    for gy in range(grid):
        for gx in range(grid):
            x0, y0 = gx * cw, gy * ch
            x1 = w if gx == grid - 1 else (gx + 1) * cw
            y1 = h if gy == grid - 1 else (gy + 1) * ch
            pw, ph = x1 - x0, y1 - y0
            buf = bytearray(pw * ph * 4)
            for y in range(ph):
                src_row = ((y0 + y) * w + x0) * 4
                dst_row = (y * pw) * 4
                buf[dst_row : dst_row + pw * 4] = rgba[src_row : src_row + pw * 4]
            crop_name = f"zone_r{gy}_c{gx}.png"
            (out_dir / crop_name).write_bytes(encode_png_rgba(pw, ph, bytes(buf)))
            crops.append({
                "zone": f"r{gy}_c{gx}",
                "file": crop_name,
                "region": {
                    "x": round(x0 / w, 4),
                    "y": round(y0 / h, 4),
                    "width": round(pw / w, 4),
                    "height": round(ph / h, 4),
                },
            })
    return {"image": str(image_path), "width": w, "height": h, "grid": grid, "crops": crops}


def _luma_grid(w: int, h: int, rgba: bytes, size: int = 64) -> list[float]:
    scaled = _resize_nn(w, h, rgba, size, size)
    return [
        (0.2126 * scaled[i * 4] + 0.7152 * scaled[i * 4 + 1] + 0.0722 * scaled[i * 4 + 2]) / 255.0
        for i in range(size * size)
    ]


def _sobel_edges(luma: list[float], size: int) -> list[float]:
    edges = [0.0] * (size * size)
    for y in range(1, size - 1):
        for x in range(1, size - 1):
            gx = (
                -luma[(y - 1) * size + (x - 1)] + luma[(y - 1) * size + (x + 1)]
                - 2 * luma[y * size + (x - 1)] + 2 * luma[y * size + (x + 1)]
                - luma[(y + 1) * size + (x - 1)] + luma[(y + 1) * size + (x + 1)]
            )
            gy = (
                -luma[(y - 1) * size + (x - 1)] - 2 * luma[(y - 1) * size + x] - luma[(y - 1) * size + (x + 1)]
                + luma[(y + 1) * size + (x - 1)] + 2 * luma[(y + 1) * size + x] + luma[(y + 1) * size + (x + 1)]
            )
            edges[y * size + x] = math.hypot(gx, gy)
    return edges


def _hog_cosine(luma_a: list[float], luma_b: list[float], size: int = 64) -> float:
    """Coarse 8-bin gradient orientation cosine similarity (OSIM-lite objectness rescue)."""
    def hist8(luma: list[float]) -> list[float]:
        bins = [0.0] * 8
        for y in range(1, size - 1):
            for x in range(1, size - 1):
                gx = luma[y * size + x + 1] - luma[y * size + x - 1]
                gy = luma[(y + 1) * size + x] - luma[(y - 1) * size + x]
                mag = math.hypot(gx, gy)
                if mag > 0.02:
                    ang = (math.atan2(gy, gx) + math.pi) / (2.0 * math.pi)
                    b = min(7, int(ang * 8))
                    bins[b] += mag
        norm = math.sqrt(sum(v * v for v in bins)) or 1.0
        return [v / norm for v in bins]

    ha = hist8(luma_a)
    hb = hist8(luma_b)
    return sum(a * b for a, b in zip(ha, hb))


def compute_interior_difference(
    ref_rgba: bytes,
    ren_rgba: bytes,
    size: int = 64,
    bands: int = 4,
) -> dict[str, Any]:
    """Compare interior pixels INSIDE the silhouette, banded vertically (catches deleted faces)."""
    ref_l = _luma_grid(size, size, ref_rgba, size)
    ren_l = _luma_grid(size, size, ren_rgba, size)
    mask_ref, _ = build_foreground_mask(size, size, ref_rgba)
    mask_ren, _ = build_foreground_mask(size, size, ren_rgba)

    cells_compared = 0
    total_abs_diff = 0.0
    band_diffs: list[float | None] = []
    band_h = max(1, size // bands)
    for b in range(bands):
        y0 = b * band_h
        y1 = size if b == bands - 1 else (b + 1) * band_h
        b_cnt = 0
        b_sum = 0.0
        for y in range(y0, y1):
            for x in range(size):
                idx = y * size + x
                if mask_ref[idx]:
                    p = idx * 4
                    dr = abs(ref_rgba[p] - ren_rgba[p]) / 255.0
                    dg = abs(ref_rgba[p + 1] - ren_rgba[p + 1]) / 255.0
                    db = abs(ref_rgba[p + 2] - ren_rgba[p + 2]) / 255.0
                    d = (dr + dg + db) / 3.0 + 0.25 * abs(ref_l[idx] - ren_l[idx])
                    b_sum += d
                    b_cnt += 1
                    total_abs_diff += d
                    cells_compared += 1
        band_diffs.append(round(b_sum / b_cnt, 4) if b_cnt > 0 else None)

    mean_diff = (total_abs_diff / cells_compared) if cells_compared > 0 else 1.0
    return {
        "cellsCompared": cells_compared,
        "meanInteriorDifference": round(mean_diff, 4),
        "bandedDifferences": band_diffs,
        "passed": cells_compared >= 16 and mean_diff <= 0.35,
    }


def evaluate_divine_eye(ref_path: Path, render_path: Path) -> dict[str, Any]:
    """Deterministic multi-signal evaluator (IoU/scale hard gates + soft ensemble + OSIM-lite rescue)."""
    rw, rh, r_raw = decode_png_rgba(ref_path)
    gw, gh, g_raw = decode_png_rgba(render_path)
    grid = 64
    r_64 = _resize_nn(rw, rh, r_raw, grid, grid)
    g_64 = _resize_nn(gw, gh, g_raw, grid, grid)

    mask_r, _ = build_foreground_mask(grid, grid, r_64)
    mask_g, _ = build_foreground_mask(grid, grid, g_64)
    inter = sum(1 for a, b in zip(mask_r, mask_g) if a and b)
    union = sum(1 for a, b in zip(mask_r, mask_g) if a or b)
    iou = inter / max(1, union)

    area_r = sum(mask_r) / float(grid * grid)
    area_g = sum(mask_g) / float(grid * grid)
    scale_delta = abs(area_r - area_g) / max(0.01, area_r)

    luma_r = _luma_grid(grid, grid, r_64, grid)
    luma_g = _luma_grid(grid, grid, g_64, grid)
    mean_r = sum(luma_r) / len(luma_r)
    mean_g = sum(luma_g) / len(luma_g)
    var_r = sum((v - mean_r) ** 2 for v in luma_r) / len(luma_r)
    var_g = sum((v - mean_g) ** 2 for v in luma_g) / len(luma_g)
    cov_rg = sum((a - mean_r) * (b - mean_g) for a, b in zip(luma_r, luma_g)) / len(luma_r)
    c1, c2 = 0.0001, 0.0009
    ssim = ((2 * mean_r * mean_g + c1) * (2 * cov_rg + c2)) / ((mean_r**2 + mean_g**2 + c1) * (var_r + var_g + c2))
    ssim = max(0.0, min(1.0, ssim))

    er = _sobel_edges(luma_r, grid)
    eg = _sobel_edges(luma_g, grid)
    e_inter = sum(1 for a, b in zip(er, eg) if a > 0.15 and b > 0.15)
    e_union = sum(1 for a, b in zip(er, eg) if a > 0.15 or b > 0.15)
    edge_overlap = e_inter / max(1, e_union)

    objectness = _hog_cosine(luma_r, luma_g, grid)
    interior = compute_interior_difference(r_64, g_64, size=grid, bands=4)

    soft_score = 0.35 * ssim + 0.25 * edge_overlap + 0.25 * (1.0 - interior["meanInteriorDifference"]) + 0.15 * objectness
    iou_ok = iou >= 0.85
    scale_ok = scale_delta <= 0.08
    hard_ok = iou_ok and scale_ok and interior["passed"]

    reconstruction_rescue = (not iou_ok) and scale_ok and objectness >= 0.48
    if hard_ok and soft_score >= 0.72:
        verdict = "continue"
    elif reconstruction_rescue:
        verdict = "probe"
    elif not hard_ok:
        verdict = "refine-code"
    else:
        verdict = "refine-code"

    return {
        "verdict": verdict,
        "reconstructionModeSuspected": reconstruction_rescue,
        "hardGates": {
            "silhouetteIoU": round(iou, 4),
            "iouPassed": iou_ok,
            "scaleDelta": round(scale_delta, 4),
            "scalePassed": scale_ok,
            "interiorPassed": interior["passed"],
        },
        "softSignals": {
            "lumaSSIM": round(ssim, 4),
            "edgeOverlap": round(edge_overlap, 4),
            "objectnessHOG": round(objectness, 4),
            "interiorDifference": interior,
            "compositeSoftScore": round(soft_score, 4),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ThreeJSWorld intake & visual diagnostics")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_probe = sub.add_parser("probe")
    p_probe.add_argument("--image", type=Path, required=True)

    p_slice = sub.add_parser("slice")
    p_slice.add_argument("--image", type=Path, required=True)
    p_slice.add_argument("--out-dir", type=Path, required=True)
    p_slice.add_argument("--grid", type=int, default=3)

    p_delight = sub.add_parser("delight")
    p_delight.add_argument("--image", type=Path, required=True)
    p_delight.add_argument("--out", type=Path, required=True)

    p_sheet = sub.add_parser("sheet")
    p_sheet.add_argument("--reference", type=Path, required=True)
    p_sheet.add_argument("--render", type=Path, required=True)
    p_sheet.add_argument("--out", type=Path, required=True)

    p_eval = sub.add_parser("evaluate")
    p_eval.add_argument("--reference", type=Path, required=True)
    p_eval.add_argument("--render", type=Path, required=True)

    args = parser.parse_args(argv)
    if args.cmd == "probe":
        w, h, rgba = decode_png_rgba(args.image)
        _, fg = build_foreground_mask(w, h, rgba)
        print(json.dumps({"width": w, "height": h, "aspect": round(w / max(1, h), 4), "foreground": fg}, indent=2))
        return 0
    if args.cmd == "slice":
        print(json.dumps(slice_grid_crops(args.image, args.out_dir, args.grid), indent=2))
        return 0
    if args.cmd == "delight":
        w, h, rgba = decode_png_rgba(args.image)
        delit = delight_albedo(w, h, rgba)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(encode_png_rgba(w, h, delit))
        print(json.dumps({"delit": str(args.out), "width": w, "height": h}, indent=2))
        return 0
    if args.cmd == "sheet":
        print(json.dumps(make_comparison_sheet(args.reference, args.render, args.out), indent=2))
        return 0
    if args.cmd == "evaluate":
        res = evaluate_divine_eye(args.reference, args.render)
        print(json.dumps(res, indent=2))
        return 0 if res["verdict"] == "continue" else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
