#!/usr/bin/env python3
"""Pure Python stdlib Surface::shaped multi-scale relief PBR synthesizer & coverage-preserving mipmaps."""

from __future__ import annotations

import argparse
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any


def encode_png_rgba(width: int, height: int, rgba: bytes) -> bytes:
    """Minimal pure-stdlib RGBA PNG encoder."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type None
        row_start = y * stride
        raw.extend(rgba[row_start : row_start + stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=6)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def _hash2(ix: int, iy: int, seed: int) -> float:
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFFFF) / float(0x1000000)


def _periodic_value_noise(u: float, v: float, period: int, seed: int) -> float:
    x = u * period
    y = v * period
    x0 = math.floor(x)
    y0 = math.floor(y)
    fx = x - x0
    fy = y - y0
    sx = fx * fx * (3.0 - 2.0 * fx)
    sy = fy * fy * (3.0 - 2.0 * fy)
    ix0 = x0 % period
    iy0 = y0 % period
    ix1 = (ix0 + 1) % period
    iy1 = (iy0 + 1) % period
    n00 = _hash2(ix0, iy0, seed)
    n10 = _hash2(ix1, iy0, seed)
    n01 = _hash2(ix0, iy1, seed)
    n11 = _hash2(ix1, iy1, seed)
    nx0 = n00 + (n10 - n00) * sx
    nx1 = n01 + (n11 - n01) * sx
    return nx0 + (nx1 - nx0) * sy


def _periodic_fbm(u: float, v: float, base_period: int, octaves: int, seed: int) -> float:
    val = 0.0
    amp = 0.5
    norm = 0.0
    freq = base_period
    for o in range(octaves):
        val += amp * _periodic_value_noise(u, v, freq, seed + o * 97)
        norm += amp
        amp *= 0.5
        freq *= 2
    return val / max(1e-6, norm)


def _periodic_worley(u: float, v: float, cells: int, seed: int) -> float:
    x = u * cells
    y = v * cells
    cx = math.floor(x)
    cy = math.floor(y)
    min_d = 99.0
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx = (cx + dx) % cells
            ny = (cy + dy) % cells
            px = (cx + dx) + _hash2(nx, ny, seed + 17)
            py = (cy + dy) + _hash2(nx, ny, seed + 53)
            d = math.hypot(px - x, py - y)
            if d < min_d:
                min_d = d
    return min_d


def _height_recipe(preset: str, u: float, v: float, seed: int) -> tuple[float, float]:
    """Return physical height in metres and material tag in [0, 1]. Strictly periodic over [0, 1]^2."""
    if preset == "vertical-bark-furrows":
        groove = math.sin(u * math.tau * 6.0 + _periodic_fbm(u, v, 4, 3, seed) * 2.4)
        ridge = _periodic_fbm(u * 2.0 % 1.0, v, 8, 4, seed + 11)
        h_m = 0.028 * (0.65 * groove + 0.35 * (ridge - 0.5))
        return h_m, 0.5 + 0.5 * groove
    if preset == "engraved-patina":
        brush = _periodic_value_noise(u, (v * 8.0) % 1.0, 16, seed + 3)
        ring = abs(((u - 0.5) ** 2 + (v - 0.5) ** 2) ** 0.5 - 0.32)
        engrave = -0.004 if ring < 0.018 else 0.0
        h_m = engrave + 0.0012 * (brush - 0.5)
        return h_m, 1.0 if engrave < 0.0 else 0.0
    if preset == "pebbled-leather-grain":
        cell = _periodic_worley(u, v, 18, seed)
        dome = max(0.0, 0.48 - cell)
        h_m = 0.006 * dome + 0.001 * (_periodic_fbm(u, v, 12, 3, seed + 5) - 0.5)
        return h_m, cell
    if preset == "wood-grain-fibers":
        ring_arg = u * 10.0 + _periodic_fbm(u, v, 3, 3, seed) * 3.0
        ring = 0.5 + 0.5 * math.sin(ring_arg * math.tau)
        h_m = 0.004 * (ring - 0.5)
        return h_m, ring
    if preset == "pine-needles-card":
        # Central stem around u=0.5, angled needles radiating outward
        du = abs(u - 0.5)
        stem = 1.0 if (du < 0.035 * (1.0 - 0.7 * v) and v < 0.94) else 0.0
        needle_coord = (v * 14.0 - du * 18.0)
        needle_wave = math.sin(needle_coord * math.tau)
        in_cone = du < (0.42 * (1.0 - 0.65 * v) + 0.04)
        needle = 1.0 if (in_cone and 0.05 < v < 0.96 and needle_wave > -0.15) else 0.0
        alpha = max(stem, needle)
        return (0.01 * alpha, 1.0 if stem > 0.5 else 0.0)
    # Default: granite-cracks-moss
    broad = _periodic_fbm(u, v, 4, 4, seed)
    crack_d = _periodic_worley(u, v, 6, seed + 29)
    crack = -0.045 * max(0.0, 1.0 - crack_d * 5.0)
    h_m = 0.09 * (broad - 0.5) + crack
    return h_m, broad


def _box_blur_periodic(grid: list[float], size: int, radius: int) -> list[float]:
    if radius <= 0:
        return list(grid)
    horiz = [0.0] * (size * size)
    win = 2 * radius + 1
    for y in range(size):
        row_off = y * size
        acc = sum(grid[row_off + ((x) % size)] for x in range(-radius, radius + 1))
        for x in range(size):
            horiz[row_off + x] = acc / win
            add_x = (x + radius + 1) % size
            rem_x = (x - radius) % size
            acc += grid[row_off + add_x] - grid[row_off + rem_x]
    out = [0.0] * (size * size)
    for x in range(size):
        acc = sum(horiz[((y) % size) * size + x] for y in range(-radius, radius + 1))
        for y in range(size):
            out[y * size + x] = acc / win
            add_y = (y + radius + 1) % size
            rem_y = (y - radius) % size
            acc += horiz[add_y * size + x] - horiz[rem_y * size + x]
    return out


def synthesize_shaped_surface(
    preset: str = "granite-cracks-moss",
    size: int = 128,
    tile_metres: float = 2.5,
    seed: int = 42,
    moss_coverage: float = 0.25,
) -> dict[str, Any]:
    """Synthesize coupled albedo (RGBA sRGB), normal (RGBA linear), roughness & cavity (RGBA linear)."""
    heights = [0.0] * (size * size)
    tags = [0.0] * (size * size)
    for y in range(size):
        v = y / float(size)
        for x in range(size):
            u = x / float(size)
            h_m, tag = _height_recipe(preset, u, v, seed)
            heights[y * size + x] = h_m
            tags[y * size + x] = tag

    # Solstice-style 3-band relative relief (2cm fine, 10cm medium, 50cm broad)
    px_per_m = size / max(0.05, tile_metres)
    r_fine = max(1, round(0.02 * px_per_m))
    r_med = max(2, round(0.10 * px_per_m))
    r_broad = max(3, round(0.50 * px_per_m))

    avg_fine = _box_blur_periodic(heights, size, min(r_fine, size // 4))
    avg_med = _box_blur_periodic(heights, size, min(r_med, size // 3))
    avg_broad = _box_blur_periodic(heights, size, min(r_broad, size // 2))

    albedo = bytearray(size * size * 4)
    normal = bytearray(size * size * 4)
    roughness_ao = bytearray(size * size * 4)

    texel_m = tile_metres / float(size)
    for y in range(size):
        ym1 = (y - 1) % size
        yp1 = (y + 1) % size
        for x in range(size):
            xm1 = (x - 1) % size
            xp1 = (x + 1) % size
            idx = y * size + x
            h = heights[idx]
            fine = h - avg_fine[idx]
            med = h - avg_med[idx]
            broad = h - avg_broad[idx]
            tag = tags[idx]

            # Tangent-space normal from real physical metre slope
            dh_dx = (heights[y * size + xp1] - heights[y * size + xm1]) / (2.0 * texel_m)
            dh_dy = (heights[yp1 * size + x] - heights[ym1 * size + x]) / (2.0 * texel_m)
            nx, ny, nz = -dh_dx, -dh_dy, 1.0
            nlen = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / nlen, ny / nlen, nz / nlen

            cavity = _clamp01(0.75 + med * 14.0 + broad * 4.0)
            wear = _clamp01(med * 22.0 + fine * 30.0)

            if preset == "pine-needles-card":
                alpha_on = h > 0.001
                if not alpha_on:
                    r_col, g_col, b_col, a_col = 0.0, 0.0, 0.0, 0.0
                elif tag > 0.5:  # twig
                    r_col, g_col, b_col, a_col = 0.36, 0.33, 0.27, 1.0
                else:
                    v_norm = y / float(size)
                    shade = 0.72 + 0.28 * v_norm
                    r_col, g_col, b_col, a_col = 0.18 * shade, 0.42 * shade, 0.22 * shade, 1.0
                rough = 0.68
            elif preset == "vertical-bark-furrows":
                base_r, base_g, base_b = 0.36, 0.29, 0.23
                dark = 0.45 + 0.55 * cavity
                r_col = base_r * dark + 0.05 * wear
                g_col = base_g * dark + 0.04 * wear
                b_col = base_b * dark + 0.03 * wear
                a_col = 1.0
                rough = _clamp01(0.92 - 0.14 * wear)
            elif preset == "engraved-patina":
                is_groove = tag > 0.5
                r_col = 0.24 if is_groove else (0.76 + 0.08 * wear)
                g_col = 0.22 if is_groove else (0.61 + 0.06 * wear)
                b_col = 0.14 if is_groove else (0.31 + 0.04 * wear)
                a_col = 1.0
                rough = 0.78 if is_groove else _clamp01(0.32 - 0.10 * wear)
            elif preset == "pebbled-leather-grain":
                r_col = 0.26 * (0.7 + 0.3 * cavity) + 0.08 * wear
                g_col = 0.17 * (0.7 + 0.3 * cavity) + 0.05 * wear
                b_col = 0.12 * (0.7 + 0.3 * cavity) + 0.03 * wear
                a_col = 1.0
                rough = _clamp01(0.72 - 0.22 * wear)
            elif preset == "wood-grain-fibers":
                tone = 0.55 + 0.45 * tag
                r_col = 0.44 * tone * cavity
                g_col = 0.28 * tone * cavity
                b_col = 0.16 * tone * cavity
                a_col = 1.0
                rough = _clamp01(0.76 - 0.12 * tag)
            else:  # granite-cracks-moss
                stone = 0.42 * cavity + 0.10 * wear
                # Moss prefers hollows (med < 0) and non-vertical slopes (nz > 0.7), not sharp ridges
                moss_mask = _clamp01((moss_coverage - 0.1 + (-med * 18.0)) * (1.0 - wear) * (1.0 if nz > 0.75 else 0.0))
                r_col = stone * (1.0 - moss_mask) + 0.24 * moss_mask
                g_col = stone * (1.0 - moss_mask) + 0.42 * moss_mask
                b_col = stone * (1.0 - moss_mask) + 0.14 * moss_mask
                a_col = 1.0
                rough = _clamp01(0.84 - 0.16 * wear + 0.10 * moss_mask)

            p4 = idx * 4
            # Linear -> sRGB gamma ~ 1/2.2 for albedo
            albedo[p4] = int(round(_clamp01(r_col ** (1.0 / 2.2)) * 255))
            albedo[p4 + 1] = int(round(_clamp01(g_col ** (1.0 / 2.2)) * 255))
            albedo[p4 + 2] = int(round(_clamp01(b_col ** (1.0 / 2.2)) * 255))
            albedo[p4 + 3] = int(round(_clamp01(a_col) * 255))

            normal[p4] = int(round((nx * 0.5 + 0.5) * 255))
            normal[p4 + 1] = int(round((ny * 0.5 + 0.5) * 255))
            normal[p4 + 2] = int(round((nz * 0.5 + 0.5) * 255))
            normal[p4 + 3] = 255

            # glTF channel packing: R=AO/cavity, G=roughness, B=metalness(0/0.9)
            metal_byte = 230 if (preset == "engraved-patina" and tag < 0.5) else 0
            roughness_ao[p4] = int(round(cavity * 255))
            roughness_ao[p4 + 1] = int(round(rough * 255))
            roughness_ao[p4 + 2] = metal_byte
            roughness_ao[p4 + 3] = 255

    return {
        "width": size,
        "height": size,
        "tileMetres": tile_metres,
        "albedo": bytes(albedo),
        "normal": bytes(normal),
        "orm": bytes(roughness_ao),
    }


def _coverage_ratio(rgba: bytes, alpha_test: float) -> float:
    thresh = int(math.ceil(alpha_test * 255))
    total = len(rgba) // 4
    if total == 0:
        return 0.0
    covered = sum(1 for i in range(3, len(rgba), 4) if rgba[i] >= thresh)
    return covered / float(total)


def build_coverage_preserving_mipmaps(
    width: int,
    height: int,
    rgba: bytes,
    alpha_test: float = 0.45,
) -> list[dict[str, Any]]:
    """Build full mip chain preserving opaque alpha-test coverage ratio across every mip level."""
    target_cov = _coverage_ratio(rgba, alpha_test)
    thresh = int(math.ceil(alpha_test * 255))
    mips: list[dict[str, Any]] = [
        {"level": 0, "width": width, "height": height, "coverage": target_cov, "data": bytes(rgba)}
    ]
    cur_w, cur_h, cur_data = width, height, bytes(rgba)
    level = 0
    while cur_w > 1 or cur_h > 1:
        level += 1
        nw = max(1, cur_w // 2)
        nh = max(1, cur_h // 2)
        out = bytearray(nw * nh * 4)
        for y in range(nh):
            sy0 = min(cur_h - 1, y * 2)
            sy1 = min(cur_h - 1, sy0 + 1)
            for x in range(nw):
                sx0 = min(cur_w - 1, x * 2)
                sx1 = min(cur_w - 1, sx0 + 1)
                offs = [
                    (sy0 * cur_w + sx0) * 4,
                    (sy0 * cur_w + sx1) * 4,
                    (sy1 * cur_w + sx0) * 4,
                    (sy1 * cur_w + sx1) * 4,
                ]
                alphas = [cur_data[o + 3] for o in offs]
                asum = sum(alphas)
                o4 = (y * nw + x) * 4
                for c in range(3):
                    if asum > 0:
                        out[o4 + c] = int(round(sum(cur_data[o + c] * cur_data[o + 3] for o in offs) / asum))
                    else:
                        out[o4 + c] = 0
                out[o4 + 3] = int(round(asum * 0.25))

        # Binary search alpha scale multiplier to match target_cov
        if target_cov > 0.0:
            n_px = nw * nh
            target_count = round(target_cov * n_px)
            lo, hi = 0.0, 255.0
            best_s = 1.0
            best_err = n_px + 1
            hist = [0] * 256
            for i in range(3, len(out), 4):
                hist[out[i]] += 1
            for _ in range(32):
                mid = 0.5 * (lo + hi)
                cov = sum(hist[a] for a in range(1, 256) if min(255, round(a * mid)) >= thresh)
                err = abs(cov - target_count)
                if err < best_err:
                    best_err = err
                    best_s = mid
                if err == 0:
                    break
                if cov < target_count:
                    lo = mid
                else:
                    hi = mid
            for i in range(3, len(out), 4):
                out[i] = min(255, round(out[i] * best_s))

            # Exact histogram cutoff tweak if duplicate alphas caused quantization residual
            if best_err > max(1, round(n_px * 0.002)):
                cur_hist = [0] * 256
                for i in range(3, len(out), 4):
                    cur_hist[out[i]] += 1
                cutoff = 255
                above = 0
                while cutoff > 0 and above + cur_hist[cutoff] < target_count:
                    above += cur_hist[cutoff]
                    cutoff -= 1
                raise_n = target_count - above
                for i in range(3, len(out), 4):
                    a = out[i]
                    if a == 0:
                        continue
                    if a > cutoff:
                        out[i] = max(a, thresh)
                    elif a < cutoff:
                        out[i] = min(a, thresh - 1)
                    elif raise_n > 0:
                        out[i] = max(a, thresh)
                        raise_n -= 1
                    else:
                        out[i] = min(a, thresh - 1)

        cur_w, cur_h, cur_data = nw, nh, bytes(out)
        mips.append(
            {
                "level": level,
                "width": cur_w,
                "height": cur_h,
                "coverage": _coverage_ratio(cur_data, alpha_test),
                "data": cur_data,
            }
        )
    return mips


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Synthesize Surface::shaped PBR PNG textures")
    parser.add_argument(
        "--preset",
        default="granite-cracks-moss",
        choices=[
            "granite-cracks-moss",
            "vertical-bark-furrows",
            "engraved-patina",
            "pebbled-leather-grain",
            "wood-grain-fibers",
            "pine-needles-card",
        ],
    )
    parser.add_argument("--size", type=int, default=128)
    parser.add_argument("--tile-metres", type=float, default=2.5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--moss", type=float, default=0.25)
    parser.add_argument("--alpha-test", type=float, default=0.45)
    parser.add_argument("--mipmaps", action="store_true")
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    surf = synthesize_shaped_surface(
        preset=args.preset,
        size=args.size,
        tile_metres=args.tile_metres,
        seed=args.seed,
        moss_coverage=args.moss,
    )
    (args.out_dir / "albedo.png").write_bytes(encode_png_rgba(surf["width"], surf["height"], surf["albedo"]))
    (args.out_dir / "normal.png").write_bytes(encode_png_rgba(surf["width"], surf["height"], surf["normal"]))
    (args.out_dir / "orm.png").write_bytes(encode_png_rgba(surf["width"], surf["height"], surf["orm"]))

    meta: dict[str, Any] = {
        "preset": args.preset,
        "size": args.size,
        "tileMetres": args.tile_metres,
        "colorSpace": {"albedo.png": "SRGBColorSpace", "normal.png": "NoColorSpace", "orm.png": "NoColorSpace"},
    }
    if args.mipmaps:
        chain = build_coverage_preserving_mipmaps(surf["width"], surf["height"], surf["albedo"], args.alpha_test)
        meta["mipmaps"] = [
            {"level": m["level"], "width": m["width"], "height": m["height"], "coverage": round(m["coverage"], 4)}
            for m in chain
        ]
    (args.out_dir / "surface_meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
