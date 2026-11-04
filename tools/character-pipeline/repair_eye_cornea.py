"""Split eye index triangles by atlas region; no anatomy or animation rebuild.

The MakeHuman high-poly eye's blue atlas corner belongs to a separate outer
corneal shell. Its alpha was lost in legacy JPEG conversion. Assign only that
surface a fully clear MASK material while preserving the original iris/sclera.
"""
import argparse,copy,json,struct
from pathlib import Path
from material_policy import ALPHA_CUTOFF,CORNEA_MATERIAL
from repair_materials import accessor_signature,fingerprint,read,sha,write
from finalize_glb import canonicalize_gltf,compact

def values(g,data,index):
 a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];code={5121:'B',5123:'H',5125:'I',5126:'f'}[a['componentType']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];step=struct.calcsize('<'+code*width);stride=v.get('byteStride',step);offset=v.get('byteOffset',0)+a.get('byteOffset',0)
 assert 'sparse' not in a
 return [struct.unpack_from('<'+code*width,data,offset+i*stride) for i in range(a['count'])]

def triangle_fingerprint(g,data):
 """Exact attribute/morph buffers and oriented index-triangle multiset.

 Primitive grouping/material assignment is intentionally excluded; triangles,
 vertex order, winding, duplicate multiplicity and all attribute bytes remain.
 """
 meshes=[]
 for mesh in g.get('meshes',[]):
  groups={}
  for primitive in mesh['primitives']:
   assert primitive.get('mode',4)==4
   attrs={k:accessor_signature(g,data,i) for k,i in primitive['attributes'].items() if k!='TANGENT'};targets=[{k:accessor_signature(g,data,i) for k,i in t.items()} for t in primitive.get('targets',[])];key=json.dumps([attrs,targets],sort_keys=True,separators=(',',':'))
   indices=[row[0] for row in values(g,data,primitive['indices'])] if 'indices'in primitive else list(range(g['accessors'][primitive['attributes']['POSITION']]['count']))
   groups.setdefault(key,[]).extend(tuple(indices[i:i+3]) for i in range(0,len(indices),3))
  meshes.append({'name':mesh.get('name'),'weights':mesh.get('weights'),'extras':mesh.get('extras'),'groups':[(key,sorted(triangles)) for key,triangles in sorted(groups.items())]})
 return sha(json.dumps(meshes,sort_keys=True,separators=(',',':')).encode())

def preservation(g,data):
 result=fingerprint(g,data);result['geometry']=triangle_fingerprint(g,data)
 # Clear material is intentionally added; preserve every original albedo row.
 trimmed=copy.deepcopy(g);trimmed['materials']=[m for m in g['materials'] if m.get('name')!=CORNEA_MATERIAL];result['albedos']=fingerprint(trimmed,data)['albedos']
 return result

def add_indices(g,data,template,indices):
 original=g['accessors'][template];code={5121:'B',5123:'H',5125:'I'}[original['componentType']];data.extend(b'\0'*((-len(data))%4));start=len(data);data.extend(struct.pack('<'+code*len(indices),*indices));view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(data)-start,'target':34963});accessor=len(g['accessors']);g['accessors'].append({'bufferView':view,'componentType':original['componentType'],'count':len(indices),'type':'SCALAR','min':[min(indices)],'max':[max(indices)]});return accessor

def repair(path):
 g,data,blob=read(path);before=preservation(g,data);changes=[]
 clear_index=next((i for i,m in enumerate(g['materials']) if m.get('name')==CORNEA_MATERIAL),None)
 for mesh in g['meshes']:
  added=[]
  for primitive in list(mesh['primitives']):
   material=g['materials'][primitive['material']]
   if not material.get('name','').startswith('PatientBody.high-poly'):continue
   uv=values(g,data,primitive['attributes']['TEXCOORD_0']);indices=[row[0] for row in values(g,data,primitive['indices'])];shell=[];inner=[];mixed=0
   for i in range(0,len(indices),3):
    triangle=indices[i:i+3];corner=[uv[v][0]>.87 and uv[v][1]>.87 for v in triangle]
    if any(corner) and not all(corner):mixed+=1
    (shell if all(corner) else inner).extend(triangle)
   if not shell:continue
   if mixed:raise RuntimeError('Refusing mixed atlas boundary in '+str(path))
   if clear_index is None:
    clear_index=len(g['materials']);g['materials'].append({'name':CORNEA_MATERIAL,'alphaMode':'MASK','alphaCutoff':ALPHA_CUTOFF,'doubleSided':False,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,0],'metallicFactor':0,'roughnessFactor':1}})
   mutable=bytearray(data);source=primitive['indices'];primitive['indices']=add_indices(g,mutable,source,inner);clear=copy.deepcopy(primitive);clear['indices']=add_indices(g,mutable,source,shell);clear['material']=clear_index;added.append(clear);data=bytes(mutable)
   changes.append({'mesh':mesh.get('name'),'innerTriangles':len(inner)//3,'clearShellTriangles':len(shell)//3,'mixedBoundaryTriangles':mixed,'sharedVertexAndMorphAccessors':True})
  mesh['primitives'].extend(added)
 g=canonicalize_gltf(g,data);g,data=compact(g,data);after=preservation(g,data)
 if before!=after:raise RuntimeError('Refusing triangle/attribute/animation/albedo change: '+str([key for key in before if before[key]!=after[key]]))
 fixed=write(path,g,data)
 return {'file':str(path),'beforeSha256':sha(blob),'afterSha256':sha(fixed),'bytesBefore':len(blob),'bytesAfter':len(fixed),'preserved':before,'semanticDataUnchanged':before==after,'preservationDefinition':'Geometry hash preserves exact attribute and morph bytes plus oriented triangle multiset; only primitive/material grouping changes. All original albedo image bytes, rig and animations stay exact.','changes':changes}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--assets',required=True);p.add_argument('--report',required=True);args=p.parse_args();root=Path(args.assets);rows=[]
 for folder in ('patients','scenes'):
  for path in sorted((root/folder).glob('*.glb')):
   rows.append(repair(path));print('CORNEA_MATERIAL_REPAIRED',path.name,flush=True)
 Path(args.report).write_text(json.dumps({'material':CORNEA_MATERIAL,'policy':{'alphaMode':'MASK','alphaCutoff':ALPHA_CUTOFF,'alpha':0,'doubleSided':False},'files':rows,'roomAssetsChanged':False},indent=2)+'\n')
