// Anchor-click download (R6): web → content-disposition:attachment from the server; APK →
// WebView onDownloadStart → DownloadManager (MainActivity). No blobs anywhere.
import { Capacitor } from "@capacitor/core";
import { downloadUrl } from "./media-paths";
import { toast } from "./toast";

export function downloadFile(path: string, name: string): void {
  const a = document.createElement("a");
  a.href = downloadUrl(path);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!Capacitor.isNativePlatform()) toast(`Downloading ${name}…`);
}
