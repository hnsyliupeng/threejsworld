#!/usr/bin/env python3
"""Atomic resumable workflow state machine and bounded correction-loop gate."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

PROFILE_STEPS: dict[str, list[dict[str, Any]]] = {
    "prop": [
        {"id": "intake-observation", "stage": "intake", "command": "Analyze reference via 8-layer object-space protocol and run forge_world/image_intake.py probe"},
        {"id": "detail-inventory", "stage": "intake", "command": "python3 forge_world/image_intake.py slice --image <ref.png> --out-dir evidence/crops"},
        {"id": "spec-authoring", "stage": "spec", "command": "Author S3S-World v2 spec with qualityContract, detailInventory, and T0-T5 topologyClasses"},
        {"id": "strict-validation", "stage": "spec", "command": "python3 forge_world/spec_validator.py <spec.json> --strict-quality"},
        {"id": "pbr-surface-synth", "stage": "material", "command": "python3 forge_world/pbr_surface_synth.py --preset <recipe> --size 256 --out-dir textures/"},
        {"id": "geometry-build", "stage": "build", "command": "python3 forge_world/ts_codegen.py <spec.json> --out src/createModel.ts"},
        {"id": "pre-render-geometry-gates", "stage": "review", "command": "python3 forge_world/geometry_gates.py --spec <spec.json> --mesh evidence/meshes.json"},
        {"id": "render-6pass-turntable", "stage": "review", "command": "Capture 6-pass render-profile.v2 across turntable azimuths [0, 90, 180, 270]"},
        {"id": "divine-eye-and-interior", "stage": "review", "command": "python3 forge_world/image_intake.py evaluate --reference <ref.png> --render <shot.png>"},
        {"id": "action-ready-check", "stage": "readiness", "command": "Verify sculptRuntime pivots, sockets, colliders, and explode/pick parity"},
    ],
    "character": [
        {"id": "intake-observation", "stage": "intake", "command": "Analyze character reference, extract landmarks and camera FOV evidence"},
        {"id": "anatomy-and-hair-profile", "stage": "spec", "command": "Populate anatomy head-units, faceLandmarks, and scalp (u,v) hairProfile"},
        {"id": "spec-authoring", "stage": "spec", "command": "Author S3S-World v2 spec with -l/-r chirality pairs and open-shell membranes"},
        {"id": "strict-validation", "stage": "spec", "command": "python3 forge_world/spec_validator.py <spec.json> --strict-quality"},
        {"id": "delight-and-projection", "stage": "material", "command": "python3 forge_world/image_intake.py delight --image <ref.png> --out evidence/delit.png"},
        {"id": "geometry-build", "stage": "build", "command": "python3 forge_world/ts_codegen.py <spec.json> --out src/createCharacter.ts"},
        {"id": "scalp-and-geometry-gates", "stage": "review", "command": "python3 forge_world/geometry_gates.py --spec <spec.json> --mesh evidence/meshes.json"},
        {"id": "render-6pass-turntable", "stage": "review", "command": "Capture 6-pass render-profile.v2 + interior facial region comparison"},
        {"id": "divine-eye-and-interior", "stage": "review", "command": "python3 forge_world/image_intake.py evaluate --reference <ref.png> --render <shot.png>"},
        {"id": "action-ready-rig-check", "stage": "readiness", "command": "Verify rigid hair parenting, shared Skeleton binding, and sculptRuntime"},
    ],
    "botanical": [
        {"id": "species-grammar-intake", "stage": "intake", "command": "Resolve botanical .species / TreeOptions / LOD vertex budgets from knowledge/species-presets.json"},
        {"id": "spec-authoring", "stage": "spec", "command": "Author S3S-World v2 botanical spec with upNormalCards, root ground embedding, and LOD0-4"},
        {"id": "strict-validation", "stage": "spec", "command": "python3 forge_world/spec_validator.py <spec.json> --strict-quality"},
        {"id": "coverage-mipmap-synth", "stage": "material", "command": "python3 forge_world/pbr_surface_synth.py --preset pine-needles-card --alpha-test 0.45 --mipmaps --out-dir textures/"},
        {"id": "skeleton-and-dag-build", "stage": "build", "command": "Generate deterministic skeleton, RNG-free LODs, and 4-dir alpha coverage calibration"},
        {"id": "pre-render-geometry-gates", "stage": "review", "command": "python3 forge_world/geometry_gates.py --spec <spec.json> --mesh evidence/meshes.json"},
        {"id": "impostor-4elev-bake", "stage": "review", "command": "Bake unlit albedo+normal 4-elevation [0,30,60,90] impostor atlas + collider"},
        {"id": "render-ablation-and-lod-check", "stage": "review", "command": "Verify zero pop across LOD0->LOD4 and lighting parity against real trees"},
    ],
    "architecture": [
        {"id": "modular-intake", "stage": "intake", "command": "Decompose architectural massing, dressed stone, trim, and modular kits"},
        {"id": "spec-authoring", "stage": "spec", "command": "Author S3S-World v2 spec with ablationGroup tags and Surface::shaped tileMetres"},
        {"id": "strict-validation", "stage": "spec", "command": "python3 forge_world/spec_validator.py <spec.json> --strict-quality"},
        {"id": "pbr-surface-synth", "stage": "material", "command": "python3 forge_world/pbr_surface_synth.py --preset granite --size 256 --out-dir textures/"},
        {"id": "geometry-build", "stage": "build", "command": "python3 forge_world/ts_codegen.py <spec.json> --out src/createArchitecture.ts"},
        {"id": "pre-render-geometry-gates", "stage": "review", "command": "python3 forge_world/geometry_gates.py --spec <spec.json> --mesh evidence/meshes.json"},
        {"id": "ablation-and-render-check", "stage": "review", "command": "Run --without ablation cost checks and 6-pass lighting/GI verification"},
    ],
    "world-scene": [
        {"id": "world-layout-intake", "stage": "intake", "command": "Define planet radius, terrain relief, water height, atmosphere/weather, and biomes"},
        {"id": "spec-authoring", "stage": "spec", "command": "Author S3S-World v2 scene spec with Cluster DAG (max-error) and streaming budget"},
        {"id": "strict-validation", "stage": "spec", "command": "python3 forge_world/spec_validator.py <spec.json> --strict-quality"},
        {"id": "procedural-biome-build", "stage": "build", "command": "Build terrain chunks, Morton-ordered scatter, and 128-tri Cluster DAGs"},
        {"id": "pre-render-geometry-gates", "stage": "review", "command": "python3 forge_world/geometry_gates.py --spec <spec.json> --mesh evidence/meshes.json"},
        {"id": "gpu-budget-and-impostor-check", "stage": "review", "command": "Verify two-phase HZB, Specular AA, ListGuard, maxInFlightGpuFrames<=2, and frame budget"},
    ],
}

DEFAULT_MAX_PER_PASS = 3
DEFAULT_MAX_TOTAL = 6


class WorkflowStateError(RuntimeError):
    """Raised when state JSON is invalid or violated."""


def _sha256_file(path: Path | None) -> str | None:
    if path is None or not path.exists() or not path.is_file():
        return None
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def init_state(
    state_path: Path,
    profile: str,
    spec_path: Path | None = None,
    reference_path: Path | None = None,
    max_per_pass: int = DEFAULT_MAX_PER_PASS,
    max_total: int = DEFAULT_MAX_TOTAL,
) -> dict[str, Any]:
    if profile not in PROFILE_STEPS:
        raise WorkflowStateError(f"Unknown profile '{profile}'. Valid: {sorted(PROFILE_STEPS)}")
    steps = [
        {
            "id": s["id"],
            "stage": s["stage"],
            "command": s["command"],
            "status": "pending",
            "evidence": None,
            "evidenceHash": None,
            "note": None,
        }
        for s in PROFILE_STEPS[profile]
    ]
    payload: dict[str, Any] = {
        "schemaVersion": "threejsworld.state.v1",
        "profile": profile,
        "status": "active",
        "stopReason": None,
        "artifacts": {
            "spec": str(spec_path) if spec_path else None,
            "reference": str(reference_path) if reference_path else None,
            "referenceHash": _sha256_file(reference_path),
        },
        "loop": {
            "maxPerPass": max_per_pass,
            "maxTotal": max_total,
            "totalCorrections": 0,
            "perStepCorrections": {},
            "history": [],
        },
        "steps": steps,
    }
    save_state(state_path, payload)
    return payload


def load_state(state_path: Path) -> dict[str, Any]:
    if not state_path.exists():
        raise WorkflowStateError(f"State file does not exist: {state_path}")
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkflowStateError(f"Invalid state file {state_path}: {exc}") from exc
    if not isinstance(data, dict) or "steps" not in data:
        raise WorkflowStateError(f"Malformed state structure in {state_path}")
    return data


def save_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = state_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(state_path)


def mark_step(
    state: dict[str, Any],
    step_id: str,
    status: str = "completed",
    evidence: Path | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    if status not in {"completed", "skipped"}:
        raise WorkflowStateError(f"Invalid status '{status}'; expected completed|skipped")
    if status == "completed" and evidence is None:
        raise WorkflowStateError(f"Step '{step_id}' requires --evidence when marked completed")
    if status == "skipped" and not reason:
        raise WorkflowStateError(f"Step '{step_id}' requires --reason when marked skipped")

    for step in state["steps"]:
        if step["id"] == step_id:
            step["status"] = status
            step["evidence"] = str(evidence) if evidence else None
            step["evidenceHash"] = _sha256_file(evidence)
            step["note"] = reason
            return state
    raise WorkflowStateError(f"Unknown step id '{step_id}'")


def record_correction(
    state: dict[str, Any],
    step_id: str,
    action: str,
    defect_tag: str,
) -> dict[str, Any]:
    if action not in {"continue", "refine-spec", "refine-code", "request-input", "stop"}:
        raise WorkflowStateError(f"Invalid review action '{action}'")
    loop = state["loop"]
    loop["history"].append({"stepId": step_id, "action": action, "defectTag": defect_tag})
    if action in {"refine-spec", "refine-code"}:
        loop["totalCorrections"] += 1
        per_step = loop["perStepCorrections"]
        per_step[step_id] = per_step.get(step_id, 0) + 1
        # Detect oscillation/ceiling
        if per_step[step_id] >= loop["maxPerPass"]:
            state["status"] = "stopped"
            state["stopReason"] = (
                f"Per-pass correction limit reached ({per_step[step_id]}/{loop['maxPerPass']}) at '{step_id}'"
            )
        elif loop["totalCorrections"] >= loop["maxTotal"]:
            state["status"] = "stopped"
            state["stopReason"] = (
                f"Global correction limit reached ({loop['totalCorrections']}/{loop['maxTotal']})"
            )
        elif len(loop["history"]) >= 3:
            last3 = [h["defectTag"] for h in loop["history"][-3:] if h["action"] in {"refine-spec", "refine-code"}]
            if len(last3) == 3 and len(set(last3)) == 1:
                state["status"] = "stopped"
                state["stopReason"] = f"Repeated identical defect '{last3[0]}' across 3 iterations; escalate via request-input"
    elif action == "stop":
        state["status"] = "stopped"
        state["stopReason"] = defect_tag or "Explicitly stopped"
    elif action == "request-input":
        state["status"] = "stopped"
        state["stopReason"] = f"Input requested: {defect_tag}"
    return state


def next_action(state: dict[str, Any]) -> dict[str, Any]:
    pending = [s for s in state["steps"] if s["status"] == "pending"]
    current = pending[0] if pending else None
    if state["status"] == "stopped":
        status = "stopped"
    elif current is None:
        status = "complete"
    else:
        status = "active"
    loop = state["loop"]
    step_id = current["id"] if current else "none"
    return {
        "status": status,
        "profile": state["profile"],
        "currentStep": step_id,
        "nextCommand": current["command"] if current else None,
        "pendingCount": len(pending),
        "pendingSteps": [s["id"] for s in pending],
        "totalCorrections": loop["totalCorrections"],
        "maxTotal": loop["maxTotal"],
        "stepCorrections": loop["perStepCorrections"].get(step_id, 0),
        "maxPerPass": loop["maxPerPass"],
        "stopReason": state.get("stopReason"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ThreeJSWorld workflow state gate")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="Initialize workflow state")
    p_init.add_argument("--state", type=Path, required=True)
    p_init.add_argument("--profile", required=True, choices=sorted(PROFILE_STEPS))
    p_init.add_argument("--spec", type=Path)
    p_init.add_argument("--reference", type=Path)

    p_next = sub.add_parser("next", help="Inspect next required step")
    p_next.add_argument("--state", type=Path, required=True)
    p_next.add_argument("--json", action="store_true")

    p_mark = sub.add_parser("mark", help="Mark a step completed or skipped")
    p_mark.add_argument("step_id")
    p_mark.add_argument("--state", type=Path, required=True)
    p_mark.add_argument("--status", default="completed", choices=["completed", "skipped"])
    p_mark.add_argument("--evidence", type=Path)
    p_mark.add_argument("--reason")

    p_loop = sub.add_parser("record-loop", help="Record a review/correction action")
    p_loop.add_argument("--state", type=Path, required=True)
    p_loop.add_argument("--step-id", required=True)
    p_loop.add_argument("--action", required=True)
    p_loop.add_argument("--defect", default="")

    args = parser.parse_args(argv)
    try:
        if args.cmd == "init":
            state = init_state(args.state, args.profile, args.spec, args.reference)
            print(json.dumps(next_action(state), indent=2))
            return 0
        if args.cmd == "next":
            state = load_state(args.state)
            payload = next_action(state)
            if args.json:
                print(json.dumps(payload, indent=2))
            else:
                print(
                    f"STATE status={payload['status']} profile={payload['profile']} "
                    f"step={payload['currentStep']} loop={payload['stepCorrections']}/{payload['maxPerPass']} "
                    f"total={payload['totalCorrections']}/{payload['maxTotal']}"
                )
                if payload["stopReason"]:
                    print(f"STOP: {payload['stopReason']}")
                elif payload["nextCommand"]:
                    print(f"NEXT: {payload['nextCommand']}")
            return 3 if payload["status"] == "stopped" else 0
        if args.cmd == "mark":
            state = load_state(args.state)
            mark_step(state, args.step_id, args.status, args.evidence, args.reason)
            save_state(args.state, state)
            print(json.dumps(next_action(state), indent=2))
            return 0
        if args.cmd == "record-loop":
            state = load_state(args.state)
            record_correction(state, args.step_id, args.action, args.defect)
            save_state(args.state, state)
            payload = next_action(state)
            print(json.dumps(payload, indent=2))
            return 3 if payload["status"] == "stopped" else 0
    except WorkflowStateError as exc:
        print(f"state error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
