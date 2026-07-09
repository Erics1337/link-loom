import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { LoginForm } from "./LoginForm";

function LoginFallback() {
  return (
    <div className="flex min-h-[24rem] items-center justify-center">
      <Loader2
        className="h-8 w-8 animate-spin text-ll-accent"
        aria-label="Loading login form"
      />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="ll-field-bg ll-map-grid flex min-h-screen flex-1 flex-col justify-center px-6 py-12 lg:px-8">
      <Suspense fallback={<LoginFallback />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
