"""Raster-safe character materials; intentionally independent of Blender/Pillow."""
import struct,zlib

ALPHA_CUTOFF=.34
CORNEA_MATERIAL='PatientEyeCorneaClear'

def is_cutout(name):
 text=name.lower()
 return any(token in text for token in ('eyebrow','eyelash','short0','bob0','long0','ponytail','braid','afro0'))

def is_character_material(name):
 return name==CORNEA_MATERIAL or name.startswith(('Skin_','PatientBody.','WardCotton'))

def image_bytes(g,binary,index):
 image=g['images'][index]
 if 'bufferView' not in image:return None
 view=g['bufferViews'][image['bufferView']];start=view.get('byteOffset',0)
 return bytes(binary[start:start+view['byteLength']])

def all_black_png(encoded):
 """Prove solid black for RGB8 non-interlaced PNG without optional libraries.

 Zero-valued filtered RGB rows decode to zero under all five PNG filters. This
 deliberately conservative fast path never rejects an unfamiliar valid map.
 """
 if encoded is None or encoded[:8]!=b'\x89PNG\r\n\x1a\n':return False
 cursor=8;idat=[];width=height=0
 while cursor+12<=len(encoded):
  n=struct.unpack_from('>I',encoded,cursor)[0];kind=encoded[cursor+4:cursor+8];body=encoded[cursor+8:cursor+8+n];cursor+=n+12
  if kind==b'IHDR':
   width,height,depth,channels,compression,filtering,interlaced=struct.unpack('>IIBBBBB',body)
   if depth!=8 or channels!=2 or interlaced:return False
  elif kind==b'IDAT':idat.append(body)
  elif kind==b'IEND':break
 if not width or not height:return False
 try:raw=zlib.decompress(b''.join(idat))
 except zlib.error:return False
 stride=width*3+1
 if len(raw)!=stride*height:return False
 return all(raw[y*stride]<=4 and not any(raw[y*stride+1:(y+1)*stride]) for y in range(height))

def apply_material_policy(g,binary=None):
 changes=[]
 for m in g.get('materials',[]):
  name=m.get('name','')
  if not is_character_material(name):continue
  before={k:m.get(k) for k in ('alphaMode','alphaCutoff','doubleSided')}
  if name==CORNEA_MATERIAL:
   m['alphaMode']='MASK';m['alphaCutoff']=ALPHA_CUTOFF;m['doubleSided']=False;m.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=[1,1,1,0]
  elif is_cutout(name):m['alphaMode']='MASK';m['alphaCutoff']=ALPHA_CUTOFF;m['doubleSided']=True
  else:
   m['alphaMode']='OPAQUE';m.pop('alphaCutoff',None)
   # Opaque cloth can keep its authored two-sidedness; anatomy is depth-safe.
   if not name.startswith('WardCotton'):m['doubleSided']=False
   pbr=m.get('pbrMetallicRoughness',{})
   if 'baseColorFactor'in pbr:pbr['baseColorFactor'][3]=1
  removed_normal=False
  normal=m.get('normalTexture')
  if normal is not None and binary is not None:
   tex=g['textures'][normal['index']]
   if 'source'in tex and all_black_png(image_bytes(g,binary,tex['source'])):m.pop('normalTexture');removed_normal=True
  after={k:m.get(k) for k in ('alphaMode','alphaCutoff','doubleSided')}
  if before!=after or removed_normal:changes.append({'material':name,'before':before,'after':after,'removedBlackNormal':removed_normal})
 return changes

def prune_material_resources(g):
 def indices(value,transform=None):
  if isinstance(value,dict):
   for key,item in value.items():
    if key=='extras':continue
    if key=='index' and isinstance(item,int):
     if transform is None:yield item
     else:value[key]=transform[item]
    else:yield from indices(item,transform)
  elif isinstance(value,list):
   for item in value:yield from indices(item,transform)
 used=sorted({i for m in g.get('materials',[]) for i in indices(m)})
 remap={old:new for new,old in enumerate(used)}
 for m in g.get('materials',[]):list(indices(m,remap))
 old=g.get('textures',[]);g['textures']=[old[i] for i in used]
 image_ids=set();sampler_ids=set()
 for tex in g['textures']:
  if 'source'in tex:image_ids.add(tex['source'])
  if 'sampler'in tex:sampler_ids.add(tex['sampler'])
  for ex in tex.get('extensions',{}).values():
   if isinstance(ex,dict) and 'source'in ex:image_ids.add(ex['source'])
 imap={old:new for new,old in enumerate(sorted(image_ids))};smap={old:new for new,old in enumerate(sorted(sampler_ids))}
 for tex in g['textures']:
  if 'source'in tex:tex['source']=imap[tex['source']]
  if 'sampler'in tex:tex['sampler']=smap[tex['sampler']]
  for ex in tex.get('extensions',{}).values():
   if isinstance(ex,dict) and 'source'in ex:ex['source']=imap[ex['source']]
 g['images']=[g['images'][i] for i in sorted(image_ids)]
 if 'samplers'in g:g['samplers']=[g['samplers'][i] for i in sorted(sampler_ids)]
 return g

def prune_extension_declarations(g):
 used=set()
 def walk(value):
  if isinstance(value,dict):
   for key,item in value.items():
    if key=='extensions' and isinstance(item,dict):used.update(item)
    if key not in ('extras','extensionsUsed','extensionsRequired'):walk(item)
  elif isinstance(value,list):
   for item in value:walk(item)
 walk(g)
 if used:g['extensionsUsed']=sorted(used)
 else:g.pop('extensionsUsed',None)
 if 'extensionsRequired'in g:
  g['extensionsRequired']=[name for name in g['extensionsRequired'] if name in used]
  if not g['extensionsRequired']:g.pop('extensionsRequired')
 return g
