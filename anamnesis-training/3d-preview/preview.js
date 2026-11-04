import { PATIENT_CASES } from '../src/cases/index.js';
import { Patient3DRenderer } from '../src/scene/patient3DRenderer.js?v=clinical-3d-3';
import { PatientStateEngine } from '../src/patientState.js';
import { PatientEngine } from '../src/patientEngine.js';
import { getPatientAsset } from '../src/scene/patientAssets.js?v=clinical-3d-3';
import { speak, stopSpeaking } from '../src/speech.js';

const $=id=>document.getElementById(id);
let renderer,patientState,interview,activeCase,generation=0,unsubscribe,talkTimer;
for(const [i,c] of PATIENT_CASES.entries())$('patientSelect').append(new Option(`${String(i+1).padStart(2,'0')} · ${c.identity.name}`,c.id));
const requested=new URLSearchParams(location.search).get('case');if(PATIENT_CASES.some(c=>c.id===requested))$('patientSelect').value=requested;

async function loadCase(){
  const token=++generation;clearTimeout(talkTimer);stopSpeaking();unsubscribe?.();renderer?.dispose();
  enableVisualControls(false);
  activeCase=PATIENT_CASES.find(c=>c.id===$('patientSelect').value) || PATIENT_CASES[0];patientState=new PatientStateEngine(activeCase);interview=new PatientEngine(activeCase);
  const index=PATIENT_CASES.indexOf(activeCase),asset=getPatientAsset(activeCase);
  $('patientNumber').textContent=`CASE ${String(index+1).padStart(2,'0')} / 08`;$('patientName').textContent=activeCase.identity.name;$('patientIdentity').textContent=`${activeCase.identity.age} years · ${activeCase.identity.sex} · ${activeCase.identity.residence}`;$('patientComplaint').textContent=activeCase.chiefComplaint;$('roomLabel').textContent=activeCase.stationBrief.location;$('viewTitle').textContent=asset.room==='acute'?'Emergency assessment':asset.room==='internal'?'Internal medicine':'Examination room';$('loadBadge').textContent='Loading patient';$('findingPanel').hidden=true;$('previewReply').textContent=activeCase.openingLine;
  const current=new Patient3DRenderer($('patientViewer'),{activeCase,initialView:'patient',quality:$('qualitySelect').value,onExamination:showFinding,onEcgComplete:showEcgCompletion});renderer=current;
  try{
    await current.init();if(token!==generation){current.dispose();return;}
    unsubscribe=patientState.subscribe(snapshot=>current.setSnapshot(snapshot));$('loadBadge').textContent='Interactive · ready';
    enableVisualControls(true);
    $('animationSelect').replaceChildren(new Option('Follow clinical state',''),...current.animationNames.map(n=>new Option(n.replace(/([a-z])([A-Z])/g,'$1 $2'),n)));updateDetails();
    history.replaceState(null,'',`?case=${encodeURIComponent(activeCase.id)}`);
  }catch(error){if(token!==generation)return;$('loadBadge').textContent='Scene unavailable';$('patientViewer').replaceChildren(Object.assign(document.createElement('p'),{className:'preview-error',textContent:`The 3D scene could not load: ${error.message.replace(/\.+$/,'')}. A WebGL 2 capable browser is required.`}));console.error(error);current.dispose();}
}
function enableVisualControls(enabled){document.querySelectorAll('[data-mode],#animationSelect,#resetAnimation,#qualitySelect').forEach(control=>{control.disabled=!enabled;});}
function updateDetails(){if(renderer)$('assetDetails').textContent=JSON.stringify(renderer.getDiagnostics(),null,2);}
function showFinding(detail){$('findingTitle').textContent=`${detail.siteLabel} · ${detail.technique}`;$('findingText').textContent=[detail.finding,detail.audioNote].filter(Boolean).join(' ');$('findingPanel').hidden=false;updateDetails();}
function showEcgCompletion(detail){$('findingTitle').textContent='12-lead placement complete';$('findingText').textContent=detail.hasRecording?'All 10 electrodes are placed. This case has a supplied ECG recording in the full encounter.':'All 10 electrodes are placed. No case-specific ECG tracing is supplied for this patient.';$('findingPanel').hidden=false;updateDetails();}
$('patientSelect').addEventListener('change',loadCase);$('qualitySelect').addEventListener('change',e=>{renderer?.setQuality(e.target.value);updateDetails();});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{renderer?.setClinicalMode(b.dataset.mode);$('animationSelect').value='';document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));updateDetails();}));
$('animationSelect').addEventListener('change',e=>{if(e.target.value)renderer?.playAnimation(e.target.value);else renderer?.setClinicalMode('case');updateDetails();});
$('resetAnimation').addEventListener('click',()=>{renderer?.setClinicalMode('case');$('animationSelect').value='';document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode==='case')));updateDetails();});
$('previewQuestionForm').addEventListener('submit',e=>{e.preventDefault();if(!interview)return;const text=$('previewQuestion').value.trim();if(!text)return;clearTimeout(talkTimer);stopSpeaking();const result=interview.ask(text),reply=result.reply,visual=renderer?.loaded?renderer:null;$('previewReply').textContent=reply;visual?.reactToReply(reply,result);if($('previewVoice').checked){speak(reply,activeCase,{onStart:()=>visual?.setSpeaking(true,reply),onBoundary:event=>visual?.pulseSpeechBoundary(event),onEnd:()=>visual?.setSpeaking(false),onError:()=>visual?.setSpeaking(false)});}else if(visual){visual.setSpeaking(true,reply);talkTimer=setTimeout(()=>visual.setSpeaking(false),Math.min(12000,Math.max(1800,reply.length*52)));}updateDetails();});
window.addEventListener('pagehide',()=>{clearTimeout(talkTimer);stopSpeaking();unsubscribe?.();renderer?.dispose();});
if(matchMedia('(max-width:700px)').matches)$('qualitySelect').value='mobile';
await loadCase();
