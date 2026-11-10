// Full utterances only. The intent points to the existing authored answer.
// Keep a narrowly worded question separate from its broader history section.
export const QUESTION_VARIANTS = {
  identity_name: [
    'How should I address you?',
    'May I confirm your first and last names?',
    'What name do you go by?',
    'Could I start by checking your name?'
  ],
  identity_dob: [
    'Could you confirm the day, month and year you were born?',
    'May I check your birth date for the record?',
    'Could I have your date of birth, including the year?',
    'What day were you born on?'
  ],
  intake_birthplace: [
    'Which town were you born in?',
    'Where did your life begin?',
    'In which city were you born?',
    'Where was your birthplace?'
  ],
  identity_residence: [
    'Where are you based now?',
    'Which town is home for you these days?',
    'What area do you live in at the moment?',
    'Where are you living currently?'
  ],
  identity_occupation: [
    'What kind of work or study do you do?',
    'Are you working or studying at the moment?',
    'What do you do for a living?',
    'Are you currently in work or education?'
  ],
  administrative_admission_time: [
    'About what time did you get to the clinic?',
    'When did you first get to this unit?',
    'How recently did you get here?',
    'When did you come in for assessment?'
  ],
  administrative_arrival_method: [
    'How did you make your way here?',
    'Could you tell me how you got to the clinic?',
    'What transport did you use to get here?',
    'Did you make your own way here or did somebody bring you?'
  ],
  intake_height: [
    'Roughly how tall would you say you are?',
    'Do you know your height in centimetres?',
    'What height should I put down?',
    'Can you tell me how tall you are in centimetres?'
  ],
  intake_weight: [
    'Approximately how many kilos do you weigh?',
    'What is your weight at the moment?',
    'What did you weigh the last time you checked?',
    'Do you know your current weight in kilograms?'
  ],
  intake_marital_status: [
    'May I ask whether you are married?',
    'What should I put down for marital status?',
    'Could you tell me whether you are married, single or widowed?',
    'Can I check your marital status for the record?'
  ],
  intake_children: [
    'Are you a parent?',
    'Do you have children of your own?',
    'Could I ask if you have any children?',
    'Do you have any sons or daughters?'
  ],
  intake_siblings: [
    'Did you grow up with brothers or sisters?',
    'Can I ask about any brothers or sisters?',
    'Are there any other children in the family you grew up in?',
    'Do you have brothers and sisters?'
  ],
  intake_contact_person: [
    'Who should we get in touch with if we need to reach someone?',
    'Who would you like us to call in an emergency?',
    'Is there someone we should contact on your behalf?',
    'Who would you list as your emergency contact?'
  ],
  intake_diet: [
    'What are your meals normally like?',
    'What sorts of food do you usually eat?',
    'Could you walk me through your usual eating habits?',
    'How would you describe the way you usually eat?'
  ],
  intake_sleep: [
    'How have you been sleeping lately?',
    'What has your sleep been like?',
    'Are you getting a decent night of sleep?',
    'How are you getting on with sleep at the moment?'
  ],
  chief_complaint: [
    'What made you decide to get checked today?',
    'What would you like us to help with first?',
    'Could you tell me what made you seek help?',
    'What is the biggest issue for you at the moment?'
  ],
  hpi_previous_episodes: [
    'Has anything similar happened to you on another occasion?',
    'Is this the first episode you can remember?',
    'Have you gone through anything like this in the past?',
    'Has this sort of thing ever happened to you before?'
  ],
  hpi_activity_at_onset: [
    'What were you up to when the symptoms began?',
    'What was happening just as the symptoms started?',
    'Can you remember what you were doing just before it began?',
    'What were you in the middle of doing when you first noticed it?'
  ],
  hpi_relieving: [
    'Have you found anything that makes it easier to bear?',
    'Is there anything that settles the symptoms down?',
    'What have you found most helpful for easing the symptoms?',
    'Is there anything you can do to get some relief?'
  ],
  hpi_exacerbating: [
    'What makes the symptoms flare up?',
    'What tends to set it off?',
    'Is there anything that brings the symptoms on or makes them worse?',
    'Have you noticed any triggers for the symptoms?'
  ],
  hpi_course: [
    'How have the symptoms changed from when you first noticed them?',
    'What has happened to the symptoms since they began?',
    'Compared with the start, is it improving or worsening?',
    'Have the symptoms changed as time has gone on?'
  ],
  pmh_chronic_diseases: [
    'Are you being treated for any ongoing health problems?',
    'Have you been diagnosed with any long-standing illnesses?',
    'What conditions are you living with at the moment?',
    'What health problems did you have before this started?'
  ],
  pmh_hospitalizations: [
    'Have you ever needed to stay overnight in hospital?',
    'Was there ever a time you had to be admitted to a hospital?',
    'Have you had any hospital stays in the past?',
    'Were you ever kept in hospital for treatment?'
  ],
  pmh_operations: [
    'Have you ever had a surgical procedure?',
    'Has a surgeon ever operated on you?',
    'What operations have you had in the past?',
    'Have you had any operations I should know about?'
  ],
  allergies: [
    'Is there any medicine you know you are allergic to?',
    'Are there any known allergies we should write down?',
    'Do you have any allergies to medicines?',
    'Have you been told that you are allergic to any medication?'
  ],
  allergy_environment_food: [
    'Do you have any allergies to things you eat or encounter at home?',
    'Are you allergic to foods or anything in your surroundings?',
    'What about allergies other than medicines?',
    'Do any foods or things around you cause an allergic reaction?'
  ],
  transfusions: [
    'Have you ever been given blood in hospital?',
    'Has anybody ever given you a blood transfusion?',
    'Have you ever had blood given through a drip?',
    'Have you ever needed to receive donated blood?'
  ],
  medication_regular: [
    'Which medicines do you take on a normal day?',
    'Can you talk me through your usual medicines?',
    'Are there any prescriptions you take routinely?',
    'What medications are part of your usual routine?'
  ],
  medication_otc: [
    'Do you buy anything from the pharmacy without a prescription?',
    'What do you take that you can buy without seeing a doctor?',
    'Are there any pharmacy medicines you buy yourself?',
    'Apart from prescriptions, what medicines do you take?'
  ],
  family_history: [
    'What health conditions have your close relatives had?',
    'Are there any important illnesses among your immediate relatives?',
    'Could you tell me about the health of your parents and siblings?',
    'What medical problems have affected your close relatives?'
  ],
  social_household: [
    'Who shares your home with you?',
    'Is it just you at home or do you live with someone?',
    'Could you tell me who lives in the same household?',
    'Who else lives in your home?'
  ],
  social_housing: [
    'What sort of place do you live in?',
    'Could you describe your home setup?',
    'Do you live in a house or a flat?',
    'What type of accommodation do you have?'
  ],
  social_support: [
    'Who can you turn to if you need help at home?',
    'Is there anyone who can help with everyday things?',
    'Who normally helps if you cannot manage on your own?',
    'Who could come and help you if you needed it?'
  ],
  social_current_function: [
    'What everyday things are harder for you now?',
    'What can you manage by yourself at the moment?',
    'How much has this affected what you can do day to day?',
    'Has this made it harder to get around or look after yourself?'
  ],
  substance_smoking: [
    'Have you ever been a smoker?',
    'Do you currently smoke or have you smoked in the past?',
    'Could I ask about your tobacco use?',
    'Are cigarettes or other tobacco products part of your routine?'
  ],
  substance_alcohol: [
    'How often do you have an alcoholic drink?',
    'What does your alcohol use look like in a normal week?',
    'Could I ask how much alcohol you drink?',
    'Do you have any beer, wine or other alcoholic drinks?'
  ],
  substance_caffeine: [
    'What caffeinated drinks do you usually have?',
    'How many coffees, teas or energy drinks do you have?',
    'What is your usual caffeine intake?',
    'Do you normally drink coffee or other caffeinated drinks?'
  ],
  substance_drugs: [
    'May I ask whether you use drugs recreationally?',
    'Do you use any drugs for recreation?',
    'Have you used any recreational substances?',
    'Would you mind telling me about any recreational drug use?'
  ],
  closure_concerns: [
    'What is the biggest worry this has brought up for you?',
    'Is there anything about this that is worrying you in particular?',
    'What are you most afraid this might be?',
    'What worries you about what has happened?'
  ],
  closure_anything_else: [
    'Before we stop, is there something important we have left out?',
    'Is there anything you want to add before we finish?',
    'Have I left anything out that you wanted to tell me?',
    'Is there anything we have not covered that you think matters?'
  ]
};

// A short phrase is only allowed to resolve from the listed preceding intents.
export const QUESTION_FOLLOWUPS = [
  { phrase: 'And which town was that?', after: ['identity_dob', 'intake_birthplace'], intent: 'intake_birthplace' },
  { phrase: 'And who lives there with you?', after: ['identity_residence', 'social_housing'], intent: 'social_household' },
  { phrase: 'And who can help out there?', after: ['social_household', 'social_housing'], intent: 'social_support' },
  { phrase: 'And what happens when you take it?', after: ['allergies'], intent: 'allergy_reaction' },
  { phrase: 'And what about things you buy yourself?', after: ['medication_regular'], intent: 'medication_otc' },
  { phrase: 'And when did this episode begin?', after: ['chief_complaint', 'hpi_previous_episodes'], intent: 'hpi_onset' },
  { phrase: 'Has it happened on another occasion?', after: ['chief_complaint', 'hpi_onset'], intent: 'hpi_previous_episodes' },
  { phrase: 'And what are you finding difficult now?', after: ['social_baseline_function'], intent: 'social_current_function' }
];
