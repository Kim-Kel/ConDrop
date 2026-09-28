"""Optional fixture regeneration: python with the official usd-core package."""
from pathlib import Path
from pxr import Usd, UsdGeom, Gf

path = Path(__file__).with_name("triangle.usdc")
stage = Usd.Stage.CreateNew(str(path))
UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
UsdGeom.SetStageMetersPerUnit(stage, 1)
mesh = UsdGeom.Mesh.Define(stage, "/Triangle")
mesh.CreatePointsAttr([Gf.Vec3f(0, 0, 0), Gf.Vec3f(2, 0, 0), Gf.Vec3f(0, 3, 0)])
mesh.CreateFaceVertexCountsAttr([3])
mesh.CreateFaceVertexIndicesAttr([0, 1, 2])
mesh.CreateSubdivisionSchemeAttr("none")
mesh.CreateNormalsAttr([Gf.Vec3f(0, 0, 1)] * 3)
mesh.SetNormalsInterpolation("vertex")
stage.SetDefaultPrim(mesh.GetPrim())
stage.GetRootLayer().Save()
print(path)
