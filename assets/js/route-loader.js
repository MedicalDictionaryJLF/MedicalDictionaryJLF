import { resolveAppModuleUrl, resolveAppShellUrl } from "./core/app-paths.js?v=27";

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

  document.body.replaceChildren(document.importNode(appShell, true));

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
