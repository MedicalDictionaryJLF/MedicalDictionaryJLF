"""Raise only the room bedspread node 35 mm; preserve every GLB binary byte."""
import argparse,copy,hashlib,json,math,struct
from pathlib import Path
import numpy as np

SHIFT=.035
def sha(data):return hashlib.sha256(data).hexdigest()
def local_matrix(node):
 if 'matrix'in node:return np.array(node['matrix']).reshape(4,4).T
 x,y,z,w=node.get('rotation',[0,0,0,1]);m=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w,0],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w,0],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y,0],[0,0,0,1]],dtype=float);m[:3,:3]*=node.get('scale',[1,1,1]);m[:3,3]=node.get('translation',[0,0,0]);return m
def world_bounds(g,data,name):
 parents={child:i for i,n in enumerate(g['nodes']) for child in n.get('children',[])};index=next(i for i,n in enumerate(g['nodes']) if n.get('name')==name);matrix=local_matrix(g['nodes'][index]);ancestor=index
 while ancestor in parents:ancestor=parents[ancestor];matrix=local_matrix(g['nodes'][ancestor])@matrix
 points=[]
 for primitive in g['meshes'][g['nodes'][index]['mesh']]['primitives']:
  a=g['accessors'][primitive['attributes']['POSITION']];v=g['bufferViews'][a['bufferView']];assert a['componentType']==5126 and a['type']=='VEC3';offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',12)
  for i in range(a['count']):points.append(matrix@np.array([*struct.unpack_from('<fff',data,offset+i*stride),1]))
 p=np.array(points)[:,:3];return {'min':p.min(axis=0).tolist(),'max':p.max(axis=0).tolist()}
def repair(path):
 blob=path.read_bytes();size=struct.unpack_from('<I',blob,12)[0];g=json.loads(blob[20:20+size]);tail=blob[20+size:];data=tail[8:];before=copy.deepcopy(g);cover=next(n for n in g['nodes'] if n.get('name')=='FoldedCover');old=cover.get('translation',[0,0,0]);assert 'matrix' not in cover and len(old)==3
 if abs(old[1])<1e-8:cover['translation']=[old[0],old[1]+SHIFT,old[2]]
 elif abs(old[1]-SHIFT)>1e-8:raise ValueError('Unexpected bedspread height in '+str(path))
 check=copy.deepcopy(g);next(n for n in check['nodes'] if n.get('name')=='FoldedCover').pop('translation',None)
 original=copy.deepcopy(before);next(n for n in original['nodes'] if n.get('name')=='FoldedCover').pop('translation',None);assert check==original
 initial_cover=world_bounds(before,data,'FoldedCover');mattress=world_bounds(g,data,'Mattress');final_cover=world_bounds(g,data,'FoldedCover');clearance=final_cover['min'][1]-mattress['max'][1];assert clearance>.03
 raw=json.dumps(g,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);fixed=struct.pack('<4sII',b'glTF',2,20+len(raw)+len(tail))+struct.pack('<I4s',len(raw),b'JSON')+raw+tail
 temp=path.with_suffix('.glb.bedding-repair.tmp');temp.write_bytes(fixed);temp.replace(path);assert fixed[20+len(raw):]==tail
 return {'file':str(path),'beforeSha256':sha(blob),'afterSha256':sha(fixed),'binarySha256':sha(data),'binaryBytesUnchanged':True,'onlyFoldedCoverTranslationChanged':True,'translationBefore':old,'translationAfter':cover['translation'],'coverBoundsBefore':initial_cover,'coverBoundsAfter':final_cover,'mattressBounds':mattress,'minimumClearanceMeters':clearance}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--assets',required=True);p.add_argument('--report',required=True);args=p.parse_args();root=Path(args.assets);rows=[]
 for folder in ('environments','scenes'):
  for path in sorted((root/folder).glob('*.glb')):rows.append(repair(path));print('BEDDING_RAISED',path.name,flush=True)
 Path(args.report).write_text(json.dumps({'shiftMeters':SHIFT,'scope':'3 room and 8 combined GLBs; metadata node translation only','patientAssetsChanged':False,'files':rows},indent=2)+'\n')
