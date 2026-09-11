(()=>{'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const current=()=>$('.screen.is-active:not(.hidden)')?.id||$('.screen:not(.hidden)')?.id||'';
function drawer(v){document.body.classList.toggle('sidebar-open',!!v);$('#app-nav-toggle')?.setAttribute('aria-expanded',v?'true':'false')}
function read(key,fallback){try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback}catch{return fallback}}
function dashboardStats(){
  const terms=read('cache/user_terms',[]); const saved=Array.isArray(terms)?terms.length:0;
  const sessions=read('quiz/sessions_v1',[]); const sessionCount=Array.isArray(sessions)?sessions.length:0;
  const today=new Date().toISOString().slice(0,10); const fcStats=read('flashcards/stats_v1',{}); const reviewed=Number(fcStats?.[today]?.reviewed||0);
  let due=0, now=Date.now();
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'';if(!k.startsWith('flashcards/v2/progress/'))continue;const p=read(k,{});for(const row of Object.values(p||{})){const t=row?.nextReview?Date.parse(row.nextReview):0;if(t&&t<=now)due++;}}}catch{}
  const vals=[['#home-due-count',due],['#home-saved-count',saved],['#home-session-count',sessionCount],['#home-reviewed-count',reviewed]];
  vals.forEach(([s,v])=>{const el=$(s);if(el)el.textContent=String(v)});
}
function sync(){const s=current(),on=!!s&&s!=='screen-menu';document.body.classList.toggle('app-workspace-active',on);document.body.dataset.currentScreen=s;$$('.sidebar-item[data-shell-screen]').forEach(x=>{const a=x.dataset.shellScreen===s;x.classList.toggle('is-active',a);a?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current')});const m={'screen-submenu':0,'screen-search':1,'screen-quiz':2,'screen-flashcards':2,'screen-courses':2,'screen-biophysics-tf':2,'screen-anamnesis':3};$$('.mobile-bottom-nav>button').forEach((x,i)=>x.classList.toggle('is-active',m[s]===i));if(s==='screen-submenu')dashboardStats();if(innerWidth<900)drawer(false)}
function hit(id){document.getElementById(id)?.click()}
const APP_ROUTES=new Set(['main','anamnesis','muscles','quiz','flashcards','menu','feedback','search','lab-parameters','pharmacology','entry','courses','biophysics','latin-terminology']);
function appBasePath(){
  const parts=String(location.pathname||'').split('/').filter(Boolean);
  if(String(parts.at(-1)||'').toLowerCase()==='index.html')parts.pop();
  if(APP_ROUTES.has(String(parts.at(-1)||'').toLowerCase()))parts.pop();
  return '/'+(parts.length?parts.join('/')+'/':'');
}
function goHome(){
  const target = `${appBasePath()}main/`;
  // Home is an in-app destination. Do not reload the document, because a reload
  // reconstructs the shell from the login screen before app.js selects /main/.
  try{
    const current = `${location.pathname}${location.search}${location.hash}`;
    if(current !== target) history.pushState(null, '', target);
  }catch{}
  const home = $('#shell-home');
  home?.dispatchEvent(new CustomEvent('shell-home-request',{bubbles:true}));
  // app.js owns screen state. This fallback only runs if the app handler was not
  // available for some reason; it still avoids showing the login/menu screen.
  setTimeout(()=>{
    const mainScreen = $('#screen-submenu');
    if(mainScreen && mainScreen.classList.contains('hidden')){
      $$('.screen').forEach(x=>{
        const active=x===mainScreen;
        x.classList.toggle('hidden',!active);
        x.classList.toggle('is-active',active);
        x.setAttribute('aria-hidden',active?'false':'true');
      });
      sync();
    }
  },80);
}
function search(){hit('to-search');setTimeout(()=>{const i=$('#search-input');if(i){i.focus();i.select?.()}},120)}
function init(){ $$('[data-app-route]').forEach(link=>{ const route=String(link.dataset.appRoute||'').replace(/^\/+|\/+$/g,''); if(route) link.setAttribute('href', `${appBasePath()}${route}/`); }); const t=$('#app-nav-toggle');t?.addEventListener('click',()=>{if(innerWidth<900)drawer(!document.body.classList.contains('sidebar-open'));else{document.body.classList.toggle('sidebar-collapsed');try{localStorage.setItem('md_sidebar_collapsed',document.body.classList.contains('sidebar-collapsed')?'1':'0')}catch{}}});try{if(localStorage.getItem('md_sidebar_collapsed')==='1')document.body.classList.add('sidebar-collapsed')}catch{}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-open-control]');if(!b)return;const id=b.dataset.openControl;if(id==='shell-home')goHome();else hit(id);drawer(false)});$('#global-search-trigger')?.addEventListener('click',search);$('#sidebar-settings')?.addEventListener('click',()=>drawer(false));$('#mobile-nav-more')?.addEventListener('click',()=>drawer(true));$('#sidebar-scrim')?.addEventListener('click',()=>drawer(false));document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();search()}if(e.key==='Escape')drawer(false)});const o=new MutationObserver(sync);$$('.screen').forEach(x=>o.observe(x,{attributes:true,attributeFilter:['class']}));addEventListener('resize',()=>{if(innerWidth>=900)drawer(false)});addEventListener('storage',dashboardStats);setTimeout(sync,0);setTimeout(sync,350);setTimeout(sync,750)}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();})();
