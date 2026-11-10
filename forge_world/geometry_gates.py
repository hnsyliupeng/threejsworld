#!/usr/bin/env python3
"""Pre-render geometric verification gates (distinctZ, winding, seam overlap, part coverage, scalp exposure)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

DEFAULT_MIN_DISTINCT_Z = 11  # <= 10 indicates planar 2.5D extrusion (Glock-18 ghost protocol)


def _aabb(positions: list[float]) -> tuple[list[float], list[float]]:
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    return [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]


def _aabb_gap(a_min: list[float], a_max: list[float], b_min: list[float], b_max: list[float]) -> float:
    dx = max(0.0, a_min[0] - b_max[0], b_min[0] - a_max[0])
    dy = max(0.0, a_min[1] - b_max[1], b_min[1] - a_max[1])
    dz = max(0.0, a_min[2] - b_max[2], b_min[2] - a_max[2])
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def check_distinct_z(
    positions: list[float],
    min_planes: int = DEFAULT_MIN_DISTINCT_Z,
    precision: int = 3,
) -> dict[str, Any]:
    zs = {round(positions[i + 2], precision) for i in range(0, len(positions), 3)}
    return {
        "distinctZCount": len(zs),
        "minRequired": min_planes,
        "passed": len(zs) >= min_planes,
    }


def check_mesh_sanity(positions: list[float], indices: list[int] | None = None) -> dict[str, Any]:
    if len(positions) % 3 != 0 or len(positions) < 9:
        return {"passed": False, "error": "Invalid vertex buffer length", "nanCount": 0, "degenerateTris": 0}
    nan_count = sum(1 for v in positions if not math.isfinite(v))
    tri_count = (len(indices) // 3) if indices else (len(positions) // 9)
    degenerate = 0
    signed_vol = 0.0
    for t in range(tri_count):
        if indices:
            i0, i1, i2 = indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]
        else:
            i0, i1, i2 = t * 3, t * 3 + 1, t * 3 + 2
        if max(i0, i1, i2) * 3 + 2 >= len(positions):
            degenerate += 1
            continue
        ax, ay, az = positions[i0 * 3 : i0 * 3 + 3]
        bx, by, bz = positions[i1 * 3 : i1 * 3 + 3]
        cx, cy, cz = positions[i2 * 3 : i2 * 3 + 3]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        area2 = math.sqrt(nx * nx + ny * ny + nz * nz)
        if area2 < 1e-10:
            degenerate += 1
        signed_vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0

    return {
        "passed": nan_count == 0 and degenerate == 0,
        "nanCount": nan_count,
        "triangleCount": tri_count,
        "degenerateTris": degenerate,
        "signedVolume": round(signed_vol, 6),
    }


def check_scalp_exposure(
    skull_center: list[float],
    skull_radii: list[float],
    hair_points: list[float],
    clearance_min: float = 0.002,
    max_sunk_fraction: float = 0.15,
) -> dict[str, Any]:
    """Geometric bald-patch gate: counts hair points strictly OUTSIDE the skull ellipsoid SDF.

    A naive nearest-neighbor test passes vertices sunk inside the skull; this evaluates the
    normalized ellipsoid SDF so buried vertices fail immediately before any render.
    """
    n_pts = len(hair_points) // 3
    if n_pts == 0:
        return {"passed": False, "reason": "No hair points sampled", "outsideFraction": 0.0}
    rx, ry, rz = [max(1e-5, float(r)) for r in skull_radii]
    cx, cy, cz = [float(c) for c in skull_center]
    outside = 0
    sunk = 0
    for i in range(n_pts):
        x = (hair_points[i * 3] - cx) / rx
        y = (hair_points[i * 3 + 1] - cy) / ry
        z = (hair_points[i * 3 + 2] - cz) / rz
        norm = math.sqrt(x * x + y * y + z * z)
        approx_dist = (norm - 1.0) * min(rx, ry, rz)
        if approx_dist >= clearance_min:
            outside += 1
        else:
            sunk += 1
    sunk_frac = sunk / n_pts
    return {
        "passed": sunk_frac <= max_sunk_fraction,
        "sampledPoints": n_pts,
        "outsideCount": outside,
        "sunkCount": sunk,
        "sunkFraction": round(sunk_frac, 4),
        "maxAllowedSunkFraction": max_sunk_fraction,
    }


def run_geometry_gates(spec: dict[str, Any], mesh_payload: dict[str, Any]) -> dict[str, Any]:
    failures: list[str] = []
    warnings: list[str] = []
    part_reports: dict[str, Any] = {}

    built_parts: dict[str, Any] = mesh_payload.get("parts", {})
    spec_parts = {p["id"]: p for p in spec.get("parts", [])}

    # 1. check_part_coverage & explode/pick parity
    expected_buildable = [
        pid
        for pid, p in spec_parts.items()
        if p.get("topologyClass") != "material-only" and str(p.get("role", "")).lower() not in {"root", "container"}
    ]
    missing_parts = [pid for pid in expected_buildable if pid not in built_parts]
    if missing_parts:
        failures.append(f"Part coverage failed — spec components unbuilt in mesh manifest: {missing_parts}")

    # Detect fused single-mesh collapse (one built mesh sharing multiple distinct macro/meso spec parts)
    if len(expected_buildable) >= 2 and len(built_parts) == 1:
        failures.append(
            f"Fused-mesh failure: {len(expected_buildable)} spec parts collapsed into 1 built mesh node; "
            "every model must ship explodable and clickable."
        )

    aabbs: dict[str, tuple[list[float], list[float]]] = {}
    for pid, pdata in built_parts.items():
        pos = pdata.get("positions", [])
        idx = pdata.get("indices")
        sanity = check_mesh_sanity(pos, idx)
        if not sanity["passed"]:
            failures.append(f"Mesh sanity failed on '{pid}': {sanity}")

        aabb = _aabb(pos) if len(pos) >= 3 else ([0, 0, 0], [0, 0, 0])
        aabbs[pid] = aabb

        spec_p = spec_parts.get(pid, {})
        tclass = spec_p.get("topologyClass", "")
        prim = spec_p.get("primitive", "")
        dz_report = None
        if tclass in {"continuous-sculpt", "assembled-solid"} and prim not in {"box", "plane-card", "open-membrane"}:
            dz_report = check_distinct_z(pos)
            if not dz_report["passed"]:
                failures.append(
                    f"2.5D slab bias detected on '{pid}': distinctZ={dz_report['distinctZCount']} "
                    f"< {dz_report['minRequired']}. Use variable-thickness loft or lathe."
                )

        # Check explode/pick contract flag if present
        if spec_p.get("topologyClass") == "surface-relief" and pdata.get("explodeWithParent") is False:
            warnings.append(f"Surface-relief part '{pid}' should set explodeWithParent=true so it rides its shell.")

        part_reports[pid] = {
            "sanity": sanity,
            "distinctZ": dz_report,
            "aabb": {"min": aabb[0], "max": aabb[1]},
        }

    # 2. Attachment seam overlap / floating gap gate
    for pid, spec_p in spec_parts.items():
        att = spec_p.get("attachment")
        parent_id = spec_p.get("parentId")
        if not att or not parent_id or pid not in aabbs or parent_id not in aabbs:
            continue
        tol = float(att.get("gapTolerance", 0.02))
        gap = _aabb_gap(aabbs[pid][0], aabbs[pid][1], aabbs[parent_id][0], aabbs[parent_id][1])
        if gap > tol:
            failures.append(
                f"Floating attachment on '{pid}' -> '{parent_id}': AABB gap={gap:.4f}m > gapTolerance={tol:.4f}m."
            )

    # 3. Optional scalp exposure check for hair subjects
    scalp_report = None
    if "skull" in mesh_payload and "hairPoints" in mesh_payload:
        sk = mesh_payload["skull"]
        scalp_report = check_scalp_exposure(
            sk.get("center", [0, 0, 0]),
            sk.get("radii", [0.1, 0.12, 0.1]),
            mesh_payload["hairPoints"],
        )
        if not scalp_report["passed"]:
            failures.append(
                f"Scalp exposure hard gate failed: sunkFraction={scalp_report['sunkFraction']} "
                f"> {scalp_report['maxAllowedSunkFraction']}"
            )

    return {
        "passed": len(failures) == 0,
        "failureCount": len(failures),
        "warningCount": len(warnings),
        "failures": failures,
        "warnings": warnings,
        "partReports": part_reports,
        "scalpExposure": scalp_report,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run pre-render geometric gates")
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--mesh", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        spec = json.loads(args.spec.read_text(encoding="utf-8"))
        mesh = json.loads(args.mesh.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"geometry gate io error: {exc}", file=sys.stderr)
        return 2

    res = run_geometry_gates(spec, mesh)
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print(f"GEOMETRY_GATES {'PASS' if res['passed'] else 'FAIL'} failures={res['failureCount']}")
        for f in res["failures"]:
            print(f"  [FAIL] {f}")
        for w in res["warnings"]:
            print(f"  [WARN] {w}")
    return 0 if res["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
