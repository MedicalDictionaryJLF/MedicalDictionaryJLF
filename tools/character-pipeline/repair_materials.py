"""Repair already exported patient GLBs without rebuilding their anatomy.

Verifies semantic geometry, skin/animation data and every albedo byte before
atomically replacing each file. Uses Pillow only for a human-readable image audit.
"""
import argparse,copy,hashlib,io,json,struct
from pathlib import Path
from PIL import Image
from material_policy import apply_material_policy,CORNEA_MATERIAL,is_character_material,is_cutout
from finalize_glb import canonicalize_gltf,compact

def sha(data):return hashlib.sha256(data).hexdigest()
def read(path):
 blob=Path(path).read_bytes();assert blob[:4]==b'glTF' and len(blob)==struct.unpack_from('<I',blob,8)[0]
 n=struct.unpack_from('<I',blob,12)[0];return json.loads(blob[20:20+n]),blob[28+n:],blob

def bv(g,data,index):
 v=g['bufferViews'][index];start=v.get('byteOffset',0);return bytes(data[start:start+v['byteLength']])
def accessor_signature(g,data,index):
 a=copy.deepcopy(g['accessors'][index]);chunks=[]
 if 'bufferView'in a:chunks.append(bv(g,data,a.pop('bufferView')))
 if 'sparse'in a:
  for kind in ('indices','values'):chunks.append(bv(g,data,a['sparse'][kind].pop('bufferView')))
 return sha(json.dumps(a,sort_keys=True,separators=(',',':')).encode()+b''.join(chunks))
def image_data(g,data,index):
 im=g['images'][index];return bv(g,data,im['bufferView'])
def fingerprint(g,data):
 meshes=[]
 for m in g.get('meshes',[]):
  primitives=[]
  for p in m['primitives']:
   row={'attributes':{k:accessor_signature(g,data,i) for k,i in p['attributes'].items() if k!='TANGENT'},'targets':[{k:accessor_signature(g,data,i) for k,i in t.items()} for t in p.get('targets',[])],'mode':p.get('mode',4)}
   if 'indices'in p:row['indices']=accessor_signature(g,data,p['indices'])
   primitives.append(row)
  meshes.append({'name':m.get('name'),'primitives':primitives,'weights':m.get('weights'),'extras':m.get('extras')})
 animations=[]
 for a in g.get('animations',[]):
  channels=[]
  for c in a['channels']:
   s=a['samplers'][c['sampler']];channels.append({'target':c['target'],'interpolation':s.get('interpolation','LINEAR'),'input':accessor_signature(g,data,s['input']),'output':accessor_signature(g,data,s['output'])})
  animations.append({'name':a.get('name'),'channels':channels})
 skins=[]
 for skin in g.get('skins',[]):
  s=copy.deepcopy(skin)
  if 'inverseBindMatrices'in s:s['inverseBindMatrices']=accessor_signature(g,data,s['inverseBindMatrices'])
  skins.append(s)
 albedos=[]
 for m in g.get('materials',[]):
  pbr=m.get('pbrMetallicRoughness',{});row={'material':m.get('name'),'baseColorFactor':pbr.get('baseColorFactor',[1,1,1,1])}
  if 'baseColorTexture'in pbr:
   info=copy.deepcopy(pbr['baseColorTexture']);tex=g['textures'][info.pop('index')];row['textureInfo']=info;row['encodedImageSha256']=sha(image_data(g,data,tex['source']));row['mimeType']=g['images'][tex['source']].get('mimeType');row['sampler']=g.get('samplers',[])[tex['sampler']] if 'sampler'in tex else None
  albedos.append(row)
 def digest(value):return sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())
 return {'geometry':digest(meshes),'animations':digest(animations),'skins':digest(skins),'nodesAndScenes':digest([g.get('nodes'),g.get('scenes')]),'albedos':digest(albedos)}

def texture_audit(g,data):
 rows=[]
 for m in g.get('materials',[]):
  if not is_character_material(m.get('name','')):continue
  row={'material':m['name'],'alphaMode':m.get('alphaMode','OPAQUE'),'doubleSided':m.get('doubleSided',False),'alphaCutoff':m.get('alphaCutoff')}
  for slot,info in [('albedo',m.get('pbrMetallicRoughness',{}).get('baseColorTexture')),('normal',m.get('normalTexture'))]:
   if not info:continue
   tex=g['textures'][info['index']];encoded=image_data(g,data,tex['source']);im=Image.open(io.BytesIO(encoded));im.load();rgb=im.convert('RGB');stat={'width':im.width,'height':im.height,'mode':im.mode,'rgbExtrema':rgb.getextrema(),'encodedSha256':sha(encoded)}
   if 'A'in im.getbands():stat['alphaExtrema']=im.getchannel('A').getextrema()
   row[slot]=stat
  rows.append(row)
 return rows

def write(path,g,data):
 g['buffers'][0]['byteLength']=len(data);raw=json.dumps(g,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
 data+=b'\0'*((-len(data))%4);blob=struct.pack('<4sII',b'glTF',2,28+len(raw)+len(data))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(data),b'BIN\0')+data
 p=Path(path);temp=p.with_suffix(p.suffix+'.material-repair.tmp');temp.write_bytes(blob);temp.replace(p)
 return blob

def repair(path):
 old,old_bin,old_blob=read(path);before=fingerprint(old,old_bin);before_audit=texture_audit(old,old_bin)
 g=copy.deepcopy(old);changes=apply_material_policy(g,old_bin);g=canonicalize_gltf(g,old_bin);g,data=compact(g,old_bin)
 after=fingerprint(g,data)
 if before!=after:raise RuntimeError(f'Refusing geometry/animation/albedo change in {path}: '+str([key for key in before if before[key]!=after[key]]))
 for m in g['materials']:
  if not is_character_material(m.get('name','')):continue
  if m['name']==CORNEA_MATERIAL:assert m['alphaMode']=='MASK' and not m['doubleSided'] and m['pbrMetallicRoughness']['baseColorFactor'][3]==0
  elif is_cutout(m['name']):assert m['alphaMode']=='MASK' and m['doubleSided'] and abs(m['alphaCutoff']-.34)<1e-6
  else:assert m['alphaMode']=='OPAQUE' and (m.get('doubleSided') is False or m['name'].startswith('WardCotton'))
 new_blob=write(path,g,data);after_audit=texture_audit(g,data)
 return {'file':str(path),'beforeSha256':sha(old_blob),'afterSha256':sha(new_blob),'bytesBefore':len(old_blob),'bytesAfter':len(new_blob),'preserved':before,'semanticDataUnchanged':before==after,'changes':changes,'beforeMaterials':before_audit,'afterMaterials':after_audit}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--assets',required=True);p.add_argument('--report',required=True);args=p.parse_args();root=Path(args.assets);rows=[]
 for folder in ('patients','scenes'):
  for file in sorted((root/folder).glob('*.glb')):
   row=repair(file);rows.append(row);print('MATERIAL_REPAIRED',file.name,'preserved anatomy/animation/albedo',flush=True)
 result={'repair':'Depth-safe anatomy, alpha-masked hair, invalid black-normal removal','files':rows,'roomAssetsChanged':False};out=Path(args.report);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
