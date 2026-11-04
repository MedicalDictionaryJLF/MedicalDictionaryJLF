"""Repair the eight editable patient sources without rebuilding their identities.

blender -b --python repair_blend_materials.py -- --sources PATH --report PATH
"""
import argparse,hashlib,json,struct,sys
from array import array
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_material_policy import apply_blender_material_policy,assign_cornea_material

def sha(data):return hashlib.sha256(data).hexdigest()
def array_hash(collection,key,width,kind='f'):
 values=array(kind,[0])*(len(collection)*width);collection.foreach_get(key,values)
 return sha(values.tobytes())
def fingerprint(include_material_assignments=True):
 meshes=[]
 for mesh in bpy.data.meshes:
  row={'name':mesh.name,'vertices':array_hash(mesh.vertices,'co',3),'loops':array_hash(mesh.loops,'vertex_index',1,'i'),'polygonSizes':array_hash(mesh.polygons,'loop_total',1,'i'),'uvs':[(uv.name,array_hash(uv.data,'uv',2)) for uv in mesh.uv_layers]}
  if include_material_assignments:row['polygonMaterials']=array_hash(mesh.polygons,'material_index',1,'i')
  if mesh.shape_keys:row['shapeKeys']=[(key.name,key.relative_key.name,array_hash(key.data,'co',3)) for key in mesh.shape_keys.key_blocks]
  weights=hashlib.sha256()
  for vertex in mesh.vertices:
   for group in vertex.groups:weights.update(struct.pack('<IIf',vertex.index,group.group,group.weight))
  row['skinWeights']=weights.hexdigest();meshes.append(row)
 rigs=[]
 for rig in bpy.data.armatures:rigs.append({'name':rig.name,'bones':[(b.name,b.parent.name if b.parent else None,[list(row) for row in b.matrix_local],b.use_deform) for b in rig.bones]})
 actions=[]
 for action in bpy.data.actions:
  curves=[]
  # These sources contain layered Blender 4.5 actions. Keep channel samples,
  # handles and interpolation as well as their binding slots unchanged.
  for layer in action.layers:
   for strip in layer.strips:
    for channelbag in getattr(strip,'channelbags',[]):
     for curve in channelbag.fcurves:curves.append((curve.data_path,curve.array_index,[(list(k.co),list(k.handle_left),list(k.handle_right),k.interpolation) for k in curve.keyframe_points]))
  if action.is_action_legacy:
   for curve in action.fcurves:curves.append((curve.data_path,curve.array_index,[(list(k.co),list(k.handle_left),list(k.handle_right),k.interpolation) for k in curve.keyframe_points]))
  actions.append((action.name,curves))
 albedos=[]
 for mat in bpy.data.materials:
  if not mat.use_nodes:continue
  for node in mat.node_tree.nodes:
   if node.type=='TEX_IMAGE' and node.image and node.image.packed_file:albedos.append((mat.name,node.image.name,sha(bytes(node.image.packed_file.data))))
 objects=[(o.name,o.type,o.parent.name if o.parent else None,[list(row) for row in o.matrix_local],[(g.name,g.index) for g in o.vertex_groups] if o.type=='MESH' else []) for o in bpy.data.objects]
 def digest(value):return sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())
 return {'geometryAndMorphs':digest(meshes),'rigs':digest(rigs),'actions':digest(actions),'packedImages':digest(albedos),'objects':digest(objects)}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--sources',required=True);p.add_argument('--report',required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(args.sources);rows=[]
 for path in sorted(root.glob('*.blend')):
  if path.name.startswith('room_'):continue
  before_sha=sha(path.read_bytes());bpy.ops.wm.open_mainfile(filepath=str(path));before=fingerprint(False);cornea=assign_cornea_material(bpy.context.scene.objects);materials=apply_blender_material_policy(bpy.data.materials);after=fingerprint(False)
  if before!=after:raise RuntimeError('Refusing source anatomy/animation/image change in '+path.name)
  bpy.context.preferences.filepaths.save_version=0
  bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
  rows.append({'file':str(path),'beforeSha256':before_sha,'afterSha256':sha(path.read_bytes()),'preserved':before,'semanticDataUnchanged':before==after,'faceMaterialAssignmentsMayChange':True,'corneaAssignment':cornea,'materials':materials})
  Path(args.report).write_text(json.dumps({'sources':rows,'roomSourcesChanged':False},indent=2)+'\n')
  print('SOURCE_MATERIAL_REPAIRED',path.name,flush=True)
