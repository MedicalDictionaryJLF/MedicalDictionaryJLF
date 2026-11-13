/*
 * Obstetric Anamnesis
 * Native, schema-driven addition to the existing Medical Dictionary workspace.
 * No diagnosis is inferred, and hidden fields are retained in patient records.
 */
const TEXT = {
  antenatal: ['Pre-birth (Antenatal)', 'Pred pôrodom (prenatálna)'],
  postpartum: ['Post-birth (Postpartum)', 'Po pôrode (šestonedelie)'],
  pathway: ['Patient status / pathway', 'Stav pacientky / typ anamnézy'],
  review: ['Learning review', 'Kontrola úplnosti anamnézy'],
  reviewInfo: ['Checks documentation only; not a diagnosis or a replacement for clinical judgement.', 'Kontrola dokumentácie, nie diagnóza ani náhrada klinického úsudku.'],
  add: ['Add entry', 'Pridať záznam'],
  remove: ['Remove entry', 'Odstrániť záznam'],
  uncertain: ['Not assessed', 'Nezistené'],
  yes: ['Yes', 'Áno'],
  no: ['No', 'Nie'],
  unknown: ['Unknown', 'Neznáme'],
  notasked: ['Not asked', 'Nepýtané'],
  notapplicable: ['Not applicable', 'Nerelevantné']
};
const lang = () => document.documentElement.lang === 'sk' ? 1 : 0;
function local(en, sk) { return lang() ? (sk || en) : en; }
function translated(node, en, sk) {
  node.dataset.obEn = en;
  node.dataset.obSk = sk || en;
  node.textContent = local(en, sk);
  return node;
}
function el(tag, className = '') {
  const node = document.createElement(tag);
  if(className) node.className = className;
  return node;
}
const yn = [['', '—', '—'], ['yes', 'Yes', 'Áno'], ['no','No','Nie'], ['unknown','Unknown','Neznáme'], ['not_asked','Not asked','Nepýtané'], ['not_applicable','Not applicable','Nerelevantné']];
const optionSets = {
  conception: [['','—','—'],['spontaneous','Spontaneous','Spontánne'],['assisted','Assisted reproduction','Asistovaná reprodukcia'],['unknown','Unknown','Neznáme']],
  multiplicity: [['','—','—'],['singleton','Singleton','Jednoplodová'],['twins','Twins','Dvojčatá'],['higher','Higher-order multiple','Viacplodová'],['unknown','Unknown','Neznáme']],
  delivery: [['','—','—'],['vaginal','Spontaneous vaginal','Spontánny vaginálny'],['instrumental','Instrumental vaginal','Operačný vaginálny'],['caesarean','Caesarean section','Cisársky rez'],['unknown','Unknown','Neznáme']],
  feeding: [['','—','—'],['breast','Breastfeeding','Dojčenie'],['mixed','Mixed feeding','Kombinované'],['formula','Formula feeding','Umelé mlieko'],['not_applicable','Not applicable','Nerelevantné'],['unknown','Unknown','Neznáme']],
  outcome: [['','—','—'],['live_birth','Live birth','Živonarodené dieťa'],['stillbirth','Stillbirth','Mŕtvonarodené dieťa'],['miscarriage','Miscarriage','Spontánny potrat'],['termination','Pregnancy termination','Umelé prerušenie tehotenstva'],['ectopic','Ectopic pregnancy','Mimomaternicová gravidita'],['neonatal_death','Neonatal death','Novorodenecké úmrtie'],['unknown','Unknown','Neznáme']],
  source: [['','—','—'],['lmp','Last menstrual period','Posledná menštruácia'],['ultrasound','Dating ultrasound','Datovací ultrazvuk'],['ivf','Assisted reproduction dating','Datovanie podľa asistovanej reprodukcie'],['clinical','Clinical documentation','Zdravotná dokumentácia'],['unknown','Unknown','Neznáme']]
};
// Field rows: stable key | English label | Slovak label | control kind | optional condition
const GROUPS = [
 ['shared','3. Presenting illness','3. Terajšie ochorenie',
 'present_reason|Reason for visit|Dôvod návštevy|long;present_onset|Symptom onset|Začiatok ťažkostí|text;present_duration|Duration and course|Trvanie a priebeh|text;present_severity|Severity|Závažnosť|text;present_aggravating|Aggravating factors|Zhoršujúce faktory|text;present_relieving|Relieving factors|Zmierňujúce faktory|text;present_associated|Associated symptoms|Sprievodné príznaky|long;present_treatment|Previous assessment and treatment|Doterajšie vyšetrenia a liečba|long;present_notes|Other relevant symptoms|Ďalšie relevantné príznaky|long'],
 ['shared','4. Personal medical history','4. Osobná anamnéza',
 'pmh_chronic|Chronic diseases|Chronické ochorenia|long;pmh_cardiac|Cardiovascular conditions|Kardiovaskulárne ochorenia|text;pmh_respiratory|Respiratory conditions|Respiračné ochorenia|text;pmh_diabetes|Diabetes mellitus|Diabetes mellitus|yn;pmh_hypertension|Chronic hypertension|Chronická hypertenzia|yn;pmh_thyroid|Thyroid disorders|Ochorenia štítnej žľazy|text;pmh_renal|Renal conditions|Ochorenia obličiek|text;pmh_liver|Hepatic conditions|Ochorenia pečene|text;pmh_haem|Haematological disorders|Hematologické ochorenia|text;pmh_vte|Previous thrombosis or embolism|Prekonaná trombóza alebo embólia|yn;pmh_autoimmune|Autoimmune conditions|Autoimunitné ochorenia|text;pmh_neuro|Neurological disorders|Neurologické ochorenia|text;pmh_psych|Psychiatric history|Psychiatrická anamnéza|text;pmh_surgery|Previous surgeries and uterine procedures|Predchádzajúce operácie a výkony na maternici|long;pmh_hospital|Previous hospitalisations|Predchádzajúce hospitalizácie|long;pmh_anaesthesia|Previous anaesthetic complications|Komplikácie anestézie|text;pmh_transfusion|Blood transfusions and reactions|Transfúzie a reakcie|text'],
 ['shared','5. Medication and allergies','5. Farmakologická a alergologická anamnéza',
 'med_regular|Regular medications and doses|Pravidelné lieky a dávky|long;med_recent|Recently discontinued medications|Nedávno vysadené lieky|text;med_supplements|Vitamins and supplements|Vitamíny a doplnky|text;med_pregnancy_exposure|Relevant pregnancy drug exposures|Lieky užívané počas gravidity|text;med_allergies|Drug allergies|Liekové alergie|text;med_reactions|Type and severity of reactions|Typ a závažnosť reakcií|text;med_other|Other allergies|Iné alergie|text'],
 ['shared','6. Family history','6. Rodinná anamnéza',
 'family_genetic|Genetic and hereditary disorders|Genetické a dedičné ochorenia|text;family_anomalies|Congenital anomalies|Vrodené vývojové chyby|text;family_vte|Venous thromboembolism|Venózna tromboembólia|text;family_htn|Hypertension|Hypertenzia|text;family_diabetes|Diabetes|Diabetes|text;family_malignancy|Breast and gynaecological malignancies|Nádory prsníka a gynekologické malignity|text;family_multiple|Multiple pregnancies in family|Viacplodové gravidity v rodine|text;family_other|Other relevant family conditions|Iné relevantné ochorenia v rodine|long'],
 ['shared','7. Social and sensitive history','7. Sociálna a citlivá anamnéza',
 'social_smoking|Smoking and vaping|Fajčenie a vaping|text;social_alcohol|Alcohol use|Alkohol|text;social_drugs|Other substance use|Iné návykové látky|text;social_occupation|Occupation and workplace exposures|Povolanie a pracovné expozície|text;social_home|Living conditions|Životné podmienky|text;social_support|Family and social support|Rodinná a sociálna podpora|text;social_diet|Nutrition and physical activity|Výživa a pohyb|text;social_safety|Safety at home (ask privately)|Bezpečie doma (pýtať sa v súkromí)|text;social_trauma|Prior birth-related or other trauma|Traumatická skúsenosť s pôrodom alebo iná trauma|text;social_notes|Other sensitive context|Iné citlivé okolnosti|long'],
 ['shared','8. Gynaecological history','8. Gynekologická anamnéza',
 'gyn_menarche|Age at menarche|Vek pri menarché|number;gyn_cycle|Cycle regularity and length|Pravidelnosť a dĺžka cyklu|text;gyn_bleeding|Bleeding duration and volume|Dĺžka a intenzita krvácania|text;gyn_dysmenorrhea|Dysmenorrhoea|Dysmenorea|text;gyn_disorders|Known gynaecological diagnoses|Gynekologické ochorenia|long;gyn_cervical|Cervical screening history|Cervikálny skríning|text;gyn_operations|Previous gynaecological procedures|Gynekologické výkony|long;gyn_sti|Sexually transmitted infections|Sexuálne prenosné infekcie|text;gyn_contraception|Previous contraception|Predchádzajúca antikoncepcia|text;gyn_infertility|Infertility and fertility treatments|Infertilita a liečba|text;gyn_sexual|Relevant sexual history|Relevantná sexuálna anamnéza|long'],
 ['shared','9. Previous obstetric history','9. Predchádzajúca pôrodnícka anamnéza',
 'ob_gravida|Gravidity (all pregnancies including current)|Gravidita (všetky gravidity vrátane terajšej)|number;ob_para|Parity (specify convention)|Parita (uviesť používanú konvenciu)|number;ob_term_births|Previous term deliveries|Predchádzajúce termínové pôrody|number;ob_preterm_births|Previous preterm deliveries|Predchádzajúce predčasné pôrody|number;ob_miscarriages|Previous miscarriages|Predchádzajúce spontánne potraty|number;ob_terminations|Previous terminations|Predchádzajúce interrupcie|number;ob_ectopic|Previous ectopic pregnancies|Predchádzajúce mimomaternicové gravidity|number;ob_living_children|Living children|Žijúce deti|number;ob_previous_complications|Previous obstetric complications|Predchádzajúce pôrodnícke komplikácie|long;ob_previous_notes|Other previous pregnancy history|Iná pôrodnícka anamnéza|long'],
 ['antenatal','10. Current pregnancy and dating','10. Súčasná gravidita a datovanie',
 'antenatal_lmp|Last menstrual period|Posledná menštruácia|date;antenatal_dating_source|Dating source|Spôsob datovania|source;antenatal_edd_lmp|EDD calculated from LMP (estimate)|TP podľa menštruácie (odhad)|readonly;antenatal_edd_clinical|Clinically accepted EDD (editable)|Klinicky stanovený termín pôrodu|date;antenatal_ga_lmp|Current gestational age from LMP (estimate)|Gestačný vek podľa menštruácie (odhad)|readonly;antenatal_ga_weeks|Clinically accepted gestational weeks|Klinicky stanovené gestačné týždne|number;antenatal_ga_days|Additional gestational days (0–6)|Doplňujúce gestačné dni (0–6)|number;antenatal_dating_scan|Dating ultrasound date and findings|Datovací ultrazvuk a nález|text;antenatal_multiplicity|Number of fetuses|Počet plodov|multiplicity;antenatal_planned|Planned pregnancy|Plánovaná gravidita|yn;antenatal_conception|Conception|Počatie|conception;antenatal_antenatal_care|Antenatal care and attendance|Prenatálna starostlivosť|text;antenatal_risk|Known pregnancy risks|Známe riziká gravidity|long'],
 ['antenatal','11. Pregnancy course and complications','11. Priebeh gravidity a komplikácie',
 'antenatal_first|First trimester course|Priebeh I. trimestra|long;antenatal_second|Second trimester course|Priebeh II. trimestra|long;antenatal_third|Third trimester course|Priebeh III. trimestra|long;antenatal_nausea|Nausea or hyperemesis|Nauzea alebo hypereméza|text;antenatal_bleeding|Vaginal bleeding|Vaginálne krvácanie|yn;antenatal_bleeding_details|Bleeding onset, amount and associated symptoms|Začiatok, množstvo a pridružené príznaky krvácania|long|antenatal_bleeding=yes;antenatal_infection|Infections during pregnancy|Infekcie počas gravidity|text;antenatal_gdm|Gestational diabetes|Gestačný diabetes|yn;antenatal_htn|Pregnancy hypertension or pre-eclampsia|Gestačná hypertenzia alebo preeklampsia|yn;antenatal_anaemia|Anaemia|Anémia|yn;antenatal_cholestasis|Intrahepatic cholestasis|Intrahepatálna cholestáza|yn;antenatal_vte|Thromboembolic complication|Tromboembolická komplikácia|yn;antenatal_hospital|Hospitalisations in pregnancy|Hospitalizácie počas gravidity|long;antenatal_treatment|Treatments and antenatal medications|Liečba a lieky počas gravidity|long;antenatal_other|Other complications|Ďalšie komplikácie|long'],
 ['antenatal','12. Fetal assessment history','12. Anamnéza stavu plodu',
 'antenatal_movements|Fetal movements perceived|Vnímanie pohybov plodu|yn|week>=16;antenatal_movements_change|Reduced or changed fetal movements|Znížené alebo zmenené pohyby plodu|yn|week>=16;antenatal_growth|Fetal growth assessment|Hodnotenie rastu plodu|text;antenatal_presentation|Fetal presentation when known|Poloha a naliehanie plodu|text;antenatal_placenta|Placental location|Lokalizácia placenty|text;antenatal_fluid|Amniotic fluid findings|Množstvo plodovej vody|text;antenatal_ultrasound|Ultrasound history and findings|Ultrazvukové vyšetrenia a nálezy|long;antenatal_anomalies|Known or suspected fetal anomalies|Známe alebo suspektné chyby plodu|long;antenatal_fgr|Suspected growth restriction|Podozrenie na rastovú reštrikciu|yn;antenatal_ctg|Relevant cardiotocography|Relevantné CTG nálezy|text'],
 ['antenatal','13. Antenatal investigations','13. Prenatálne vyšetrenia',
 'antenatal_blood_group|ABO and RhD blood group|ABO a RhD krvná skupina|text;antenatal_antibodies|Red-cell antibodies|Erytrocytové protilátky|text;antenatal_hb|Haemoglobin and full blood count (date, units)|Hemoglobín a krvný obraz (dátum, jednotky)|text;antenatal_urine|Urinalysis and urine culture|Močové vyšetrenie a kultivácia|text;antenatal_ogtt|Gestational diabetes screening|Skríning gestačného diabetu|text;antenatal_infectious|Infectious disease screening|Infekčný skríning|long;antenatal_gbs|GBS culture (where indicated)|GBS kultivácia (podľa indikácie)|text;antenatal_chromosomal|Chromosomal screening or diagnostic testing|Chromozómový skríning alebo diagnostika|text;antenatal_imaging|Other ultrasound screening|Ďalšie ultrazvukové vyšetrenia|text;antenatal_tests_other|Other dated results and follow-up|Ďalšie nálezy s dátumom a kontrolami|long'],
 ['antenatal','14. Labour and acute symptoms','14. Pôrod a akútne príznaky',
 'antenatal_labour|Suspected labour|Podozrenie na začiatok pôrodu|yn;antenatal_contractions|Contractions|Kontrakcie|yn;antenatal_contractions_details|Onset, frequency, duration and intensity|Začiatok, frekvencia, trvanie a intenzita|long|antenatal_contractions=yes;antenatal_membranes|Possible membrane rupture|Možný odtok plodovej vody|yn;antenatal_membrane_details|Time, colour, amount, odour of leaking fluid|Čas, farba, množstvo a zápach tekutiny|long|antenatal_membranes=yes;antenatal_pelvic_pressure|Pelvic pressure|Tlak v panve|yn;antenatal_pain|Abdominal or pelvic pain|Bolesť brucha alebo panvy|yn;antenatal_fever|Fever or chills|Horúčka alebo zimnica|yn;antenatal_headache|Severe headache|Silná bolesť hlavy|yn;antenatal_visual|Visual disturbances|Poruchy videnia|yn;antenatal_ruq|Epigastric or right upper quadrant pain|Bolesť epigastria alebo pravého podrebria|yn;antenatal_oedema|Sudden swelling|Náhly opuch|yn;antenatal_dyspnoea|Dyspnoea or chest pain|Dýchavica alebo bolesť na hrudníku|yn;antenatal_leg|Unilateral painful leg swelling|Jednostranný bolestivý opuch končatiny|yn;antenatal_delivery_plan|Planned mode and place of delivery|Plánovaný spôsob a miesto pôrodu|text;antenatal_labour_other|Other acute concerns|Ďalšie akútne ťažkosti|long'],
 ['postpartum','10. Delivery history','10. Pôrodná anamnéza',
 'post_delivery_date|Date of delivery|Dátum pôrodu|date;post_delivery_time|Time of delivery|Čas pôrodu|time;post_interval|Postpartum interval (calculated)|Čas od pôrodu (vypočítaný)|readonly;post_ga|Gestational age at delivery|Gestačný vek pri pôrode|text;post_birth_location|Place of delivery|Miesto pôrodu|text;post_delivery_mode|Mode of delivery|Spôsob pôrodu|delivery;post_indication|Indication for operative delivery|Indikácia operačného pôrodu|text;post_labour_onset|Spontaneous or induced labour|Spontánny alebo vyvolaný pôrod|text;post_labour_length|Duration and course of labour|Trvanie a priebeh pôrodu|text;post_anaesthesia|Analgesia and anaesthesia|Analgézia a anestézia|text;post_placenta|Placental delivery and findings|Pôrod placenty a nález|text;post_blood_loss|Estimated or measured blood loss (mL)|Odhadovaná alebo meraná strata krvi (ml)|number;post_transfusion|Transfusion|Transfúzia|yn;post_complications_birth|Maternal complications during delivery|Materské komplikácie pri pôrode|long;post_outcome|Pregnancy outcome|Výsledok gravidity|outcome'],
 ['postpartum','11. Maternal recovery','11. Zotavovanie matky',
 'post_general|Current general condition|Celkový aktuálny stav|long;post_pain|Pain severity and location|Intenzita a lokalizácia bolesti|text;post_fatigue|Fatigue and sleep|Únava a spánok|text;post_mobility|Mobility|Mobilita|text;post_oral|Oral intake and hydration|Príjem potravy a tekutín|text;post_urine|Urination and urinary retention|Močenie a retencia moču|text;post_bowel|Bowel function|Funkcia čriev|text;post_fever|Fever or chills|Horúčka alebo zimnica|yn;post_dizziness|Dizziness or weakness|Závraty alebo slabosť|yn;post_chest|Chest pain or dyspnoea|Bolesť na hrudníku alebo dýchavica|yn;post_leg|Unilateral painful leg swelling|Jednostranný bolestivý opuch končatiny|yn;post_other|Other recovery concerns|Ďalšie ťažkosti pri zotavovaní|long'],
 ['postpartum','12. Lochia, bleeding and uterine recovery','12. Očistky, krvácanie a involúcia maternice',
 'post_lochia_amount|Lochia amount|Množstvo očistkov|text;post_lochia_colour|Lochia colour|Farba očistkov|text;post_lochia_odour|Lochia odour|Zápach očistkov|text;post_bleeding_heavy|Heavy or increasing bleeding|Silné alebo pribúdajúce krvácanie|yn;post_bleeding_clots|Passage of clots|Odchod krvných zrazenín|yn;post_bleeding_history|Timing and progression of bleeding|Časový priebeh krvácania|long;post_uterus|Uterine involution (if examined)|Involúcia maternice (ak vyšetrené)|text;post_tenderness|Uterine tenderness (if examined)|Citlivosť maternice (ak vyšetrené)|text;post_ultrasound|Relevant ultrasound findings|Relevantný ultrazvukový nález|text'],
 ['postpartum','13. Perineal and operative recovery','13. Hojenie hrádze a operačnej rany',
 'post_episiotomy|Episiotomy|Epiziotómia|yn|post_delivery_mode=vaginal,instrumental;post_tear|Perineal injury and documented grade|Poranenie hrádze a stupeň|text|post_delivery_mode=vaginal,instrumental;post_perineal_pain|Perineal pain or haematoma|Bolesť hrádze alebo hematóm|text|post_delivery_mode=vaginal,instrumental;post_perineal_repair|Suturing and healing|Šitie a hojenie|text|post_delivery_mode=vaginal,instrumental;post_csection_indication|Caesarean indication and details|Indikácia a detaily cisárskeho rezu|text|post_delivery_mode=caesarean;post_surgical_pain|Incision pain and swelling|Bolesť a opuch operačnej rany|text|post_delivery_mode=caesarean;post_wound|Wound redness, discharge or dehiscence|Začervenanie, výtok alebo dehiscencia rany|text|post_delivery_mode=caesarean;post_wound_other|Wound care and other concerns|Starostlivosť o ranu a ďalšie ťažkosti|long'],
 ['postpartum','14. Infant feeding and breast health','14. Kŕmenie dieťaťa a stav prsníkov',
 'post_feeding_mode|Feeding method|Spôsob kŕmenia|feeding;post_feeding_intent|Feeding intention and support|Zámer kŕmenia a podpora|text;post_feeding_frequency|Feeding frequency|Frekvencia kŕmenia|text|post_feeding_mode=breast,mixed;post_latch|Latching difficulties|Problémy s prisatím|text|post_feeding_mode=breast,mixed;post_milk|Milk supply concerns|Problémy s tvorbou mlieka|text|post_feeding_mode=breast,mixed;post_nipple|Nipple trauma or pain|Poranenie alebo bolesť bradaviek|text|post_feeding_mode=breast,mixed;post_breast_engorgement|Breast engorgement|Naliatie prsníkov|yn;post_mastitis|Breast redness, pain or fever|Začervenanie, bolesť prsníka alebo horúčka|yn;post_feeding_other|Other feeding concerns|Ďalšie problémy s kŕmením|long'],
 ['postpartum','15. Newborn history','15. Anamnéza novorodenca',
 'post_baby_count|Number of babies delivered|Počet narodených detí|number;post_nicu|Neonatal intensive care|Novorodenecká intenzívna starostlivosť|yn;post_neonatal_complications|Neonatal complications|Novorodenecké komplikácie|long;post_separation|Maternal-infant separation|Oddelenie matky a dieťaťa|text;post_baby_followup|Paediatric follow-up|Pediatrické sledovanie|text'],
 ['postpartum','16. Postpartum complications','16. Popôrodné komplikácie',
 'post_pph|Postpartum haemorrhage|Popôrodné krvácanie|yn;post_retained|Retained placental tissue or products|Retinované placentárne tkanivo|yn;post_endometritis|Endometritis or uterine infection|Endometritída alebo infekcia maternice|yn;post_wound_infection|Surgical or perineal infection|Infekcia operačnej rany alebo hrádze|yn;post_uti|Urinary tract infection|Infekcia močových ciest|yn;post_vte|Venous thromboembolism|Venózna tromboembólia|yn;post_hypertension|Postpartum hypertension or pre-eclampsia|Popôrodná hypertenzia alebo preeklampsia|yn;post_incontinence|Urinary incontinence|Inkontinencia moču|yn;post_sphincter|Anal sphincter or bowel dysfunction|Porucha análneho zvierača alebo vyprázdňovania|yn;post_pelvic|Pelvic floor dysfunction|Dysfunkcia panvového dna|yn;post_treatment|Treatments, monitoring and follow-up|Liečba, monitorovanie a kontroly|long'],
 ['postpartum','17. Psychological wellbeing and family planning','17. Psychický stav a plánovanie rodiny',
 'post_mood|Mood changes and anxiety|Zmeny nálady a úzkosť|text;post_depression|Depression symptoms|Príznaky depresie|yn;post_sleep|Severe sleep disturbance|Závažná porucha spánku|yn;post_psychosis|Confusion, hallucinations or severe behavioural change|Zmätenosť, halucinácie alebo závažná zmena správania|yn;post_selfharm|Thoughts of self-harm or harm to infant (ask sensitively)|Myšlienky na sebapoškodenie alebo ublíženie dieťaťu (citlivo)|text;post_birth_trauma|Traumatic birth experience|Traumatický zážitok z pôrodu|text;post_support|Available support and safety|Dostupná podpora a bezpečie|text;post_screen|Validated screening tool if administered|Validovaný skríningový nástroj, ak použitý|text;post_menses|Return of menstruation|Návrat menštruácie|text;post_sexual|Sexual health and pain|Sexuálne zdravie a bolesti|text;post_contraception|Current or planned contraception|Súčasná alebo plánovaná antikoncepcia|text;post_future|Future pregnancy plans|Plány ďalšej gravidity|text;post_followup|Postpartum follow-up appointments|Popôrodné kontroly|text']
];
const REPEAT = {
 preg: {title:['Previous pregnancy','Predchádzajúca gravidita'], fields: 'year|Year|Rok|number;weeks|Gestational age at outcome|Gestačný vek pri ukončení|text;outcome|Pregnancy outcome|Výsledok gravidity|outcome;mode|Delivery method|Spôsob pôrodu|delivery;maternal|Maternal complications|Komplikácie u matky|long;baby|Neonatal outcome and complications|Stav dieťaťa a komplikácie|long'},
 fetus: {title:['Fetus','Plod'], fields: 'identifier|Fetus identifier|Označenie plodu|text;growth|Growth and measurements|Rast a biometria|text;presentation|Presentation|Poloha a naliehanie|text;ultrasound|Ultrasound findings|Ultrazvukové nálezy|long;concerns|Known complications|Známe komplikácie|long'},
 baby: {title:['Newborn','Novorodenec'], fields: 'identifier|Newborn identifier|Označenie novorodenca|text;outcome|Neonatal outcome|Stav dieťaťa|outcome;weight|Birth weight (g)|Pôrodná hmotnosť (g)|number;apgar|Apgar scores|Apgar skóre|text;resuscitation|Resuscitation required|Potrebná resuscitácia|yn;nicu|NICU and complications|JIS a komplikácie|long'},
 visit: {title:['Clinical encounter','Klinický kontakt'], fields: 'date|Date of encounter|Dátum kontaktu|date;context|Pregnancy / postpartum stage|Štádium gravidity / po pôrode|text;symptoms|Symptoms and changes|Príznaky a zmeny|long;results|Investigations and findings|Vyšetrenia a nálezy|long;treatment|Treatment and follow-up|Liečba a kontroly|long'}
};
function parse(raw) {
  return String(raw).split(';').filter(Boolean).map(entry => {
    const [key, en, sk, type = 'text', when = ''] = entry.split('|');
    return {key,en,sk,type,when};
  });
}
function value(form, name) {
  const item = form.elements.namedItem('ob_' + name);
  return item && 'value' in item ? String(item.value || '') : '';
}
function makeField(def, override = '') {
  const host = el('div', 'anam-ob-field');
  const strong = translated(el('strong'), def.en, def.sk);
  host.appendChild(strong);
  const name = override || 'ob_' + def.key;
  let control;
  if(def.type === 'long') {
    control = el('textarea');
    control.rows = 2;
  } else if(def.type === 'yn' || optionSets[def.type]){
    control = el('select');
    const opts = def.type === 'yn' ? yn : optionSets[def.type];
    opts.forEach(([v,en,sk]) => {
      const option = translated(el('option'), en, sk);
      option.value = v;
      control.appendChild(option);
    });
  } else {
    control = el('input');
    control.type = def.type === 'readonly' ? 'text' : def.type;
    if(def.type === 'readonly') control.readOnly = true;
    if(def.type === 'number') { control.min = '0'; control.step = '1'; }
    if(def.key === 'antenatal_ga_days') control.max = '6';
    control.placeholder = local(def.en,def.sk);
    control.dataset.obPlaceholderEn = def.en;
    control.dataset.obPlaceholderSk = def.sk;
  }
  control.name = name;
  control.setAttribute('aria-label', local(def.en,def.sk));
  control.dataset.obAriaEn = def.en;
  control.dataset.obAriaSk = def.sk;
  host.appendChild(control);
  if(def.when) host.dataset.obWhen = def.when;
  return host;
}
function makeSection(scope,en,sk,defs,repeatType) {
  const section = el('div','anam-section anam-ob-section');
  section.dataset.obScope = scope;
  translated(section.appendChild(el('h3')),en,sk);
  const grid = el('div','anam-grid anam-ob-grid');
  parse(defs).forEach(def => grid.appendChild(makeField(def)));
  section.appendChild(grid);
  if(repeatType) {
    const host = el('div','anam-ob-repeat');
    host.dataset.obRepeat = repeatType;
    const add = translated(el('button','secondary anam-ob-add'), 'Add ' + REPEAT[repeatType].title[0].toLowerCase(), 'Pridať: ' + REPEAT[repeatType].title[1].toLowerCase());
    add.type = 'button';
    add.dataset.obAdd = repeatType;
    host.appendChild(add);
    const rows = el('div','anam-ob-repeat-rows');
    host.appendChild(rows);
    section.appendChild(host);
  }
  return section;
}
function rowIndices(raw, type) {
  const ids = new Set();
  Object.keys(raw || {}).forEach(key => {
    const match = key.match(new RegExp('^ob_' + type + '_(\\d+)_'));
    if(match) ids.add(Number(match[1]));
  });
  return [...ids].filter(x => x > 0 && x < 100).sort((a,b)=>a-b);
}
function addRow(form, type, index, onChange) {
  const target = form.querySelector('[data-ob-repeat="' + type + '"] .anam-ob-repeat-rows');
  if(!target || target.querySelector('[data-ob-row="' + type + '-' + index + '"]')) return;
  const item = el('div','anam-ob-repeat-row');
  item.dataset.obRow = type + '-' + index;
  const header = el('div','anam-ob-repeat-heading');
  translated(header.appendChild(el('strong')),REPEAT[type].title[0] + ' ' + index,REPEAT[type].title[1] + ' ' + index);
  const remove = translated(el('button','secondary'), 'Remove', 'Odstrániť');
  remove.type = 'button';
  remove.addEventListener('click',()=>{
    const occupied = [...item.querySelectorAll('input,select,textarea')].some(x => x.value);
    if(occupied && !window.confirm(local('Remove this recorded entry?','Odstrániť tento vyplnený záznam?'))) return;
    item.remove();
    if(onChange) onChange(true);
  });
  header.appendChild(remove);
  item.appendChild(header);
  const grid = el('div','anam-grid anam-ob-grid');
  parse(REPEAT[type].fields).forEach(def => grid.appendChild(makeField(def,'ob_' + type + '_' + index + '_' + def.key)));
  item.appendChild(grid);
  target.appendChild(item);
  return item;
}
function daysSince(iso){
  if(!/^\d{4}-\d\d-\d\d$/.test(iso || '')) return null;
  const date = new Date(iso + 'T12:00:00');
  if(Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== iso) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}
function addDays(iso, amount){
  const date = new Date(iso + 'T12:00:00');
  if(Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate()+amount);
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}
function applyDerived(form){
  const lmp = value(form,'antenatal_lmp');
  const elapsed = daysSince(lmp);
  const due = form.elements.namedItem('ob_antenatal_edd_lmp');
  const weeks = form.elements.namedItem('ob_antenatal_ga_lmp');
  if(due) due.value = elapsed !== null ? addDays(lmp,280) : '';
  if(weeks) weeks.value = elapsed !== null && elapsed >= 0 && elapsed <= 315 ? Math.floor(elapsed/7) + 'w ' + (elapsed%7) + 'd' : '';
  const delivery = daysSince(value(form,'post_delivery_date'));
  const interval = form.elements.namedItem('ob_post_interval');
  if(interval) interval.value = delivery !== null && delivery >= 0 ? delivery+' days' : '';
}
const redFlags = [
  ['antenatal_bleeding','Vaginal bleeding','Vaginálne krvácanie'],
  ['antenatal_movements_change','Changed fetal movements','Zmena pohybov plodu'],
  ['antenatal_membranes','Possible rupture of membranes','Možný odtok plodovej vody'],
  ['antenatal_headache','Severe headache','Silná bolesť hlavy'],
  ['antenatal_visual','Visual disturbances','Poruchy videnia'],
  ['antenatal_ruq','Epigastric or RUQ pain','Bolesť epigastria alebo pravého podrebria'],
  ['antenatal_dyspnoea','Chest pain or dyspnoea','Bolesť na hrudníku alebo dýchavica'],
  ['antenatal_leg','Unilateral leg swelling','Jednostranný opuch končatiny'],
  ['post_bleeding_heavy','Heavy postpartum bleeding','Silné popôrodné krvácanie'],
  ['post_fever','Postpartum fever','Popôrodná horúčka'],
  ['post_chest','Chest pain or dyspnoea','Bolesť na hrudníku alebo dýchavica'],
  ['post_leg','Unilateral leg swelling','Jednostranný opuch končatiny'],
  ['post_psychosis','Severe mental-state symptoms','Závažné psychické príznaky']
];
function updateReview(form){
  const view = form.querySelector('[data-ob-review]');
  if(!view) return;
  const pathway = value(form,'pathway') || 'antenatal';
  const required = pathway === 'antenatal'
    ? ['antenatal_lmp','antenatal_dating_source','antenatal_ga_weeks','antenatal_multiplicity','antenatal_movements_change','antenatal_bleeding','antenatal_membranes']
    : ['post_delivery_date','post_delivery_mode','post_outcome','post_bleeding_heavy','post_fever','post_feeding_mode','post_mood'];
  const missing = required.filter(k=>!value(form,k));
  const concerns = redFlags.filter(([key]) => value(form,key)==='yes' && ((pathway==='antenatal') === key.startsWith('antenatal')));
  view.textContent = '';
  const description = translated(el('p','muted'), 'Education only. The form does not diagnose patients.', 'Iba na výučbu. Formulár nestanovuje diagnózu.');
  view.appendChild(description);
  const completeness = translated(el('p'),missing.length ? 'Still undocumented: '+missing.length+' key topics.' : 'Core pathway questions are documented.',missing.length ? 'Nevyplnené kľúčové okruhy: '+missing.length+'.' : 'Základné otázky sú zdokumentované.');
  view.appendChild(completeness);
  if(concerns.length) {
    const warning = translated(el('p','anam-ob-warning'), 'Potentially urgent symptoms reported. Arrange clinical assessment; do not rely on this form.', 'Hlásené potenciálne urgentné príznaky. Zabezpečte klinické vyšetrenie, nespoliehajte sa na formulár.');
    view.appendChild(warning);
    const list = el('ul');
    concerns.forEach(([,en,sk]) => list.appendChild(translated(el('li'),en,sk)));
    view.appendChild(list);
  }
}
export function updateObstetricUi(form){
  if(!form || form.dataset.ready !== '1') return;
  const pathway = value(form,'pathway') === 'postpartum' ? 'postpartum' : 'antenatal';
  let weeks = Number(value(form,'antenatal_ga_weeks'));
  if(!value(form,'antenatal_ga_weeks')) {
    const days = daysSince(value(form,'antenatal_lmp'));
    weeks = days === null ? NaN : Math.floor(days/7);
  }
  const showNeonatal = !['miscarriage','termination','ectopic','stillbirth','neonatal_death'].includes(value(form,'post_outcome'));
  form.querySelectorAll('[data-ob-scope]').forEach(section => {
    const scope = section.dataset.obScope;
    section.classList.toggle('hidden',scope !== 'shared' && scope !== pathway);
    if(scope==='postpartum' && section.querySelector('[data-ob-repeat="baby"]')){
      section.classList.toggle('hidden',pathway !== 'postpartum' || !showNeonatal);
    }
  });
  form.querySelectorAll('[data-ob-when]').forEach(field=>{
    const rule = field.dataset.obWhen || '';
    let visible = true;
    if(rule.startsWith('week>=')){
      const cutoff = Number(rule.slice(6));
      // Unknown gestation should not silently hide clinically relevant questions.
      visible = !Number.isFinite(weeks) || weeks >= cutoff;
    } else {
      const parts = rule.split('=');
      visible = parts.length !== 2 || parts[1].split(',').includes(value(form,parts[0]));
    }
    field.classList.toggle('hidden',!visible);
  });
  applyDerived(form);
  updateReview(form);
}
export function applyObstetricLanguage(form){
  if(!form) return;
  form.querySelectorAll('[data-ob-en]').forEach(node=>node.textContent=local(node.dataset.obEn,node.dataset.obSk));
  form.querySelectorAll('[data-ob-placeholder-en]').forEach(node=>node.placeholder=local(node.dataset.obPlaceholderEn,node.dataset.obPlaceholderSk));
  form.querySelectorAll('[data-ob-aria-en]').forEach(node=>node.setAttribute('aria-label',local(node.dataset.obAriaEn,node.dataset.obAriaSk)));
}
export function buildObstetricAnamnesisForm(form, buildIdentification, buildChief, notify){
  if(!form || form.dataset.ready==='1') return;
  form.textContent='';
  form.appendChild(buildIdentification());
  form.appendChild(buildChief());
  const switcher = el('div','anam-ob-pathway');
  translated(switcher.appendChild(el('strong')),TEXT.pathway[0],TEXT.pathway[1]);
  const switchGrid=el('div','anam-ob-pathway-choices');
  const select = el('select');
  select.name = 'ob_pathway';
  select.setAttribute('aria-label',local(TEXT.pathway[0],TEXT.pathway[1]));
  [['antenatal',...TEXT.antenatal],['postpartum',...TEXT.postpartum]].forEach(([key,en,sk])=>{
    const option=translated(el('option'),en,sk);
    option.value=key;
    select.appendChild(option);
  });
  switchGrid.appendChild(select);
  switcher.appendChild(switchGrid);
  form.appendChild(switcher);
  GROUPS.forEach(([scope,en,sk,fields])=> {
    const repeatType = en.includes('Previous obstetric history') ? 'preg' : en.includes('Fetal assessment') ? 'fetus' : en.includes('Newborn history') ? 'baby' : null;
    form.appendChild(makeSection(scope,en,sk,fields,repeatType));
  });
  const encounter = makeSection('shared','20. Dated clinical encounters','20. Dátované klinické kontakty','', 'visit');
  form.appendChild(encounter);
  const review = el('div','anam-ob-review-panel');
  translated(review.appendChild(el('h4')),TEXT.review[0],TEXT.review[1]);
  const reviewContent = el('div');
  reviewContent.dataset.obReview='1';
  review.appendChild(reviewContent);
  form.appendChild(review);
  const changed=(sectionsChanged)=>{
    updateObstetricUi(form);
    if(typeof notify==='function') notify(!!sectionsChanged);
  };
  form.querySelectorAll('[data-ob-add]').forEach(btn=>btn.addEventListener('click',()=>{
    const type=btn.dataset.obAdd;
    const rowHost=form.querySelector('[data-ob-repeat="'+type+'"] .anam-ob-repeat-rows');
    const indices=[...rowHost.children].map(x=>Number((x.dataset.obRow||'').split('-')[1])).filter(Number.isFinite);
    const next=indices.length ? Math.max(...indices)+1 : 1;
    const row=addRow(form,type,next,changed);
    changed(true);
    if(row) row.querySelector('input,select,textarea')?.focus();
  }));
  form.addEventListener('input',e=>{
    if(e.target?.name==='ident_dob'){
      // Original shared header rules are handled by the parent workflow.
    }
    changed(false);
  });
  form.addEventListener('change',e=>changed(e.target?.name==='ob_pathway' || e.target?.name==='ob_post_outcome'));
  form.dataset.ready='1';
  updateObstetricUi(form);
  applyObstetricLanguage(form);
}
export function prepareObstetricFormForData(form, data, onChange){
  if(!form) return;
  form.querySelectorAll('.anam-ob-repeat-rows').forEach(host=>host.textContent='');
  Object.keys(REPEAT).forEach(type=>{
    rowIndices(data,type).forEach(index=>addRow(form,type,index,onChange));
  });
  form.reset();
}
export const OBSTETRIC_FIELD_COUNT = GROUPS.reduce((sum,g)=>sum+parse(g[3]).length,0);
