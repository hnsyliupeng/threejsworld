#!/usr/bin/env python3
"""Strict validator and architectural invariant gate for S3S-World v2 specs."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

VALID_DOMAINS = {"object", "character", "botanical", "architecture", "environment", "hybrid"}
VALID_COMPLEXITIES = {"simple", "moderate", "complex", "ultra-complex"}
VALID_TOPOLOGY_CLASSES = {
    "assembled-solid",
    "continuous-sculpt",
    "conforming-shell",
    "open-shell",
    "surface-relief",
    "fiber-strand",
    "implicit",
    "material-only",
}
VALID_TIERS = {
    "T0-primitive",
    "T1-parametric",
    "T2-sweep",
    "T3-proceduralSurface",
    "T4-field",
    "T5-fittedBuffer",
}
VALID_PRIMITIVES = {
    "box", "sphere", "ellipsoid", "cylinder", "cone", "capsule", "torus",
    "tube", "lathe", "extrude", "ground-blade", "curve-sweep", "tapered-sweep",
    "variable-loft", "open-membrane", "up-normal-cards", "convex-rock",
    "botanical-skeleton", "sdf-implicit", "instanced-cluster", "fitted-buffer",
}

DISALLOWED_TOPOLOGY_PRIMITIVES: dict[str, set[str]] = {
    "continuous-sculpt": {"box", "cylinder", "cone"},
    "fiber-strand": {"box", "plane-card", "open-membrane"},
    "open-shell": {"sdf-implicit", "box", "sphere", "cylinder", "cone", "capsule"},
}

RECESSED_TOKENS = {"cavity", "canal", "recess", "recessed", "nostril"}
RECESSED_COMPOUNDS = {"eyesocket"}
RECESSED_ROLE_ONLY = {"hollow", "concave"}
REJECTED_HAIR_PRIMITIVES = {"tube", "box", "plane-card"}

DEFAULT_MAT_REF_PATH = Path(__file__).resolve().parent.parent / "knowledge" / "material-reference.json"


def _load_material_reference(path: Path | None = None) -> dict[str, Any]:
    target = path or DEFAULT_MAT_REF_PATH
    if not target.exists():
        return {"materials": {}}
    return json.loads(target.read_text(encoding="utf-8"))


def _tokenize_identity(part: dict[str, Any]) -> set[str]:
    text = f"{part.get('role', '')} {part.get('name', '')} {part.get('id', '')}".lower()
    return set(re.findall(r"[a-z0-9]+", text))


def _norm_field(val: Any) -> str:
    return re.sub(r"[\s_-]+", "", str(val or "").lower())


def is_recessed_feature(part: dict[str, Any]) -> bool:
    if _tokenize_identity(part) & RECESSED_TOKENS:
        return True
    fields = (_norm_field(part.get("role")), _norm_field(part.get("name")), _norm_field(part.get("id")))
    if any(comp in f for comp in RECESSED_COMPOUNDS for f in fields):
        return True
    role_tokens = set(re.findall(r"[a-z0-9]+", str(part.get("role") or "").lower()))
    return bool(role_tokens & RECESSED_ROLE_ONLY)


def _pair_side_key(part_id: str) -> tuple[str, str] | None:
    patterns = [
        (r"^(.*?)[-_](l|left)$", "L"),
        (r"^(.*?)[-_](r|right)$", "R"),
        (r"^(left)[-_](.+)$", "L_PREFIX"),
        (r"^(right)[-_](.+)$", "R_PREFIX"),
    ]
    low = part_id.lower()
    for pat, tag in patterns:
        m = re.match(pat, low)
        if m:
            if tag == "L":
                return (m.group(1), "L")
            if tag == "R":
                return (m.group(1), "R")
            if tag == "L_PREFIX":
                return (m.group(2), "L")
            if tag == "R_PREFIX":
                return (m.group(2), "R")
    return None


def validate_chirality(parts: list[dict[str, Any]], errors: list[str]) -> None:
    """Ensure every -l/-r pair is a true sagittal reflection (x -> -x), NOT a Y-rotation."""
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for p in parts:
        key = _pair_side_key(str(p.get("id", "")))
        if key:
            base, side = key
            grouped.setdefault(base, {})[side] = p

    for base, sides in grouped.items():
        if "L" not in sides or "R" not in sides:
            continue
        pl = sides["L"]
        pr = sides["R"]
        tl = pl.get("transform", {})
        tr = pr.get("transform", {})
        pos_l = tl.get("position", [0, 0, 0])
        pos_r = tr.get("position", [0, 0, 0])
        rot_l = tl.get("rotation", [0, 0, 0])
        rot_r = tr.get("rotation", [0, 0, 0])

        # With Y-up, +Z forward, right-handed frame: sagittal mirror flips X and keeps Z equal.
        if abs(pos_l[0]) > 1e-4 or abs(pos_r[0]) > 1e-4:
            if pos_l[0] * pos_r[0] >= 0:
                errors.append(
                    f"Chirality failure on pair '{base}': left x={pos_l[0]} and right x={pos_r[0]} "
                    f"must have opposite signs (sagittal mirror x -> -x)."
                )
            if abs(pos_l[0] + pos_r[0]) > 0.02:
                errors.append(
                    f"Chirality asymmetry on pair '{base}': |x_L + x_R|={abs(pos_l[0] + pos_r[0]):.4f} > 0.02."
                )
        # Catch classic 180-deg Y-rotation bug: both x AND z negated!
        if abs(pos_l[2]) > 0.02 and pos_l[2] * pos_r[2] < 0:
            errors.append(
                f"Chirality rotation bug on pair '{base}': z_L={pos_l[2]} and z_R={pos_r[2]} have opposite signs, "
                f"indicating a 180° Y-rotation instead of sagittal reflection (which creates two left hands)."
            )
        # Sagittal reflection of Euler XYZ negates ry and rz while preserving rx.
        if abs(rot_l[0] - rot_r[0]) > 0.05 and abs(rot_l[0] + rot_r[0]) < 0.05:
            errors.append(
                f"Chirality rotation hint on pair '{base}': rx flipped ({rot_l[0]} vs {rot_r[0]}); "
                f"sagittal mirror preserves rx and negates ry, rz."
            )


def validate_spec(
    spec: dict[str, Any],
    strict_quality: bool = False,
    material_ref: dict[str, Any] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    mat_db = (material_ref or _load_material_reference()).get("materials", {})

    if spec.get("schemaVersion") != "s3s-world.v2":
        errors.append(f"schemaVersion must be 's3s-world.v2', got {spec.get('schemaVersion')!r}")
    if spec.get("suitability") not in {"pass", "conditional", "reject"}:
        errors.append(f"Invalid suitability: {spec.get('suitability')!r}")
    if spec.get("suitability") == "reject":
        errors.append("Spec suitability is 'reject'; cannot proceed to build.")

    frame = spec.get("frame", {})
    if frame.get("handedness") != "right-handed":
        errors.append("frame.handedness must be 'right-handed'")
    if frame.get("up") != [0, 1, 0]:
        warnings.append("Non-standard up vector; standard ThreeJSWorld convention is [0, 1, 0].")

    subject = spec.get("subject", {})
    domain = subject.get("primaryDomain")
    complexity = subject.get("complexityTier")
    if domain not in VALID_DOMAINS:
        errors.append(f"subject.primaryDomain invalid: {domain!r}")
    if complexity not in VALID_COMPLEXITIES:
        errors.append(f"subject.complexityTier invalid: {complexity!r}")

    materials = spec.get("materials", [])
    mat_map: dict[str, dict[str, Any]] = {}
    if not isinstance(materials, list) or not materials:
        errors.append("materials[] must be non-empty")
    else:
        for m in materials:
            mid = m.get("id")
            if not mid:
                errors.append("Material missing id")
                continue
            mat_map[mid] = m
            rough = m.get("roughness")
            metal = m.get("metalness")
            if rough is None or not (0.0 <= float(rough) <= 1.0):
                errors.append(f"Material '{mid}' roughness out of [0,1]: {rough}")
            if metal is None or not (0.0 <= float(metal) <= 1.0):
                errors.append(f"Material '{mid}' metalness out of [0,1]: {metal}")
            ior = m.get("ior")
            if ior is not None and not (1.0 <= float(ior) <= 2.333):
                errors.append(f"Material '{mid}' ior {ior} outside Three.js legal range [1.0, 2.333]")

            fam = str(m.get("family", "")).lower()
            base_col = str(m.get("baseColor", "")).strip()
            if float(metal or 0.0) >= 0.8 and re.fullmatch(r"#[0-9a-fA-F]{6}", base_col):
                r_b = int(base_col[1:3], 16)
                g_b = int(base_col[3:5], 16)
                b_b = int(base_col[5:7], 16)
                if r_b > 245 and g_b > 245 and b_b > 245:
                    errors.append(
                        f"Material '{mid}' bare metal baseColor '{base_col}' is unrealistically white (>245/255); "
                        "real metals need calibrated linear reflectance (e.g. #d0d5db)."
                    )
            if fam == "painted-metal" and float(metal or 0.0) > 0.25:
                errors.append(
                    f"Material '{mid}' family='painted-metal' has metalness={metal} > 0.25. "
                    "Intact paint is dielectric; expose bare metal via mask or chip sub-region."
                )
            if fam == "glass" and float(m.get("transmission", 0.0)) < 0.5:
                errors.append(
                    f"Material '{mid}' family='glass' must use transmission >= 0.5, never alpha transparency air."
                )
            if fam == "leaf" and m.get("doubleSided") is True and not m.get("upNormalCards"):
                errors.append(
                    f"Material '{mid}' foliage cannot enable doubleSided without upNormalCards=true "
                    "(causes dark inverted underside artifacts)."
                )
            if fam == "leaf" and float(m.get("alphaTest", 0.0)) > 0.0 and m.get("coveragePreservingMipmaps") is False:
                errors.append(
                    f"Material '{mid}' alpha-tested foliage must not disable coveragePreservingMipmaps."
                )
            if m.get("lightingUnknown") is True:
                gating = m.get("channelGating", {})
                if gating.get("roughness") != "report-only" or gating.get("metalness") != "report-only":
                    errors.append(
                        f"Material '{mid}' sets lightingUnknown=true so channelGating.roughness and metalness "
                        "MUST be 'report-only' (never hard-gate photographer lighting)."
                    )
            prior_id = m.get("referencePriorId")
            if prior_id and prior_id in mat_db:
                prior = mat_db[prior_id]
                r_min, r_max = prior.get("roughnessRange", [0.0, 1.0])
                if rough is not None and not (r_min <= float(rough) <= r_max):
                    warnings.append(
                        f"Material '{mid}' roughness={rough} outside prior '{prior_id}' range [{r_min}, {r_max}]."
                    )

    parts = spec.get("parts", [])
    part_map: dict[str, dict[str, Any]] = {}
    if not isinstance(parts, list) or not parts:
        errors.append("parts[] must be non-empty")
    else:
        for p in parts:
            pid = p.get("id")
            if not pid:
                errors.append("Part missing id")
                continue
            if pid in part_map:
                errors.append(f"Duplicate part id '{pid}'")
            part_map[pid] = p

        for p in parts:
            pid = p.get("id", "<unknown>")
            parent_id = p.get("parentId")
            if parent_id is not None and parent_id not in part_map:
                errors.append(f"Part '{pid}' references missing parentId '{parent_id}'")

            role = str(p.get("role", "")).lower()
            tf = p.get("transform", {})
            scale = tf.get("scale", [1, 1, 1])
            if parent_id is None and role in {"root", "container"} and scale != [1, 1, 1]:
                errors.append(
                    f"Root/container '{pid}' transform.scale MUST be [1, 1, 1] (got {scale}); "
                    "non-unit root scale collapses child components. Hide with opacity=0 instead."
                )
            if parent_id is not None and p.get("runtimeAction", {}).get("animationRole") == "root":
                errors.append(
                    f"Non-root part '{pid}' inherited animationRole='root'; assign part-specific role."
                )

            tclass = p.get("topologyClass")
            tier = p.get("geometryTier")
            prim = p.get("primitive")
            if tclass not in VALID_TOPOLOGY_CLASSES:
                errors.append(f"Part '{pid}' invalid topologyClass: {tclass!r}")
            if tier not in VALID_TIERS:
                errors.append(f"Part '{pid}' invalid geometryTier: {tier!r}")
            if prim not in VALID_PRIMITIVES:
                errors.append(f"Part '{pid}' invalid primitive: {prim!r}")

            if tclass in DISALLOWED_TOPOLOGY_PRIMITIVES and prim in DISALLOWED_TOPOLOGY_PRIMITIVES[tclass]:
                errors.append(
                    f"Part '{pid}' pairs topologyClass='{tclass}' with forbidden primitive='{prim}'."
                )

            mid = p.get("materialId")
            mat = mat_map.get(mid)
            if not mat:
                errors.append(f"Part '{pid}' references missing materialId '{mid}'")
            elif tclass == "open-shell":
                if not (mat.get("doubleSided") is True or mat.get("upNormalCards") is True):
                    errors.append(
                        f"Part '{pid}' uses topologyClass='open-shell' (zero-thickness membrane) so material '{mid}' "
                        "must set doubleSided=true or upNormalCards=true."
                    )

            # Recessed feature allow-list gate (US-004)
            if is_recessed_feature(p):
                ops = [
                    str(op.get("op", "")).lower()
                    for op in p.get("geometryDescriptor", {}).get("sdfOps", [])
                    if isinstance(op, dict)
                ]
                if tclass != "implicit" or prim != "sdf-implicit" or "subtract" not in ops:
                    errors.append(
                        f"Recessed feature '{pid}' MUST use topologyClass='implicit', primitive='sdf-implicit', "
                        "and include an SDF 'subtract' op (hollow sockets cannot be faked by surface patches or spheres)."
                    )

            # Tapered sweep must actually taper
            if prim == "tapered-sweep":
                stations = p.get("geometryDescriptor", {}).get("stations", [])
                if len(stations) >= 2:
                    r0 = float(stations[0].get("rx", 1.0))
                    r_end = float(stations[-1].get("rx", 1.0))
                    if r_end >= r0 * 0.95:
                        warnings.append(
                            f"Part '{pid}' uses tapered-sweep but end radius {r_end} does not taper from {r0}."
                        )

            # standProud bounds check
            sp = p.get("standProud")
            if sp:
                if sp.get("againstComponentId") not in part_map:
                    errors.append(f"Part '{pid}' standProud references missing component '{sp.get('againstComponentId')}'.")
                if float(sp.get("maxPush", 0)) < float(sp.get("clearance", 0)):
                    errors.append(f"Part '{pid}' standProud.maxPush must be >= clearance.")

            # Validate attachment socket on parent if named
            att = p.get("attachment")
            if att and parent_id and parent_id in part_map:
                parent_sockets = set(part_map[parent_id].get("runtimeAction", {}).get("sockets", []))
                psock = att.get("parentSocket")
                if psock and parent_sockets and psock not in parent_sockets:
                    errors.append(
                        f"Part '{pid}' attachment.parentSocket='{psock}' not declared in parent '{parent_id}' sockets {sorted(parent_sockets)}."
                    )

        validate_chirality(parts, errors)

    # Character domain gates
    if domain in {"character", "hybrid"}:
        anatomy = subject.get("anatomy")
        if not anatomy or "styleHeads" not in anatomy or "faceLandmarks" not in anatomy:
            errors.append("Character/hybrid spec requires subject.anatomy with styleHeads and faceLandmarks.")
        hp = subject.get("hairProfile")
        if hp:
            if hp.get("scalpComponentId") not in part_map:
                errors.append("hairProfile.scalpComponentId must match an existing part id.")
            for mass in hp.get("masses", []):
                uv = mass.get("scalpUvRoot")
                if not isinstance(uv, list) or len(uv) != 2 or not (0.0 <= float(uv[0]) <= 1.0 and 0.0 <= float(uv[1]) <= 1.0):
                    errors.append(f"Hair mass '{mass.get('id')}' scalpUvRoot must be normalized [u, v] in [0, 1].")
                if mass.get("primitive") in REJECTED_HAIR_PRIMITIVES:
                    errors.append(f"Hair mass '{mass.get('id')}' uses rejected hair primitive '{mass.get('primitive')}'.")

    # LOD & World Nanite error propagation gate
    lod_world = spec.get("lodAndWorld", {})
    if lod_world.get("strategy") == "cluster-dag-nanite":
        if lod_world.get("errorPropagation") != "max":
            errors.append("Cluster DAG strategy MUST set errorPropagation='max' (sum keeps distant LODs too fine).")
        elevs = lod_world.get("impostor", {}).get("elevationsDeg", [])
        if len(elevs) < 4:
            errors.append("Impostor atlas requires >= 4 elevation angles (e.g. [0, 30, 60, 90]) to prevent steep-angle popping.")

    # Strict-quality gate
    if strict_quality:
        qc = subject.get("qualityContract")
        if not qc or len(str(qc.get("definitionOfDone", ""))) < 12:
            errors.append("Strict quality requires subject.qualityContract.definitionOfDone.")
        macro_count = sum(1 for p in parts if p.get("level") == "macro")
        if complexity in {"complex", "ultra-complex"} and len(parts) < 3:
            errors.append(f"Complexity '{complexity}' requires >= 3 components in parts[], found {len(parts)}.")
        if macro_count == 0:
            errors.append("Strict quality requires at least one macro-level part.")

        di = spec.get("evidence", {}).get("detailInventory", {})
        details = di.get("details", [])
        target_min = int(di.get("targetMinDetails", qc.get("targetMinDetails", 0) if qc else 0))
        if complexity in {"moderate", "complex", "ultra-complex"} and len(details) < max(1, target_min):
            errors.append(
                f"Detail inventory insufficient for '{complexity}': {len(details)} < targetMinDetails={target_min}."
            )

        # Every detailInventory item MUST resolve to a real localFeature or localOverride (no orphan prose)
        valid_feature_refs: set[str] = set()
        for p in parts:
            for lf in p.get("localFeatures", []):
                valid_feature_refs.add(f"{p['id']}/{lf['id']}")
        valid_override_refs: set[str] = set()
        for m in materials:
            for lo in m.get("localOverrides", []):
                valid_override_refs.add(f"{m['id']}/{lo['id']}")

        for det in details:
            maps_to = det.get("mapsTo", {})
            mtype = maps_to.get("type")
            mref = maps_to.get("ref")
            if mtype == "component.localFeature" and mref not in valid_feature_refs:
                errors.append(
                    f"Detail '{det.get('id')}' mapsTo='{mref}' does not resolve to any part.localFeatures entry."
                )
            elif mtype == "material.localOverride" and mref not in valid_override_refs:
                errors.append(
                    f"Detail '{det.get('id')}' mapsTo='{mref}' does not resolve to any material.localOverrides entry."
                )

    return {
        "valid": len(errors) == 0,
        "strictQuality": strict_quality,
        "errorCount": len(errors),
        "warningCount": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "parts": len(parts),
            "materials": len(materials),
            "details": len(spec.get("evidence", {}).get("detailInventory", {}).get("details", [])),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate an S3S-World v2 specification")
    parser.add_argument("spec", type=Path)
    parser.add_argument("--strict-quality", action="store_true")
    parser.add_argument("--material-ref", type=Path, default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        spec = json.loads(args.spec.read_text(encoding="utf-8"))
        mat_ref = _load_material_reference(args.material_ref)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"validator error: {exc}", file=sys.stderr)
        return 2

    res = validate_spec(spec, strict_quality=args.strict_quality, material_ref=mat_ref)
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        status = "PASS" if res["valid"] else "FAIL"
        print(
            f"SPEC_GATE {status} strict={res['strictQuality']} "
            f"parts={res['stats']['parts']} materials={res['stats']['materials']} "
            f"errors={res['errorCount']} warnings={res['warningCount']}"
        )
        for e in res["errors"]:
            print(f"  [ERROR] {e}")
        for w in res["warnings"]:
            print(f"  [WARN]  {w}")
    return 0 if res["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
