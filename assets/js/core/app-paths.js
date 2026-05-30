export const SCREEN_ROUTE_MAP = {
  "screen-menu": "menu",
  "screen-feedback": "feedback",
  "screen-submenu": "main",
  "screen-search": "search",
  "screen-lab-parameters": "lab-parameters",
  "screen-pharmacology": "pharmacology",
  "screen-entry": "entry",
  "screen-courses": "courses",
  "screen-quiz": "quiz",
  "screen-flashcards": "flashcards",
  "screen-biophysics-tf": "biophysics",
  "screen-muscle-training": "muscles",
  "screen-latin-terminology": "latin-terminology",
  "screen-anamnesis": "anamnesis"
};

export const ROUTE_SCREEN_MAP = Object.fromEntries(
  Object.entries(SCREEN_ROUTE_MAP).map(([screenId, route]) => [route, screenId])
);

export const SECTION_ROUTE_KEYS = new Set([
  "main",
  "anamnesis",
  "muscles",
  "quiz",
  "flashcards",
  "menu",
  "feedback",
  "search",
  "lab-parameters",
  "pharmacology",
  "entry",
  "courses",
  "biophysics",
  "latin-terminology"
]);

export function normalizeRoutePath(value) {
  const text = String(value || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  return text || "menu";
}

export function currentSection(pathname = window.location.pathname) {
  const path = String(pathname || "").replace(/\/+$/g, "");
  if (!path) return "root";
  const parts = path.split("/").filter(Boolean);
  let lastPart = parts.pop() || "";
  if (String(lastPart).toLowerCase() === "index.html") {
    lastPart = parts.pop() || "";
    if (!lastPart) return "root";
  }
  const last = normalizeRoutePath(lastPart);
  if (SECTION_ROUTE_KEYS.has(last)) return last;
  return "root";
}

export function getRouteForScreen(screenId) {
  return SCREEN_ROUTE_MAP[String(screenId || "").trim()] || "menu";
}

export function getScreenForRoute(route) {
  return ROUTE_SCREEN_MAP[normalizeRoutePath(route)] || "screen-menu";
}

export function getAppBasePath(pathname = window.location.pathname) {
  const formatBasePath = (baseParts) => {
    const joined = (baseParts || []).filter(Boolean).join("/");
    return joined ? `/${joined}/` : "/";
  };

  const path = String(pathname || "").replace(/\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "/";

  const lastPart = String(parts[parts.length - 1] || "").toLowerCase();
  const prevPart = String(parts[parts.length - 2] || "").toLowerCase();

  if (lastPart === "index.html") {
    if (SECTION_ROUTE_KEYS.has(prevPart)) {
      return formatBasePath(parts.slice(0, -2));
    }
    return formatBasePath(parts.slice(0, -1));
  }

  if (SECTION_ROUTE_KEYS.has(lastPart)) {
    return formatBasePath(parts.slice(0, -1));
  }

  return formatBasePath(parts);
}

export function buildAppPathForRoute(
  route,
  { pathname = window.location.pathname, search = window.location.search } = {}
) {
  const normalized = normalizeRoutePath(route);
  const params = new URLSearchParams(search);
  params.delete("page");
  const query = params.toString();
  return `${getAppBasePath(pathname)}${normalized}/${query ? `?${query}` : ""}`;
}

export function getRouteFromLocation({
  pathname = window.location.pathname,
  search = window.location.search,
  hash = window.location.hash
} = {}) {
  const path = String(pathname || "").replace(/\/+$/g, "");
  if (path) {
    const parts = path.split("/").filter(Boolean);
    let lastPart = parts.pop() || "";
    if (String(lastPart).toLowerCase() === "index.html") {
      lastPart = parts.pop() || "";
      if (!lastPart) lastPart = "";
    }
    const lastPathSegment = lastPart ? normalizeRoutePath(lastPart) : "";
    if (lastPathSegment && ROUTE_SCREEN_MAP[lastPathSegment]) {
      return lastPathSegment;
    }
  }

  const rawPageParam = new URLSearchParams(search).get("page");
  const pageParam = rawPageParam ? normalizeRoutePath(rawPageParam) : "";
  if (ROUTE_SCREEN_MAP[pageParam]) {
    return pageParam;
  }

  const hashValue = decodeURIComponent(String(hash || "").replace(/^#/, ""));
  if (hashValue && document.getElementById(hashValue)) {
    return getRouteForScreen(hashValue);
  }

  return "";
}

export function resolveBundledDataUrl(path) {
  const normalized = String(path || "").replace(/^\/+/, "").replace(/^data\//, "");
  return new URL(`../../../data/${normalized}`, import.meta.url).href;
}

export function resolveAppShellUrl() {
  return new URL("../../../index.html", import.meta.url).href;
}

export function resolveAppModuleUrl() {
  return new URL("../app.js?v=25", import.meta.url).href;
}
