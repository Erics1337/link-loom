import React from 'react';

export const PopOutButton: React.FC = () => {
    const handlePopOut = async () => {
        if (typeof chrome !== 'undefined' && chrome.windows) {
            try {
                const url = chrome.runtime.getURL('popup.html');
                
                await chrome.windows.create({
                    url: url,
                    type: 'popup',
                    width: 400,
                    height: 600
                });
            } catch (err) {
                console.error("Failed to pop out window", err);
            }
        } else {
            console.log("Mock pop-out triggered");
            window.open(window.location.href, '_blank', 'width=400,height=600');
        }
    };

    return (
        <button 
            onClick={handlePopOut}
            className="btn-icon"
            title="Pop out into new window"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
        </button>
    );
};
