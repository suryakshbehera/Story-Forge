import { Suspense } from "react";
import { SignupForm } from "@/components/signup-form";

export default function SignupPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 pt-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Requires an admin code or an invite link to join.
        </p>
      </div>
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  );
}
