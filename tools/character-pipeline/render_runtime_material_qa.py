"""Render actual Three.js CPU-deformed vertices and runtime camera values.

The JSON snapshots come from Patient3DRenderer, not Blender's animation mixer.
The corrected GLB supplies the original embedded albedo/materials; imported room
geometry remains unchanged. Cycles lighting and recomputed smooth normals are
explicitly validation approximations, not a WebGL screenshot.
"""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector

def xyz(value):return Vector((value[0],-value[2],value[1]))
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def clear():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for action in list(bpy.data.actions):bpy.data.actions.remove(action)
 bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
def hide_tree(obj,hidden=True):
 if not obj:return
 obj.hide_render=hidden
 for child in obj.children_recursive:child.hide_render=hidden
def area(name,location,power,size):
 lamp=bpy.data.lights.new(name,'AREA');lamp.energy=power;lamp.shape='DISK';lamp.size=size
 obj=bpy.data.objects.new(name,lamp);bpy.context.collection.objects.link(obj);obj.location=location
 obj.rotation_euler=(Vector((0,0,.9))-obj.location).to_track_quat('-Z','Y').to_euler()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--assets',required=True);p.add_argument('--snapshots',nargs='+',required=True);p.add_argument('--output',required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);assets=Path(args.assets);out=Path(args.output);out.mkdir(parents=True,exist_ok=True);rows=[]
 for snapshot in map(Path,args.snapshots):
  data=json.loads(snapshot.read_text());slug=data['patient'];clear();patient=assets/'patients'/(slug+'.glb')
  bpy.ops.import_scene.gltf(filepath=str(patient));materials={m.name:m for m in bpy.data.materials}
  for obj in list(bpy.context.scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
  for source in data['meshes']:
   flat=source['vertices'];vertices=[xyz(flat[i:i+3]) for i in range(0,len(flat),3)];ix=source['indices'];triangles=[ix[i:i+3] for i in range(0,len(ix),3)]
   mesh=bpy.data.meshes.new('Runtime_'+source['name']);mesh.from_pydata(vertices,[],triangles);mesh.update()
   if source.get('uv'):
    uv=mesh.uv_layers.new(name='UVMap');values=source['uv']
    for loop in mesh.loops:uv.data[loop.index].uv=(values[loop.vertex_index*2],1-values[loop.vertex_index*2+1])
   for face in mesh.polygons:face.use_smooth=True
   obj=bpy.data.objects.new('Runtime_'+source['name'],mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(materials[source['material']])
  room='acute' if slug in ['peter_novak','jana_kovacova','lucia_benkova','karol_urban'] else 'internal' if slug in ['milan_hronec','eva_sykorova'] else 'examination'
  room_file=assets/'environments'/(room+'.glb');bpy.ops.import_scene.gltf(filepath=str(room_file))
  for name in ['IVEquipment','OxygenEquipment','BedsideMonitor']:hide_tree(bpy.data.objects.get(name))
  hide_tree(bpy.data.objects.get('ExamChair'),not data['chairVisible'])
  bed=bpy.data.objects.get('HospitalBed')
  if bed:bed.matrix_world.translation=xyz(data['bedPosition'])
  # The room bedspread stays flat: no synthetic cover arch or mesh deformation.
  area('QA_Key',(1.6,-3.5,4.5),500,3);area('QA_Fill',(-3,-1.5,2.3),220,2);area('QA_Window',(-1.6,2,2.6),350,1.5)
  scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.world.color=(.19,.22,.21);scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
  camera=bpy.data.cameras.new('RuntimeCamera');cam=bpy.data.objects.new('RuntimeCamera',camera);scene.collection.objects.link(cam);scene.camera=cam
  values=data['camera'];cam.location=xyz(values['position']);target=xyz(values['target']);cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();camera.sensor_fit='VERTICAL';camera.sensor_height=24;camera.lens=12/math.tan(math.radians(values['fov'])/2);camera.clip_start=.01;camera.clip_end=100
  scene.render.resolution_y=1200;scene.render.resolution_x=round(1200*values['aspect']);scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';dest=out/(snapshot.stem+'.png');scene.render.filepath=str(dest);bpy.ops.render.render(write_still=True)
  cover=bpy.data.objects.get('FoldedCover');mattress=bpy.data.objects.get('Mattress');clearance=min((cover.matrix_world@v.co).z for v in cover.data.vertices)-max((mattress.matrix_world@v.co).z for v in mattress.data.vertices);assert clearance>.03
  rows.append({'patient':slug,'posture':data['posture'],'view':data['view'],'snapshot':str(snapshot),'snapshotSha256':digest(snapshot),'patientGlbSha256':digest(patient),'roomGlb':str(room_file),'roomGlbSha256':digest(room_file),'bedspreadMattressClearanceMeters':clearance,'render':str(dest),'renderSha256':digest(dest),'camera':values,'bedPosition':data['bedPosition'],'meshCount':len(data['meshes']),'evidenceLimit':'Actual runtime world vertices and camera; corrected GLB albedo/materials; Cycles lighting and recomputed vertex normals, not a WebGL screenshot.'})
  (out/'runtime-render-qa.json').write_text(json.dumps(rows,indent=2)+'\n');print('RUNTIME_QA_RENDERED',dest,flush=True)
