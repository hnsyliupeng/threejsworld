#!/usr/bin/env python3
"""Comprehensive tests for ThreeJSWorld Python Forge pipeline (zero external dependencies)."""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "forge_world"))

import geometry_gates  # noqa: E402
import image_intake  # noqa: E402
import pbr_surface_synth  # noqa: E402
import spec_validator  # noqa: E402
import state as fw_state  # noqa: E402
import ts_codegen  # noqa: E402


class TestForgeState(unittest.TestCase):
    def test_state_init_and_bounded_ceilings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sp = Path(tmp) / "state.json"
            s = fw_state.init_state(sp, "prop")
            nxt = fw_state.next_action(s)
            self.assertEqual(nxt["currentStep"], "intake-observation")
            for _ in range(3):
                fw_state.record_correction(s, "divine-eye-and-interior", "refine-code", "silhouette")
            self.assertEqual(s["status"], "stopped")
            self.assertIn("Per-pass correction limit reached", s["stopReason"])


class TestSpecValidator(unittest.TestCase):
    def test_valid_examples_strict(self) -> None:
        for rel in ["examples/vintage_camera.spec.json", "examples/alpine_pine_grove.spec.json"]:
            spec = json.loads((ROOT / rel).read_text(encoding="utf-8"))
            res = spec_validator.validate_spec(spec, strict_quality=True)
            self.assertTrue(res["valid"], f"{rel} failed: {res['errors']}")

    def test_rejects_pure_white_bare_metal(self) -> None:
        spec = json.loads((ROOT / "examples/vintage_camera.spec.json").read_text(encoding="utf-8"))
        bad = copy.deepcopy(spec)
        bad["materials"][0]["baseColor"] = "#ffffff"
        res = spec_validator.validate_spec(bad, strict_quality=True)
        self.assertFalse(res["valid"])
        self.assertTrue(any("#ffffff" in e or "bare metal" in e for e in res["errors"]))

    def test_rejects_cavity_in_closed_solid(self) -> None:
        spec = json.loads((ROOT / "examples/vintage_camera.spec.json").read_text(encoding="utf-8"))
        bad = copy.deepcopy(spec)
        bad["parts"][3]["topologyClass"] = "assembled-solid"
        bad["parts"][3]["primitive"] = "box"
        res = spec_validator.validate_spec(bad, strict_quality=True)
        self.assertFalse(res["valid"])
        self.assertTrue(any("sdf-implicit" in e for e in res["errors"]))

    def test_rejects_sagittal_asymmetry(self) -> None:
        spec = json.loads((ROOT / "examples/vintage_camera.spec.json").read_text(encoding="utf-8"))
        bad = copy.deepcopy(spec)
        for p in bad["parts"]:
            if p["id"] == "strap_eyelet-r":
                p["transform"]["position"][0] = 0.25  # breaks symmetry with -0.072
        res = spec_validator.validate_spec(bad, strict_quality=True)
        self.assertFalse(res["valid"])
        self.assertTrue(any("Chirality" in e for e in res["errors"]))

    def test_rejects_botanical_without_coverage_mips(self) -> None:
        spec = json.loads((ROOT / "examples/alpine_pine_grove.spec.json").read_text(encoding="utf-8"))
        bad = copy.deepcopy(spec)
        bad["materials"][1]["coveragePreservingMipmaps"] = False
        res = spec_validator.validate_spec(bad, strict_quality=True)
        self.assertFalse(res["valid"])
        self.assertTrue(any("coveragePreservingMipmaps" in e for e in res["errors"]))


class TestGeometryGates(unittest.TestCase):
    def test_detects_25d_slab(self) -> None:
        flat_verts = [c for k in range(2) for y in range(6) for x in range(6) for c in (x * 0.1, y * 0.1, 0.05 if k == 0 else -0.05)]
        res = geometry_gates.check_distinct_z(flat_verts)
        self.assertFalse(res["passed"])
        self.assertEqual(res["distinctZCount"], 2)

        rich_verts = [c for y in range(6) for x in range(6) for c in (x * 0.1, y * 0.1, (x + y) * 0.015)]
        res_ok = geometry_gates.check_distinct_z(rich_verts)
        self.assertTrue(res_ok["passed"])
        self.assertGreater(res_ok["distinctZCount"], 10)

    def test_attachment_gap_and_scalp(self) -> None:
        spec = json.loads((ROOT / "examples/vintage_camera.spec.json").read_text(encoding="utf-8"))
        # Build matching AABB dummy meshes for every buildable part except make top_plate_metal float high
        meshes = {"parts": {}}
        for p in spec["parts"]:
            if p["topologyClass"] == "material-only":
                continue
            y_off = 0.5 if p["id"] == "top_plate_metal" else 0.0
            pts = [
                -0.1, y_off, -0.1, 0.1, y_off, -0.1, 0.1, y_off + 0.1, 0.1, -0.1, y_off + 0.1, 0.1,
                -0.08, y_off + 0.02, -0.05, 0.08, y_off + 0.04, 0.03, 0.04, y_off + 0.06, -0.02,
                -0.04, y_off + 0.08, 0.07, 0.02, y_off + 0.09, -0.07, 0.06, y_off + 0.03, 0.09,
                -0.06, y_off + 0.05, 0.11, 0.01, y_off + 0.07, -0.09, 0.03, y_off + 0.01, 0.13,
            ]
            meshes["parts"][p["id"]] = {"positions": pts}
        gate_res = geometry_gates.run_geometry_gates(spec, meshes)
        self.assertFalse(gate_res["passed"])
        self.assertTrue(any("Floating attachment" in f for f in gate_res["failures"]))

        scalp_ok = geometry_gates.check_scalp_exposure(
            skull_center=[0.0, 0.0, 0.0],
            skull_radii=[0.2, 0.23, 0.22],
            hair_points=[0.0, 0.25, 0.0, 0.22, 0.0, 0.0],
        )
        self.assertTrue(scalp_ok["passed"])

        scalp_bad = geometry_gates.check_scalp_exposure(
            skull_center=[0.0, 0.0, 0.0],
            skull_radii=[0.2, 0.23, 0.22],
            hair_points=[0.0, 0.05, 0.0],
        )
        self.assertFalse(scalp_bad["passed"])


class TestPbrAndIntake(unittest.TestCase):
    def test_shaped_surface_and_mip_coverage(self) -> None:
        surf = pbr_surface_synth.synthesize_shaped_surface(preset="granite-cracks-moss", size=64, seed=7)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "albedo.png"
            p.write_bytes(pbr_surface_synth.encode_png_rgba(64, 64, surf["albedo"]))
            self.assertTrue(p.exists())
            w, h, rgba = image_intake.decode_png_rgba(p)
            self.assertEqual((w, h), (64, 64))
            self.assertEqual(len(rgba), 64 * 64 * 4)

        size = 64
        buf = bytearray(size * size * 4)
        for y in range(size):
            for x in range(size):
                dx = (x - size / 2) / (size * 0.4)
                dy = (y - size / 2) / (size * 0.4)
                inside = (dx * dx + dy * dy) <= 1.0
                i = (y * size + x) * 4
                buf[i : i + 4] = bytes((70, 140, 50, 255 if inside else 0))

        mips = pbr_surface_synth.build_coverage_preserving_mipmaps(size, size, bytes(buf), alpha_test=0.45)
        cov0 = mips[0]["coverage"]
        for m in mips:
            if m["width"] >= 4:
                self.assertLess(abs(m["coverage"] - cov0), 0.03)

    def test_divine_eye_catches_interior_hole(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            w = h = 64
            ref = bytearray([20, 20, 25, 255] * (w * h))
            ren_bad = bytearray([20, 20, 25, 255] * (w * h))
            for y in range(12, 52):
                for x in range(12, 52):
                    p = (y * w + x) * 4
                    ref[p : p + 4] = bytes((180, 150, 110, 255))
                    if 18 <= x <= 46 and 18 <= y <= 46:
                        ren_bad[p : p + 4] = bytes((24, 24, 28, 255))
                    else:
                        ren_bad[p : p + 4] = bytes((180, 150, 110, 255))

            p_ref = Path(tmp) / "ref.png"
            p_bad = Path(tmp) / "bad.png"
            p_ref.write_bytes(pbr_surface_synth.encode_png_rgba(w, h, bytes(ref)))
            p_bad.write_bytes(pbr_surface_synth.encode_png_rgba(w, h, bytes(ren_bad)))

            eval_bad = image_intake.evaluate_divine_eye(p_ref, p_bad)
            self.assertNotEqual(eval_bad["verdict"], "continue")
            self.assertGreater(eval_bad["softSignals"]["interiorDifference"]["meanInteriorDifference"], 0.25)

            eval_same = image_intake.evaluate_divine_eye(p_ref, p_ref)
            self.assertEqual(eval_same["verdict"], "continue")
            self.assertGreaterEqual(eval_same["hardGates"]["silhouetteIoU"], 0.99)

            sheet = image_intake.make_comparison_sheet(p_ref, p_bad, Path(tmp) / "sheet.png")
            self.assertTrue(Path(sheet["sheetPath"]).exists())

    def test_ts_codegen(self) -> None:
        spec = json.loads((ROOT / "examples/vintage_camera.spec.json").read_text(encoding="utf-8"))
        code = ts_codegen.generate_typescript_factory(spec)
        self.assertIn("export function createVintageRangefinderCameraModel()", code)
        self.assertIn("buildVariableThicknessLoft", code)
        self.assertIn("sculptRuntime", code)


if __name__ == "__main__":
    unittest.main(verbosity=2)
