import React from 'react';

interface LayoutProps {
    children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
    return (
        <div className="h-full flex flex-col bg-background text-text-primary">
            <main className="flex-1 overflow-hidden relative">
                {children}
            </main>
        </div>
    );
};

