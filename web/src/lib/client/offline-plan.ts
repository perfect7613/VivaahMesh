import type { View } from "@/components/flows/types";

const key = "vm_offline_plan_v1";
export const offlineViewerKey = "vm_offline_viewer";
const lifetime = 24 * 60 * 60 * 1000;

interface ScheduleItem {
  title: string;
  time: string;
}

export interface OfflinePlan {
  savedAt: number;
  viewer: string;
  weddingId: string;
  title: string;
  schedule: ScheduleItem[];
}

export function saveOfflinePlan(view: View, schedule?: ScheduleItem[]) {
  try {
    const viewer = sessionStorage.getItem(offlineViewerKey);
    if (!viewer || localStorage.getItem(offlineViewerKey) !== viewer) return;
    const previous = readOfflinePlan();
    const snapshot: OfflinePlan = {
      savedAt: Date.now(),
      viewer,
      weddingId: view.wedding.id,
      title: `${view.wedding.partnerA} & ${view.wedding.partnerB}`,
      schedule: schedule ?? (previous?.weddingId === view.wedding.id ? previous.schedule : []),
    };
    if (snapshot.schedule.length === 0) {
      snapshot.schedule = view.functions.map((item) => ({
        title: item.title,
        time: [item.on_date, item.starts_at?.slice(0, 5)].filter(Boolean).join(" · "),
      }));
    }
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch { /* offline storage is optional on restricted browsers */ }
}

export function setOfflineViewer(id: number | null) {
  try {
    const viewer = id === null ? null : String(id);
    if (viewer === null || localStorage.getItem(offlineViewerKey) !== viewer) clearOfflinePlan();
    if (viewer === null) {
      localStorage.removeItem(offlineViewerKey);
      sessionStorage.removeItem(offlineViewerKey);
    } else {
      localStorage.setItem(offlineViewerKey, viewer);
      sessionStorage.setItem(offlineViewerKey, viewer);
    }
  } catch { /* storage can be disabled */ }
}

export function clearOfflinePlan() {
  try { localStorage.removeItem(key); } catch { /* storage can be disabled */ }
}

export function readOfflinePlan(weddingId?: string | null): OfflinePlan | null {
  try {
    const plan = JSON.parse(localStorage.getItem(key) ?? "null") as OfflinePlan | null;
    const age = plan ? Date.now() - plan.savedAt : Infinity;
    if (!plan || !Number.isFinite(age) || age < 0 || age >= lifetime || !plan.viewer || plan.viewer !== localStorage.getItem(offlineViewerKey) ||
      typeof plan.title !== "string" || !Array.isArray(plan.schedule)) {
      clearOfflinePlan();
      return null;
    }
    if (weddingId && plan.weddingId !== weddingId) return null;
    return plan;
  } catch { /* malformed saved data is ignored */ }
  return null;
}
