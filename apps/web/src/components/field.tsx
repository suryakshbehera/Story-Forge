import { Label } from "@/components/ui/label";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {hint}
      </Label>
      {children}
    </div>
  );
}
