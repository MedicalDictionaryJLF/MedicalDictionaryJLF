// Optional browser integration suite. Run with Playwright and a WebGL-capable
// Chromium. PT_PLAYWRIGHT_PATH and PT_CHROMIUM_HELPER may point to installed
// test runtimes; they are not production dependencies. Requests are fulfilled
// from the tracked site files, so no production API is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PATIENT_CASES } from '../anamnesis-training/src/cases/index.js';
import { PATIENT_ASSETS } from '../anamnesis-training/src/scene/patientAssets.js';
import { ECG_LEADS } from '../anamnesis-training/src/scene/bedsideInteractions.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PT_PLAYWRIGHT_PATH || 'playwright');
const helper = process.env.PT_CHROMIUM_HELPER ? (await import(process.env.PT_CHROMIUM_HELPER)).default : null;
const launchBrowser = async () => chromium.launch(helper ? { executablePath: await helper.executablePath(), args: helper.args.filter(arg => !['--disable-web-security','--allow-running-insecure-content'].includes(arg)) } : {});
let browser = await launchBrowser();
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://patient-trainer.test';
const mime = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const screenshotDir = process.env.PT_SCREENSHOT_DIR;
const sleepReady = page => page.locator('#avatarMount[data-visual-mode="3d"]').waitFor({ timeout: 30000 });
const errorReady = page => page.locator('#avatarMount .patient3d-error').waitFor({ timeout: 30000 });
const codes = ECG_LEADS.map(lead => lead.id);

async function openPage(options) {
  const context = await browser.newContext(options);
  const faults = { asset: null, mode: null };
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}', headers: { 'access-control-allow-origin': '*' } });
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}${url.pathname.endsWith('/') ? 'index.html' : ''}`);
    if (!file.startsWith(root)) return route.fulfill({ status: 403 });
    if (faults.asset && url.pathname.endsWith(faults.asset)) {
      if (faults.mode === 'missing') return route.fulfill({ status: 404 });
      if (faults.mode === 'corrupt') return route.fulfill({ contentType:'model/gltf-binary', body:'invalid glTF' });
    }
    try { await route.fulfill({ path: file, contentType: mime[path.extname(file)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  const page = await context.newPage();
  const pageErrors = [];
  const apiRequests = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/')) apiRequests.push(pathname);
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/anamnesis-training/?conversationDiagnostics=1`);
  // Attach a test observer to the real renderer for projected marker coordinates.
  await observeRenderer(page);
  return { context, page, faults, pageErrors, apiRequests };
}
async function observeRenderer(page) {
  await page.evaluate(async () => {
    const { Patient3DRenderer } = await import('/anamnesis-training/src/scene/patient3DRenderer.js?v=chat-positioning-1');
    const setup = Patient3DRenderer.prototype.createInspectionPoints;
    Patient3DRenderer.prototype.createInspectionPoints = function(...args) { setup.apply(this, args); window.examTestRenderer = this; };
  });
}
async function start(page, id, mode = 'practice', experience = 'full') {
  if (await page.locator('#restartBtn').isVisible()) await page.locator('#restartBtn').click();
  await page.locator(`button[data-trainer-experience="${experience}"]`).click();
  await page.locator('#caseSelect').selectOption(id);
  await page.locator('#modeSelect').selectOption(mode);
  await page.locator('#startTrainingBtn').click();
}
async function ask(page, question, expected) {
  const messages = page.locator('#chatLog .message.patient');
  const before = await messages.count();
  await page.locator('#questionInput').fill(question);
  await page.locator('#sendQuestionBtn').click();
  await messages.nth(before).waitFor();
  assert.match(await messages.nth(before).innerText(), expected);
}

async function position(page) {
  return page.evaluate(() => window.examTestRenderer.getDiagnostics().position);
}

async function verifyFixedPosition(page, mode) {
  await start(page, 'chest_pain_acs_risk', mode);
  await sleepReady(page);
  assert.equal(await position(page), 'seated');
  assert.deepEqual(await page.locator('.patient3d-toolbar button').allTextContents(), ['Face', 'Patient', 'Room']);
  await page.locator('[data-focus="room"]').click();
  await ask(page, 'Please stand up.', /available in Teaching mode/);
  assert.equal(await position(page), 'seated');
}

async function examination(page, technique, site) {
  await page.locator('[data-exam-tool="'+technique+'"]').click();
  await page.locator('.patient3d-bedside-panel summary').click();
  await page.locator(`[data-exam-site="${site}"]`).press('Enter');
}
async function lead(page, selected, target = selected) {
  await page.locator(`[data-select-lead="${selected}"]`).click();
  await page.locator('.patient3d-bedside-panel summary').click();
  await page.locator(`[data-lead-target="${target}"]`).press('Enter');
}
async function recordCount(page) { return page.locator('.clinical-findings-record .patient3d-observed-finding').count(); }
async function canvasClick(page, site, touch = false, electrode = false) {
  const canvas = page.locator('.patient-3d-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const point = await page.evaluate(({id,electrode}) => {
    const r = window.examTestRenderer, marker = (electrode?r.leadPoints:r.inspectionPoints).find(item => (electrode?item.userData.leadId:item.userData.siteId)===id);
    const p = marker.getWorldPosition(marker.position.clone()).project(r.camera), box = r.canvas.getBoundingClientRect();
    const x = box.left + (p.x+1)*box.width/2, y = box.top + (1-p.y)*box.height/2;
    const hit = document.elementFromPoint(x,y);
    return { x, y, visible: marker.visible, unobstructed: hit === r.canvas, obscurer: hit === r.canvas ? null : hit?.outerHTML.slice(0, 140), box: box.toJSON() };
  },{id:site,electrode});
  assert.ok(point.visible && point.unobstructed, `The ${site} marker is hidden by the layout: ${JSON.stringify(point)}`);
  if (touch) await page.touchscreen.tap(point.x,point.y); else await page.mouse.click(point.x,point.y);
}
async function verifyFailure(page) {
  await errorReady(page);
  assert.equal(await page.locator('#avatarMount strong').textContent(),'3D environment cannot be loaded.');
  assert.equal(await page.locator('#avatarMount canvas, #avatarMount img, #avatarMount svg, #avatarFallback').count(),0);
  assert.equal(await page.locator('#patientBedsideControls .patient3d-bedside-panel').count(),0);
  assert.equal(await page.locator('#openEcgBtn').isEnabled(),false);
  const buttons = await page.locator('[data-exam-tool]').all();
  for (const button of buttons) assert.equal(await button.isEnabled(),false);
}
async function screenshot(page, name) {
  if (!screenshotDir) return;
  await fs.mkdir(screenshotDir,{recursive:true});
  await page.screenshot({path:path.join(screenshotDir,name),quality:92,type:'jpeg',animations:'disabled'});
}
async function handover(page) {
  await page.locator('#finishBtn').click();
  await page.locator('[name="presentation"]').fill('58-year-old man with central chest pressure radiating to the left arm.');
  await page.locator('[name="primaryDiagnosis"]').fill('Inferior STEMI');
  await page.locator('[name="investigations"]').fill('12-lead ECG, troponin, vital signs, FBC, renal function and electrolytes.');
  await page.locator('[name="management"]').fill('Urgent cardiology review, continuous monitoring and IV access.');
  await page.locator('#closingForm button[type="submit"]').click();
  await page.getByText('Clinical encounter score',{exact:true}).waitFor();
}

try {
  if (process.env.PT_BROWSER_SCOPE !== 'mobile') {
  const desktop = await openPage({viewport:{width:1450,height:1000}});
  const { page, faults } = desktop;
  const layout = () => page.evaluate(() => ['.patient-focus-window', '.workspace-window'].map(selector => {
    const { x, width } = document.querySelector(selector).getBoundingClientRect();
    return [Math.round(x), Math.round(width)];
  }));
  await start(page,'chest_pain_acs_risk','practice','anamnesis');
  await sleepReady(page);
  const anamnesisLayout = await layout();
  await ask(page, 'Where exactly is the pain, when did it start, and does it spread anywhere?', /breastbone.*2 hours.*left arm.*jaw/);
  await ask(page, 'And your jaw?', /in my jaw/);
  assert.deepEqual(desktop.apiRequests, []);
  const details = page.locator('#anamnesisDiagnostics');
  assert.equal(await details.getByText('Conversation Diagnostics').count(), 0);
  await details.locator('summary').click();
  await details.locator('#detailsPasswordInput').fill('1379');
  await details.locator('button[type=submit]').click();
  await details.getByText('Conversation Diagnostics', { exact: true }).click();
  await details.getByText('2. And your jaw?', { exact: true }).click();
  assert.match(await details.locator('pre:visible').innerText(), /radiation\.sites/);
  assert.match(await details.locator('pre:visible').innerText(), /"aiCalled": false/);
  await verifyFixedPosition(page, 'practice');
  await verifyFixedPosition(page, 'exam');
  await start(page,'chest_pain_acs_risk','teaching');
  await sleepReady(page);
  assert.equal(await position(page), 'seated');
  assert.equal(await page.locator('[data-position]').count(), 0);
  assert.deepEqual(await layout(), anamnesisLayout, 'Anamnesis and full encounter patient cards must line up');
  console.log('WebGL renderer:',await page.evaluate(()=>{const gl=window.examTestRenderer.renderer.getContext();return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);}));
  await page.locator('#questionInput').fill('What is your main problem?');
  await page.locator('#sendQuestionBtn').click();
  await page.locator('#chatLog .message.patient').waitFor();
  await page.locator('[data-workspace-target="reasoning"]').click();
  await page.locator('[data-note-key="history"]').fill('Software WebGL QA: preserve these clinical notes.');
  await page.locator('#openExamBtn').click();
  assert.deepEqual(await layout(), anamnesisLayout, 'Opening the examination must not move the patient card');
  await page.locator('[data-exam-tool="inspect"]').click();
  await canvasClick(page,'general');
  assert.match(await page.locator('.clinical-findings-record').innerText(),/clammy/i);
  await examination(page,'auscultate','heart-aortic');
  assert.match(await page.locator('.clinical-findings-record').innerText(),/S1 and S2/);
  await page.locator('.patient3d-audio summary').click();
  assert.equal(await page.locator('[data-audio-play]').isVisible(),true);
  await page.locator('[data-audio-stop]').click();
  await examination(page,'percuss','lung-back-right');
  assert.match(await page.locator('.clinical-findings-record').innerText(),/finding unavailable/);
  await examination(page,'palpate','radial-right');
  assert.equal(await recordCount(page),4);
  await page.locator('[data-exam-tool="palpate"]').click();
  await canvasClick(page, 'abdomen-ruq');
  assert.equal(await position(page), 'seated');
  assert.match(await page.locator('.patient3d-message').innerText(), /ask the patient in chat/i);
  await page.locator('[data-workspace-target="interview"]').click();
  await ask(page, 'Hello, would you be able to lie down for me?', /lie on my back/);
  assert.equal(await position(page), 'reclined');
  await ask(page, 'Hello, can you lye down on the bed for me?', /lie on my back/);
  assert.equal(await position(page), 'reclined');
  await ask(page, 'Could you lie on your back and bend your knees slightly?', /knees slightly bent/);
  assert.equal(await position(page), 'abdominal');
  await page.locator('[data-focus="back"]').click();
  assert.equal(await position(page), 'abdominal', 'A camera preset must not change the patient pose');
  await page.locator('#openExamBtn').click();
  await page.locator('[data-exam-tool="palpate"]').click();
  assert.equal(await recordCount(page),4, 'Moving to the bed must not record an examination');
  await screenshot(page,'clinical-exam-abdominal-position.jpg');
  await canvasClick(page, 'abdomen-ruq');
  assert.equal(await recordCount(page),5);
  await page.locator('[data-workspace-target="interview"]').click();
  assert.equal(await page.locator('#patientBedsideControls').isVisible(),false);
  await ask(page, 'can you sit on a chair?', /sit upright/);
  assert.equal(await position(page), 'seated');
  await ask(page, 'Could you get to your feet, please?', /stand up/);
  assert.equal(await position(page), 'standing');
  await page.locator('#openExamBtn').click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await screenshot(page,'clinical-exam-desktop.jpg');
  await page.locator('[data-exam-tool="ecg"]').click();
  assert.equal(await page.locator('#patientBedsideControls .patient3d-bedside-panel').isVisible(),true);
  assert.deepEqual(await layout(), anamnesisLayout, 'The electrode tray must fit the patient column');
  await screenshot(page,'clinical-exam-ecg-targets.jpg');
  await lead(page,'RA','LA');
  assert.match(await page.locator('.patient3d-bedside-panel strong').innerText(),/0\/10/);
  await lead(page,'RA');await lead(page,'LA');
  assert.match(await page.locator('.patient3d-bedside-panel strong').innerText(),/2\/10/);
  await page.evaluate(()=>window.examTestRenderer.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  await verifyFailure(page);
  assert.equal(await recordCount(page),5);
  await screenshot(page,'clinical-exam-failure-desktop.jpg');
  await page.getByRole('button',{name:'Retry loading 3D environment'}).click();
  await sleepReady(page);
  assert.equal(await position(page), 'standing', '3D retry must restore the pose');
  await page.locator('[data-exam-tool="ecg"]').click();
  assert.match(await page.locator('.patient3d-bedside-panel strong').innerText(),/2\/10/);
  // Restore an unfinished session after a full page load.
  await page.reload();await observeRenderer(page);
  await page.getByRole('button',{name:'Continue session'}).first().click();
  await sleepReady(page);
  assert.equal(await recordCount(page),5);
  assert.equal(await page.locator('[data-note-key="history"]').inputValue(),'Software WebGL QA: preserve these clinical notes.');
  assert.equal(await page.locator('#chatLog .message').count(),12);
  assert.equal(await position(page), 'standing', 'Resuming a saved Teaching session must restore the pose');
  await page.locator('[data-workspace-target="interview"]').click();
  await ask(page, 'When did it start?', /2 hours before/);
  await page.locator('#openExamBtn').click();
  assert.deepEqual(desktop.apiRequests, [], 'Ordinary interviews must run without API requests in both trainer modes');
  await page.locator('[data-exam-tool="ecg"]').click();
  for (const id of codes.slice(2)) {
    await page.locator(`[data-select-lead="${id}"]`).click();
    await canvasClick(page, id, false, true);
  }
  await page.locator('#ecgViewerModal.visible').waitFor();
  await page.waitForFunction(()=>{const image=document.querySelector('#ecgRecordingImage');return image.complete&&image.naturalWidth>0;});
  await page.locator('#closeEcgBtn').click();
  await handover(page);
  assert.match(await page.locator('#closingPanel').innerText(),/1 incorrect placements/);
  assert.match(await page.locator('#closingPanel').innerText(),/Case ECG: acquired/);
  await page.locator('#restartBtn').click();
  await page.getByRole('button',{name:'View record'}).first().click();
  assert.match(await page.locator('#patientTrainerRecordContent').innerText(),/Clinical encounter score/);
  assert.equal(desktop.pageErrors.length,0,desktop.pageErrors.join('\n'));
  console.log('Desktop: shared layout, four examination techniques, abdominal positioning, ECG raycast, failure/retry, session restore and stored report PASS');
  await browser.close();
  if (process.env.PT_BROWSER_SCOPE === 'desktop') process.exit(0);
  browser = await launchBrowser();
  }

  const mobile = await openPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  for (const patient of PATIENT_CASES.filter(item=>!process.env.PT_CASE_FILTER||item.id===process.env.PT_CASE_FILTER)) {
    await start(mobile.page,patient.id,'teaching');
    await sleepReady(mobile.page);
    assert.equal(await mobile.page.locator('#avatarMount').getAttribute('data-patient'),PATIENT_ASSETS[patient.id].slug);
    assert.equal(await position(mobile.page), 'seated');
    await ask(mobile.page, 'Please stand up.', /stand up/);
    assert.equal(await position(mobile.page), 'standing');
    await mobile.page.locator('#openExamBtn').click();
    await mobile.page.locator('[data-exam-tool="inspect"]').click();
    await canvasClick(mobile.page,'general',true);
    assert.equal(await recordCount(mobile.page),1,`${patient.id}: tap on general appearance did not record a finding`);
    await mobile.page.locator('[data-workspace-target="interview"]').click();
    await ask(mobile.page, 'Please lie down on the bed.', /lie on my back/);
    assert.equal(await position(mobile.page), 'reclined');
    await ask(mobile.page, 'Bend your knees a little, please.', /knees slightly bent/);
    assert.equal(await position(mobile.page), 'abdominal');
    await mobile.page.locator('#openExamBtn').click();
    await mobile.page.locator('[data-exam-tool="palpate"]').click();
    assert.equal(await recordCount(mobile.page),1, `${patient.id}: positioning recorded a palpation`);
    await canvasClick(mobile.page,'abdomen-ruq',true);
    assert.equal(await recordCount(mobile.page),2,`${patient.id}: RUQ palpation did not record`);
    await mobile.page.locator('[data-workspace-target="interview"]').click();
    await ask(mobile.page, 'Could you take a seat?', /sit upright/);
    await mobile.page.locator('#openExamBtn').click();
    await mobile.page.locator('[data-focus="back"]').click();
    await examination(mobile.page,'percuss','flank-right');
    assert.equal(await recordCount(mobile.page),3,`${patient.id}: renal-angle percussion did not record`);
    await examination(mobile.page,'auscultate','lung-back-left');
    assert.equal(await recordCount(mobile.page),4,`${patient.id}: posterior auscultation did not record`);
    assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Mobile page overflows');
    if(patient.id==='abdominal_pain_cholecystitis') {
      assert.match(await mobile.page.locator('.clinical-findings-record').innerText(),/Right upper quadrant tenderness/);
      await mobile.page.locator('[data-focus="patient"]').click();
      await mobile.page.locator('#avatarMount').scrollIntoViewIfNeeded();
      await screenshot(mobile.page,'clinical-exam-mobile.jpg');
    }
    await mobile.page.locator('[data-exam-tool="ecg"]').click();
    for(const id of codes.slice(0,4)) await lead(mobile.page,id);
    for(const id of codes.slice(4)) {
      await mobile.page.locator(`[data-select-lead="${id}"]`).click();
      await canvasClick(mobile.page,id,true,true);
    }
    if(patient.ecg.available) await mobile.page.locator('#closeEcgBtn').click();
    else assert.equal(await mobile.page.locator('#ecgViewerModal.visible').count(),0);
    assert.match(await mobile.page.locator('.patient3d-bedside-panel strong').innerText(),/10\/10/);
    console.log(`${patient.id}: mobile touch, four modalities, three positions, posterior access, ten ECG electrodes PASS`);
  }
  await mobile.page.locator('#ptSettingsToggle').click();await mobile.page.locator('#ptThemeDark').click();await mobile.page.locator('#ptSettingsClose').click();
  mobile.faults.asset='peter_novak.glb';mobile.faults.mode='missing';
  await start(mobile.page,'chest_pain_acs_risk');await verifyFailure(mobile.page);
  mobile.faults.mode='corrupt';
  await mobile.page.getByRole('button',{name:'Retry loading 3D environment'}).click();await verifyFailure(mobile.page);
  await mobile.page.locator('#openExamBtn').click();await mobile.page.locator('#avatarMount').scrollIntoViewIfNeeded();
  await screenshot(mobile.page,'clinical-exam-failure-mobile-dark.jpg');
  mobile.faults.mode=null;
  await mobile.page.getByRole('button',{name:'Retry loading 3D environment'}).click();await sleepReady(mobile.page);
  assert.equal(await recordCount(mobile.page),0);
  assert.equal(mobile.pageErrors.length,0,mobile.pageErrors.join('\n'));
  console.log('Mobile dark mode: missing GLB, corrupt GLB, successful retry and no false records PASS');
  await mobile.context.close();
} finally { await browser.close(); }
