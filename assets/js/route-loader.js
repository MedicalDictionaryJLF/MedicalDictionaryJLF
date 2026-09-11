import {
  currentSection,
  getScreenForRoute,
  resolveAppModuleUrl,
  resolveAppShellUrl
} from "./core/app-paths.js?v=61";

async function bootstrapRoutedPage(){
  const indexUrl = resolveAppShellUrl();
  const res = await fetch(indexUrl);
  if(!res.ok){
    throw new Error(`Failed to load app shell: ${res.status}`);
  }

  const html = await res.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const appShell = parsed.querySelector("#app");
  if(!appShell){
    throw new Error("App shell markup was not found in index.html.");
  }

  if(parsed.title) document.title = parsed.title;

  // Route pages must never paint the login/menu screen first. Select the route
  // in the detached shell before it reaches the live document.
  const route = currentSection(window.location.pathname);
  const targetScreenId = getScreenForRoute(route);
  appShell.querySelectorAll('.screen').forEach((screen)=>{
    const active = screen.id === targetScreenId;
    screen.classList.toggle('hidden', !active);
    screen.classList.toggle('is-active', active);
    screen.classList.remove('is-exiting');
    screen.setAttribute('aria-hidden', active ? 'false' : 'true');
  });

  // Relative image URLs inside fetched index.html otherwise resolve against
  // /lab-parameters/, /quiz/, etc. Rebase them to the real shell URL.
  appShell.querySelectorAll('[src]').forEach((el)=>{
    const src = String(el.getAttribute('src') || '').trim();
    if(!src || /^(?:[a-z]+:|\/\/|data:|blob:)/i.test(src)) return;
    try{ el.setAttribute('src', new URL(src, indexUrl).href); }catch{}
  });

  document.body.classList.toggle('app-workspace-active', targetScreenId !== 'screen-menu');
  document.body.dataset.currentScreen = targetScreenId;
  document.body.replaceChildren(document.importNode(appShell, true));

  const shellScript = document.createElement("script");
  shellScript.src = new URL("./app-shell.js?v=51", import.meta.url).href;
  document.body.appendChild(shellScript);

  const script = document.createElement("script");
  script.type = "module";
  script.src = resolveAppModuleUrl();
  document.body.appendChild(script);
}

bootstrapRoutedPage().catch((error)=>{
  console.error("Route bootstrap failed:", error);
  document.body.innerHTML = `
    <main style="padding:24px;font-family:system-ui,sans-serif">
      <h1 style="margin:0 0 12px 0">Medical Dictionary</h1>
      <p style="margin:0">The route page could not load the app shell.</p>
    </main>
  `;
});
