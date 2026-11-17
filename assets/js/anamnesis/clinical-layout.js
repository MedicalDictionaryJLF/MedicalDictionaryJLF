/* Reuses the Internal/Surgery worksheet vocabulary: anam-grid for short facts,
 * anam-row for labelled findings and choices, and one primary notes area.
 * Moves existing controls without renaming or recreating recorded answers. */
export function organizeClinicalWorksheet(form, ui) {
  const {el, translated, makeSection, makeField} = ui;
  const originals = [...form.querySelectorAll(':scope > .anam-ob-section')];
  const fields = new Map([...form.querySelectorAll('.anam-ob-field')].map(node => [node.querySelector('[name]')?.name.replace(/^ob_/,''), node]));
  const take = key => fields.get(key);
  const sections = new Map();
  function section(id,en,sk,scope='shared') {
    const node = makeSection(scope,en,sk,'');
    node.dataset.obLayout = id;
    node.querySelector('.anam-ob-grid').remove();
    sections.set(id,node);
    return node;
  }
  const hpi=section('hpi','History of Present Illness (SOCRATES)','Terajšie ochorenie (SOCRATES)');
  section('ros','Review of Systems','Prehľad orgánových systémov');
  section('menstrual','Menstrual History','Menštruačná anamnéza');
  section('sexual','Sexual History & Contraception','Sexuálna anamnéza a antikoncepcia');
  section('gyn_history','Gynaecological History','Gynekologická anamnéza');
  section('ob_history','Previous Obstetric History','Predchádzajúca pôrodnícka anamnéza');
  section('personal','Personal Medical & Surgical History','Osobná a chirurgická anamnéza');
  section('medication','Medication, Allergies & Transfusions','Lieky, alergie a transfúzie');
  section('family','Family History','Rodinná anamnéza');
  section('social','Social & Sensitive History','Sociálna a citlivá anamnéza');
  section('screening','Screening & Prevention','Skríning a prevencia');

  const sourceDestination = {
    present_reason:'hpi',ws_setting:'hpi',gyn_menarche:'gyn_history',ws_lmp:'menstrual',
    ws_sexually_active:'sexual',ws_fibroids:'gyn_history',ob_gravida:'ob_history',pmh_chronic:'personal',
    med_regular:'medication',family_genetic:'family',social_smoking:'social',ws_colposcopy:'screening'
  };
  const overrides = {
    gyn_menarche:'menstrual',gyn_cycle:'menstrual',gyn_bleeding:'menstrual',gyn_dysmenorrhea:'menstrual',
    gyn_sexual:'sexual',gyn_contraception:'sexual',gyn_sti:'sexual',gyn_cervical:'screening',
    ws_molar:'ob_history',ws_migraine:'personal',ws_travel:'social',ws_caffeine:'social',ws_safety:'social',
    pmh_transfusion:'medication',ws_antid:'medication'
  };
  // Keep antenatal/postpartum sections, then integrate the additional worksheet prompts.
  for(const source of originals) {
    const first=source.querySelector('[name]')?.name.replace(/^ob_/,'');
    source.dataset.obSource = first || '';
    if(sourceDestination[first] || first==='ws_consciousness' || first==='ws_chorionicity' || first==='ws_membrane_duration') continue;
    if(source.querySelector('[data-ob-repeat="med"], [data-ob-repeat="allergy"], [data-ob-repeat="procedure"]')) continue;
    if(source.querySelector('[name^="ob_ws_ros_"], [name^="ob_ws_spg_"], [name^="ob_ws_tests_done_"]')) continue;
    source.dataset.obLayout = first || 'encounters';
    sections.set(first || 'encounters',source);
  }
  section('spg','Status Praesens Generalis & Vital Signs','Status praesens generalis a vitálne funkcie');
  const aliases={antenatalDating:'antenatal_lmp',antenatalCourse:'antenatal_first',fetal:'antenatal_movements',antenatalAcute:'antenatal_labour',postDelivery:'post_delivery_date',postRecovery:'post_general',postPsych:'post_mood'};
  for(const [a,b] of Object.entries(aliases)) if(!sections.has(b)) throw new Error('Missing worksheet section '+a);
  function destination(key,first) {
    const base=key.replace(/_details$/,'');
    if(overrides[base]) return sections.get(overrides[base]);
    if(base.startsWith('ws_family_')) return sections.get('family');
    if(first==='ws_consciousness') return sections.get('spg');
    if(first==='ws_chorionicity') {
      if(/^ws_(chorionicity|booking|access)/.test(key)) return sections.get('antenatal_lmp');
      if(/^ws_(cervical_shortening|pruritus|fall)/.test(key)) return sections.get('antenatal_first');
      if(/^ws_(fundal_height|fetal_rate|fetal_method|engagement)/.test(key)) return sections.get('antenatal_movements');
      return sections.get('antenatal_labour');
    }
    if(first==='ws_membrane_duration') {
      if(/^ws_(membrane_duration|discharge_readmit)/.test(key)) return sections.get('post_delivery_date');
      if(key==='ws_bonding') return sections.get('post_mood');
      if(key==='ws_expression') return sections.get('post_feeding_mode');
      if(key==='ws_jaundice') return sections.get('post_baby_count');
      return sections.get('post_general');
    }
    return sections.get(sourceDestination[first]);
  }
  for(const source of originals) {
    const first=source.dataset.obSource;
    for(const field of [...source.querySelectorAll('.anam-ob-field')]) {
      const key=field.querySelector('[name]')?.name.replace(/^ob_/,'');
      const target=destination(key,first);
      if(target) target.appendChild(field);
    }
    const target=sections.get(sourceDestination[first]);
    if(target) source.querySelectorAll('[data-ob-repeat]').forEach(n=>target.appendChild(n));
    for(const type of ['med','allergy','procedure']) {
      const repeater=source.querySelector('[data-ob-repeat="'+type+'"]');
      if(repeater) sections.get(type==='procedure'?'personal':'medication').appendChild(repeater);
    }
    // A system checklist becomes one row in ROS, not a separate navigation section.
    const box=source.querySelector('input[type=checkbox][name^="ob_ws_"]');
    if(box && /ob_ws_(ros_|spg_|tests_done_)/.test(box.name)) {
      const target=sections.get(box.name.startsWith('ob_ws_ros_')?'ros':box.name.startsWith('ob_ws_spg_')?'spg':'clinical_reported');
      if(target) {
        const row=source.querySelector('.anam-ob-checkbox-choices');
        const oldTitle=source.querySelector('summary strong');
        const title=translated(el('span'),oldTitle.dataset.obEn,oldTitle.dataset.obSk);
        row.prepend(title); row.classList.add('anam-ob-system-row');
        target.appendChild(row);
        source.querySelectorAll('.anam-ob-field').forEach(n=>target.appendChild(n));
      }
    }
  }
  // Unwrap old uniform grids: each clinical row now participates in the native layout.
  for(const node of sections.values()) {
    node.querySelectorAll(':scope > .anam-ob-grid').forEach(grid=>grid.replaceWith(...grid.childNodes));
  }
  // SOCRATES short facts use the same two-column arrangement as Internal/Surgery.
  const grid=el('div','anam-grid'); grid.dataset.obSocratesFacts='1'; hpi.querySelector('summary').after(grid);
  for(const key of ['ws_site','present_onset','hpi_activity','present_duration','present_aggravating','present_relieving']) {
    let field=take(key);
    if(!field && key==='hpi_activity') field=makeField({key,en:'What were you doing at onset?',sk:'Čo ste robili pri vzniku ťažkostí?',type:'text'});
    field.classList.add('anam-ob-brief'); grid.appendChild(field);
  }
  function multi(key,en,sk,options) {
    const row=el('div','anam-row anam-ob-field anam-ob-multi');
    row.dataset.obField=key;
    const title=translated(el('span'),en,sk); row.appendChild(title);
    row.dataset.obHelpEn='Which of these apply? Describe the onset, frequency and any change.';
    row.dataset.obHelpSk='Ktoré z možností sa vás týkajú? Opíšte začiatok, frekvenciu a zmeny.';
    for(const [id,en,sk] of options) {
      const label=el('label');const input=el('input');input.type='checkbox';input.name='ob_'+key+'_'+id;
      label.append(input,translated(el('span'),en,sk));row.appendChild(label);
    }
    hpi.appendChild(row);return row;
  }
  multi('hpi_character','Character / Type of symptoms','Charakter / typ ťažkostí',[
    ['mild','Mild','Mierne'],['moderate','Moderate','Stredné'],['severe','Severe','Silné'],['progressive','Progressive','Progresívne'],['episodic','Episodic','Epizodické'],['fluctuating','Fluctuating','Kolísavé']]);
  hpi.appendChild(take('ws_pain_character'));
  const radiation=makeField({key:'hpi_radiation',en:'Radiation',sk:'Vyžarovanie',type:'yn'});hpi.appendChild(radiation);
  hpi.appendChild(makeField({key:'hpi_radiation_where',en:'Where does the pain radiate?',sk:'Kam bolesť vyžaruje?',type:'text',when:'hpi_radiation=yes'}));
  multi('hpi_associated','Associated symptoms','Sprievodné príznaky',[
    ['pelvic_pain','Pelvic pain','Panvová bolesť'],['bleeding','Abnormal bleeding','Abnormálne krvácanie'],['discharge','Discharge','Výtok'],['itching','Itching','Svrbenie'],['fever','Fever','Horúčka'],['dysuria','Dysuria','Dyzúria'],['dyspareunia','Dyspareunia','Dyspareunia'],['nausea','Nausea','Nauzea']]);
  hpi.appendChild(take('ws_pain_vas'));
  hpi.appendChild(take('ws_course'));
  for(const key of ['ws_cycle_relation','present_frequency','present_treatment']) hpi.appendChild(take(key));
  // Narrative answers remain editable and reportable, without repeated empty boxes in the main sheet.
  const secondary = new Set(['present_reason','present_severity','present_associated','present_notes','ws_expectations','ws_informant','ws_setting','ws_previous_episodes','ws_impact','gyn_cycle','gyn_bleeding','gyn_disorders','med_regular','med_allergies','med_reactions','pmh_surgery','pmh_hospital','ob_previous_notes']);
  for(const node of sections.values()) {
    let notes=null;const extras=[];
    for(const field of [...node.querySelectorAll(':scope > .anam-ob-field')]) {
      const key=field.dataset.obField || field.querySelector('[name]')?.name.replace(/^ob_/,'');
      if(/_section_notes$/.test(key) || /^(social_notes|family_other|clinical_notes|risk_notes)$/.test(key)) {
        if(!notes) notes=field;else extras.push(field);
      } else if(secondary.has(key)) extras.push(field);
    }
    if(notes) {
      notes.classList.add('anam-ob-notes');
      const input=notes.querySelector('textarea');
      if(input) { input.placeholder='Notes';input.dataset.obPlaceholderEn='Notes';input.dataset.obPlaceholderSk='Poznámky'; }
      node.appendChild(notes);
    }
    if(extras.length) {
      const details=el('details','anam-ob-additional');
      translated(details.appendChild(el('summary')),'Additional details','Doplňujúce podrobnosti');
      details.append(...extras);node.appendChild(details);
    }
  }
  // HPI primary rows are now in a deliberate interview order.
  const hpiOrder=['hpi_character','ws_pain_character','hpi_radiation','hpi_radiation_where','hpi_associated','ws_pain_vas','ws_course','ws_cycle_relation','present_frequency','present_treatment'];
  hpiOrder.forEach(key=>{
    const node=hpi.querySelector('[data-ob-field="'+key+'"]');
    if(node) hpi.appendChild(node);
  });
  for(const node of [...hpi.querySelectorAll(':scope > .anam-ob-notes, :scope > .anam-ob-additional')]) hpi.appendChild(node);
  // Render history before pathway-specific findings; examinations and review come last.
  const tail=['spg','ws_exam_consent','clinical_reported','ws_review_bleeding','encounters'];
  const ordered=[...sections.entries()].filter(([id])=>!tail.includes(id)).map(([,n])=>n);
  for(const id of tail) if(sections.has(id)) ordered.push(sections.get(id));
  const marker=form.querySelector('.anam-ob-pathway');let previous=marker;
  for(const node of ordered) { previous.after(node);previous=node; }
  for(const source of originals) if(!ordered.includes(source)) source.remove();
  for(const node of ordered) {
    const title=node.querySelector('summary strong');
    title.dataset.obEn=title.dataset.obEn.replace(/^\d+\.\s*/, '');
    title.dataset.obSk=title.dataset.obSk.replace(/^\d+\.\s*/, '');
  }
}
