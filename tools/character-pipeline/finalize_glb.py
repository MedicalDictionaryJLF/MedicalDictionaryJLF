"""Fix identity-parent portability and compact unreachable glTF binary payloads."""
import json,struct
from pathlib import Path
from material_policy import apply_material_policy,prune_material_resources,prune_extension_declarations

def canonicalize_gltf(g,binary=None):
 apply_material_policy(g,binary)
 prune_material_resources(g)
 prune_extension_declarations(g)
 parents={c:i for i,node in enumerate(g['nodes']) for c in node.get('children',[])}
 identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
 def close(a,b):return len(a)==len(b) and all(abs(x-y)<1e-6 for x,y in zip(a,b))
 for i,node in enumerate(g['nodes']):
  if 'skin' not in node or i not in parents:continue
  pi=parents[i];parent=g['nodes'][pi]
  if not (close(parent.get('translation',[0,0,0]),[0,0,0]) and close(parent.get('rotation',[0,0,0,1]),[0,0,0,1]) and close(parent.get('scale',[1,1,1]),[1,1,1]) and close(parent.get('matrix',identity),identity)):raise ValueError('Refusing nonidentity skinned-mesh parent')
  if not all(pi in s.get('nodes',[]) for s in g['scenes']):raise ValueError('Refusing an unexpected nested armature root')
  parent['children'].remove(i)
  for s in g['scenes']:
   if i not in s['nodes']:s['nodes'].append(i)
 for mesh in g.get('meshes',[]):
  for primitive in mesh['primitives']:
   material=g.get('materials',[])[primitive['material']] if 'material' in primitive else {}
   if 'normalTexture' not in material:primitive.get('attributes',{}).pop('TANGENT',None)
 return g

def compact(g,old_bin):
 accessors=set()
 for mesh in g.get('meshes',[]):
  for p in mesh['primitives']:
   accessors.update(p.get('attributes',{}).values())
   if 'indices'in p:accessors.add(p['indices'])
   for t in p.get('targets',[]):accessors.update(t.values())
 for s in g.get('skins',[]):
  if 'inverseBindMatrices'in s:accessors.add(s['inverseBindMatrices'])
 for a in g.get('animations',[]):
  for s in a['samplers']:accessors.update([s['input'],s['output']])
 amap={old:new for new,old in enumerate(sorted(accessors))}
 for mesh in g.get('meshes',[]):
  for p in mesh['primitives']:
   p['attributes']={k:amap[v] for k,v in p['attributes'].items()}
   if 'indices'in p:p['indices']=amap[p['indices']]
   for t in p.get('targets',[]):
    for k in t:t[k]=amap[t[k]]
 for s in g.get('skins',[]):
  if 'inverseBindMatrices'in s:s['inverseBindMatrices']=amap[s['inverseBindMatrices']]
 for a in g.get('animations',[]):
  for s in a['samplers']:s['input']=amap[s['input']];s['output']=amap[s['output']]
 g['accessors']=[g['accessors'][i] for i in sorted(accessors)];views={im['bufferView'] for im in g.get('images',[]) if 'bufferView'in im}
 for a in g['accessors']:
  if 'bufferView'in a:views.add(a['bufferView'])
  if 'sparse'in a:views.update([a['sparse']['indices']['bufferView'],a['sparse']['values']['bufferView']])
 vmap={old:new for new,old in enumerate(sorted(views))}
 for im in g.get('images',[]):
  if 'bufferView'in im:im['bufferView']=vmap[im['bufferView']]
 for a in g['accessors']:
  if 'bufferView'in a:a['bufferView']=vmap[a['bufferView']]
  if 'sparse'in a:
   for item in ['indices','values']:a['sparse'][item]['bufferView']=vmap[a['sparse'][item]['bufferView']]
 new_bin=bytearray();new_views=[]
 for old in sorted(views):
  v=g['bufferViews'][old].copy();start=v.get('byteOffset',0);new_bin.extend(b'\0'*((-len(new_bin))%4));v['byteOffset']=len(new_bin);new_bin.extend(old_bin[start:start+v['byteLength']]);new_views.append(v)
 g['bufferViews']=new_views;g['buffers'][0]['byteLength']=len(new_bin)
 return g,bytes(new_bin)

def finalize_glb(path):
 p=Path(path);blob=p.read_bytes();n=struct.unpack_from('<I',blob,12)[0];g=json.loads(blob[20:20+n]);g=canonicalize_gltf(g,blob[28+n:]);g,data=compact(g,blob[28+n:]);raw=json.dumps(g,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);data+=b'\0'*((-len(data))%4)
 p.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(raw)+len(data))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(data),b'BIN\0')+data)
if __name__=='__main__':
 import sys
 for path in sys.argv[1:]:finalize_glb(path);print('FINALIZED',path)
