"""Apply the same bedspread-only elevation to the three editable room sources."""
import argparse,hashlib,json,sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from repair_blend_materials import fingerprint

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def matrices():return {o.name:[list(row) for row in o.matrix_local] for o in bpy.data.objects}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--sources',required=True);p.add_argument('--report',required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);report=Path(args.report);result=json.loads(report.read_text());rows=[]
 for path in sorted(Path(args.sources).glob('room_*.blend')):
  before_sha=sha(path);bpy.ops.wm.open_mainfile(filepath=str(path));bpy.context.view_layer.update();before=fingerprint();before.pop('objects');old_matrices=matrices();cover=bpy.data.objects['FoldedCover'];old=list(cover.location)
  if abs(old[2])<1e-8:cover.location.z+=.035
  elif abs(old[2]-.035)>1e-7:raise ValueError('Unexpected room source cover height: '+path.name)
  bpy.context.view_layer.update();after=fingerprint();after.pop('objects');assert before==after
  new_matrices=matrices();changed=[name for name in old_matrices if old_matrices[name]!=new_matrices[name]];assert changed in ([],['FoldedCover'])
  row={'file':str(path),'beforeSha256':before_sha,'translationBefore':old,'onlyObjectTransformChanged':'FoldedCover','geometryRigAnimationPackedImagesUnchanged':True,'preserved':before};rows.append(row);result['sources']=rows;report.write_text(json.dumps(result,indent=2)+'\n')
  if changed:
   bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
  after_sha=sha(path)
  bpy.ops.wm.open_mainfile(filepath=str(path));bpy.context.view_layer.update();reopened=fingerprint();reopened.pop('objects');assert reopened==before and matrices()==new_matrices
  row.update({'afterSha256':after_sha,'translationAfter':list(bpy.data.objects['FoldedCover'].location),'savedFileReopenedAndVerified':True})
  result['sources']=rows;result['patientSourcesChanged']=False;report.write_text(json.dumps(result,indent=2)+'\n');print('SOURCE_BEDDING_RAISED',path.name,flush=True)
