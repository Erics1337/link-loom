import React from 'react';
import { ExtensionSignUpResult } from '../hooks/useExtensionAuth';
import { ArrowLeft, Check } from 'lucide-react';

export type SignUpPlan = 'free' | 'paid';

interface LoginScreenProps {
    onBack: () => void;
    onSignIn: (email: string, password: string) => Promise<void>;
    onSignInWithGoogle: () => Promise<void>;
    onSignUp: (email: string, password: string, plan: SignUpPlan) => Promise<ExtensionSignUpResult>;
    initialError?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
    onBack,
    onSignIn,
    onSignInWithGoogle,
    onSignUp,
    initialError
}) => {
    const [mode, setMode] = React.useState<'sign-in' | 'sign-up'>('sign-in');
    const [plan, setPlan] = React.useState<SignUpPlan>('free');
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [message, setMessage] = React.useState<string | null>(initialError || null);

    React.useEffect(() => {
        if (initialError) setMessage(initialError);
    }, [initialError]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setMessage(null);
        setIsSubmitting(true);

        try {
            if (mode === 'sign-in') {
                await onSignIn(email.trim(), password);
                return;
            }

            const result = await onSignUp(email.trim(), password, plan);
            if (result.requiresEmailConfirmation) {
                setMessage('Check your email to confirm your account, then sign in.');
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Authentication failed.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="app-shell">
            <div className="app-header">
                <button onClick={onBack} className="btn-icon" title="Back">
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1">
                    <p className="eyebrow">{mode === 'sign-in' ? 'Welcome back' : 'New workspace'}</p>
                    <h1 className="screen-title">{mode === 'sign-in' ? 'Log In' : 'Create Account'}</h1>
                </div>
            </div>

            <div className="card">
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button onClick={() => setMode('sign-in')} className={`btn ${mode === 'sign-in' ? 'btn-primary' : 'btn-secondary'}`} type="button">
                        Sign In
                    </button>
                    <button onClick={() => setMode('sign-up')} className={`btn ${mode === 'sign-up' ? 'btn-primary' : 'btn-secondary'}`} type="button">
                        Sign Up
                    </button>
                </div>
            </div>

            {mode === 'sign-in' && (
                <div className="card flex flex-col gap-3">
                    <button
                        type="button"
                        onClick={async () => {
                            setMessage(null);
                            setIsSubmitting(true);
                            try {
                                await onSignInWithGoogle();
                            } catch (error) {
                                setMessage(error instanceof Error ? error.message : 'Google sign in failed.');
                            } finally {
                                setIsSubmitting(false);
                            }
                        }}
                        disabled={isSubmitting}
                        className="btn btn-secondary w-full flex items-center justify-center gap-3"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                fill="#4285F4"
                            />
                            <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                            />
                            <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                            />
                            <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                            />
                        </svg>
                        Continue with Google
                    </button>

                    <div className="relative text-center">
                        <span className="text-xs text-secondary bg-[var(--surface-color)] px-2 relative z-10">or use email</span>
                        <div className="absolute inset-x-0 top-1/2 border-t border-[var(--border-color)]" aria-hidden="true" />
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
                <p className="screen-copy">
                    {mode === 'sign-in'
                        ? 'Sync plan status, Cloud Snapshots, and device access.'
                        : 'Start free, or create an account and continue to Pro checkout.'}
                </p>

                <label className="text-xs text-secondary">Email</label>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field" placeholder="you@example.com" required />

                <label className="text-xs text-secondary">Password</label>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="field" placeholder="At least 8 characters" {...(mode === 'sign-up' ? { minLength: 8 } : {})} required />

                {mode === 'sign-up' && (
                    <div className="space-y-2">
                        <label className="text-xs text-secondary">Choose a plan</label>
                        {[
                            { id: 'free' as const, title: 'Free Plan', copy: 'Up to 500 bookmarks' },
                            { id: 'paid' as const, title: 'Pro Lifetime', copy: 'Unlimited bookmarks and Pro tools' },
                        ].map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setPlan(item.id)}
                                className="w-full flex items-center gap-3 p-3 rounded-md border cursor-pointer text-left"
                                style={{
                                    borderColor: plan === item.id ? 'var(--accent-color)' : 'var(--border-color)',
                                    background: plan === item.id ? 'color-mix(in oklab, var(--accent-color) 12%, transparent)' : 'transparent',
                                }}
                            >
                                <span className="badge">{plan === item.id ? <Check size={12} /> : null}</span>
                                <span className="flex flex-col">
                                    <span className="text-sm font-bold text-primary">{item.title}</span>
                                    <span className="text-xs text-secondary">{item.copy}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {message && <div className="message">{message}</div>}

                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting
                        ? 'Please wait...'
                        : mode === 'sign-in'
                            ? 'Sign In'
                            : plan === 'paid'
                                ? 'Create Account & Checkout'
                                : 'Create Free Account'}
                </button>
            </form>
        </div>
    );
};
