"""Optional independent export validation with Pixar's usd-core, for developers."""
from pathlib import Path
import zipfile
from pxr import Usd, UsdGeom, UsdShade

archive = next(Path("test-results").rglob("validation.zip"))
destination = Path("work/usd-verification").resolve()
destination.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(archive) as package:
    for entry in package.infolist():
        assert (destination / entry.filename).resolve().is_relative_to(destination)
    package.extractall(destination)
stage = Usd.Stage.Open(str(destination / "validation.usd"))
assert stage
triangles = 0
double_sided = 0
for prim in stage.Traverse():
    if prim.IsA(UsdGeom.Mesh):
        mesh = UsdGeom.Mesh(prim)
        triangles += len(mesh.GetFaceVertexCountsAttr().Get())
        double_sided += bool(mesh.GetDoubleSidedAttr().Get())
        assert mesh.GetNormalsInterpolation() == "vertex"
        assert len(mesh.GetNormalsAttr().Get()) == len(mesh.GetPointsAttr().Get())
        assert UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
assert triangles == 12
assert double_sided == 3
print(f"OpenUSD validated {triangles} triangles, {double_sided} double-sided meshes and material bindings.")
