import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_DOWNLOAD_URL } from "@/lib/app-download";

export function DownloadAppButton({ label = "Download the app" }: { label?: string }) {
  return (
    <Button
      variant="outline"
      render={<a href={APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />}
    >
      <Download className="size-4" />
      {label}
    </Button>
  );
}
