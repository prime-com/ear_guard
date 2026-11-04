declare const __BUILD__: string;

/** Shows which build is running, so a stale cached page is easy to spot. */
export function showBuild(): void {
  const el = document.getElementById("build");
  if (el) el.textContent = `Build ${__BUILD__}`;
}
