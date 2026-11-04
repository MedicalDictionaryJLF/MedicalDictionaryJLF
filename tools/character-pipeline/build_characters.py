"""Build anatomical patient assets using Blender 4.5 and MPFB core CC0 assets.

Blender --background --python build_characters.py -- --mpfb-root PATH
 --asset-root PATH --output PATH [--only peter_novak] [--source-output PATH]
The supplied procedural Peter body/head are not reused.
"""
import argparse,json,math,struct,sys
from pathlib import Path
import bpy,addon_utils
sys.path.insert(0,str(Path(__file__).resolve().parent))
from finalize_glb import canonicalize_gltf
from blender_material_policy import apply_blender_material_policy,assign_cornea_material
from mathutils import Vector,Quaternion,Matrix
p=argparse.ArgumentParser();p.add_argument('--mpfb-root',required=True);p.add_argument('--asset-root',required=True);p.add_argument('--output',required=True);p.add_argument('--only',default='');p.add_argument('--source-output',default='')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);ASSETS=Path(args.asset_root).resolve();OUT=Path(args.output).resolve();OUT.mkdir(parents=True,exist_ok=True)
SOURCE=Path(args.source_output).resolve() if args.source_output else None
if SOURCE:SOURCE.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(args.mpfb_root).resolve()/'src'))
original_extension_path=bpy.utils.extension_path_user
bpy.utils.extension_path_user=lambda package,**kw:str(OUT/'_mpfb-work') if package=='mpfb' else original_extension_path(package,**kw)
addon_utils.enable('mpfb',default_set=True,persistent=True)
import mpfb
mpfb.set_preference('mpfb_second_root',str(ASSETS))
from mpfb.services.humanservice import HumanService
from mpfb.services.targetservice import TargetService
from mpfb.services.faceservice import FaceService
from mpfb.services.exportservice import ExportService
from mpfb.services.locationservice import LocationService
LocationService.update_second_root()
DEFINITIONS=[
 dict(slug='peter_novak',caseId='chest_pain_acs_risk',name='Peter Novak',age=58,sex='male',weight=.51,muscle=.44,hair='short02',skin='middleage_caucasian_male',color=(.34,.48,.52),details={'head/head-age-incr':.5,'head/head-rectangular':.15,'nose/nose-hump-incr':.12,'chin/chin-width-incr':.13}),
 dict(slug='jana_kovacova',caseId='abdominal_pain_cholecystitis',name='Jana Kovacova',age=43,sex='female',weight=.53,muscle=.40,hair='bob01',skin='middleage_caucasian_female',color=(.42,.50,.57),details={'head/head-round':.13,'nose/nose-width-decr':.1}),
 dict(slug='milan_hronec',caseId='progressive_dyspnea_edema',name='Milan Hronec',age=72,sex='male',weight=.54,muscle=.35,hair='short01',skin='old_caucasian_male',color=(.42,.48,.43),details={'head/head-scale-horiz-incr':.13,'nose/nose-width-incr':.12,'chin/chin-prominent-incr':.12}),
 dict(slug='lucia_benkova',caseId='fever_flank_dysuria',name='Lucia Benkova',age=29,sex='female',weight=.47,muscle=.43,hair='ponytail01',skin='young_caucasian_female',color=(.44,.52,.59),details={'head/head-oval':.15,'chin/chin-width-decr':.12}),
 dict(slug='karol_urban',caseId='melena_dizziness_nsaid',name='Karol Urban',age=64,sex='male',weight=.50,muscle=.39,hair='short04',skin='middleage_caucasian_male',color=(.48,.46,.41),details={'head/head-square':.15,'nose/nose-width-incr':.15,'chin/chin-width-incr':.2}),
 dict(slug='eva_sykorova',caseId='exertional_syncope',name='Eva Sykorova',age=76,sex='female',weight=.46,muscle=.31,hair='short03',skin='old_caucasian_female',color=(.49,.45,.53),details={'head/head-scale-horiz-decr':.11,'nose/nose-hump-incr':.1,'chin/chin-width-decr':.1}),
 dict(slug='zuzana_kralova',caseId='weight_loss_bowel_change',name='Zuzana Kralova',age=61,sex='female',weight=.43,muscle=.36,hair='bob02',skin='middleage_caucasian_female',color=(.40,.50,.48),details={'head/head-oval':.12,'cheek/l-cheek-volume-decr':.12,'cheek/r-cheek-volume-decr':.12}),
 dict(slug='nina_molnarova',caseId='recurrent_headache_migraine',name='Nina Molnarova',age=25,sex='female',weight=.48,muscle=.43,hair='braid01',skin='young_caucasian_female2',color=(.43,.46,.59),details={'head/head-diamond':.12,'nose/nose-width-decr':.13,'chin/chin-width-decr':.1})]
FACE_KEYS=['eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight','eyeLookDownLeft','eyeLookDownRight','eyeLookUpLeft','eyeLookUpRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight','browDownLeft','browDownRight','browInnerUp','mouthFrownLeft','mouthFrownRight','mouthPressLeft','mouthPressRight','jawOpen','mouthPucker','viseme_aa','viseme_E','viseme_O','viseme_PP','viseme_FF','viseme_SS']

def reset_scene():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
 bpy.context.scene.render.fps=24

def simple_mat(name,color,rough=.78,metallic=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF')
 b.inputs['Base Color'].default_value=(*color[:3],1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metallic;m.diffuse_color=(*color[:3],1);return m

def ward_materials(color):
 import numpy as np
 n=256;y,x=np.mgrid[0:n,0:n];h=.06*np.sin(x*math.pi/2)*np.cos(y*math.pi/2);dx,dy=np.gradient(h)
 pixels=np.stack((.5-dx,.5-dy,np.ones_like(dx),np.ones_like(dx)),axis=-1).astype('float32')
 im=bpy.data.images.get('WovenCottonNormal') or bpy.data.images.new('WovenCottonNormal',n,n);im.colorspace_settings.name='Non-Color';im.pixels.foreach_set(pixels.ravel());im.update();im.filepath_raw=str(OUT/'cotton_normal.png');im.file_format='PNG';im.save()
 mats=[]
 for name,c in [('WardCottonTop',color),('WardCottonTrousers',tuple(v*.65 for v in color))]:
  m=simple_mat(name,c,.87);tree=m.node_tree;bsdf=tree.nodes.get('Principled BSDF');tex=tree.nodes.new('ShaderNodeTexImage');tex.image=im
  mapping=tree.nodes.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=50
  uv=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(uv.outputs['UV'],mapping.inputs[0]);tree.links.new(mapping.outputs['Vector'],tex.inputs['Vector'])
  normal=tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.2;tree.links.new(tex.outputs['Color'],normal.inputs['Color']);tree.links.new(normal.outputs['Normal'],bsdf.inputs['Normal']);mats.append(m)
 return mats

def set_skin(body,d):
 path=ASSETS/'skins'/d['skin']/(d['skin']+'.mhmat');HumanService.set_character_skin(str(path),body,skin_type='GAMEENGINE')
 for mat in body.data.materials:
  bsdf=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if bsdf:
   bsdf.inputs['Roughness'].default_value=.62;bsdf.inputs['Specular IOR Level'].default_value=.27;bsdf.inputs['Subsurface Weight'].default_value=.035;bsdf.inputs['Subsurface Radius'].default_value=(1,.42,.25)
  mat.name='Skin_'+d['slug']
 import numpy as np
 mat=body.data.materials[0];texture=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image);im=texture.image;w,h=im.size;pixel=np.empty(w*h*4,dtype=np.float32);im.pixels.foreach_get(pixel);rgb=pixel.reshape(h,w,4)
 if d['slug']=='peter_novak':
  old=bpy.data.images.load(str(ASSETS/'skins/old_caucasian_male/old_lightskinned_male_diffuse.png'),check_existing=False);other=np.empty(w*h*4,dtype=np.float32);old.pixels.foreach_get(other);rgb[:,:,:3]=rgb[:,:,:3]*.55+other.reshape(h,w,4)[:,:,:3]*.45;im.pixels.foreach_set(rgb.ravel());im.update()
 lum=rgb[:,:,:3].mean(axis=2);rng=np.random.default_rng(42);height=lum*.7+rng.normal(0,.003,lum.shape);dy,dx=np.gradient(height)
 normal=np.stack((.5-dx*2,.5-dy*2,np.ones_like(dx),np.ones_like(dx)),axis=-1).clip(0,1).astype(np.float32)
 nm=bpy.data.images.new('SkinMicroNormal_'+d['slug'],w,h);nm.colorspace_settings.name='Non-Color';nm.pixels.foreach_set(normal.ravel());nm.update();nm.filepath_raw=str(OUT/('skin_normal_'+d['slug']+'.png'));nm.file_format='PNG';nm.save()
 tree=mat.node_tree;tex=tree.nodes.new('ShaderNodeTexImage');tex.image=nm;n=tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.22;tree.links.new(tex.outputs['Color'],n.inputs['Color']);tree.links.new(n.outputs['Normal'],bsdf.inputs['Normal'])

def load_asset(body,folder,name,kind,subdiv=0):
 return HumanService.add_mhclo_asset(str(ASSETS/folder/name/(name+'.mhclo')),body,asset_type=kind,subdiv_levels=subdiv,material_type='GAMEENGINE')

def shade_and_limit_images():
 for o in bpy.context.scene.objects:
  if o.type=='MESH':
   for f in o.data.polygons:f.use_smooth=True
 texdir=OUT/'export-textures';texdir.mkdir(exist_ok=True)
 for im in list(bpy.data.images):
  if im.name in ['Render Result','Viewer Node']:continue
  name=im.name.lower();normal='normal' in name;alpha='eye' in name or any(s in name for s in ['short0','long0','bob0','ponytail','braid']);limit=2048 if 'skinned' in name or 'skinmicro' in name else (1024 if alpha else 512)
  if max(im.size)>limit:
   k=limit/max(im.size);im.scale(max(1,round(im.size[0]*k)),max(1,round(im.size[1]*k)))
  fmt='PNG' if normal or alpha else 'JPEG';im.filepath_raw=str(texdir/(im.name.replace('.','_')+('.png' if fmt=='PNG' else '.jpg')));im.file_format=fmt;im.save()

def aim_bone(pb,head,direction):
 source=pb.bone.matrix_local.to_quaternion();rest_direction=source@Vector((0,1,0));q=rest_direction.rotation_difference(Vector(direction).normalized())@source;mat=q.to_matrix().to_4x4();mat.translation=Vector(head);pb.matrix=mat;bpy.context.view_layer.update()

def arm_pose(rig,side,target,pole,fingers=(0,0,-1),palm_roll=0):
 upper=rig.pose.bones['upperarm_'+side];lower=rig.pose.bones['lowerarm_'+side];hand=rig.pose.bones['hand_'+side];shoulder=upper.head.copy();target=Vector(target);pole=Vector(pole);l1=upper.length;l2=lower.length;direction=target-shoulder;dist=max(.02,min(direction.length,l1+l2-.004));direction.normalize();target=shoulder+direction*dist;a=(l1*l1-l2*l2+dist*dist)/(2*dist);plane=pole-shoulder;plane=plane-direction*plane.dot(direction)
 if plane.length<.001:plane=Vector((1,0,0))
 plane.normalize();height=math.sqrt(max(.000001,l1*l1-a*a));elbow=shoulder+direction*a+plane*height;aim_bone(upper,shoulder,elbow-shoulder);aim_bone(lower,lower.head.copy(),target-elbow);aim_bone(hand,hand.head.copy(),fingers)
 if palm_roll:hand.rotation_quaternion=hand.rotation_quaternion@Quaternion((0,1,0),palm_roll);bpy.context.view_layer.update()

def align_palm(rig,side,direction):
 hand=rig.pose.bones['hand_'+side]
 # Use the anatomical knuckle plane; the rig's bone axes are rolled and
 # do not coincide with the palmar surface.
 index=rig.pose.bones['index_01_'+side].head.copy()
 pinky=rig.pose.bones['pinky_01_'+side].head.copy()
 middle=rig.pose.bones['middle_01_'+side].head.copy()
 thumb=rig.pose.bones['thumb_01_'+side].head.copy()
 normal=(index-pinky).cross(middle-hand.head).normalized()
 if normal.dot(thumb-(middle+hand.head)*.5)<0:normal=-normal
 world=hand.matrix.to_quaternion();axis=(world @ Vector((0,1,0))).normalized()
 normal=(normal-axis*normal.dot(axis)).normalized()
 target=Vector(direction);target=(target-axis*target.dot(axis)).normalized()
 angle=math.atan2(axis.dot(normal.cross(target)),max(-1,min(1,normal.dot(target))))
 hand.rotation_quaternion=hand.rotation_quaternion @ Quaternion((0,1,0),angle)
 bpy.context.view_layer.update()
 return target

def curl_fingers(rig,side,palm_direction):
 for name in ['index','middle','ring','pinky']:
  for j in range(1,4):rig.pose.bones[f'{name}_0{j}_{side}'].rotation_quaternion=Quaternion()
 bpy.context.view_layer.update()
 for name in ['index','middle','ring','pinky']:
  for j,angle in [(1,.17),(2,.24),(3,.14)]:
   bone=rig.pose.bones[f'{name}_0{j}_{side}'];matrix=bone.matrix.copy();q=matrix.to_quaternion()
   direction=(q @ Vector((0,1,0))).normalized();axis=direction.cross(Vector(palm_direction)).normalized()
   rotated=(Quaternion(axis,angle) @ q).to_matrix().to_4x4();rotated.translation=matrix.translation
   bone.matrix=rotated;bpy.context.view_layer.update()

def restore_pose(rig):
 for b in rig.pose.bones:b.rotation_mode='QUATERNION';b.matrix_basis=Matrix.Identity(4)
 bpy.context.view_layer.update()

def rest_arms(rig):
 z=rig.pose.bones['upperarm_r'].head.z
 for side,sgn in [('l',1),('r',-1)]:arm_pose(rig,side,(sgn*.255,-.13,z-.40),(sgn*.48,.04,z-.25))
 for b in rig.pose.bones:
  if any(b.name.startswith(x) for x in ['index','middle','ring','pinky']):b.rotation_quaternion=Quaternion((1,0,0),.12)

def key_bones(rig,names,frame):
 for name in names:
  p=rig.pose.bones[name];p.keyframe_insert('rotation_quaternion',frame=frame,group=name)
  if name=='Root':p.keyframe_insert('location',frame=frame,group=name)
  if name.startswith('spine_'):p.keyframe_insert('scale',frame=frame,group=name)

def nla_action(owner,name,build):
 owner.animation_data_create();action=bpy.data.actions.new(name);owner.animation_data.action=action;build();track=owner.animation_data.nla_tracks.new();track.name=name;track.strips.new(name,1,action);track.mute=True;owner.animation_data.action=None;action.use_fake_user=True

def create_animations(rig,body,definition):
 arms=[b.name for b in rig.pose.bones if b.name.startswith(('upperarm','lowerarm','hand','index','middle','ring','pinky','thumb'))];legs=['Root','pelvis','thigh_l','thigh_r','calf_l','calf_r','foot_l','foot_r','ball_l','ball_r']
 def position(kind):
  restore_pose(rig)
  if kind=='Seated':
   hip_z=(rig.pose.bones['thigh_l'].head.z+rig.pose.bones['thigh_r'].head.z)*.5;rig.pose.bones['Root'].location.z=.57-hip_z
   for side in ['l','r']:
    thigh=rig.pose.bones['thigh_'+side];aim_bone(thigh,thigh.head.copy(),(0,-1,-.09));calf=rig.pose.bones['calf_'+side];aim_bone(calf,calf.head.copy(),(0,.08,-1));foot=rig.pose.bones['foot_'+side];mat=foot.bone.matrix_local.copy();mat.translation=foot.head.copy();foot.matrix=mat
  elif kind=='Reclined':rig.pose.bones['Root'].rotation_quaternion=Quaternion((1,0,0),-math.pi/2);rig.pose.bones['Root'].location=(0,-.94,.91)
  for f in [1,25]:key_bones(rig,legs,f)
 for kind in ['Standing','Seated','Reclined']:nla_action(rig,'Position'+kind,lambda kind=kind:position(kind))
 def arms_clip(kind):
  restore_pose(rig);rest_arms(rig);z=rig.pose.bones['upperarm_r'].head.z
  if kind=='ChestPain':arm_pose(rig,'r',(-.045,-.21,z-.12),(-.48,.04,z-.35),(.45,0,.85),math.pi)
  elif kind=='AbdominalGuard':arm_pose(rig,'r',(-.13,-.24,z-.24),(-.47,.04,z-.38),(.55,0,-.8),math.pi)
  elif kind=='FlankGuard':arm_pose(rig,'r',(-.24,.07,z-.30),(-.48,.1,z-.36),(0,0,-1),-math.pi/2 if definition['slug']=='lucia_benkova' else 0)
  elif kind=='Headache':
   head=rig.pose.bones['head'].head.copy()
   if definition['slug']=='nina_molnarova':
    arm_pose(rig,'l',(.115,-.06,head.z-.02),(.40,-.10,z-.17),(0,.70,.714))
    normal=align_palm(rig,'l',(-1,0,0));curl_fingers(rig,'l',normal)
   else:arm_pose(rig,'l',(.105,-.07,head.z+.08),(.45,-.13,z-.13),(0,0,1))
  for f in [1,73]:key_bones(rig,arms,f)
 for kind in ['RestArms','ChestPain','AbdominalGuard','FlankGuard','Headache']:nla_action(rig,kind,lambda kind=kind:arms_clip(kind))
 for name,seconds,amplitude in [('IdleBreathing',4.6,.006),('RespiratoryEffort',2.9,.015)]:
  def breath(seconds=seconds,amplitude=amplitude):
   restore_pose(rig)
   for k in range(9):
    wave=(1-math.cos(k/8*math.tau))*.5;b=rig.pose.bones['spine_03'];b.scale=(1+amplitude*wave,1+amplitude*.2*wave,1+amplitude*wave);b.rotation_quaternion=Quaternion((1,0,0),amplitude*wave*.7);key_bones(rig,['spine_03'],1+round(k/8*seconds*24))
  nla_action(rig,name,breath)
 def fatigue():
  restore_pose(rig)
  for k in range(5):rig.pose.bones['head'].rotation_quaternion=Quaternion((1,0,0),math.radians(3+math.sin(k*math.pi/2)));key_bones(rig,['head'],1+k*24)
 nla_action(rig,'Fatigue',fatigue);restore_pose(rig)
 def face_clip(name,sequence):
  names=set(n for _,values in sequence for n in values)
  for ob in bpy.context.scene.objects:
   if ob.type!='MESH' or not ob.data.shape_keys:continue
   keys=ob.data.shape_keys
   if not any(keys.key_blocks.get(n) for n in names):continue
   def build(keys=keys):
    for key in keys.key_blocks:key.value=0
    for frame,values in sequence:
     for n in names:
      key=keys.key_blocks.get(n)
      if key:key.value=values.get(n,0);key.keyframe_insert('value',frame=frame,group=n)
    for key in keys.key_blocks:key.value=0
   nla_action(keys,name,build)
 face_clip('Blink',[(1,{}),(42,{}),(44,{'eyeBlinkLeft':1,'eyeBlinkRight':1}),(46,{}),(97,{})])
 pain={'browDownLeft':.5,'browDownRight':.5,'browInnerUp':.22,'eyeSquintLeft':.3,'eyeSquintRight':.3,'mouthPressLeft':.32,'mouthPressRight':.32}
 face_clip('PainExpression',[(1,pain),(73,pain)])
 face_clip('Talking',[(1,{}),(7,{'viseme_aa':.6}),(12,{'viseme_E':.5}),(17,{'viseme_PP':.5}),(22,{'viseme_O':.55}),(27,{}),(33,{'viseme_FF':.45}),(39,{'viseme_aa':.5}),(45,{}),(49,{})])
 face_clip('EyeMovement',[(1,{}),(25,{'eyeLookOutLeft':.2,'eyeLookInRight':.2}),(49,{}),(73,{'eyeLookInLeft':.2,'eyeLookOutRight':.2}),(97,{})])
 restore_pose(rig)
 for ob in bpy.context.scene.objects:
  if ob.type=='MESH' and ob.data.shape_keys:
   for key in ob.data.shape_keys.key_blocks:key.value=0
 bpy.context.scene.frame_set(1)

def compact_glb(path):
 blob=Path(path).read_bytes();size=struct.unpack_from('<I',blob,12)[0];g=canonicalize_gltf(json.loads(blob[20:20+size]),blob[28+size:]);tail=blob[20+size:]
 for a in g.get('animations',[]):
  name=a['name']
  def keep(ch):
   t=ch['target'];bone=g['nodes'][t['node']].get('name','');prop=t['path']
   if prop=='weights':return True
   if name.startswith('Position'):return bone in ['Root','pelvis','thigh_l','thigh_r','calf_l','calf_r','foot_l','foot_r','ball_l','ball_r'] and (prop=='rotation' or (bone=='Root' and prop=='translation'))
   if name in ['RestArms','ChestPain','AbdominalGuard','FlankGuard','Headache']:return bone.startswith(('upperarm','lowerarm','hand','index','middle','ring','pinky','thumb')) and prop=='rotation'
   if name in ['IdleBreathing','RespiratoryEffort']:return bone=='spine_03' and prop in ['scale','rotation']
   if name=='Fatigue':return bone=='head' and prop=='rotation'
   return False
  a['channels']=[c for c in a['channels'] if keep(c)];used=sorted({c['sampler'] for c in a['channels']});mp={old:new for new,old in enumerate(used)};a['samplers']=[a['samplers'][i] for i in used]
  for c in a['channels']:c['sampler']=mp[c['sampler']]
 accessors=set()
 for mesh in g.get('meshes',[]):
  for primitive in mesh['primitives']:
   accessors.update(primitive.get('attributes',{}).values())
   if 'indices' in primitive:accessors.add(primitive['indices'])
   for target in primitive.get('targets',[]):accessors.update(target.values())
 for skin in g.get('skins',[]):
  if 'inverseBindMatrices' in skin:accessors.add(skin['inverseBindMatrices'])
 for anim in g.get('animations',[]):
  for sampler in anim['samplers']:accessors.update([sampler['input'],sampler['output']])
 amap={old:new for new,old in enumerate(sorted(accessors))}
 for mesh in g.get('meshes',[]):
  for primitive in mesh['primitives']:
   primitive['attributes']={k:amap[v] for k,v in primitive['attributes'].items()}
   if 'indices' in primitive:primitive['indices']=amap[primitive['indices']]
   for target in primitive.get('targets',[]):
    for key in target:target[key]=amap[target[key]]
 for skin in g.get('skins',[]):
  if 'inverseBindMatrices' in skin:skin['inverseBindMatrices']=amap[skin['inverseBindMatrices']]
 for anim in g.get('animations',[]):
  for sampler in anim['samplers']:sampler['input']=amap[sampler['input']];sampler['output']=amap[sampler['output']]
 g['accessors']=[g['accessors'][i] for i in sorted(accessors)];views={im['bufferView'] for im in g.get('images',[]) if 'bufferView' in im}
 for a in g['accessors']:
  if 'bufferView' in a:views.add(a['bufferView'])
  if 'sparse' in a:views.update([a['sparse']['indices']['bufferView'],a['sparse']['values']['bufferView']])
 vmap={old:new for new,old in enumerate(sorted(views))}
 for im in g.get('images',[]):
  if 'bufferView' in im:im['bufferView']=vmap[im['bufferView']]
 for a in g['accessors']:
  if 'bufferView' in a:a['bufferView']=vmap[a['bufferView']]
  if 'sparse' in a:
   for item in ['indices','values']:a['sparse'][item]['bufferView']=vmap[a['sparse'][item]['bufferView']]
 old_bin=tail[8:];new_bin=bytearray();new_views=[]
 for old in sorted(views):
  v=g['bufferViews'][old].copy();start=v.get('byteOffset',0);new_bin.extend(b'\0'*((-len(new_bin))%4));v['byteOffset']=len(new_bin);new_bin.extend(old_bin[start:start+v['byteLength']]);new_views.append(v)
 g['bufferViews']=new_views;g['buffers'][0]['byteLength']=len(new_bin);new_bin.extend(b'\0'*((-len(new_bin))%4));raw=json.dumps(g,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);tail=struct.pack('<I4s',len(new_bin),b'BIN\0')+new_bin
 Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,20+len(raw)+len(tail))+struct.pack('<I4s',len(raw),b'JSON')+raw+tail)

def export_glb(path):
 assign_cornea_material(bpy.context.scene.objects)
 apply_blender_material_policy(bpy.data.materials)
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=False,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_frame_range=False,export_morph=True,export_morph_normal=False,export_try_sparse_sk=True,export_image_quality=85,export_tangents=True,export_extras=True,export_cameras=False,export_lights=False,export_skins=True,export_all_influences=False)
 compact_glb(path)

def build_character(d):
 reset_scene();macro=TargetService.get_default_macro_info_dict();macro.update(gender=1 if d['sex']=='male' else 0,age=.5+max(0,d['age']-25)/130,weight=d['weight'],muscle=d['muscle'],height=.5,proportions=.5);macro['race']={'caucasian':1.,'african':0.,'asian':0.};body=HumanService.create_human(macro_detail_dict=macro)
 for fragment,value in d['details'].items():
  f=Path(args.mpfb_root)/'src/mpfb/data/targets'/(fragment+'.target.gz')
  if f.exists():TargetService.load_target(body,str(f),weight=value)
 body.name='PatientBody';rig=HumanService.add_builtin_rig(body,'game_engine');rig.name='PatientRig';set_skin(body,d)
 for folder,name,kind in [('eyes','high-poly','Eyes'),('eyebrows','eyebrow001','Eyebrows'),('eyelashes','eyelashes01','Eyelashes'),('teeth','teeth_base','Teeth'),('tongue','tongue01','Tongue')]:load_asset(body,folder,name,kind,0)
 hair=load_asset(body,'hair',d['hair'],'Hair',0);hair.name='PatientHair'
 if d['age']>50:
  import numpy as np
  gray=min(.78,max(0,(d['age']-50)/34))
  for material in hair.data.materials:
   for tex in material.node_tree.nodes:
    if tex.type!='TEX_IMAGE' or not tex.image:continue
    im=tex.image;w,h=im.size;pixels=np.empty(w*h*4,dtype=np.float32);im.pixels.foreach_get(pixels);rgba=pixels.reshape(h,w,4);lum=rgba[:,:,:3].mean(axis=2,keepdims=True);rgba[:,:,:3]=rgba[:,:,:3]*(1-gray)+(lum*.85+.07)*gray;im.pixels.foreach_set(rgba.ravel());im.update()
 clothes=load_asset(body,'clothes','male_casualsuit06','Clothes',1);clothes.name='WardPyjamas';mats=ward_materials(d['color']);clothes.data.materials.clear()
 for m in mats:clothes.data.materials.append(m)
 parents=list(range(len(clothes.data.vertices)))
 def find(i):
  while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
  return i
 for face in clothes.data.polygons:
  root=find(face.vertices[0])
  for v in face.vertices:parents[find(v)]=root
 tops={}
 for v in clothes.data.vertices:
  root=find(v.index);tops[root]=max(tops.get(root,-100),v.co.z)
 for face in clothes.data.polygons:face.material_index=0 if tops[find(face.vertices[0])]>1.25 else 1
 load_asset(body,'clothes','shoes02','Clothes',0);TargetService.bake_targets(body)
 for name in FACE_KEYS:TargetService.load_target(body,str(ASSETS/'targets'/('visemes' if name.startswith('viseme_') else 'faceunits')/(name+'.target')),name=name,weight=0.)
 FaceService.interpolate_targets(body);ExportService.bake_modifiers_remove_helpers(body,bake_masks=True,bake_subdiv=True,remove_helpers=True,also_proxy=True);shade_and_limit_images()
 body['caseId']=d['caseId'];body['patientName']=d['name'];body['age']=d['age'];body['assetLicense']='MakeHuman core assets CC0; see ASSET_CREDITS.md';rig['coordinateSystem']='glTF: metres, Y up, faces +Z';rig['appearanceNote']='Hair, clothing and facial variation are artistic choices; case facts are unchanged.';create_animations(rig,body,d);export_glb(OUT/(d['slug']+'.glb'))
 if SOURCE:
  for image in bpy.data.images:
   if image.source=='FILE':
    try:image.pack()
    except RuntimeError:pass
  bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(d['slug']+'.blend')),compress=True)
 print('CHARACTER_COMPLETE',d['slug'],flush=True)

(OUT/'character-definitions.json').write_text(json.dumps(DEFINITIONS,indent=2)+'\n')
for d in DEFINITIONS:
 if not args.only or d['slug']==args.only:build_character(d)
print('BUILD_FINISHED',flush=True)
