import { parseProfiles, serializeProfiles, type Profile } from "./core/profile";

/** Profiles live only in this browser (no backend, no telemetry). Storage can be blocked, so every access is guarded. */
const KEY = "earguard.profiles.v1";

export function loadProfiles(): Profile[] {
  try {
    return parseProfiles(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveProfile(p: Profile): boolean {
  try {
    const all = loadProfiles().filter((x) => x.id !== p.id);
    all.push(p);
    localStorage.setItem(KEY, serializeProfiles(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteProfile(id: string): void {
  try {
    localStorage.setItem(KEY, serializeProfiles(loadProfiles().filter((x) => x.id !== id)));
  } catch {
    /* storage unavailable */
  }
}
