"""Source-node equivalent of the exported, raster-safe material policy.

Run on existing materials only: it never changes geometry, rigging or animation.
The explicit alpha comparison also exports as glTF MASK in Blender 4.5.
"""
from material_policy import ALPHA_CUTOFF,CORNEA_MATERIAL,all_black_png,is_character_material,is_cutout

def assign_cornea_material(objects):
 """Keep eye geometry, hide only the atlas-corner corneal surface.

 The high-poly MakeHuman eye has a separate outer surface whose UVs occupy
 the blue bottom-right atlas corner. In Blender UV space its V is < .13.
 """
 import bpy
 rows=[];clear=bpy.data.materials.get(CORNEA_MATERIAL)
 for obj in objects:
  if obj.type!='MESH' or not obj.data.uv_layers.active:continue
  mesh=obj.data;eyes={i for i,m in enumerate(mesh.materials) if m and m.name.startswith('PatientBody.high-poly')}
  if not eyes:continue
  faces=[face for face in mesh.polygons if face.material_index in eyes and all(mesh.uv_layers.active.data[i].uv.x>.87 and mesh.uv_layers.active.data[i].uv.y<.13 for i in face.loop_indices)]
  if not faces:continue
  if clear is None:
   clear=bpy.data.materials.new(CORNEA_MATERIAL);clear.use_nodes=True;clear.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=0;clear.diffuse_color=(1,1,1,0);clear.use_backface_culling=True
  slot=next((i for i,m in enumerate(mesh.materials) if m==clear),None)
  if slot is None:slot=len(mesh.materials);mesh.materials.append(clear)
  for face in faces:face.material_index=slot
  rows.append({'object':obj.name,'shellPolygons':len(faces),'shellTriangles':sum(len(face.vertices)-2 for face in faces),'material':CORNEA_MATERIAL})
 return rows

def upstream_images(socket,seen=None):
 seen=set() if seen is None else seen
 for link in socket.links:
  node=link.from_node
  if node.as_pointer() in seen:continue
  seen.add(node.as_pointer())
  if node.type=='TEX_IMAGE' and node.image:yield node.image
  for item in node.inputs:yield from upstream_images(item,seen)

def image_is_black(image):
 packed=image.packed_file
 if packed and all_black_png(bytes(packed.data)):return True
 # Generated maps may not be packed yet. Inspect RGB while ignoring alpha.
 if image.name.startswith(('SkinMicroNormal_','WovenCottonNormal')):
  import numpy as np
  pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
  return bool(pixels.size and not np.any(pixels.reshape(-1,4)[:,:3]))
 return False

def apply_blender_material_policy(materials):
 rows=[]
 for material in materials:
  if not is_character_material(material.name) or not material.use_nodes:continue
  tree=material.node_tree;clear=material.name==CORNEA_MATERIAL;cutout=is_cutout(material.name);removed=[]
  for bsdf in [node for node in tree.nodes if node.type=='BSDF_PRINCIPLED']:
   alpha=bsdf.inputs.get('Alpha')
   if clear and alpha:
    for link in list(alpha.links):tree.links.remove(link)
    compare=tree.nodes.get('ClearCorneaAlphaMask') or tree.nodes.new('ShaderNodeMath');compare.name='ClearCorneaAlphaMask';compare.operation='GREATER_THAN';compare.inputs[0].default_value=0;compare.inputs[1].default_value=ALPHA_CUTOFF
    tree.links.new(compare.outputs[0],alpha);alpha.default_value=0
   elif cutout and alpha and alpha.is_linked:
    link=alpha.links[0];previous=link.from_node
    if not (previous.type=='MATH' and previous.operation=='GREATER_THAN' and abs(previous.inputs[1].default_value-ALPHA_CUTOFF)<1e-6):
     source=link.from_socket;tree.links.remove(link)
     compare=tree.nodes.new('ShaderNodeMath');compare.operation='GREATER_THAN';compare.label='Hair alpha cutoff';compare.inputs[1].default_value=ALPHA_CUTOFF
     compare.location=(bsdf.location.x-200,bsdf.location.y-300)
     tree.links.new(source,compare.inputs[0]);tree.links.new(compare.outputs[0],alpha)
   elif alpha and not cutout:
    for link in list(alpha.links):tree.links.remove(link)
    alpha.default_value=0 if clear else 1
   normal=bsdf.inputs.get('Normal')
   if normal and normal.is_linked:
    images=list(upstream_images(normal))
    if images and all(image_is_black(image) for image in images):
     removed.extend(image.name for image in images)
     for link in list(normal.links):tree.links.remove(link)
  if not cutout:material.diffuse_color[3]=0 if clear else 1
  if cutout:material.use_backface_culling=False
  elif not material.name.startswith('WardCotton'):material.use_backface_culling=True
  if hasattr(material,'surface_render_method'):material.surface_render_method='DITHERED'
  rows.append({'material':material.name,'alphaMode':'MASK' if cutout or clear else 'OPAQUE','alphaCutoff':ALPHA_CUTOFF if cutout or clear else None,'doubleSided':not material.use_backface_culling,'disconnectedBlackNormalImages':sorted(set(removed))})
 return rows
