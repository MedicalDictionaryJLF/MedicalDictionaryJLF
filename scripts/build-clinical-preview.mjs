// A private static preview. The original application's source index is preserved.
import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd(),out=path.join(root,'dist');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const excluded=new Set(['dist','node_modules','api','scripts','tools','docs','standalone']);
for(const entry of await fs.readdir(root,{withFileTypes:true})){
  if(entry.name.startsWith('.')||excluded.has(entry.name))continue;
  if(entry.isFile()&&!/\.(html|css|js|json|svg|png|jpg|jpeg|ico|webmanifest|txt)$/i.test(entry.name))continue;
  if(['package.json','package-lock.json','vite.config.mjs'].includes(entry.name))continue;
  await fs.cp(path.join(root,entry.name),path.join(out,entry.name),{recursive:true});
}
// Combined GLBs and editable sources are downloadable release artifacts. The
// interactive viewer loads only individual characters and one reusable room.
await fs.rm(path.join(out,'anamnesis-training/assets/3d/clinical/scenes'),{recursive:true,force:true});
await fs.copyFile(path.join(root,'index.html'),path.join(out,'medical-dictionary-entry.html'));
await fs.writeFile(path.join(out,'index.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./anamnesis-training/3d-preview/?v=clinical-3d-3"><title>Medical Dictionary · 3D Patient Trainer</title></head><body><a href="./anamnesis-training/3d-preview/?v=clinical-3d-3">Open the 3D Patient Trainer</a></body></html>\n');
console.log('Private clinical preview prepared in dist/.');
