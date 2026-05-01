import React from 'react';
import { ExtensionSignUpResult } from '../hooks/useExtensionAuth';

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
        <div className="flex flex-col h-full p-4 gap-4">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold">{mode === 'sign-in' ? 'Log In' : 'Create Account'}</h1>
                <button onClick={onBack} className="btn btn-secondary">Back</button>
            </div>

            <div className="card">
                <div className="flex gap-2">
                    <button
                        onClick={() => setMode('sign-in')}
                        className={`btn flex-1 ${mode === 'sign-in' ? 'btn-primary' : 'btn-secondary'}`}
                        type="button"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => setMode('sign-up')}
                        className={`btn flex-1 ${mode === 'sign-up' ? 'btn-primary' : 'btn-secondary'}`}
                        type="button"
                    >
                        Sign Up
                    </button>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
                <p className="text-xs text-secondary">
                    {mode === 'sign-in'
                        ? 'Sign in to manage backups and sync your account plan.'
                        : 'Create a free account (up to 500 bookmarks) or upgrade to Pro.'}
                </p>

                <label className="text-xs text-secondary">Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="btn"
                    placeholder="you@example.com"
                    required
                />

                <label className="text-xs text-secondary">Password</label>
                <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="btn"
                    placeholder="At least 6 characters"
                    minLength={6}
                    required
                />

                {mode === 'sign-up' && (
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-secondary mb-1">Choose a plan</label>
                        <div
                            onClick={() => setPlan('free')}
                            className="flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors"
                            style={{
                                borderColor: plan === 'free' ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                                backgroundColor: plan === 'free' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.02)'
                            }}
                        >
                            <input type="radio" checked={plan === 'free'} readOnly className="cursor-pointer" />
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Free Plan</span>
                                <span className="text-xs text-secondary">Up to 500 bookmarks</span>
                            </div>
                        </div>
                        <div
                            onClick={() => setPlan('paid')}
                            className="flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors"
                            style={{
                                borderColor: plan === 'paid' ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                                backgroundColor: plan === 'paid' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.02)'
                            }}
                        >
                            <input type="radio" checked={plan === 'paid'} readOnly className="cursor-pointer" />
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Pro Lifetime</span>
                                <span className="text-xs text-secondary">Unlimited bookmarks and Pro tools</span>
                            </div>
                        </div>
                    </div>
                )}

                {message && <p className="text-xs text-secondary">{message}</p>}

                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting
                        ? 'Please wait...'
                        : mode === 'sign-in'
                            ? 'Sign In'
                            : plan === 'paid'
                                ? 'Create Account & Start Pro Checkout'
                                : 'Create Free Account'}
                </button>
            </form>
        </div>
    );
};
