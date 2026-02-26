import { useState, useEffect } from 'react';

export function useVersion() {
    const [version, setVersion] = useState<string>('1.0.0');

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
            const manifest = chrome.runtime.getManifest();
            if (manifest?.version) {
                setVersion(manifest.version);
            }
        }
    }, []);

    return version;
}
