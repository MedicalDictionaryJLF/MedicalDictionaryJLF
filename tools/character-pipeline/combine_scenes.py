"""Lossless glTF merger; keeps character clips, weights and embedded maps intact."""
import argparse,copy,json,struct
from pathlib import Path

def read(path):
 blob=Path(path).read_bytes();n=struct.unpack_from('<I',blob,12)[0];return json.loads(blob[20:20+n]),blob[28+n:]
def write(path,g,data):
 g['buffers']=[{'byteLength':len(data)}];raw=json.dumps(g,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);data+=b'\0'*((-len(data))%4)
 Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,28+len(raw)+len(data))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(data),b'BIN\0')+data)
def merge(patient,environment,out):
 a,ab=read(patient);b,bb=read(environment);g=copy.deepcopy(a);fields=['bufferViews','accessors','images','samplers','textures','materials','meshes','nodes','skins','animations'];offsets={k:len(a.get(k,[])) for k in fields};base=len(ab);base+=(4-base%4)%4;data=ab+b'\0'*(base-len(ab))+bb
 for v in b.get('bufferViews',[]):v['buffer']=0;v['byteOffset']=v.get('byteOffset',0)+base
 for accessor in b.get('accessors',[]):
  if 'bufferView' in accessor:accessor['bufferView']+=offsets['bufferViews']
  for v in accessor.get('sparse',{}).values():
   if isinstance(v,dict) and 'bufferView' in v:v['bufferView']+=offsets['bufferViews']
 for im in b.get('images',[]):
  if 'bufferView' in im:im['bufferView']+=offsets['bufferViews']
 for tex in b.get('textures',[]):
  if 'source' in tex:tex['source']+=offsets['images']
  if 'sampler' in tex:tex['sampler']+=offsets['samplers']
 def texture_indices(value):
  if isinstance(value,dict):
   for key,item in value.items():
    if key=='index' and isinstance(item,int):value[key]=item+offsets['textures']
    else:texture_indices(item)
  elif isinstance(value,list):
   for item in value:texture_indices(item)
 for m in b.get('materials',[]):texture_indices(m)
 for mesh in b.get('meshes',[]):
  for pr in mesh['primitives']:
   pr['attributes']={k:v+offsets['accessors'] for k,v in pr['attributes'].items()}
   if 'indices' in pr:pr['indices']+=offsets['accessors']
   if 'material' in pr:pr['material']+=offsets['materials']
   for target in pr.get('targets',[]):
    for key in target:target[key]+=offsets['accessors']
 for node in b.get('nodes',[]):
  if 'children' in node:node['children']=[i+offsets['nodes'] for i in node['children']]
  for field,table in [('mesh','meshes'),('skin','skins')]:
   if field in node:node[field]+=offsets[table]
 for skin in b.get('skins',[]):
  skin['joints']=[i+offsets['nodes'] for i in skin['joints']]
  if 'skeleton' in skin:skin['skeleton']+=offsets['nodes']
  if 'inverseBindMatrices' in skin:skin['inverseBindMatrices']+=offsets['accessors']
 for anim in b.get('animations',[]):
  for s in anim['samplers']:s['input']+=offsets['accessors'];s['output']+=offsets['accessors']
  for c in anim['channels']:c['target']['node']+=offsets['nodes']
 for field in fields:g.setdefault(field,[]).extend(b.get(field,[]))
 g['scenes']=[{'name':'PatientAndHospitalRoom','nodes':a['scenes'][a.get('scene',0)]['nodes']+[n+offsets['nodes'] for n in b['scenes'][b.get('scene',0)]['nodes']]}];g['scene']=0;g['asset']['generator']='Medical Dictionary Clinical 3D · lossless scene assembler';g['extensionsUsed']=sorted(set(a.get('extensionsUsed',[])+b.get('extensionsUsed',[])));write(out,g,data)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--assets',required=True);p.add_argument('--definitions',required=True);args=p.parse_args();root=Path(args.assets);out=root/'scenes';out.mkdir(exist_ok=True)
 for d in json.loads(Path(args.definitions).read_text()):
  room='acute' if d['slug'] in ['peter_novak','jana_kovacova','lucia_benkova','karol_urban'] else 'internal' if d['slug'] in ['milan_hronec','eva_sykorova'] else 'examination';merge(root/'patients'/(d['slug']+'.glb'),root/'environments'/(room+'.glb'),out/(d['slug']+'_hospital.glb'));print('SCENE',d['slug'])
