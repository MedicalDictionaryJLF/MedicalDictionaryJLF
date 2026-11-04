"""Re-import final GLBs and render actual posed geometry as validation evidence."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--characters',required=True);p.add_argument('--rooms',required=True);p.add_argument('--output',required=True);p.add_argument('--only',default='');p.add_argument('--all-poses',action='store_true');args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);OUT=Path(args.output);OUT.mkdir(parents=True,exist_ok=True)
def set_tracks(owner,names):
 if not owner or not owner.animation_data:return
 owner.animation_data.action=None
 for t in owner.animation_data.nla_tracks:
  t.mute=t.name not in names
  for strip in t.strips:strip.blend_type='REPLACE'
def pose(rig,posture,gesture,pain,breathing='IdleBreathing'):
 set_tracks(rig,[posture,gesture,breathing])
 for o in bpy.context.scene.objects:
  if o.type=='MESH' and o.data.shape_keys:set_tracks(o.data.shape_keys,['PainExpression'] if pain else [])
 bpy.context.scene.frame_set(24);bpy.context.view_layer.update()
def light(name,loc,energy,size):
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
definitions=json.loads((Path(args.characters)/'character-definitions.json').read_text());rows=[]
for d in definitions:
 slug=d['slug']
 if args.only and slug!=args.only:continue
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
 bpy.ops.import_scene.gltf(filepath=str(Path(args.characters)/(slug+'.glb')));rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');patient_objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith(('PatientBody','PatientHair','WardPyjamas'))]
 room='acute' if slug in ['peter_novak','jana_kovacova','lucia_benkova','karol_urban'] else 'internal' if slug in ['milan_hronec','eva_sykorova'] else 'examination';bpy.ops.import_scene.gltf(filepath=str(Path(args.rooms)/(room+'.glb')))
 for name in ['IVEquipment','OxygenEquipment','BedsideMonitor']:
  obj=bpy.data.objects.get(name)
  if obj:
   obj.hide_render=True
   for c in obj.children_recursive:c.hide_render=True
 chair=bpy.data.objects.get('ExamChair');bed=bpy.data.objects.get('HospitalBed')
 light('RenderKey',(1.6,-3.5,4.5),500,3);light('RenderFill',(-3,-1.5,2.3),220,2);light('RenderWindow',(-1.6,2.,2.6),350,1.5)
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.world.color=(.19,.22,.21);scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.render.resolution_x=1100;scene.render.resolution_y=900;scene.render.resolution_percentage=100
 data=bpy.data.cameras.new('ValidationCamera');cam=bpy.data.objects.new('ValidationCamera',data);scene.collection.objects.link(cam);scene.camera=cam;data.lens=53
 gesture={'peter_novak':'ChestPain','jana_kovacova':'AbdominalGuard','lucia_benkova':'FlankGuard','nina_molnarova':'Headache'}.get(slug,'RestArms');poses=[('standing','PositionStanding',gesture)] if slug=='peter_novak' else [('seated','PositionSeated',gesture)]
 if args.all_poses:
  for label,position in [('standing','PositionStanding'),('seated','PositionSeated'),('reclined','PositionReclined')]:
   if not any(label==x[0] for x in poses):poses.append((label,position,'RestArms' if label=='reclined' else gesture))
 for label,posture,gesture in poses:
  pose(rig,posture,gesture,gesture!='RestArms','RespiratoryEffort' if slug in ['milan_hronec','peter_novak'] else 'IdleBreathing')
  if chair:
   chair.hide_render=label!='seated'
   for c in chair.children_recursive:c.hide_render=label!='seated'
  if bed:bed.location=(0,0,0) if label=='reclined' else (1.55,.45,0)
  target=Vector((0,0,1 if label=='standing' else .75));cam.location=(2.15,-3.7,2.);cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/(slug+'_'+label+'.png'));scene.render.image_settings.file_format='PNG';bpy.ops.render.render(write_still=True)
  row={'slug':slug,'pose':label,'rig_bones':len(rig.pose.bones),'head':list(rig.matrix_world@rig.pose.bones['head'].head),'wrist_r':list(rig.matrix_world@rig.pose.bones['hand_r'].head),'chest':list(rig.matrix_world@rig.pose.bones['spine_03'].head)}
  bounds=[];deps=bpy.context.evaluated_depsgraph_get()
  for obj in patient_objects:
   ev=obj.evaluated_get(deps);mesh=ev.to_mesh();bounds.extend(ev.matrix_world@v.co for v in mesh.vertices);ev.to_mesh_clear()
  row['bounds_min']=[min(v[i] for v in bounds) for i in range(3)];row['bounds_max']=[max(v[i] for v in bounds) for i in range(3)];rows.append(row)
 print('RENDER_VALIDATED',slug,flush=True)
(OUT/'render-metrics.json').write_text(json.dumps(rows,indent=2)+'\n')
