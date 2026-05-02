import React from 'react';
import { ExtensionSignUpResult } from '../hooks/useExtensionAuth';
import { ArrowLeft, Check } from 'lucide-react';

export type SignUpPlan = 'free' | 'paid';

interface LoginScreenProps {
    onBack: () => void;
    onSignIn: (email: string, password: string) => Promise<void>;
    onSignUp: (email: string, password: string, plan: SignUpPlan) => Promise<ExtensionSignUpResult>;
    initialError?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
    onBack,
    onSignIn,
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

            <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
                <p className="screen-copy">
                    {mode === 'sign-in'
                        ? 'Sync plan status, backups, and device access.'
                        : 'Start free, or create an account and continue to Pro checkout.'}
                </p>

                <label className="text-xs text-secondary">Email</label>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field" placeholder="you@example.com" required />

                <label className="text-xs text-secondary">Password</label>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="field" placeholder="At least 6 characters" minLength={6} required />

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
