const TEXT_SIZES = [13,14,15,16,17,18,19];
const LANG_KEY = 'app_language';
const THEME_KEY = 'app_theme';
const SIZE_KEY = 'text_size';

const I18N = {
  English: {
    clinical_workspace:'Clinical Study Workspace', patient_trainer:'Patient Trainer', study_workspace:'Study workspace',
    home:'Home', search:'Search', search_anything:'Search anything', reference:'Reference', pharmacology:'Pharmacology', anatomy:'Anatomy', laboratory:'Laboratory', latin:'Latin', study:'Study', quiz:'Quiz', flashcards:'Flashcards', courses:'Courses', biophysics:'Biophysics True/False', clinical:'Clinical', anamnesis:'Anamnesis', add_term:'Add term', settings:'Settings', language:'Language', text_size:'Text size', theme:'Theme', light:'Light', dark:'Dark',
    medical_education_simulator:'Medical Education Simulator', choose_training:'Choose how you want to train', choose_training_desc:'Keep the current anamnesis trainer focused, or preview the larger clinical encounter that is still being built.', anamnesis_only:'Anamnesis only', anamnesis_only_desc:'Take a complete history from the patient. Interview, track covered topics, and keep a structured worksheet.', available:'Available', anamnesis_exam:'Anamnesis + examination', anamnesis_exam_desc:'Full encounter with examination, investigations, reasoning and handover.', under_development:'Under development', station_setup:'Station setup', configure_attempt:'Configure your attempt', random_case:'Random case', case:'Case', difficulty:'Difficulty', regime:'Regime', start_anamnesis:'Start anamnesis', new_scenario:'New scenario', finish_anamnesis:'Finish anamnesis', anamnesis_companion:'Anamnesis companion', history_overview:'History overview', topics:'Topics', worksheet:'Worksheet', overview:'Overview', anamnesis_debrief:'Anamnesis debrief', history_review:'History review', close:'Close'
  },
  Deutsch: {
    clinical_workspace:'Klinischer Lernbereich', patient_trainer:'Patiententrainer', study_workspace:'Lernbereich',
    home:'Start', search:'Suche', search_anything:'Alles durchsuchen', reference:'Nachschlagen', pharmacology:'Pharmakologie', anatomy:'Anatomie', laboratory:'Labor', latin:'Latein', study:'Lernen', quiz:'Quiz', flashcards:'Karteikarten', courses:'Kurse', biophysics:'Biophysik Richtig/Falsch', clinical:'Klinisch', anamnesis:'Anamnese', add_term:'Begriff hinzufügen', settings:'Einstellungen', language:'Sprache', text_size:'Textgröße', theme:'Design', light:'Hell', dark:'Dunkel',
    medical_education_simulator:'Medizinischer Trainingssimulator', choose_training:'Wähle deinen Trainingsmodus', choose_training_desc:'Nutze den fokussierten Anamnesetrainer oder sieh dir den noch in Entwicklung befindlichen vollständigen klinischen Ablauf an.', anamnesis_only:'Nur Anamnese', anamnesis_only_desc:'Erhebe eine vollständige Anamnese, verfolge abgedeckte Themen und führe ein strukturiertes Arbeitsblatt.', available:'Verfügbar', anamnesis_exam:'Anamnese + Untersuchung', anamnesis_exam_desc:'Vollständige Station mit Untersuchung, Diagnostik, klinischem Denken und Übergabe.', under_development:'In Entwicklung', station_setup:'Stationssetup', configure_attempt:'Versuch konfigurieren', random_case:'Zufallsfall', case:'Fall', difficulty:'Schwierigkeit', regime:'Modus', start_anamnesis:'Anamnese starten', new_scenario:'Neuer Fall', finish_anamnesis:'Anamnese beenden', anamnesis_companion:'Anamnese-Begleiter', history_overview:'Anamneseübersicht', topics:'Themen', worksheet:'Arbeitsblatt', overview:'Übersicht', anamnesis_debrief:'Anamnese-Auswertung', history_review:'Anamnese-Rückblick', close:'Schließen'
  },
  Slovensky: {
    clinical_workspace:'Klinický študijný priestor', patient_trainer:'Trenažér pacienta', study_workspace:'Študijný priestor',
    home:'Domov', search:'Vyhľadávanie', search_anything:'Vyhľadať čokoľvek', reference:'Referencie', pharmacology:'Farmakológia', anatomy:'Anatómia', laboratory:'Laboratórium', latin:'Latinčina', study:'Štúdium', quiz:'Kvíz', flashcards:'Kartičky', courses:'Kurzy', biophysics:'Biofyzika Pravda/Nepravda', clinical:'Klinika', anamnesis:'Anamnéza', add_term:'Pridať termín', settings:'Nastavenia', language:'Jazyk', text_size:'Veľkosť textu', theme:'Téma', light:'Svetlá', dark:'Tmavá',
    medical_education_simulator:'Medicínsky výučbový simulátor', choose_training:'Vyberte spôsob tréningu', choose_training_desc:'Použite zameraný tréning anamnézy alebo si pozrite širší klinický režim, ktorý je ešte vo vývoji.', anamnesis_only:'Iba anamnéza', anamnesis_only_desc:'Odoberte kompletnú anamnézu, sledujte prebrané témy a zapisujte si ich do štruktúrovaného pracovného listu.', available:'Dostupné', anamnesis_exam:'Anamnéza + vyšetrenie', anamnesis_exam_desc:'Kompletné stretnutie s vyšetrením, diagnostikou, klinickým uvažovaním a odovzdaním pacienta.', under_development:'Vo vývoji', station_setup:'Nastavenie stanice', configure_attempt:'Nastaviť pokus', random_case:'Náhodný prípad', case:'Prípad', difficulty:'Náročnosť', regime:'Režim', start_anamnesis:'Začať anamnézu', new_scenario:'Nový prípad', finish_anamnesis:'Ukončiť anamnézu', anamnesis_companion:'Pomocník anamnézy', history_overview:'Prehľad anamnézy', topics:'Témy', worksheet:'Pracovný list', overview:'Prehľad', anamnesis_debrief:'Vyhodnotenie anamnézy', history_review:'Zhodnotenie anamnézy', close:'Zavrieť'
  }
};

function canonicalLanguage(value){
  const v=String(value||'').toLowerCase();
  if(v.startsWith('de')) return 'Deutsch';
  if(v.startsWith('sl') || v.includes('slov')) return 'Slovensky';
  return 'English';
}

export function getTrainerLanguage(){ return canonicalLanguage(localStorage.getItem(LANG_KEY)||'English'); }
export function ptT(key){ const lang=getTrainerLanguage(); return I18N[lang]?.[key] || I18N.English[key] || key; }

function applyLanguage(lang,{persist=true}={}){
  const canonical=canonicalLanguage(lang);
  if(persist) localStorage.setItem(LANG_KEY,canonical);
  document.documentElement.lang=canonical==='Deutsch'?'de':canonical==='Slovensky'?'sk':'en';
  document.querySelectorAll('[data-pt-i18n]').forEach(el=>{
    const key=el.getAttribute('data-pt-i18n');
    const val=I18N[canonical]?.[key] || I18N.English[key];
    if(val) el.textContent=val;
  });
  document.querySelectorAll('[data-pt-language]').forEach(btn=>btn.classList.toggle('is-selected',canonicalLanguage(btn.dataset.ptLanguage)===canonical));
  window.dispatchEvent(new CustomEvent('pt-language-change',{detail:{language:canonical}}));
}

function applyTheme(theme,{persist=true}={}){
  const next=String(theme||'light').toLowerCase()==='dark'?'dark':'light';
  document.body.dataset.theme=next;
  if(persist) localStorage.setItem(THEME_KEY,next);
  document.getElementById('ptThemeLight')?.classList.toggle('is-selected',next==='light');
  document.getElementById('ptThemeDark')?.classList.toggle('is-selected',next==='dark');
}

function applyTextSize(step,{persist=true}={}){
  const n=Math.max(1,Math.min(7,Number(step)||4));
  const px=TEXT_SIZES[n-1]||16;
  document.documentElement.style.setProperty('--base-font-size',`${px}px`);
  document.documentElement.style.setProperty('--text-scale',String(px/16));
  if(persist) localStorage.setItem(SIZE_KEY,String(n));
  const slider=document.getElementById('ptTextSize'); if(slider) slider.value=String(n);
}

function setSidebarOpen(open){
  document.body.classList.toggle('pt-sidebar-open',Boolean(open));
  document.getElementById('ptNavToggle')?.setAttribute('aria-expanded',open?'true':'false');
}
function setSettingsOpen(open){
  document.body.classList.toggle('pt-settings-open',Boolean(open));
  document.getElementById('ptSettingsDrawer')?.setAttribute('aria-hidden',open?'false':'true');
}

function initShell(){
  applyTheme(localStorage.getItem(THEME_KEY)||'light',{persist:false});
  applyTextSize(localStorage.getItem(SIZE_KEY)||'4',{persist:false});
  applyLanguage(localStorage.getItem(LANG_KEY)||'English',{persist:false});

  document.getElementById('ptNavToggle')?.addEventListener('click',()=>setSidebarOpen(!document.body.classList.contains('pt-sidebar-open')));
  document.getElementById('ptShellScrim')?.addEventListener('click',()=>setSidebarOpen(false));
  document.querySelectorAll('.pt-shell-sidebar a').forEach(a=>a.addEventListener('click',()=>setSidebarOpen(false)));
  const openSettings=()=>{setSidebarOpen(false);setSettingsOpen(true)};
  document.getElementById('ptSettingsToggle')?.addEventListener('click',openSettings);
  document.getElementById('ptSidebarSettings')?.addEventListener('click',openSettings);
  document.getElementById('ptSettingsClose')?.addEventListener('click',()=>setSettingsOpen(false));
  document.getElementById('ptSettingsScrim')?.addEventListener('click',()=>setSettingsOpen(false));
  document.querySelectorAll('[data-pt-language]').forEach(btn=>btn.addEventListener('click',()=>applyLanguage(btn.dataset.ptLanguage)));
  document.getElementById('ptThemeLight')?.addEventListener('click',()=>applyTheme('light'));
  document.getElementById('ptThemeDark')?.addEventListener('click',()=>applyTheme('dark'));
  document.getElementById('ptTextSize')?.addEventListener('input',e=>applyTextSize(e.target.value));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){setSidebarOpen(false);setSettingsOpen(false)} });
  window.addEventListener('resize',()=>{ if(window.innerWidth>=900) setSidebarOpen(false); });
}

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',initShell,{once:true}):initShell();
